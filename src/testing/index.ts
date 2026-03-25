/**
 * Testing utilities entry point
 * @module @loc/electron-window/testing
 */

import React, { useCallback, useMemo, type ReactNode, type ReactElement } from "react";
// Import contexts from the PACKAGE ENTRY, not relative paths. With
// @loc/electron-window marked as external in the testing tsup build, this
// becomes a literal `import ... from "@loc/electron-window"` in dist —
// so MockWindowProvider/MockWindow use the SAME React context instances
// as the real Window/WindowProvider. Relative imports would be inlined by
// the bundler, creating duplicate createContext() calls → context mismatch.
import {
  WindowContext,
  WindowProviderContext,
  type WindowContextValue,
  type WindowProviderContextValue,
  type WindowId,
  type WindowState,
  type Bounds,
  type DisplayInfo,
} from "@loc/electron-window";
import type { WindowEvent } from "../shared/types.js";

/**
 * Mock window data for testing
 */
export interface MockWindowData {
  id: WindowId;
  state: WindowState;
  props: Record<string, unknown>;
  events: WindowEvent[];
}

/**
 * Mock store for window data
 */
interface MockStore {
  windows: Map<WindowId, MockWindowData>;
  listeners: Map<WindowId, Set<(event: { type: string; [key: string]: unknown }) => void>>;
}

// Global mock store
let mockStore: MockStore = {
  windows: new Map(),
  listeners: new Map(),
};

/**
 * When true, MockWindowProvider.registerWindow returns false — simulating
 * main-process rejection (maxWindows/maxPendingWindows limit). Cleared by
 * resetMockWindows(); toggle per-test with setMockRejectRegistration().
 */
let rejectRegistration = false;

/**
 * Make the next (and subsequent) registerWindow calls return false, as if
 * the main process hit maxWindows. Call with `false` to restore normal
 * behavior, or rely on resetMockWindows() in beforeEach.
 */
export function setMockRejectRegistration(reject: boolean): void {
  rejectRegistration = reject;
}

/**
 * Reset the mock store (call in beforeEach)
 */
export function resetMockWindows(): void {
  mockStore = {
    windows: new Map(),
    listeners: new Map(),
  };
  rejectRegistration = false;
}

/**
 * Get all mock windows
 */
export function getMockWindows(): MockWindowData[] {
  return [...mockStore.windows.values()];
}

/**
 * Get a specific mock window by ID
 */
export function getMockWindow(id: WindowId): MockWindowData | undefined {
  return mockStore.windows.get(id);
}

/**
 * Get mock windows by name (if name prop was provided)
 */
