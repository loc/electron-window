/**
 * Main process entry point
 * @module @loc/electron-window/main
 */

export { WindowManager, setupWindowManager, getWindowManager } from "./WindowManager.js";
export type {
  WindowManagerConfig,
  SetupOptions,
  WindowOpenHandlerResult,
} from "./WindowManager.js";
export { WindowInstance } from "./WindowInstance.js";

// Re-export types needed in main process
export type {
  WindowPoolConfig,
  Bounds,
  WindowState,
  WindowId,
  WindowEvent,
  WindowAction,
} from "../shared/types.js";
