/**
 * Renderer process entry point
 * @module @loc/electron-window
 */

// Components
export { Window, type WindowRef } from "./Window.js";
export {
  PooledWindow,
  createWindowPool,
  createWindowPoolDefinition,
  destroyWindowPool,
  type PooledWindowProps,
  type WindowPoolDefinition,
  type PooledWindowRef,
} from "./PooledWindow.js";
export type { PoolShape } from "./RendererWindowPool.js";
export { WindowProvider, type WindowProviderProps } from "./WindowProvider.js";

// Hooks
export {
  useCurrentWindow,
  useWindowFocused,
  useWindowVisible,
  useWindowMaximized,
  useWindowMinimized,
  useWindowFullscreen,
  useWindowBounds,
  useWindowState,
  useWindowDocument,
  useWindowDisplay,
  usePersistedBounds,
  clearPersistedBounds,
  clearAllPersistedBounds,
  type UsePersistedBoundsOptions,
  type UsePersistedBoundsResult,
} from "./hooks/index.js";

// Context (for advanced use cases)
export {
  WindowContext,
  WindowProviderContext,
  useWindowContext,
  useWindowProviderContext,
  useIsInsideWindow,
  type WindowContextValue,
  type WindowProviderContextValue,
} from "./context.js";

// Re-export types
export type {
  WindowProps,
  BaseWindowProps,
  WindowHandle,
  WindowState,
  WindowId,
  Bounds,
  DisplayInfo,
  TitleBarOverlayOptions,
  AlwaysOnTopLevel,
  TitleBarStyle,
  VibrancyType,
  InjectStylesMode,
  TargetDisplay,
  WindowPoolConfig,
} from "../shared/types.js";
