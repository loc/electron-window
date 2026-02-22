import type { BrowserWindowConstructorOptions } from "electron";
import type {
  Bounds,
  DisplayInfo,
  WindowState,
} from "../generated-ipc/common/electron_window.js";

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
export type InjectStylesMode =
  | "auto"
  | false
  | ((targetDocument: Document) => void);

/**
 * Target display for window placement
 */
export type TargetDisplay = number | "primary" | "cursor";

/**
 * Title bar style options
 */
export type TitleBarStyle =
  | "default"
  | "hidden"
  | "hiddenInset"
  | "customButtonsOnHover";

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

/**
 * Props that can only be set at window creation time
 * These have no setter methods in Electron
 */
export const CREATION_ONLY_PROPS = new Set([
  "transparent",
  "frame",
  "titleBarStyle",
  "type",
  "vibrancy",
  "visualEffectState",
  "roundedCorners",
  "thickFrame",
  "hasShadow",
]) as ReadonlySet<string>;

/**
 * Props allowlist that renderers can set
 * Security: webPreferences and other sensitive options are NOT included
 */
export const RENDERER_ALLOWED_PROPS = new Set([
  // Geometry
  "width",
  "height",
  "x",
  "y",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "defaultWidth",
  "defaultHeight",
  "defaultX",
  "defaultY",
  "center",
  // Appearance
  "title",
  "backgroundColor",
  "opacity",
  "transparent",
  "frame",
  "titleBarStyle",
  "vibrancy",
  // Behavior
  "resizable",
  "movable",
  "minimizable",
  "maximizable",
  "closable",
  "focusable",
  "alwaysOnTop",
  "skipTaskbar",
  "fullscreen",
  "fullscreenable",
  // Mouse
  "ignoreMouseEvents",
  // Visibility
  "visible",
  "showInactive",
  "visibleOnAllWorkspaces",
  // Platform-specific
  "trafficLightPosition",
  "titleBarOverlay",
  // Advanced
  "targetDisplay",
]) as ReadonlySet<string>;

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
   * Callback fired when the user initiates a close (e.g., clicks X button).
   * The window closes immediately; use this to sync your state.
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
 * IPC channel names
 */
export const IPC_CHANNELS = {
  // Renderer -> Main
  REGISTER_WINDOW: "electron-window:register",
  UNREGISTER_WINDOW: "electron-window:unregister",
  UPDATE_WINDOW: "electron-window:update",
  DESTROY_WINDOW: "electron-window:destroy",
  WINDOW_ACTION: "electron-window:action",
  GET_WINDOW_STATE: "electron-window:get-state",

  // Main -> Renderer
  WINDOW_EVENT: "electron-window:event",
  WINDOW_STATE_UPDATE: "electron-window:state-update",
} as const;

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

/**
 * Pool shape - immutable options that define pool compatibility
 */
export type WindowShape = Pick<
  BrowserWindowConstructorOptions,
  "transparent" | "frame" | "titleBarStyle" | "type" | "vibrancy"
>;

// WindowManagerConfig is defined in src/main/WindowManager.ts
// It includes all security options (allowedOrigins, allowIframes, validator)

/**
 * Check if a prop is creation-only
 */
export function isCreationOnlyProp(prop: string): boolean {
  return CREATION_ONLY_PROPS.has(prop);
}

/**
 * Check if a prop is allowed from renderer
 */
export function isRendererAllowedProp(prop: string): boolean {
  return RENDERER_ALLOWED_PROPS.has(prop);
}
