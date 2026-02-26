import { BrowserWindow, screen, type WebContents } from "electron";
import { validateBoundsOnScreen } from "./persistence.js";
import type { WindowId, WindowState } from "../shared/types.js";
import { RENDERER_ALLOWED_PROPS } from "../shared/types.js";
import { devWarning, isMac, isWindows } from "../shared/utils.js";
import { WindowInstance } from "./WindowInstance.js";
import {
  WindowManager as WindowManagerIPC,
  type IWindowManagerImpl,
  type WindowProps as IPCWindowProps,
  type WindowAction as IPCWindowAction,
  type WindowEvent as IPCWindowEvent,
  WindowEventType,
} from "../generated-ipc/browser/electron_window.js";

const DEFAULT_WINDOW_WIDTH = 800;
const DEFAULT_WINDOW_HEIGHT = 600;

type Dispatcher = { dispatchWindowEvent: (e: IPCWindowEvent) => void };

/** Maps WebContents to their IPC event dispatchers */
const dispatchers = new WeakMap<WebContents, Dispatcher>();

/**
 * Result returned by a window open handler.
 * Matches Electron's setWindowOpenHandler return type.
 */
export type WindowOpenHandlerResult =
  | { action: "deny" }
  | {
      action: "allow";
      overrideBrowserWindowOptions?: Partial<Electron.BrowserWindowConstructorOptions>;
    };

/**
 * Options for setupForWindow / setupForWebContents.
 */
export interface SetupOptions {
  /**
   * Called for window.open() calls that aren't managed by this library.
   * If not provided, unmanaged window.open() calls are denied.
   */
  fallbackWindowOpenHandler?: (
    details: Electron.HandlerDetails,
  ) => WindowOpenHandlerResult;
}

/**
 * Filter props to only include allowed properties.
 * Provides a runtime security boundary against renderer-supplied dangerous options.
 */
function filterAllowedProps(
  props: IPCWindowProps,
  devWarnings: boolean,
): IPCWindowProps {
  const filtered: Record<string, unknown> = {};
  const rejected: string[] = [];

  for (const [key, value] of Object.entries(props)) {
    if (RENDERER_ALLOWED_PROPS.has(key)) {
      filtered[key] = value;
    } else {
      rejected.push(key);
    }
  }

  if (rejected.length > 0 && devWarnings) {
    devWarning(
      `Props not allowed from renderer and were ignored: ${rejected.join(", ")}. ` +
        "Only props in RENDERER_ALLOWED_PROPS are accepted for security reasons.",
    );
  }

  return filtered as IPCWindowProps;
}

export interface WindowManagerConfig {
  /** Default options applied to all windows. Can be a function for dynamic values (e.g., theme-aware backgroundColor). */
  defaultWindowOptions?:
    | Partial<Electron.BrowserWindowConstructorOptions>
    | (() => Partial<Electron.BrowserWindowConstructorOptions>);

  /** Enable development warnings */
  devWarnings?: boolean;

  /** Maximum pending window registrations. Default: 100. */
  maxPendingWindows?: number;

  /** Maximum active windows. Default: 50. */
  maxWindows?: number;

  /** Log all IPC calls and events to the console. Default: false. */
  debug?: boolean;
}

interface ResolvedConfig {
  defaultWindowOptions:
    | Partial<Electron.BrowserWindowConstructorOptions>
    | (() => Partial<Electron.BrowserWindowConstructorOptions>);
  devWarnings: boolean;
  maxPendingWindows: number;
  maxWindows: number;
  debug: boolean;
}

/**
 * Main process window manager.
 * Renderer calls RegisterWindow(id, props) + window.open(url, id), then this class
 * intercepts the new window via setWindowOpenHandler / did-create-window and wraps it.
 *
 * Origin and frame validation (main-frame-only enforcement) is handled by the
 * EIPC-generated `AppOrigin` validator in the schema — it runs before these handlers
 * and rejects calls from iframes or unexpected origins at the IPC layer.
 */
export class WindowManager {
  private readonly windows: Map<WindowId, WindowInstance> = new Map();
  private readonly pendingWindows: Map<
    WindowId,
    { props: IPCWindowProps; createdAt: number }
  > = new Map();
  private readonly config: ResolvedConfig;

  constructor(config: WindowManagerConfig = {}) {
    this.config = {
      defaultWindowOptions: config.defaultWindowOptions ?? (() => ({})),
      devWarnings: config.devWarnings ?? process.env.NODE_ENV === "development",
      maxPendingWindows: config.maxPendingWindows ?? 100,
      maxWindows: config.maxWindows ?? 50,
      debug: config.debug ?? false,
    };
  }

