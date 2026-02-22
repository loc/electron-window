/**
 * Testing utilities entry point
 * @module @loc/electron-window/testing
 */

import React, { useCallback, useMemo, type ReactNode } from "react";
import {
  WindowProviderContext,
  type WindowProviderContextValue,
} from "../renderer/context.js";
import type {
  WindowId,
  WindowState,
  Bounds,
  WindowEvent,
} from "../shared/types.js";

/**
 * Mock window data for testing
 */
export interface MockWindow {
  id: WindowId;
  state: WindowState;
  props: Record<string, unknown>;
  events: WindowEvent[];
}

/**
 * Mock store for window data
 */
interface MockStore {
  windows: Map<WindowId, MockWindow>;
  listeners: Map<
    WindowId,
    Set<(event: { type: string; [key: string]: unknown }) => void>
  >;
}

// Global mock store
let mockStore: MockStore = {
  windows: new Map(),
  listeners: new Map(),
};

/**
 * Reset the mock store (call in beforeEach)
 */
export function resetMockWindows(): void {
  mockStore = {
    windows: new Map(),
    listeners: new Map(),
  };
}

/**
 * Get all mock windows
 */
export function getMockWindows(): MockWindow[] {
  return [...mockStore.windows.values()];
}

/**
 * Get a specific mock window by ID
 */
export function getMockWindow(id: WindowId): MockWindow | undefined {
  return mockStore.windows.get(id);
}

/**
 * Get mock windows by name (if name prop was provided)
 */
export function getMockWindowByName(name: string): MockWindow | undefined {
  for (const window of mockStore.windows.values()) {
    if (window.props.name === name) {
      return window;
    }
  }
  return undefined;
}

/**
 * Event without ID for simulation
 */
type SimulatedEvent =
  | { type: "closed" }
  | { type: "focused" }
  | { type: "blurred" }
  | { type: "maximized" }
  | { type: "unmaximized" }
  | { type: "minimized" }
  | { type: "restored" }
  | { type: "enterFullscreen" }
  | { type: "leaveFullscreen" }
  | { type: "boundsChanged"; bounds: Bounds }
  | { type: "userCloseRequested" }
  | { type: "ready" };

/**
 * Simulate a window event
 */
export function simulateMockWindowEvent(
  id: WindowId,
  event: SimulatedEvent,
): void {
  const window = mockStore.windows.get(id);
  if (!window) return;

  const fullEvent = { ...event, id } as WindowEvent;
  window.events.push(fullEvent);

  // Update state based on event
  switch (event.type) {
    case "focused":
      window.state.isFocused = true;
      break;
    case "blurred":
      window.state.isFocused = false;
      break;
    case "maximized":
      window.state.isMaximized = true;
      break;
    case "unmaximized":
      window.state.isMaximized = false;
      break;
    case "minimized":
      window.state.isMinimized = true;
      break;
    case "restored":
      window.state.isMinimized = false;
      break;
    case "enterFullscreen":
      window.state.isFullscreen = true;
      break;
    case "leaveFullscreen":
      window.state.isFullscreen = false;
      break;
    case "boundsChanged":
      if ("bounds" in event) {
        window.state.bounds = event.bounds as Bounds;
      }
      break;
  }

  // Notify listeners
  const listeners = mockStore.listeners.get(id);
  if (listeners) {
    for (const listener of listeners) {
      listener(fullEvent);
    }
  }
}

/**
 * Simulate user closing a window
 */
export function simulateMockUserClose(id: WindowId): void {
  simulateMockWindowEvent(id, { type: "userCloseRequested" });
}

/**
 * Simulate window resize
 */
export function simulateMockResize(id: WindowId, bounds: Bounds): void {
  simulateMockWindowEvent(id, { type: "boundsChanged", bounds });
}

/**
 * Props for MockWindowProvider
 */
export interface MockWindowProviderProps {
  children: ReactNode;
}

/**
 * Mock window provider for testing.
 * Use this instead of WindowProvider in tests.
 */
