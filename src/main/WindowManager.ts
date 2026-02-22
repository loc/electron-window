import { BrowserWindow, type WebContents } from "electron";
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

/** Maps parent BrowserWindows to their IPC event dispatchers */
const dispatchers = new WeakMap<BrowserWindow, Dispatcher>();

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
    if (
      RENDERER_ALLOWED_PROPS.has(key) ||
      key === "hasOnBoundsChange" ||
      key === "hasOnUserClose" ||
      key === "name"
    ) {
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

export type SecurityValidator = (frame: Electron.WebFrameMain) => boolean;

export interface WindowManagerConfig {
  /** Default options applied to all windows */
  defaultWindowOptions?: Partial<Electron.BrowserWindowConstructorOptions>;

  /** Enable development warnings */
  devWarnings?: boolean;

  /**
   * Allowed origins for IPC calls.
   * Use ['*'] to allow all origins (not recommended).
   */
  allowedOrigins?: string[];

  /**
   * Allow IPC calls from iframes.
   * Default: false (only main frame may make IPC calls)
   */
  allowIframes?: boolean;

  /**
   * Custom security validator. Overrides allowedOrigins and allowIframes.
   * Return true to allow, false to reject.
   */
  validator?: SecurityValidator;

  /** Maximum pending window registrations. Default: 100. */
  maxPendingWindows?: number;

  /** Maximum active windows. Default: 50. */
  maxWindows?: number;
}

interface ResolvedConfig {
  defaultWindowOptions: Partial<Electron.BrowserWindowConstructorOptions>;
  devWarnings: boolean;
  allowedOrigins: string[] | undefined;
  allowIframes: boolean;
  validator: SecurityValidator | undefined;
  maxPendingWindows: number;
  maxWindows: number;
}

/**
 * Main process window manager.
 * Renderer calls RegisterWindow(id, props) + window.open(url, id), then this class
 * intercepts the new window via setWindowOpenHandler / did-create-window and wraps it.
 */
export class WindowManager {
  private readonly windows: Map<WindowId, WindowInstance> = new Map();
  private readonly pendingWindows: Map<WindowId, { props: IPCWindowProps }> =
    new Map();
  private readonly config: ResolvedConfig;

  constructor(config: WindowManagerConfig = {}) {
    this.config = {
      defaultWindowOptions: config.defaultWindowOptions ?? {},
      devWarnings: config.devWarnings ?? process.env.NODE_ENV === "development",
      allowedOrigins: config.allowedOrigins,
      allowIframes: config.allowIframes ?? false,
      validator: config.validator,
      maxPendingWindows: config.maxPendingWindows ?? 100,
      maxWindows: config.maxWindows ?? 50,
    };
  }

  private validateFrame(frame: Electron.WebFrameMain): boolean {
    if (this.config.validator) {
      return this.config.validator(frame);
    }

    if (!this.config.allowIframes) {
      if (frame.top && frame !== frame.top) {
        if (this.config.devWarnings) {
          devWarning(
            "IPC call from iframe rejected. Set allowIframes: true to allow.",
          );
        }
        return false;
      }
    }

    if (this.config.allowedOrigins) {
      if (this.config.allowedOrigins.includes("*")) {
        return true;
      }

      const frameUrl = frame.url;
      try {
        const parsedOrigin = new URL(frameUrl).origin;
        // For non-standard protocols (file://, app://), origin is "null".
        // Fall back to protocol + host matching for these cases.
        const origin =
          parsedOrigin !== "null"
            ? parsedOrigin
            : new URL(frameUrl).protocol + "//" + new URL(frameUrl).host;
        const allowed = this.config.allowedOrigins.some(
          (allowedOrigin) => origin === allowedOrigin,
        );

        if (!allowed && this.config.devWarnings) {
          devWarning(
            `IPC call from origin "${origin}" rejected. Add to allowedOrigins to allow.`,
          );
        }

        return allowed;
      } catch {
        return false;
      }
    }

    if (this.config.devWarnings) {
      devWarning(
        `IPC call from "${frame.url}" allowed by default. Set allowedOrigins in WindowManagerConfig for stricter security.`,
      );
    }

    return true;
  }

  /**
   * Attach IPC handling and window.open interception to a parent BrowserWindow.
   * Call this once per parent window (e.g., your main app window).
   */
  setupForWindow(parentBW: BrowserWindow): void {
    const impl = this.createImplementation(parentBW.webContents);

    const dispatcher = WindowManagerIPC.for(
      parentBW.webContents,
    ).setImplementation(impl);

    dispatchers.set(parentBW, dispatcher);

    parentBW.webContents.setWindowOpenHandler(({ frameName, url }) => {
      // Security: only allow about:blank — the library hardcodes this URL.
      // A compromised renderer trying to open an arbitrary URL would inherit
      // the app's preload scripts, gaining access to privileged APIs.
      if (url !== "about:blank") {
        if (this.config.devWarnings) {
          devWarning(
            `window.open to "${url}" denied. Only "about:blank" is allowed.`,
          );
        }
        return { action: "deny" };
      }

      const pending = this.pendingWindows.get(frameName);
      if (!pending) {
        return { action: "deny" };
      }

      const constructorOptions = this.buildConstructorOptions(pending.props);

      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          ...this.config.defaultWindowOptions,
          ...constructorOptions,
          webPreferences: {
            ...this.config.defaultWindowOptions.webPreferences,
            // Security: never use renderer-specified webPreferences
          },
          show: false, // WindowInstance controls visibility
        },
      };
    });

    parentBW.webContents.on("did-create-window", (childBW, { frameName }) => {
      const windowId = frameName;
      const pending = this.pendingWindows.get(windowId);
      if (!pending) {
        // Pending entry was removed (e.g., rapid RegisterWindow + DestroyWindow
        // before window.open completed). Destroy the orphaned child window.
        childBW.destroy();
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
          if (parentBW.isDestroyed()) return;
          this.dispatchEvent(parentBW.webContents, event);
        },
        showOnCreate: (pending.props as any).showOnCreate !== false,
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
  ): Partial<Electron.BrowserWindowConstructorOptions> {
    let x = props.x ?? props.defaultX;
    let y = props.y ?? props.defaultY;
    const width = props.width ?? props.defaultWidth ?? DEFAULT_WINDOW_WIDTH;
    const height = props.height ?? props.defaultHeight ?? DEFAULT_WINDOW_HEIGHT;

    // targetDisplay isn't in IPCWindowProps, so centering falls back to Electron's default
    const shouldCenter =
      props.center !== false && x === undefined && y === undefined;

    return {
      width,
      height,
      x,
      y,
      center: shouldCenter,
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
      alwaysOnTop:
        typeof props.alwaysOnTop === "boolean"
          ? props.alwaysOnTop
          : props.alwaysOnTop !== undefined,
      skipTaskbar: props.skipTaskbar ?? false,
      fullscreen: props.fullscreen ?? false,
      fullscreenable: props.fullscreenable ?? true,
      // ignoreMouseEvents and visibleOnAllWorkspaces are applied post-creation by WindowInstance
      trafficLightPosition: isMac() ? props.trafficLightPosition : undefined,
      titleBarOverlay: isWindows() ? props.titleBarOverlay : undefined,
    };
  }

  private createImplementation(sender: WebContents): IWindowManagerImpl {
    const getFrame = () => sender.mainFrame;

    const withValidation = <T>(
      fn: () => T | Promise<T>,
      fallback: T,
    ): T | Promise<T> => {
      if (!this.validateFrame(getFrame())) {
        return fallback;
      }
      return fn();
    };

    return {
      RegisterWindow: (id: WindowId, props: IPCWindowProps) => {
        return withValidation(() => {
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
          this.pendingWindows.set(id, { props: filteredProps });
          return true;
        }, false);
      },

      UnregisterWindow: (id: WindowId) => {
        return withValidation(() => {
          this.pendingWindows.delete(id);
          const instance = this.windows.get(id);
          if (instance) {
            instance.destroy();
            this.windows.delete(id);
          }
          return true;
        }, false);
      },

      UpdateWindow: (id: WindowId, props: IPCWindowProps) => {
        return withValidation(() => {
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
        }, false);
      },

      DestroyWindow: (id: WindowId) => {
        return withValidation(() => {
          const instance = this.windows.get(id);
          if (!instance) return false;
          instance.destroy();
          this.windows.delete(id);
          return true;
        }, false);
      },

      WindowAction: (id: WindowId, action: IPCWindowAction) => {
        return withValidation(() => {
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
        }, false);
      },

      GetWindowState: (id: WindowId) => {
        return withValidation(() => {
          return this.windows.get(id)?.getState() ?? null;
        }, null);
      },
    };
  }

  private dispatchEvent(sender: WebContents, event: IPCWindowEvent): void {
    try {
      const win = BrowserWindow.fromWebContents(sender);
      if (!win || win.isDestroyed()) return;

      const dispatcher = dispatchers.get(win);
      if (dispatcher) {
        dispatcher.dispatchWindowEvent(event);
      }
    } catch {
      // Parent window may have been destroyed during shutdown
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
