/**
 * Preload script entry point
 * @module @loc/electron-window/preload
 *
 * Import this in your preload script to set up the IPC bridge:
 *
 * ```ts
 * // preload.ts
 * import '@loc/electron-window/preload';
 * ```
 *
 * Note: The preload script MUST be bundled before use.
 * Use esbuild or another bundler to bundle the preload script.
 */

// Import the generated preload setup which handles contextBridge exposure
// This automatically exposes the WindowManager API via contextBridge
import "../generated-ipc/preload/electron_window.js";

// Re-export types for convenience
export type {
  WindowId,
  WindowState,
  Bounds,
  DisplayInfo,
  WindowEvent,
  WindowProps,
  WindowAction,
  IWindowManagerRenderer,
} from "../generated-ipc/common/electron_window.js";