export function getMockWindowByName(name: string): MockWindowData | undefined {
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
export type SimulatedEvent =
  | { type: "closed" }
  | { type: "focused" }
  | { type: "blurred" }
  | { type: "maximized" }
  | { type: "unmaximized" }
  | { type: "minimized" }
  | { type: "restored" }
  | { type: "shown" }
  | { type: "hidden" }
  | { type: "enterFullscreen" }
  | { type: "leaveFullscreen" }
  | { type: "boundsChanged"; bounds: Bounds }
  | { type: "userCloseRequested" }
  | { type: "displayChanged"; display: DisplayInfo }
  | { type: "ready" };

/**
 * Simulate a window event
 */
export function simulateMockWindowEvent(id: WindowId, event: SimulatedEvent): void {
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
    case "shown":
      window.state.isVisible = true;
      break;
    case "hidden":
      window.state.isVisible = false;
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
export function MockWindowProvider({ children }: MockWindowProviderProps): ReactElement {
  const registerWindow = useCallback(
    async (id: WindowId, props: Record<string, unknown>): Promise<boolean> => {
      if (rejectRegistration) return false;
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
          width: (props.defaultWidth as number) ?? (props.width as number) ?? 800,
          height: (props.defaultHeight as number) ?? (props.height as number) ?? 600,
        },
        title: (props.title as string) ?? "",
      };

      const window: MockWindowData = {
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
      return true;
    },
    [],
  );

  const unregisterWindow = useCallback(async (id: WindowId) => {
    mockStore.windows.delete(id);
    mockStore.listeners.delete(id);
    // Mirror real behavior: UnregisterWindow → BrowserWindow.destroy() →
    // renderer's Window proxy .closed = true. The window.open mock (in
    // tests/setup.ts) tracks windows by name; close it so tests that
    // assert on getGlobalMockWindows().size see the window gone.
    const mockWindows = (globalThis as Record<string, unknown>).__mockWindows__ as
      | Map<string, { destroy: () => void; close: () => void }>
      | undefined;
    // Use destroy() (not close()) — matches real BrowserWindow.destroy()
    // which does NOT fire unload. This exercises the "destroy doesn't fire
    // unload" path that the production code has explicit handling for
    // (styleCleanupRef, pool.notifyDestroyed, etc.).
    mockWindows?.get(id)?.destroy();
  }, []);

  const updateWindow = useCallback(async (id: WindowId, props: Record<string, unknown>) => {
    const window = mockStore.windows.get(id);
    if (!window) return;

    Object.assign(window.props, props);

    if ("title" in props) {
      window.state.title = props.title as string;
    }
    if ("width" in props || "height" in props || "x" in props || "y" in props) {
      window.state.bounds = {
        x: (props.x as number) ?? window.state.bounds.x,
        y: (props.y as number) ?? window.state.bounds.y,
        width: (props.width as number) ?? window.state.bounds.width,
        height: (props.height as number) ?? window.state.bounds.height,
      };
    }
    // Mirror real WindowInstance.updateProps: visible triggers show()/hide()
    // which emit shown/hidden events. Without this, tests can't observe
    // visible-prop-driven visibility transitions.
    if ("visible" in props && props.visible !== window.state.isVisible) {
      simulateMockWindowEvent(id, props.visible === false ? { type: "hidden" } : { type: "shown" });
    }
  }, []);

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
        case "show":
          simulateMockWindowEvent(id, { type: "shown" });
          break;
        case "hide":
          simulateMockWindowEvent(id, { type: "hidden" });
          break;
      }
    },
    [destroyWindow],
  );

  const getWindowState = useCallback(async (id: WindowId): Promise<WindowState | null> => {
    return mockStore.windows.get(id)?.state ?? null;
  }, []);

  const subscribeToEvents = useCallback(
    (id: WindowId, callback: (event: { type: string; [key: string]: unknown }) => void) => {
      let listeners = mockStore.listeners.get(id);
      if (!listeners) {
        listeners = new Set();
        mockStore.listeners.set(id, listeners);
      }
      listeners.add(callback);

      return () => {
        listeners?.delete(callback);
        // Match real WindowProvider: clean up empty listener sets so the
        // map doesn't grow unbounded across mount/unmount cycles.
        if (listeners?.size === 0) {
          mockStore.listeners.delete(id);
        }
      };
    },
    [],
  );

  const contextValue = useMemo<WindowProviderContextValue>(
    () => ({
      hasBridge: true,
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

  return React.createElement(WindowProviderContext.Provider, { value: contextValue }, children);
}

/**
 * Props for MockWindow
 */
export interface MockWindowComponentProps {
  children: React.ReactNode;
  id?: string;
  state?: Partial<WindowState>;
}

/**
 * Wraps children in a WindowContext.Provider with configurable state.
 * Use this to test components that call useCurrentWindow() without needing
 * a real <Window> or MockWindowProvider.
 *
 * @example
 * render(
 *   <MockWindow state={{ isFocused: true }}>
 *     <MyPanel />
 *   </MockWindow>
 * );
 */
export function MockWindow({
  children,
  id = "mock-window",
  state = {},
}: MockWindowComponentProps): ReactElement {
  // useSyncExternalStore requires getSnapshot() to return a stable reference
  // unless state changed — a new object each render triggers React's
  // "getSnapshot should be cached" warning and causes thrashing.
  const fullState: WindowState = useMemo(
    () => ({
      id,
      isFocused: false,
      isVisible: true,
      isMaximized: false,
      isMinimized: false,
      isFullscreen: false,
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      title: "",
      ...state,
    }),
    [id, state],
  );

  const contextValue: WindowContextValue = useMemo(
    () => ({
      windowId: id,
      subscribe: (_listener) => () => {},
      getSnapshot: () => fullState,
      getDisplaySnapshot: () => null,
      document: null,
      signal: null,
    }),
    [id, fullState],
  );

  return React.createElement(WindowContext.Provider, { value: contextValue }, children);
}

// ─── Leak testing ────────────────────────────────────────────────────────────

export interface LeakTester {
  /**
   * Run `fn` and record which child windows were opened during it.
   * Typically `fn` opens one or more <Window>s then closes them.
   */
  track: (fn: () => void | Promise<void>) => Promise<void>;
  /**
   * Assert that every window opened during `track()` has been GC'd.
   * Forces garbage collection (requires `--expose-gc` or a CDP-capable
   * test runner), waits a tick, then throws if any WeakRef still derefs.
   */
  expectNoLeaks: () => Promise<void>;
}

/**
 * Create a leak tester for child windows.
 *
 * Requires dev/test mode (NODE_ENV !== "production" or `devWarnings` on
 * WindowProvider) so that window tracking is active.
 *
 * For `expectNoLeaks()` to force GC, run your test process with
 * `--js-flags=--expose-gc` (Electron) or `--expose-gc` (Node). Without
 * it, GC is best-effort — the test may pass when there IS a leak simply
 * because the VM hasn't collected yet.
 *
 * @example
 * ```ts
 * const leaks = createLeakTester();
 * await leaks.track(async () => {
 *   render(<MyWindowComponent open />);
 *   // ... interact ...
 *   render(<MyWindowComponent open={false} />);
 * });
 * await leaks.expectNoLeaks();
 * ```
 */
export function createLeakTester(): LeakTester {
  // Read the same global the renderer writes to. Declared inline rather
  // than imported so this bundle doesn't need to resolve renderer paths.
  const getRefs = (): readonly WeakRef<globalThis.Window>[] => {
    const arr = (globalThis as Record<string, unknown>).__ELECTRON_WINDOW_TRACKED__ as
      | WeakRef<globalThis.Window>[]
      | undefined;
    return arr ?? [];
  };

  let startLen = 0;
  let endLen = 0;

  return {
    async track(fn) {
      startLen = getRefs().length;
      await fn();
      endLen = getRefs().length;
    },

    async expectNoLeaks() {
      await forceGC();
      // Two microtask turns: FinalizationRegistry / WeakRef clearing is
      // not guaranteed synchronous with gc(). A second turn covers the
      // common case of a promise-resolution in between.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));

      const refs = getRefs();
      const slice = refs.slice(startLen, endLen);
      const alive = slice.filter((r) => r.deref() !== undefined);

      if (alive.length > 0) {
        throw new Error(
          `[electron-window] ${alive.length} of ${slice.length} window(s) opened during track() ` +
            `were not garbage-collected. Something is retaining a reference to the ` +
            `child Window or its Document (event listeners, closures, refs).`,
        );
      }
    },
  };
}

/**
 * Force a garbage collection if possible. Tries, in order:
 *  1. globalThis.gc (available with --expose-gc)
 *  2. CDP HeapProfiler.collectGarbage (Playwright / Puppeteer attach)
 *  3. Fallback: warn and continue (test may false-pass)
 */
async function forceGC(): Promise<void> {
  const g = globalThis as Record<string, unknown>;

  if (typeof g.gc === "function") {
    (g.gc as () => void)();
    return;
  }

  // Playwright exposes a CDP session on window.__PW_CDP__ in some setups,
  // or the test can inject one. Check for a callable that takes a method name.
  const cdp = g.__pw_cdp__ ?? g.__CDP__;
  if (cdp && typeof (cdp as { send?: unknown }).send === "function") {
    try {
      await (cdp as { send: (m: string) => Promise<void> }).send("HeapProfiler.collectGarbage");
      return;
    } catch {
      // fall through
    }
  }

  console.warn(
    "[electron-window] createLeakTester: cannot force GC. " +
      "Run with --expose-gc (Node) or --js-flags=--expose-gc (Electron) for reliable leak detection. " +
      "Without forced GC, expectNoLeaks() may pass even when a leak exists.",
  );
}