export function MockWindowProvider({
  children,
}: MockWindowProviderProps): JSX.Element {
  const registerWindow = useCallback(
    async (id: WindowId, props: Record<string, unknown>) => {
      const state: WindowState = {
        id,
        isFocused: false,
        isVisible: true,
        isMaximized: false,
        isMinimized: false,
        isFullscreen: false,
        bounds: {
          x: (props.defaultX as number) ?? (props.x as number) ?? 0,
          y: (props.defaultY as number) ?? (props.y as number) ?? 0,
          width:
            (props.defaultWidth as number) ?? (props.width as number) ?? 800,
          height:
            (props.defaultHeight as number) ?? (props.height as number) ?? 600,
        },
        title: (props.title as string) ?? "",
      };

      const window: MockWindow = {
        id,
        state,
        props,
        events: [],
      };

      mockStore.windows.set(id, window);

      // Emit ready event asynchronously so callers can set up subscriptions first
      setTimeout(() => {
        simulateMockWindowEvent(id, { type: "ready" });
      }, 0);
    },
    [],
  );

  const unregisterWindow = useCallback(async (id: WindowId) => {
    mockStore.windows.delete(id);
    mockStore.listeners.delete(id);
  }, []);

  const updateWindow = useCallback(
    async (id: WindowId, props: Record<string, unknown>) => {
      const window = mockStore.windows.get(id);
      if (!window) return;

      Object.assign(window.props, props);

      if ("title" in props) {
        window.state.title = props.title as string;
      }
      if (
        "width" in props ||
        "height" in props ||
        "x" in props ||
        "y" in props
      ) {
        window.state.bounds = {
          x: (props.x as number) ?? window.state.bounds.x,
          y: (props.y as number) ?? window.state.bounds.y,
          width: (props.width as number) ?? window.state.bounds.width,
          height: (props.height as number) ?? window.state.bounds.height,
        };
      }
    },
    [],
  );

  const destroyWindow = useCallback(async (id: WindowId) => {
    const window = mockStore.windows.get(id);
    if (!window) return;

    simulateMockWindowEvent(id, { type: "closed" });

    mockStore.windows.delete(id);
    mockStore.listeners.delete(id);
  }, []);

  const windowAction = useCallback(
    async (id: WindowId, action: { type: string; [key: string]: unknown }) => {
      const window = mockStore.windows.get(id);
      if (!window) return;

      switch (action.type) {
        case "focus":
          simulateMockWindowEvent(id, { type: "focused" });
          break;
        case "blur":
          simulateMockWindowEvent(id, { type: "blurred" });
          break;
        case "minimize":
          simulateMockWindowEvent(id, { type: "minimized" });
          break;
        case "maximize":
          simulateMockWindowEvent(id, { type: "maximized" });
          break;
        case "unmaximize":
          simulateMockWindowEvent(id, { type: "unmaximized" });
          break;
        case "close":
          simulateMockWindowEvent(id, { type: "userCloseRequested" });
          break;
        case "forceClose":
          await destroyWindow(id);
          break;
        case "setBounds":
          if ("bounds" in action) {
            const newBounds = {
              ...window.state.bounds,
              ...(action.bounds as Partial<Bounds>),
            };
            simulateMockWindowEvent(id, {
              type: "boundsChanged",
              bounds: newBounds,
            });
          }
          break;
        case "setTitle":
          if ("title" in action) {
            window.state.title = action.title as string;
          }
          break;
        case "enterFullscreen":
          simulateMockWindowEvent(id, { type: "enterFullscreen" });
          break;
        case "exitFullscreen":
          simulateMockWindowEvent(id, { type: "leaveFullscreen" });
          break;
      }
    },
    [destroyWindow],
  );

  const getWindowState = useCallback(
    async (id: WindowId): Promise<WindowState | null> => {
      return mockStore.windows.get(id)?.state ?? null;
    },
    [],
  );

  const subscribeToEvents = useCallback(
    (
      id: WindowId,
      callback: (event: { type: string; [key: string]: unknown }) => void,
    ) => {
      let listeners = mockStore.listeners.get(id);
      if (!listeners) {
        listeners = new Set();
        mockStore.listeners.set(id, listeners);
      }
      listeners.add(callback);

      return () => {
        listeners?.delete(callback);
      };
    },
    [],
  );

  const contextValue = useMemo<WindowProviderContextValue>(
    () => ({
      registerWindow,
      unregisterWindow,
      updateWindow,
      destroyWindow,
      windowAction,
      getWindowState,
      subscribeToEvents,
    }),
    [
      registerWindow,
      unregisterWindow,
      updateWindow,
      destroyWindow,
      windowAction,
      getWindowState,
      subscribeToEvents,
    ],
  );

  return React.createElement(
    WindowProviderContext.Provider,
    { value: contextValue },
    children,
  );
}
