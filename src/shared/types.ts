import type { Bounds, DisplayInfo, WindowState } from "../generated-ipc/common/electron_window.js";

// Re-export from generated IPC types to ensure structural identity.
// Prevents "Type X is not assignable to Type X" errors when consumers
// import from both entry points.
export type { Bounds, DisplayInfo, WindowState };

/**
 * Unique identifier for a window instance
 */
export type WindowId = string;

/**
 * Title bar overlay options (Windows)
 */
export interface TitleBarOverlayOptions {
  color?: string;
  symbolColor?: string;
  height?: number;
}

/**
 * Always on top level options
 */
export type AlwaysOnTopLevel =
  | "normal"
  | "floating"
  | "torn-off-menu"
  | "modal-panel"
  | "main-menu"
  | "status"
  | "pop-up-menu"
  | "screen-saver";

/**
 * Style injection mode for window content
 */
export type InjectStylesMode = "auto" | false | ((targetDocument: Document) => void);

/**
 * Target display for window placement
 */
export type TargetDisplay = number | "primary" | "cursor";

/**
 * Title bar style options
 */
export type TitleBarStyle = "default" | "hidden" | "hiddenInset" | "customButtonsOnHover";

/** Vibrancy effect options (macOS) */
export type VibrancyType =
  | "appearance-based"
  | "light"
  | "dark"
  | "titlebar"
  | "selection"
  | "menu"
  | "popover"
  | "sidebar"
  | "header"
  | "sheet"
  | "window"
  | "hud"
  | "fullscreen-ui"
  | "tooltip"
  | "content"
  | "under-window"
  | "under-page";

interface PropMeta {
  /** Whether the renderer is allowed to send this prop via IPC (security boundary) */
  allowed: boolean;
  /** Whether this prop can only be set at window creation time (no Electron setter) */
  creationOnly: boolean;
}

/**
 * Single source of truth for prop classification.
 *
 * allowed=true    → renderer may send this via IPC (security allowlist)
 * creationOnly=true → no Electron setter; must be passed at BrowserWindow construction
 *
 * From these two flags all downstream sets are derived:
 *   RENDERER_ALLOWED_PROPS  = allowed
 *   CREATION_ONLY_PROPS     = creationOnly
 *   CHANGEABLE_BEHAVIOR_PROPS (Window.tsx) = allowed && !creationOnly && not a meta/geometry prop
 *   shape props (PooledWindow.tsx)          = creationOnly && allowed
 */
export const PROP_REGISTRY: Readonly<Record<string, PropMeta>> = {
  // --- Geometry: initial values (applied once via constructor) ---
  defaultWidth: { allowed: true, creationOnly: false },
  defaultHeight: { allowed: true, creationOnly: false },
  defaultX: { allowed: true, creationOnly: false },
  defaultY: { allowed: true, creationOnly: false },
  center: { allowed: true, creationOnly: false },
  // --- Geometry: controlled values ---
  width: { allowed: true, creationOnly: false },
  height: { allowed: true, creationOnly: false },
  x: { allowed: true, creationOnly: false },
  y: { allowed: true, creationOnly: false },
  // --- Geometry: constraints ---
  minWidth: { allowed: true, creationOnly: false },
  maxWidth: { allowed: true, creationOnly: false },
  minHeight: { allowed: true, creationOnly: false },
  maxHeight: { allowed: true, creationOnly: false },
  // --- Appearance ---
  title: { allowed: true, creationOnly: false },
  backgroundColor: { allowed: true, creationOnly: false },
  opacity: { allowed: true, creationOnly: false },
  transparent: { allowed: true, creationOnly: true },
  frame: { allowed: true, creationOnly: true },
  titleBarStyle: { allowed: true, creationOnly: true },
  vibrancy: { allowed: true, creationOnly: true },
  // --- Behavior ---
  resizable: { allowed: true, creationOnly: false },
  movable: { allowed: true, creationOnly: false },
  minimizable: { allowed: true, creationOnly: false },
  maximizable: { allowed: true, creationOnly: false },
  closable: { allowed: true, creationOnly: false },
  focusable: { allowed: true, creationOnly: false },
  alwaysOnTop: { allowed: true, creationOnly: false },
  alwaysOnTopLevel: { allowed: true, creationOnly: false },
  skipTaskbar: { allowed: true, creationOnly: false },
  fullscreen: { allowed: true, creationOnly: false },
  fullscreenable: { allowed: true, creationOnly: false },
  // --- Mouse ---
  ignoreMouseEvents: { allowed: true, creationOnly: false },
  // --- Visibility ---
  visible: { allowed: true, creationOnly: false },
  showInactive: { allowed: true, creationOnly: false },
  visibleOnAllWorkspaces: { allowed: true, creationOnly: false },
  // --- Platform-specific ---
  trafficLightPosition: { allowed: true, creationOnly: false },
  titleBarOverlay: { allowed: true, creationOnly: false },
  // --- Multiple monitors ---
  targetDisplay: { allowed: true, creationOnly: false },
  // --- Advanced ---
  name: { allowed: true, creationOnly: false },
  // --- Pool support ---
  showOnCreate: { allowed: true, creationOnly: false },
  hideOnClose: { allowed: true, creationOnly: false },
  // --- Creation-only props not exposed to renderer ---
  // (allowed=false keeps them off the IPC allowlist while still tracking creationOnly)
  type: { allowed: false, creationOnly: true },
  visualEffectState: { allowed: false, creationOnly: true },
  roundedCorners: { allowed: false, creationOnly: true },
  thickFrame: { allowed: false, creationOnly: true },
  hasShadow: { allowed: false, creationOnly: true },
};

