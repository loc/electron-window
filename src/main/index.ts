/**
 * Main process entry point
 * @module @loc/electron-window/main
 */

export {
  WindowManager,
  setupWindowManager,
  getWindowManager,
} from "./WindowManager.js";
export type {
  WindowManagerConfig,
  SecurityValidator,
} from "./WindowManager.js";
export { WindowInstance } from "./WindowInstance.js";
export { WindowPool, ResourcePool, createWindowPool } from "./WindowPool.js";

// Re-export types needed in main process
export type {
  WindowPoolConfig,
  WindowShape,
  Bounds,
  WindowState,
  WindowId,
  WindowEvent,
  WindowAction,
} from "../shared/types.js";