  private debugLog(
    direction: "←" | "→",
    method: string,
    id: string,
    data?: unknown,
  ): void {
    if (!this.config.debug) return;
    const payload = data ? ` ${JSON.stringify(data)}` : "";
    console.log(`[electron-window] ${direction} ${method} "${id}"${payload}`);
  }

  private getDefaultWindowOptions(): Partial<Electron.BrowserWindowConstructorOptions> {
    return typeof this.config.defaultWindowOptions === "function"
      ? this.config.defaultWindowOptions()
      : this.config.defaultWindowOptions;
  }

  /**
   * Attach IPC handling and window.open interception to a WebContents.
   * Works with BrowserWindow, WebContentsView, or any object with a webContents property.
   *
   * @example
   * // BrowserWindow
   * manager.setupForWindow(mainWindow);
   *
   * // WebContentsView (e.g., when the renderer is in a view, not the BrowserWindow itself)
   * manager.setupForWindow(mainView);
   *
   * // With fallback handler for non-library window.open calls
   * manager.setupForWindow(mainView, {
   *   fallbackWindowOpenHandler: ({ url }) => {
   *     if (isExternalURL(url)) { shell.openExternal(url); return { action: "deny" }; }
   *     return { action: "allow" };
   *   },
   * });
   */
  setupForWindow(
    target: BrowserWindow | { webContents: WebContents } | WebContents,
    options?: SetupOptions,
  ): void {
    const webContents = "webContents" in target ? target.webContents : target;
    const isDestroyed =
      "isDestroyed" in target
        ? () => (target as { isDestroyed: () => boolean }).isDestroyed()
        : () => webContents.isDestroyed();

    this.setupForWebContents(webContents, isDestroyed, options);
  }

