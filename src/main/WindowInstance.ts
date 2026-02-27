import { BrowserWindow, screen } from "electron";
import {
  WindowEventType,
  type Bounds,
  type WindowId,
  type WindowState,
  type WindowEvent,
  type DisplayInfo,
} from "../generated-ipc/common/electron_window.js";
import type { BaseWindowProps } from "../shared/types.js";
import { CREATION_ONLY_PROPS } from "../shared/types.js";
import {
  debounce,
  isMac,
  isWindows,
  isLinux,
  devWarning,
} from "../shared/utils.js";

// Hard caps on setBounds values. Electron clamps internally on most platforms
// but NaN/Infinity have undefined behavior, and gigantic dimensions can cause
// GPU memory exhaustion. The 32767 cap matches X11's signed 16-bit dimension
// limit — safe ceiling for cross-platform.
const MAX_DIMENSION = 32767;
const MIN_DIMENSION = 1;

/** Reject NaN/Infinity, clamp to sane range. */
function sanitizeBoundsValue(
  v: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (v === undefined || !Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

/**
 * Prop to Electron setter method mapping
 */
const PROP_SETTERS: Record<
  string,
  (win: BrowserWindow, value: unknown) => void
> = {
  // title is excluded from CHANGEABLE_BEHAVIOR_PROPS (set via document.title
  // in the renderer instead), but the setter here remains for the
  // WindowAction {type: "setTitle"} path which routes through the handle.
  title: (win, v) => win.setTitle(v as string),
  backgroundColor: (win, v) => win.setBackgroundColor(v as string),
  opacity: (win, v) => win.setOpacity(v as number),
  resizable: (win, v) => win.setResizable(v as boolean),
  movable: (win, v) => win.setMovable(v as boolean),
  minimizable: (win, v) => win.setMinimizable(v as boolean),
  maximizable: (win, v) => win.setMaximizable(v as boolean),
  closable: (win, v) => win.setClosable(v as boolean),
  focusable: (win, v) => win.setFocusable(v as boolean),
  alwaysOnTop: (win, v) => {
    if (typeof v === "boolean") {
      win.setAlwaysOnTop(v);
    } else if (typeof v === "string") {
      win.setAlwaysOnTop(
        true,
        v as
          | "normal"
          | "floating"
          | "torn-off-menu"
          | "modal-panel"
          | "main-menu"
          | "status"
          | "pop-up-menu"
          | "screen-saver",
      );
    }
  },
  alwaysOnTopLevel: (win, v) => {
    win.setAlwaysOnTop(
      true,
      v as Parameters<BrowserWindow["setAlwaysOnTop"]>[1],
    );
  },
  skipTaskbar: (win, v) => win.setSkipTaskbar(v as boolean),
  fullscreen: (win, v) => win.setFullScreen(v as boolean),
  fullscreenable: (win, v) => win.setFullScreenable(v as boolean),
  ignoreMouseEvents: (win, v) => {
    win.setIgnoreMouseEvents(v as boolean);
    // Linux workaround: setIgnoreMouseEvents only takes effect once mouse exits
    if (isLinux()) {
      win.hide();
      win.showInactive();
    }
  },
  visibleOnAllWorkspaces: (win, v) => {
    if (isMac()) {
      win.setVisibleOnAllWorkspaces(v as boolean, {
        visibleOnFullScreen: true,
      });
    } else {
      win.setVisibleOnAllWorkspaces(v as boolean);
    }
  },
  trafficLightPosition: (win, v) => {
    if (isMac() && v && typeof v === "object") {
      (
        win as unknown as {
          setTrafficLightPosition: (p: { x: number; y: number }) => void;
        }
      ).setTrafficLightPosition(v as { x: number; y: number });
    } else if (!isMac() && v) {
      devWarning("trafficLightPosition only works on macOS");
    }
  },
  titleBarOverlay: (win, v) => {
    if (isWindows() && v && typeof v === "object") {
      win.setTitleBarOverlay(v as Electron.TitleBarOverlayOptions);
    } else if (!isWindows() && v) {
      devWarning("titleBarOverlay only works on Windows");
    }
  },
  minWidth: (win, v) => {
    const [, h] = win.getMinimumSize();
    win.setMinimumSize(v as number, h ?? 0);
  },
  maxWidth: (win, v) => {
    const [, h] = win.getMaximumSize();
    win.setMaximumSize(v as number, h ?? 0);
  },
  minHeight: (win, v) => {
    const [w] = win.getMinimumSize();
    win.setMinimumSize(w ?? 0, v as number);
  },
  maxHeight: (win, v) => {
    const [w] = win.getMaximumSize();
    win.setMaximumSize(w ?? 0, v as number);
  },
};

export interface WindowInstanceOptions {
  id: WindowId;
  browserWindow: BrowserWindow;
  props: Omit<BaseWindowProps, "open" | "children">;
  onEvent: (event: WindowEvent) => void;
  showOnCreate?: boolean; // default true
  /** When true, clicking X hides the window instead of closing it. Used by pool windows. */
  hideOnClose?: boolean;
}

/**
 * Wrapper around a single BrowserWindow instance.
 * The BrowserWindow is passed in already created (via window.open → setWindowOpenHandler).
 */
export class WindowInstance {
  readonly id: WindowId;
  private browserWindow: BrowserWindow | null;
  private readonly onEvent: (event: WindowEvent) => void;
  private currentProps: Omit<BaseWindowProps, "open" | "children">;
  private isDestroyed = false;
  private _forceClosing = false;
  private readonly hideOnClose: boolean;
  private lastDisplay: DisplayInfo | null = null;

  private readonly emitBoundsChange: ReturnType<typeof debounce>;

  constructor(options: WindowInstanceOptions) {
    this.id = options.id;
    this.onEvent = options.onEvent;
    this.currentProps = { ...options.props };
    this.browserWindow = options.browserWindow;
    this.hideOnClose = options.hideOnClose ?? false;

    this.emitBoundsChange = debounce(() => {
      if (this.browserWindow && !this.isDestroyed) {
        this.onEvent({
          type: WindowEventType.BoundsChanged,
          id: this.id,
          bounds: this.getBounds(),
        });
      }
    }, 100);

    this.setupEventListeners();
    this.applyPostCreationProps();

    // Only show on creation if requested (pool pre-warming passes false)
    const shouldShow = options.showOnCreate !== false;
    if (shouldShow) {
      if (this.currentProps.showInactive) {
        this.browserWindow.showInactive();
      } else {
        this.browserWindow.show();
      }
    }
  }

  /**
   * Apply props that can't be set via BrowserWindow constructor options
   */
  private applyPostCreationProps(): void {
    const win = this.browserWindow;
    if (!win) return;

    if (this.currentProps.ignoreMouseEvents) {
      win.setIgnoreMouseEvents(true);
    }

    if (this.currentProps.visibleOnAllWorkspaces) {
      if (isMac()) {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      } else {
        win.setVisibleOnAllWorkspaces(true);
      }
    }

    // Apply alwaysOnTop level if specified — constructor only accepts boolean,
    // level must be set via setAlwaysOnTop after creation.
    const level = (this.currentProps as Record<string, unknown>)
      .alwaysOnTopLevel as string | undefined;
    if (level) {
      win.setAlwaysOnTop(
        true,
        level as Parameters<BrowserWindow["setAlwaysOnTop"]>[1],
      );
    }
  }

  /**
   * Set up event listeners on the browser window
   */
  private setupEventListeners(): void {
    const win = this.browserWindow;
    if (!win) return;

    win.on("closed", () => {
      this.isDestroyed = true;
      this.browserWindow = null;
      this.onEvent({ type: WindowEventType.Closed, id: this.id });
    });

    win.on("close", (event) => {
      if (this.currentProps.closable === false) {
        event.preventDefault();
        return;
      }
      // Pool windows: hide instead of close. The close button stays enabled
      // but clicking it hides the window and notifies the renderer to release.
      if (this.hideOnClose && !this._forceClosing) {
        try {
          event.preventDefault();
          if (this.browserWindow && !this.browserWindow.isDestroyed()) {
            this.browserWindow.hide();
          }
          this.onEvent({
            type: WindowEventType.UserCloseRequested,
            id: this.id,
          });
        } catch {
          // Window may be partially destroyed during app shutdown — let close proceed
        }
        return;
      }
      if (!this.isDestroyed && !this._forceClosing) {
        this.onEvent({ type: WindowEventType.UserCloseRequested, id: this.id });
      }
    });

    win.on("focus", () => {
      if (!this.isDestroyed)
        this.onEvent({ type: WindowEventType.Focused, id: this.id });
    });
    win.on("blur", () => {
      if (!this.isDestroyed)
        this.onEvent({ type: WindowEventType.Blurred, id: this.id });
    });

    win.on("maximize", () => {
      if (!this.isDestroyed)
        this.onEvent({ type: WindowEventType.Maximized, id: this.id });
    });
    win.on("unmaximize", () => {
      if (!this.isDestroyed)
        this.onEvent({ type: WindowEventType.Unmaximized, id: this.id });
    });
    win.on("minimize", () => {
      if (!this.isDestroyed)
        this.onEvent({ type: WindowEventType.Minimized, id: this.id });
    });
    win.on("restore", () => {
      if (!this.isDestroyed)
        this.onEvent({ type: WindowEventType.Restored, id: this.id });
    });
    win.on("show", () => {
      if (!this.isDestroyed)
        this.onEvent({ type: WindowEventType.Shown, id: this.id });
    });
    win.on("hide", () => {
      if (!this.isDestroyed)
        this.onEvent({ type: WindowEventType.Hidden, id: this.id });
    });

    win.on("enter-full-screen", () => {
      if (!this.isDestroyed)
        this.onEvent({ type: WindowEventType.EnterFullscreen, id: this.id });
    });
    win.on("leave-full-screen", () => {
      if (!this.isDestroyed)
        this.onEvent({ type: WindowEventType.LeaveFullscreen, id: this.id });
    });

    win.on("resize", () => {
      if (!this.isDestroyed) this.emitBoundsChange();
    });
    win.on("move", () => {
      if (!this.isDestroyed) this.emitBoundsChange();
    });
    win.on("resized", () => {
      if (!this.isDestroyed) this.emitBoundsChange();
    });
    win.on("moved", () => {
      if (!this.isDestroyed) {
        this.emitBoundsChange();
        this.checkDisplayChange();
      }
    });
  }

  /**
   * Check if the window moved to a different display and emit an event if so
   */
  private checkDisplayChange(): void {
    if (!this.browserWindow) return;

    const bounds = this.browserWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);

    const displayInfo: DisplayInfo = {
      id: display.id,
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
    };

    if (this.lastDisplay === null || this.lastDisplay.id !== displayInfo.id) {
      this.lastDisplay = displayInfo;
      this.onEvent({
        type: WindowEventType.DisplayChanged,
        id: this.id,
        display: displayInfo,
      });
    }
  }

  updateProps(
    newProps: Partial<Omit<BaseWindowProps, "open" | "children">>,
  ): void {
    if (!this.browserWindow || this.isDestroyed) return;

    // Capture old visible BEFORE the loop updates currentProps — the loop
    // processes `visible` (it's in CHANGEABLE_BEHAVIOR_PROPS) and stores it
    // without calling show/hide (no setter in PROP_SETTERS), so by the time
    // we reach the explicit handling below, currentProps.visible already
    // reflects the new value.
    const oldVisible = (this.currentProps as Record<string, unknown>)[
      "visible"
    ];

    for (const [key, value] of Object.entries(newProps)) {
      if (this.currentProps[key as keyof typeof this.currentProps] === value) {
        continue;
      }

      if (CREATION_ONLY_PROPS.has(key)) {
        devWarning(
          `"${key}" is a creation-only prop and cannot be changed after window creation.`,
        );
        continue;
      }

      const setter = PROP_SETTERS[key];
      if (setter) {
        setter(this.browserWindow, value);
      }

      (this.currentProps as Record<string, unknown>)[key] = value;
    }

    // Handle visible prop explicitly (not a simple setter). Only act if the
    // value actually changed — prevents a spurious show()/hide() when
    // visible is re-sent at its current value.
    if ("visible" in newProps && newProps.visible !== oldVisible) {
      if (newProps.visible === false) {
        this.browserWindow.hide();
      } else {
        this.show();
      }
    }

    const boundsChanged =
      "x" in newProps ||
      "y" in newProps ||
      "width" in newProps ||
      "height" in newProps;

    if (boundsChanged) {
      // Route through this.setBounds() for sanitization (NaN/Infinity
      // rejection, on-screen clamping) — renderer-supplied bounds arrive
      // here via UpdateWindow IPC with only `typeof number` validation.
      this.setBounds({
        x: newProps.x,
        y: newProps.y,
        width: newProps.width,
        height: newProps.height,
      });
    }
  }

  getState(): WindowState {
    if (!this.browserWindow || this.isDestroyed) {
      return {
        id: this.id,
        isFocused: false,
        isVisible: false,
        isMaximized: false,
        isMinimized: false,
        isFullscreen: false,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        title: "",
      };
    }

    return {
      id: this.id,
      isFocused: this.browserWindow.isFocused(),
      isVisible: this.browserWindow.isVisible(),
      isMaximized: this.browserWindow.isMaximized(),
      isMinimized: this.browserWindow.isMinimized(),
      isFullscreen: this.browserWindow.isFullScreen(),
      bounds: this.browserWindow.getBounds(),
      title: this.browserWindow.getTitle(),
    };
  }

  getBounds(): Bounds {
    if (!this.browserWindow || this.isDestroyed) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    return this.browserWindow.getBounds();
  }

  focus(): void {
    if (this.browserWindow && !this.isDestroyed) this.browserWindow.focus();
  }

  blur(): void {
    if (this.browserWindow && !this.isDestroyed) this.browserWindow.blur();
  }

  minimize(): void {
    if (this.browserWindow && !this.isDestroyed) this.browserWindow.minimize();
  }

  maximize(): void {
    if (this.browserWindow && !this.isDestroyed) this.browserWindow.maximize();
  }

  unmaximize(): void {
    if (this.browserWindow && !this.isDestroyed)
      this.browserWindow.unmaximize();
  }

  close(): void {
    if (this.browserWindow && !this.isDestroyed) this.browserWindow.close();
  }

  forceClose(): void {
    if (this.browserWindow && !this.isDestroyed) {
      this._forceClosing = true;
      this.currentProps.closable = true;
      this.browserWindow.close();
      // _forceClosing and closable don't need resetting — the window is now destroyed
    }
  }

  /**
   * Set window bounds. Rejects NaN/Infinity/extreme values (renderer-supplied
   * bounds arrive here via the WindowAction IPC — no prior validation beyond
   * `typeof number`). Off-screen positions are clamped to the union of display
   * workAreas to prevent a compromised renderer from hiding its own window
   * under other apps (clickjacking setup) or exhausting GPU memory.
   */
  setBounds(bounds: Partial<Bounds>): void {
    if (!this.browserWindow || this.isDestroyed) return;
    const current = this.browserWindow.getBounds();

    const width = sanitizeBoundsValue(
      bounds.width,
      current.width,
      MIN_DIMENSION,
      MAX_DIMENSION,
    );
    const height = sanitizeBoundsValue(
      bounds.height,
      current.height,
      MIN_DIMENSION,
      MAX_DIMENSION,
    );

    // Clamp x/y so at least a 100px sliver stays on some display — keeps
    // the window grabbable. Uses the union of all workAreas rather than
    // a single display, since multi-monitor setups span arbitrary coords.
    const displays = screen.getAllDisplays();
    let x = sanitizeBoundsValue(
      bounds.x,
      current.x,
      -MAX_DIMENSION,
      MAX_DIMENSION,
    );
    let y = sanitizeBoundsValue(
      bounds.y,
      current.y,
      -MAX_DIMENSION,
      MAX_DIMENSION,
    );
    if (displays.length > 0) {
      const GRIP = 100;
      const anyOverlap = displays.some((d) => {
        const wa = d.workArea;
        return (
          x + width > wa.x + GRIP &&
          x < wa.x + wa.width - GRIP &&
          y + height > wa.y + GRIP &&
          y < wa.y + wa.height - GRIP
        );
      });
      if (!anyOverlap) {
        // Fallback: center on primary
        const p = screen.getPrimaryDisplay().workArea;
        x = p.x + Math.round((p.width - width) / 2);
        y = p.y + Math.round((p.height - height) / 2);
      }
    }

    this.browserWindow.setBounds({ x, y, width, height });
  }

  setTitle(title: string): void {
    if (this.browserWindow && !this.isDestroyed)
      this.browserWindow.setTitle(title);
  }

  enterFullscreen(): void {
    if (this.browserWindow && !this.isDestroyed)
      this.browserWindow.setFullScreen(true);
  }

  exitFullscreen(): void {
    if (this.browserWindow && !this.isDestroyed)
      this.browserWindow.setFullScreen(false);
  }

  show(): void {
    if (this.browserWindow && !this.isDestroyed) {
      if (this.currentProps.showInactive) {
        this.browserWindow.showInactive();
      } else {
        this.browserWindow.show();
      }
    }
  }

  hide(): void {
    if (this.browserWindow && !this.isDestroyed) this.browserWindow.hide();
  }

  destroy(): void {
    this.emitBoundsChange.cancel();
    if (this.browserWindow && !this.isDestroyed) {
      this.browserWindow.destroy();
      this.browserWindow = null;
      this.isDestroyed = true;
    }
  }

  get destroyed(): boolean {
    return this.isDestroyed;
  }

  get window(): BrowserWindow | null {
    return this.browserWindow;
  }

  get webContentsId(): number | null {
    return this.browserWindow?.webContents.id ?? null;
  }
}