/**
 * Props that can only be set at window creation time
 * These have no setter methods in Electron
 */
export const CREATION_ONLY_PROPS: ReadonlySet<string> = new Set(
  Object.entries(PROP_REGISTRY)
    .filter(([, meta]) => meta.creationOnly)
    .map(([prop]) => prop),
);

/**
 * Props allowlist that renderers can set
 * Security: webPreferences and other sensitive options are NOT included
 */
export const RENDERER_ALLOWED_PROPS: ReadonlySet<string> = new Set(
  Object.entries(PROP_REGISTRY)
    .filter(([, meta]) => meta.allowed)
    .map(([prop]) => prop),
);

/**
 * Props that can be updated after window creation via IPC.
 * These are renderer-allowed, not creation-only, and not pure meta/geometry props
 * (geometry is handled separately via bounds IPC).
 */
export const CHANGEABLE_BEHAVIOR_PROPS: ReadonlySet<string> = new Set(
  Object.entries(PROP_REGISTRY)
    .filter(([, meta]) => meta.allowed && !meta.creationOnly)
    .map(([prop]) => prop)
    .filter(
      (prop) =>
        ![
          // Controlled geometry — handled via explicit bounds IPC in the diff
          // effect, not the changeable-props loop. min/max constraints ARE
          // included (they have setters in PROP_SETTERS and can change live).
          "width",
          "height",
          "x",
          "y",
          // Default geometry — creation-time only, no setter
          "defaultWidth",
          "defaultHeight",
          "defaultX",
          "defaultY",
          "center",
          // Meta / renderer-only props. showInactive IS included — it has
          // no direct setter but updateProps stores it in currentProps where
          // WindowInstance.show() reads it on the next show/hide cycle.
          "title",
          "targetDisplay",
          "name",
          "showOnCreate",
          "hideOnClose",
        ].includes(prop),
    ),
);

/**
 * Props that CAN change live but have no clean reset API in Electron, so
 * the pool cannot reliably restore them to a neutral default on release.
 * These leak across pool uses — consumers should avoid setting them on
 * PooledWindow if they can't tolerate the leak, or explicitly reset them
 * themselves via the prop on every acquire.
 *
 * - `trafficLightPosition`: setWindowButtonPosition(null) resets on macOS,
 *   but our setter early-returns on falsy. Would need setter refactor.
 * - `titleBarOverlay`: no reset API in Electron — once set, stays set.
 * - `backgroundColor`: no "reset to system default" value; empty string
 *   behavior is undefined.
 * - `alwaysOnTopLevel`: derived from alwaysOnTop string normalization.
 *   The stale value in currentProps is dormant (setter only fires on
 *   change) but it's still a state-leak. Cleared by updateProps when
 *   alwaysOnTop is set to false (see WindowInstance.updateProps).
 */
