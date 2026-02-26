import { generateWindowId } from "../shared/utils.js";
import type {
  WindowPoolConfig,
  InjectStylesMode,
  TitleBarStyle,
  VibrancyType,
} from "../shared/types.js";
import { waitForWindowReady, initWindowDocument } from "./windowUtils.js";

/**
 * The immutable creation-only props that define a pool's window shape.
 * All windows in the pool share these — consumers can't override them.
 */
export interface PoolShape {
  transparent?: boolean;
  frame?: boolean;
  titleBarStyle?: TitleBarStyle;
  vibrancy?: VibrancyType;
}

interface PoolEntry {
  id: string;
  childWindow: globalThis.Window;
  portalTarget: HTMLElement;
  styleCleanup: () => void;
}

export interface RendererWindowPoolOptions {
  shape: PoolShape;
  config?: WindowPoolConfig;
  debug?: boolean;
  injectStyles?: InjectStylesMode;
  // Injected by PooledWindow from WindowProviderContext
  registerWindow: (
    id: string,
    props: Record<string, unknown>,
  ) => Promise<boolean>;
  unregisterWindow: (id: string) => Promise<void>;
  windowAction: (id: string, action: { type: string }) => Promise<void>;
}

/**
 * Renderer-side window pool.
 *
 * Pre-warms hidden windows via window.open() so acquisition is instant.
 * On acquire: pulls from idle queue (or creates on the fly) and shows the window.
 * On release: hides the window and returns it to the idle queue for reuse.
 *
 * This gives sub-frame show/hide performance for frequently-toggled windows
 * like overlays, menus, and HUDs — the BrowserWindow already exists and is
 * just being shown/hidden rather than created/destroyed.
 */
export class RendererWindowPool {
  readonly shape: PoolShape;
  private readonly minIdle: number;
  private readonly maxIdle: number;
  private readonly idleTimeoutMs: number;

  private readonly idle: PoolEntry[] = [];
  private readonly active: Map<string, PoolEntry> = new Map();
  private readonly idleTimers: Map<string, ReturnType<typeof setTimeout>> =
    new Map();

  private registerWindow: RendererWindowPoolOptions["registerWindow"];
  private unregisterWindow: RendererWindowPoolOptions["unregisterWindow"];
  private windowAction: RendererWindowPoolOptions["windowAction"];
  private readonly debug: boolean;
  private readonly injectStyles: InjectStylesMode;

  private isDestroyed = false;
  private inFlight = 0;

  constructor(options: RendererWindowPoolOptions) {
    this.shape = options.shape;
    this.minIdle = options.config?.minIdle ?? 1;
    this.maxIdle = options.config?.maxIdle ?? 3;
    this.idleTimeoutMs = options.config?.idleTimeout ?? 30000;
    this.registerWindow = options.registerWindow;
    this.unregisterWindow = options.unregisterWindow;
    this.windowAction = options.windowAction;
    this.debug = options.debug ?? false;
    this.injectStyles = options.injectStyles ?? "auto";
  }

  /**
   * Update the provider method references. The pool is cached in a WeakMap and
   * outlives individual component mounts, so if WindowProvider remounts (HMR,
   * test teardown), the pool needs fresh provider refs.
   */
  rebind(options: {
    registerWindow: RendererWindowPoolOptions["registerWindow"];
    unregisterWindow: RendererWindowPoolOptions["unregisterWindow"];
    windowAction: RendererWindowPoolOptions["windowAction"];
  }): void {
    this.registerWindow = options.registerWindow;
    this.unregisterWindow = options.unregisterWindow;
    this.windowAction = options.windowAction;
  }

  private debugLog(msg: string, id?: string): void {
    if (!this.debug) return;
    const idStr = id ? ` (id=${id})` : "";
    const inFlightStr = this.inFlight > 0 ? ` inFlight=${this.inFlight}` : "";
    console.log(
      `[electron-window] Pool: ${msg}${idStr} idle=${this.idle.length}/${this.maxIdle} active=${this.active.size}${inFlightStr}`,
    );
  }

