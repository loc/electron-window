import {
  useCallback,
  useMemo,
  useRef,
  useEffect,
  type ReactNode,
  type ReactElement,
} from "react";
import {
  WindowProviderContext,
  type WindowProviderContextValue,
} from "./context.js";
import type { WindowId } from "../shared/types.js";
import { devWarning } from "../shared/utils.js";
import {
  WindowManager,
  type IWindowManagerRenderer,
  type WindowEvent,
  type WindowState,
} from "../generated-ipc/renderer/electron_window.js";

export interface WindowProviderProps {
  children: ReactNode;
  /** Log all IPC calls from the renderer with stack traces. Default: false. */
  debug?: boolean;
  /** Force-enable dev warnings. In sandboxed renderers, process.env.NODE_ENV isn't available — use this to opt in. */
  devWarnings?: boolean;
}

/**
 * Root provider for window management.
 * Must wrap the entire app to enable Window components.
 */
export function WindowProvider({
  children,
  debug = false,
  devWarnings,
}: WindowProviderProps): ReactElement {
  if (devWarnings !== undefined) {
    (globalThis as Record<string, unknown>).__ELECTRON_WINDOW_DEV__ =
      devWarnings;
  }

  const eventListeners = useRef<
    Map<WindowId, Set<(event: WindowEvent) => void>>
  >(new Map());

  const hasWarnedAboutBridgeRef = useRef(false);
  const api = useMemo<IWindowManagerRenderer | null>(() => {
    if (typeof window !== "undefined" && WindowManager) {
      return WindowManager as IWindowManagerRenderer;
    }
    if (typeof window !== "undefined" && !hasWarnedAboutBridgeRef.current) {
      hasWarnedAboutBridgeRef.current = true;
      devWarning(
        "@loc/electron-window preload bridge not found on window. " +
          "Make sure your preload script imports '@loc/electron-window/preload' " +
          "and is bundled (e.g., esbuild --format=cjs) before use.",
      );
    }
    return null;
  }, []);

  // Subscribe to global window events and route to per-window listeners
  useEffect(() => {
    if (!api?.onWindowEvent) return;

    const unsubscribe = api.onWindowEvent((event: WindowEvent) => {
      const listeners = eventListeners.current.get(event.id);
      if (listeners) {
        for (const listener of listeners) {
          listener(event);
        }
      }
    });

    return unsubscribe;
  }, [api]);

  // debug is stable per mount in practice; read via ref to avoid churning
  // callback identities (and the context value) when toggled.
  const debugRef = useRef(debug);
  debugRef.current = debug;
  const trace = (method: string, id: string, data?: unknown) => {
    if (!debugRef.current) return;
    const payload = data ? ` ${JSON.stringify(data)}` : "";
    console.trace(`[electron-window] → ${method} "${id}"${payload}`);
  };

  const registerWindow = useCallback(
    async (id: WindowId, props: Record<string, unknown>): Promise<boolean> => {
      trace("RegisterWindow", id, props);
      return (
        (await api?.RegisterWindow?.(
          id,
          props as Parameters<IWindowManagerRenderer["RegisterWindow"]>[1],
        )) ?? false
      );
    },
    [api],
  );

  const unregisterWindow = useCallback(
    async (id: WindowId) => {
      trace("UnregisterWindow", id);
      await api?.UnregisterWindow?.(id);
      eventListeners.current.delete(id);
    },
    [api],
  );

  const updateWindow = useCallback(
    async (id: WindowId, props: Record<string, unknown>) => {
      trace("UpdateWindow", id, props);
      await api?.UpdateWindow?.(
        id,
        props as Parameters<IWindowManagerRenderer["UpdateWindow"]>[1],
      );
    },
    [api],
  );

  const destroyWindow = useCallback(
    async (id: WindowId) => {
      trace("DestroyWindow", id);
      await api?.DestroyWindow?.(id);
      eventListeners.current.delete(id);
    },
    [api],
  );

  const windowAction = useCallback(
    async (id: WindowId, action: { type: string; [key: string]: unknown }) => {
      trace("WindowAction", id, action);
      await api?.WindowAction?.(
        id,
        action as Parameters<IWindowManagerRenderer["WindowAction"]>[1],
      );
    },
    [api],
  );

  const getWindowState = useCallback(
    async (id: WindowId): Promise<WindowState | null> => {
      return api?.GetWindowState?.(id) ?? null;
    },
    [api],
  );

  const subscribeToEvents = useCallback(
    (
      id: WindowId,
      callback: (event: { type: string; [key: string]: unknown }) => void,
    ) => {
      let listeners = eventListeners.current.get(id);
      if (!listeners) {
        listeners = new Set();
        eventListeners.current.set(id, listeners);
      }
      const wrappedCallback = (event: WindowEvent) =>
        callback(event as unknown as { type: string; [key: string]: unknown });
      listeners.add(wrappedCallback);

      return () => {
        listeners?.delete(wrappedCallback);
        if (listeners?.size === 0) {
          eventListeners.current.delete(id);
        }
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

  return (
    <WindowProviderContext.Provider value={contextValue}>
      {children}
    </WindowProviderContext.Provider>
  );
}
