import { useCallback, useMemo, useRef, useEffect, type ReactNode } from "react";
import {
  WindowProviderContext,
  type WindowProviderContextValue,
} from "./context.js";
import type { WindowId } from "../shared/types.js";
import {
  WindowManager,
  type IWindowManagerRenderer,
  type WindowEvent,
  type WindowState,
} from "../generated-ipc/renderer/electron_window.js";

export interface WindowProviderProps {
  children: ReactNode;
}

/**
 * Root provider for window management.
 * Must wrap the entire app to enable Window components.
 */
export function WindowProvider({ children }: WindowProviderProps): JSX.Element {
  const eventListeners = useRef<
    Map<WindowId, Set<(event: WindowEvent) => void>>
  >(new Map());

  const api = useMemo<IWindowManagerRenderer | null>(() => {
    if (typeof window !== "undefined" && WindowManager) {
      return WindowManager as IWindowManagerRenderer;
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

  const registerWindow = useCallback(
    async (id: WindowId, props: Record<string, unknown>) => {
      await api?.RegisterWindow?.(
        id,
        props as Parameters<IWindowManagerRenderer["RegisterWindow"]>[1],
      );
    },
    [api],
  );

  const unregisterWindow = useCallback(
    async (id: WindowId) => {
      await api?.UnregisterWindow?.(id);
      eventListeners.current.delete(id);
    },
    [api],
  );

  const updateWindow = useCallback(
    async (id: WindowId, props: Record<string, unknown>) => {
      await api?.UpdateWindow?.(
        id,
        props as Parameters<IWindowManagerRenderer["UpdateWindow"]>[1],
      );
    },
    [api],
  );

  const destroyWindow = useCallback(
    async (id: WindowId) => {
      await api?.DestroyWindow?.(id);
      eventListeners.current.delete(id);
    },
    [api],
  );

  const windowAction = useCallback(
    async (id: WindowId, action: { type: string; [key: string]: unknown }) => {
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