  /**
   * Pre-warm the pool to minIdle. Call after construction.
   * Fire-and-forget: doesn't block first render.
   */
  async warmUp(): Promise<void> {
    this.debugLog(`warming up (minIdle=${this.minIdle})`);
    const needed = this.minIdle - this.idle.length;
    const promises: Promise<void>[] = [];
    for (let i = 0; i < needed; i++) {
      promises.push(this.createIdleWindow());
    }
    await Promise.all(promises);
  }

  /**
   * Open a hidden window and park it in the idle queue.
   */
  private async createIdleWindow(): Promise<void> {
    if (this.isDestroyed) return;

    this.inFlight++;
    try {
      const id = generateWindowId();

      // showOnCreate: false keeps the BrowserWindow hidden until we explicitly show it.
      // closable: false prevents the main process from destroying the window when the
      // user clicks X — the renderer handles close by releasing back to the pool.
      const ok = await this.registerWindow(id, {
        ...this.shape,
        showOnCreate: false,
        hideOnClose: true,
      });
      if (!ok) return;

      if (this.isDestroyed) return;

      const childWindow = window.open("about:blank", id, "");
      if (!childWindow) return;

      try {
        await waitForWindowReady(childWindow, () => this.isDestroyed);
      } catch {
        childWindow.close();
        return;
      }

      if (this.isDestroyed) {
        childWindow.close();
        return;
      }

      const { container: portalTarget, cleanup: styleCleanup } =
        initWindowDocument(childWindow.document, {
          injectStyles: this.injectStyles,
        });
      const entry: PoolEntry = { id, childWindow, portalTarget, styleCleanup };
      this.idle.push(entry);
      this.debugLog("idle window ready", id);

      // Handle external destruction (e.g., main process shutdown or DestroyWindow IPC).
      // Note: 'unload' can also fire on hide() in some Electron versions — only
      // treat it as destruction if the window is actually closed.
      childWindow.addEventListener("unload", () => {
        if (childWindow.closed) {
          styleCleanup();
          this.debugLog("window destroyed externally", id);
          this.handleWindowDestroyed(id);
        }
      });
    } finally {
      this.inFlight--;
    }
  }

  /**
   * Acquire a window from the pool. Returns immediately when idle windows exist.
   * Falls through to on-demand creation if the idle queue is empty.
   */
  async acquire(): Promise<PoolEntry> {
    if (this.isDestroyed) throw new Error("Pool has been destroyed");

    const entry = this.idle.shift();
    if (entry) {
      const timer = this.idleTimers.get(entry.id);
      if (timer) {
        clearTimeout(timer);
        this.idleTimers.delete(entry.id);
      }

      this.active.set(entry.id, entry);
      this.debugLog("acquired from idle", entry.id);

      // Replenish below minIdle in the background, but only if there's room
      // in the pool. Without this check, replenishment fills idle back to
      // minIdle, and when the active window is released, idle is already at
      // maxIdle — causing the released window to be destroyed instead of recycled.
      // inFlight counts windows currently being created so we don't over-create
      // during concurrent acquires.
      if (
        this.idle.length + this.inFlight < this.minIdle &&
        this.idle.length + this.inFlight + this.active.size < this.maxIdle
      ) {
        this.debugLog("replenishing");
        void this.createIdleWindow();
      }

      return entry;
    }

    // Pool exhausted — create on the fly (slower path)
    this.debugLog("exhausted, creating on-the-fly");
    const id = generateWindowId();
    const ok = await this.registerWindow(id, {
      ...this.shape,
      showOnCreate: false,
      hideOnClose: true,
    });
    if (!ok) throw new Error("RegisterWindow rejected by main process");

    const childWindow = window.open("about:blank", id, "");
    if (!childWindow) throw new Error("window.open returned null");

    try {
      await waitForWindowReady(childWindow);
    } catch {
      throw new Error("Timed out waiting for pool window to be ready");
    }

    const { container: portalTarget, cleanup: styleCleanup } =
      initWindowDocument(childWindow.document, {
        injectStyles: this.injectStyles,
      });
    const newEntry: PoolEntry = { id, childWindow, portalTarget, styleCleanup };
    this.active.set(id, newEntry);

    // Handle external destruction for on-the-fly windows too
    childWindow.addEventListener("unload", () => {
      if (childWindow.closed) {
        styleCleanup();
        this.handleWindowDestroyed(id);
      }
    });

    return newEntry;
  }

