import { createContext, useContext } from "react";
import type {
  WindowId,
  WindowState,
  WindowHandle,
  DisplayInfo,
} from "../shared/types.js";

/**
 * Internal window context value
 */
export interface WindowContextValue {
  /** Current window ID */
  windowId: WindowId | null;

  /** Current window state */
  state: WindowState | null;

  /** Current display info */
  display: DisplayInfo | null;

  /** Window handle for imperative access */
  handle: WindowHandle | null;

  /** Subscribe to state changes */
  subscribe: (listener: () => void) => () => void;

  /** Get current state snapshot */
  getSnapshot: () => WindowState | null;

  /** Get current display snapshot */
  getDisplaySnapshot: () => DisplayInfo | null;
}

/**
 * Context for the current window
 */
export const WindowContext = createContext<WindowContextValue | null>(null);

/**
 * Context for the root WindowProvider
 */
export interface WindowProviderContextValue {
  /** Pre-register props with main process before calling window.open */
  registerWindow: (
    id: WindowId,
    props: Record<string, unknown>,
  ) => Promise<void>;

  /** Unregister a window and clean up resources */
  unregisterWindow: (id: WindowId) => Promise<void>;

  /** Update window props (for changeable props after creation) */
  updateWindow: (id: WindowId, props: Record<string, unknown>) => Promise<void>;

  /** Destroy a window */
  destroyWindow: (id: WindowId) => Promise<void>;

  /** Perform window action */
  windowAction: (
    id: WindowId,
    action: { type: string; [key: string]: unknown },
  ) => Promise<void>;

  /** Get window state */
  getWindowState: (id: WindowId) => Promise<WindowState | null>;

  /** Subscribe to window events */
  subscribeToEvents: (
    id: WindowId,
    callback: (event: { type: string; [key: string]: unknown }) => void,
  ) => () => void;
}

export const WindowProviderContext =
  createContext<WindowProviderContextValue | null>(null);

/**
 * Hook to get the window provider context
 */
export function useWindowProviderContext(): WindowProviderContextValue {
  const context = useContext(WindowProviderContext);
  if (!context) {
    throw new Error(
      "useWindowProviderContext must be used within a WindowProvider",
    );
  }
  return context;
}

/**
 * Hook to get the current window context
 */
export function useWindowContext(): WindowContextValue {
  const context = useContext(WindowContext);
  if (!context) {
    throw new Error("useWindowContext must be used within a Window component");
  }
  return context;
}

/**
 * Hook to check if we're inside a window context
 */
export function useIsInsideWindow(): boolean {
  const context = useContext(WindowContext);
  return context !== null;
}