export const POOL_NON_RESETTABLE_PROPS: ReadonlySet<string> = new Set([
  "trafficLightPosition",
  "titleBarOverlay",
  "backgroundColor",
  "alwaysOnTopLevel",
]);

/**
 * Default values for behavior props that should reset on pool release.
 * Prevents state leaking between uses (e.g., Use A sets closable=false,
 * Use B mysteriously can't close the window).
 *
 * Intentionally EXCLUDES:
 * - `visible` — the pool hides explicitly via windowAction({type:"hide"});
 *   including visible:true would un-hide the released window.
 * - `POOL_NON_RESETTABLE_PROPS` — no clean reset API (see above).
 *
 * INVARIANT (enforced by test): every prop in CHANGEABLE_BEHAVIOR_PROPS
 * must be either in this object OR in POOL_NON_RESETTABLE_PROPS OR be
 * `visible`. Adding a new changeable prop breaks the test until you
 * decide which bucket it belongs in.
 */
export const POOL_RELEASE_PROP_DEFAULTS: Readonly<Record<string, unknown>> = {
  resizable: true,
  movable: true,
  minimizable: true,
  maximizable: true,
  closable: true,
  focusable: true,
  alwaysOnTop: false,
  skipTaskbar: false,
  fullscreen: false,
  fullscreenable: true,
  ignoreMouseEvents: false,
  visibleOnAllWorkspaces: false,
  opacity: 1,
  showInactive: false,
  // min/max constraints: 0 means "no constraint" in Electron
  minWidth: 0,
  minHeight: 0,
  maxWidth: 0,
  maxHeight: 0,
};

/**
 * Creation-only props that are also renderer-allowed — these are the pool's
 * "shape" props, fixed at pool creation time and excluded on acquire.
 */
export const POOL_SHAPE_PROPS: ReadonlySet<string> = new Set(
  Object.entries(PROP_REGISTRY)
    .filter(([, meta]) => meta.allowed && meta.creationOnly)
    .map(([prop]) => prop),
);

/**
 * Base window props (shared between Window and PooledWindow)
 */
export interface BaseWindowProps {
  /**
   * Whether the window should be open/visible.
   * When true, the window is created/shown.
   * When false, the window is destroyed.
   */
  open: boolean;

  /**
   * Called when the user initiates a close (e.g., clicks the X button).
   *
   * Fires during Electron's `close` event — the window is about to close
   * but hasn't yet. Use this to sync your `open` state back to `false`.
   * The window will close on its own; your `open={false}` is for your
   * state consistency, not to drive the close.
   *
   * This is a notification, not an interceptor. To prevent close, set
   * `closable={false}` proactively (e.g., `closable={!hasUnsavedChanges}`).
   *
   * `onClose` (a separate callback) fires after the window is fully
   * destroyed, for any reason (user, programmatic, unmount).
   */
  onUserClose?: () => void;

  /**
   * Whether the user can close the window. Default: true.
   * When false, the close button is hidden/disabled.
   */
  closable?: boolean;

  // --- Geometry: Initial values (creation-only) ---

  /** Initial width. Only applied on window creation. */
  defaultWidth?: number;

  /** Initial height. Only applied on window creation. */
  defaultHeight?: number;

  /** Initial x position. Only applied on window creation. */
  defaultX?: number;

  /** Initial y position. Only applied on window creation. */
  defaultY?: number;

  // --- Geometry: Controlled values ---

  /**
   * Controlled width. Changes will resize the window.
   * Use with onBoundsChange for two-way sync.
   */
  width?: number;

  /**
   * Controlled height. Changes will resize the window.
   * Use with onBoundsChange for two-way sync.
   */
  height?: number;

  /**
   * Controlled x position. Changes will move the window.
   * Use with onBoundsChange for two-way sync.
   */
  x?: number;