  /**
   * Release a window back to the pool. Hides it via IPC but keeps the
   * BrowserWindow alive for the next acquire.
   */
  async release(id: string): Promise<void> {
    const entry = this.active.get(id);
    if (!entry) return;

    this.active.delete(id);

    // Hide first, then clean DOM. The hide gives React time to unmount
    // the portal content before we clear the container.
    try {
      await this.windowAction(id, { type: "hide" });
    } catch {
      // Main process may be gone during shutdown — fall through to DOM cleanup
    }

    // Clean the DOM to prevent data leakage between pool window uses.
    // React unmounts portal content, but imperative DOM changes, global
    // variables, and timers from the previous use could persist.
    const doc = entry.childWindow.document;
    const container = doc.getElementById("root");
    if (container) {
      container.innerHTML = "";
    }

    // Always recycle the released window. If idle is at capacity (e.g., due to
    // a concurrent-acquire race creating an extra replenishment window), evict
    // the oldest idle window to make room. The released window is preferred
    // because it was just in active use (warm, validated).
    if (this.idle.length >= this.maxIdle) {
      const evicted = this.idle.shift();
      if (evicted) {
        this.debugLog("evicting oldest idle to make room", evicted.id);
        evicted.styleCleanup();
        evicted.childWindow.close();
        void this.unregisterWindow(evicted.id);
        const timer = this.idleTimers.get(evicted.id);
        if (timer) {
          clearTimeout(timer);
          this.idleTimers.delete(evicted.id);
        }
      }
    }

    this.idle.push(entry);
    this.debugLog("released to idle", id);

    if (this.idle.length > this.minIdle && this.idleTimeoutMs > 0) {
      const timer = setTimeout(() => {
        this.evictIdle(id);
      }, this.idleTimeoutMs);
      this.idleTimers.set(id, timer);
    }
  }

  private evictIdle(id: string): void {
    // Guard: don't drop below the minimum floor
    if (this.idle.length <= this.minIdle) {
      this.idleTimers.delete(id);
      return;
    }

    const index = this.idle.findIndex((e) => e.id === id);
    if (index !== -1) {
      const [entry] = this.idle.splice(index, 1);
      if (entry) {
        entry.styleCleanup();
        entry.childWindow.close();
        void this.unregisterWindow(id);
      }
    }
    this.idleTimers.delete(id);
  }

  /**
   * Destroy the pool and all windows (both idle and active).
   */
  destroy(): void {
    this.isDestroyed = true;

    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();

    for (const entry of this.idle) {
      entry.styleCleanup();
      entry.childWindow.close();
      void this.unregisterWindow(entry.id);
    }
    this.idle.length = 0;

    for (const entry of this.active.values()) {
      entry.styleCleanup();
      entry.childWindow.close();
      void this.unregisterWindow(entry.id);
    }
    this.active.clear();
  }

  getIdleCount(): number {
    return this.idle.length;
  }

  getActiveCount(): number {
    return this.active.size;
  }

  getInFlightCount(): number {
    return this.inFlight;
  }

  /**
   * Remove a window from pool tracking when it's destroyed externally.
   *
   * Called from:
   * - The pool's own unload listener (when childWindow.close() fires unload)
   * - PooledWindow's onWindowClosedSetState (when main process destroy()s the
   *   window directly, which does NOT fire unload — so the pool's listener
   *   never runs and the entry would leak in the active map otherwise)
   */
  notifyDestroyed(id: string): void {
    this.handleWindowDestroyed(id);
  }

  private handleWindowDestroyed(id: string): void {
    const idleIndex = this.idle.findIndex((e) => e.id === id);
    if (idleIndex !== -1) {
      this.idle.splice(idleIndex, 1);
      const timer = this.idleTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        this.idleTimers.delete(id);
      }
    }
    this.active.delete(id);
  }
}