  private setupForWebContents(
    webContents: WebContents,
    isDestroyed: () => boolean,
    options?: SetupOptions,
  ): void {
    const impl = this.createImplementation(webContents);

    const dispatcher =
      WindowManagerIPC.for(webContents).setImplementation(impl);

    dispatchers.set(webContents, dispatcher);

    webContents.setWindowOpenHandler((details) => {
      const { frameName, url } = details;

      // Check if this is a library-managed window (about:blank + registered frameName)
      if (url === "about:blank" && this.pendingWindows.has(frameName)) {
        const pending = this.pendingWindows.get(frameName)!;
        const constructorOptions = this.buildConstructorOptions(
          pending.props,
          webContents,
        );

        const defaultWindowOptions = this.getDefaultWindowOptions();
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            ...defaultWindowOptions,
            ...constructorOptions,
            webPreferences: {
              ...defaultWindowOptions.webPreferences,
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: defaultWindowOptions.webPreferences?.sandbox ?? true,
            },
            show: false,
          },
        };
      }

      // Not a library-managed window — delegate to fallback handler
      if (options?.fallbackWindowOpenHandler) {
        return options.fallbackWindowOpenHandler(details);
      }

      // No fallback handler — deny by default
      if (this.config.devWarnings) {
        devWarning(
          `window.open to "${url}" denied. Not a managed window and no fallbackWindowOpenHandler provided.`,
        );
      }
      return { action: "deny" };
    });

    webContents.on("did-create-window", (childBW, { frameName }) => {
      const windowId = frameName;
      const pending = this.pendingWindows.get(windowId);
      if (!pending) {
        // Not a library-managed window — could be from the fallback handler.
        // Don't destroy it.
        return;
      }

      this.pendingWindows.delete(windowId);

      const instance = new WindowInstance({
        id: windowId,
        browserWindow: childBW,
        props: pending.props as unknown as Omit<
          import("../shared/types.js").BaseWindowProps,
          "open" | "children"
        >,
        onEvent: (event) => {
          if (isDestroyed()) return;
          this.dispatchEvent(webContents, event);
        },
        showOnCreate: (pending.props as any).showOnCreate !== false,
        hideOnClose: (pending.props as any).hideOnClose === true,
      });

      this.windows.set(windowId, instance);
    });
  }

  /**
   * Extract BrowserWindow constructor options from IPC props.
   * Moved here from the old WindowInstance.buildBrowserWindowOptions().
   */
  private buildConstructorOptions(
    props: IPCWindowProps,
    parentWebContents?: WebContents,
  ): Partial<Electron.BrowserWindowConstructorOptions> {
    let x = props.x ?? props.defaultX;
    let y = props.y ?? props.defaultY;
    const width = props.width ?? props.defaultWidth ?? DEFAULT_WINDOW_WIDTH;
    const height = props.height ?? props.defaultHeight ?? DEFAULT_WINDOW_HEIGHT;

    // If an explicit position was provided, verify it lands on at least one display.
    // Skip the check when getAllDisplays returns nothing (e.g., in unit tests without
    // a display configured) to avoid silently discarding valid positions.
    if (x !== undefined && y !== undefined) {
      const displays = screen.getAllDisplays();
      if (displays.length > 0) {
        const onScreen = validateBoundsOnScreen({ x, y, width, height });
        if (!onScreen) {
          x = undefined;
          y = undefined;
        }
      }
    }

    const shouldCenter =
      props.center !== false && x === undefined && y === undefined;

    // Resolve targetDisplay if specified — takes precedence over parent-display centering.
    // Values: "primary", "cursor", or a stringified display index.
    let resolvedDisplay: Electron.Display | undefined;
    if (shouldCenter && props.targetDisplay) {
      try {
        if (props.targetDisplay === "primary") {
          resolvedDisplay = screen.getPrimaryDisplay();
        } else if (props.targetDisplay === "cursor") {
          resolvedDisplay = screen.getDisplayNearestPoint(
            screen.getCursorScreenPoint(),
          );
        } else {
          const idx = parseInt(props.targetDisplay, 10);
          if (!isNaN(idx)) {
            resolvedDisplay = screen.getAllDisplays()[idx];
          }
        }
      } catch {
        // Display resolution failed — fall through to parent-centered
      }
    }

    if (shouldCenter && resolvedDisplay) {
      x =
        resolvedDisplay.workArea.x +
        Math.round((resolvedDisplay.workArea.width - width) / 2);
      y =
        resolvedDisplay.workArea.y +
        Math.round((resolvedDisplay.workArea.height - height) / 2);
    } else if (shouldCenter && parentWebContents) {
      // Default: center on the same display as the parent window
      try {
        const parentWin = BrowserWindow.fromWebContents(parentWebContents);
        const parentBounds = parentWin?.getBounds();
        if (parentBounds) {
          const display = screen.getDisplayMatching(parentBounds);
          x =
            display.workArea.x +
            Math.round((display.workArea.width - width) / 2);
          y =
            display.workArea.y +
            Math.round((display.workArea.height - height) / 2);
        }
      } catch {
        // Fall through to Electron's default centering
      }
    }

    const result = {
      width,
      height,
      x,
      y,
      center: shouldCenter && x === undefined && y === undefined,
      minWidth: props.minWidth,
      maxWidth: props.maxWidth,
      minHeight: props.minHeight,
      maxHeight: props.maxHeight,
      title: props.title ?? "",
      transparent: props.transparent ?? false,
      frame: props.frame ?? true,
      titleBarStyle:
        props.titleBarStyle as Electron.BrowserWindowConstructorOptions["titleBarStyle"],
      vibrancy:
        props.vibrancy as Electron.BrowserWindowConstructorOptions["vibrancy"],
      backgroundColor: props.backgroundColor,
      opacity: props.opacity,
      resizable: props.resizable ?? true,
      movable: props.movable ?? true,
      minimizable: props.minimizable ?? true,
      maximizable: props.maximizable ?? true,
      closable: props.closable ?? true,
      focusable: props.focusable ?? true,
      alwaysOnTop: props.alwaysOnTop ?? false,
      skipTaskbar: props.skipTaskbar ?? false,
      fullscreen: props.fullscreen ?? false,
      fullscreenable: props.fullscreenable ?? true,
      // ignoreMouseEvents and visibleOnAllWorkspaces are applied post-creation by WindowInstance
      trafficLightPosition: isMac() ? props.trafficLightPosition : undefined,
      titleBarOverlay: isWindows() ? props.titleBarOverlay : undefined,
    };

    // Strip undefined values so they don't overwrite defaultWindowOptions when spread
    return Object.fromEntries(
      Object.entries(result).filter(([, v]) => v !== undefined),
    ) as Partial<Electron.BrowserWindowConstructorOptions>;
  }

  private createImplementation(_sender: WebContents): IWindowManagerImpl {
    return {
      RegisterWindow: (id: WindowId, props: IPCWindowProps) => {
        this.debugLog("←", "RegisterWindow", id, props);
        const now = Date.now();
        for (const [entryId, entry] of this.pendingWindows) {
          if (now - entry.createdAt > 10_000) {
            this.pendingWindows.delete(entryId);
          }
        }
        if (this.pendingWindows.size >= this.config.maxPendingWindows) {
          if (this.config.devWarnings) {
            devWarning(
              "Maximum pending windows reached. Registration rejected.",
            );
          }
          return false;
        }
        if (this.windows.size >= this.config.maxWindows) {
          if (this.config.devWarnings) {
            devWarning(
              "Maximum active windows reached. Registration rejected.",
            );
          }
          return false;
        }
        const filteredProps = filterAllowedProps(
          props,
          this.config.devWarnings,
        );
        this.pendingWindows.set(id, {
          props: filteredProps,
          createdAt: Date.now(),
        });
        return true;
      },

      UnregisterWindow: (id: WindowId) => {
        this.debugLog("←", "UnregisterWindow", id);
        this.pendingWindows.delete(id);
        const instance = this.windows.get(id);
        if (instance) {
          instance.destroy();
          this.windows.delete(id);
        }
        return true;
      },

      UpdateWindow: (id: WindowId, props: IPCWindowProps) => {
        this.debugLog("←", "UpdateWindow", id, props);
        const instance = this.windows.get(id);
        if (!instance) return false;
        const filteredProps = filterAllowedProps(
          props,
          this.config.devWarnings,
        );
        instance.updateProps(
          filteredProps as unknown as Parameters<
            typeof instance.updateProps
          >[0],
        );
        return true;
      },

      DestroyWindow: (id: WindowId) => {
        this.debugLog("←", "DestroyWindow", id);
        const instance = this.windows.get(id);
        if (!instance) return false;
        instance.destroy();
        this.windows.delete(id);
        return true;
      },

      WindowAction: (id: WindowId, action: IPCWindowAction) => {
        this.debugLog("←", "WindowAction", id, action);
        const instance = this.windows.get(id);
        if (!instance) return false;

        switch (action.type) {
          case "focus":
            instance.focus();
            break;
          case "blur":
            instance.blur();
            break;
          case "minimize":
            instance.minimize();
            break;
          case "maximize":
            instance.maximize();
            break;
          case "unmaximize":
            instance.unmaximize();
            break;
          case "close":
            instance.close();
            break;
          case "forceClose":
            instance.forceClose();
            break;
          case "setBounds":
            if (action.bounds) instance.setBounds(action.bounds);
            break;
          case "setTitle":
            if (action.title !== undefined) instance.setTitle(action.title);
            break;
          case "enterFullscreen":
            instance.enterFullscreen();
            break;
          case "exitFullscreen":
            instance.exitFullscreen();
            break;
          case "show":
            instance.show();
            break;
          case "hide":
            instance.hide();
            break;
        }
        return true;
      },

      GetWindowState: (id: WindowId) => {
        this.debugLog("←", "GetWindowState", id);
        return this.windows.get(id)?.getState() ?? null;
      },
    };
  }

  private dispatchEvent(sender: WebContents, event: IPCWindowEvent): void {
    this.debugLog("→", event.type, event.id, event.bounds ?? event.display);
    try {
      if (sender.isDestroyed()) return;

      const dispatcher = dispatchers.get(sender);
      if (dispatcher) {
        dispatcher.dispatchWindowEvent(event);
      }
    } catch {
      // Parent may have been destroyed during shutdown
    }

    if (event.type === WindowEventType.Closed) {
      this.windows.delete(event.id);
    }
  }

  getWindow(id: WindowId): WindowInstance | undefined {
    return this.windows.get(id);
  }

  getAllWindows(): WindowInstance[] {
    return [...this.windows.values()];
  }

  getWindowState(id: WindowId): WindowState | null {
    return this.windows.get(id)?.getState() ?? null;
  }

  destroy(): void {
    for (const instance of this.windows.values()) {
      instance.destroy();
    }
    this.windows.clear();
  }
}

let managerInstance: WindowManager | null = null;

export function setupWindowManager(
  config?: WindowManagerConfig,
): WindowManager {
  if (managerInstance) {
    devWarning(
      "setupWindowManager() called multiple times. Returning existing instance.",
    );
    return managerInstance;
  }
  managerInstance = new WindowManager(config);
  return managerInstance;
}

export function getWindowManager(): WindowManager | null {
  return managerInstance;
}