  /**
   * Controlled y position. Changes will move the window.
   * Use with onBoundsChange for two-way sync.
   */
  y?: number;

  /** Callback fired when window bounds change (resize or move). Debounced internally. */
  onBoundsChange?: (bounds: Bounds) => void;

  // --- Geometry: Constraints ---

  /** Minimum width constraint */
  minWidth?: number;

  /** Maximum width constraint */
  maxWidth?: number;

  /** Minimum height constraint */
  minHeight?: number;

  /** Maximum height constraint */
  maxHeight?: number;

  /** Center the window on creation. Default: true if no x/y specified. */
  center?: boolean;

  // --- Appearance ---

  /** Window title */
  title?: string;

  /**
   * Make the window transparent. Creation-only.
   * @creationOnly Cannot be changed after window creation.
   */
  transparent?: boolean;

  /**
   * Show window frame (title bar, borders). Creation-only.
   * @creationOnly Cannot be changed after window creation.
   */
  frame?: boolean;

  /**
   * Title bar style. Creation-only.
   * @creationOnly Cannot be changed after window creation.
   */
  titleBarStyle?: TitleBarStyle;

  /**
   * Vibrancy effect (macOS only). Creation-only.
   * @creationOnly Cannot be changed after window creation.
   */
  vibrancy?: VibrancyType;

  /** Background color */
  backgroundColor?: string;

  /** Window opacity (0.0 to 1.0) */
  opacity?: number;

  // --- Behavior ---

  /**
   * Whether the window is visible. Default: true.
   * Set to false to hide the window without destroying it (state is preserved).
   * Unlike `open`, which controls the window's existence, `visible` controls whether it's shown.
   */
  visible?: boolean;

  /** Whether the window is resizable. Default: true. */
  resizable?: boolean;

  /** Whether the window is movable. Default: true. */
  movable?: boolean;

  /** Whether the window can be minimized. Default: true. */
  minimizable?: boolean;

  /** Whether the window can be maximized. Default: true. */
  maximizable?: boolean;

  /** Whether the window is focusable. Default: true. */
  focusable?: boolean;

  /** Whether the window should always be on top. */
  alwaysOnTop?: boolean | AlwaysOnTopLevel;

  /** @internal IPC-level field: the string level for alwaysOnTop */
  alwaysOnTopLevel?: AlwaysOnTopLevel;

  /** Whether to skip showing in taskbar/dock. */
  skipTaskbar?: boolean;

  // --- Fullscreen ---

  /** Enter/exit fullscreen mode */
  fullscreen?: boolean;

  /** Whether the window can enter fullscreen. Default: true. */
  fullscreenable?: boolean;

  // --- Visibility ---

  /** Show window without stealing focus */
  showInactive?: boolean;

  /** Ignore mouse events (click-through window) */
  ignoreMouseEvents?: boolean;

  /** Visible on all workspaces/virtual desktops */
  visibleOnAllWorkspaces?: boolean;

  // --- Platform-specific ---

  /** Traffic light (close/minimize/maximize) button position (macOS) */
  trafficLightPosition?: { x: number; y: number };

  /** Title bar overlay options (Windows) */
  titleBarOverlay?: TitleBarOverlayOptions;

  // --- Multiple monitors ---

  /** Which display to open the window on */
  targetDisplay?: TargetDisplay;

  // --- Advanced ---

  /**
   * Recreate window when creation-only props change.
   * Default: false (log warning instead).
   */
  recreateOnShapeChange?: boolean;

  /**
   * Debug name for DevTools and error messages.
   * Useful for identifying windows in multi-window apps.
   */
  name?: string;

  // --- Persistence ---

  /**
   * Persist window bounds with this key.
   * Bounds are saved on resize/move and restored on next open.
   */
  persistBounds?: string;

  // --- Style injection ---

  /**
   * How to inject styles into the new window.
   * - "auto": Copy <style> and <link> tags from parent (default)
   * - false: No injection (for CSS-in-JS)
   * - function: Custom injection
   */
  injectStyles?: InjectStylesMode;

  // --- State events ---

  /** Fired when window is ready and content is mounted */
  onReady?: () => void;

  /** Fired when window is maximized */
  onMaximize?: () => void;

  /** Fired when window is unmaximized */
  onUnmaximize?: () => void;

  /** Fired when window is minimized */
  onMinimize?: () => void;

  /** Fired when window is restored from minimized */
  onRestore?: () => void;

  /** Fired when the window gains focus */
  onFocus?: () => void;

  /** Fired when the window loses focus */
  onBlur?: () => void;

  /** Fired when the window is destroyed (for any reason — user close, programmatic, unmount) */
  onClose?: () => void;

  /** Fired when window enters fullscreen */
  onEnterFullscreen?: () => void;

  /** Fired when window exits fullscreen (maps to Electron's 'leave-full-screen' event) */
  onExitFullscreen?: () => void;

  /** Fired when window moves to a different display */
  onDisplayChange?: (display: DisplayInfo) => void;
}

/**
 * Window component props (renderer process)
 */
export interface WindowProps extends BaseWindowProps {
  /** Content to render inside the window */
  children: React.ReactNode;
}

/**
 * Window handle returned by useCurrentWindow hook
 */
export interface WindowHandle {
  /** Unique window identifier */
  readonly id: WindowId;

  /** Whether the window is ready and methods are operational */
  readonly isReady: boolean;

  /** Current focused state */
  readonly isFocused: boolean;

  /** Current maximized state */
  readonly isMaximized: boolean;

  /** Current minimized state */
  readonly isMinimized: boolean;

  /** Current fullscreen state */
  readonly isFullscreen: boolean;

  /** Current bounds */
  readonly bounds: Bounds;

  /** Focus the window */
  focus(): void;

  /** Blur/unfocus the window */
  blur(): void;

  /** Minimize the window */
  minimize(): void;

  /** Maximize the window */
  maximize(): void;

  /** Unmaximize the window */
  unmaximize(): void;

  /** Toggle maximize state */
  toggleMaximize(): void;

  /** Close the window (respects closable prop) */
  close(): void;

  /** Force close the window (bypasses closable) */
  forceClose(): void;

  /** Set window bounds */
  setBounds(bounds: Partial<Bounds>): void;

  /** Set window title */
  setTitle(title: string): void;

  /** Enter fullscreen */
  enterFullscreen(): void;

  /** Exit fullscreen */
  exitFullscreen(): void;
}

/**
 * Window action types
 */
export type WindowAction =
  | { type: "focus" }
  | { type: "blur" }
  | { type: "minimize" }
  | { type: "maximize" }
  | { type: "unmaximize" }
  | { type: "close" }
  | { type: "forceClose" }
  | { type: "setBounds"; bounds: Partial<Bounds> }
  | { type: "setTitle"; title: string }
  | { type: "enterFullscreen" }
  | { type: "exitFullscreen" }
  | { type: "show" }
  | { type: "hide" };

/**
 * Window event types from main process
 */
export type WindowEvent =
  | { type: "closed"; id: WindowId }
  | { type: "focused"; id: WindowId }
  | { type: "blurred"; id: WindowId }
  | { type: "maximized"; id: WindowId }
  | { type: "unmaximized"; id: WindowId }
  | { type: "minimized"; id: WindowId }
  | { type: "restored"; id: WindowId }
  | { type: "shown"; id: WindowId }
  | { type: "hidden"; id: WindowId }
  | { type: "enterFullscreen"; id: WindowId }
  | { type: "leaveFullscreen"; id: WindowId }
  | { type: "boundsChanged"; id: WindowId; bounds: Bounds }
  | { type: "userCloseRequested"; id: WindowId }
  | { type: "displayChanged"; id: WindowId; display: DisplayInfo }
  | { type: "ready"; id: WindowId };

/**
 * Window pool configuration
 */
export interface WindowPoolConfig {
  /** Minimum number of idle windows to keep warm */
  minIdle?: number;

  /** Maximum number of idle windows to keep */
  maxIdle?: number;

  /** Time in ms before destroying idle windows */
  idleTimeout?: number;
}
