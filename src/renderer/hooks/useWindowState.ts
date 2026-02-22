import { useSyncExternalStore } from "react";
import { useWindowContext } from "../context.js";
import type { Bounds, WindowState } from "../../shared/types.js";

const DEFAULT_BOUNDS: Bounds = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Hook to subscribe to window focus state
 * Re-renders when focus changes
 */
export function useWindowFocused(): boolean {
  const { subscribe, getSnapshot } = useWindowContext();

  return useSyncExternalStore(
    subscribe,
    () => getSnapshot()?.isFocused ?? false,
    () => false,
  );
}

/**
 * Hook to subscribe to window visibility state
 * Re-renders when visibility changes
 */
export function useWindowVisible(): boolean {
  const { subscribe, getSnapshot } = useWindowContext();

  return useSyncExternalStore(
    subscribe,
    () => getSnapshot()?.isVisible ?? false,
    () => false,
  );
}

/**
 * Hook to subscribe to window maximized state
 * Re-renders when maximized state changes
 */
export function useWindowMaximized(): boolean {
  const { subscribe, getSnapshot } = useWindowContext();

  return useSyncExternalStore(
    subscribe,
    () => getSnapshot()?.isMaximized ?? false,
    () => false,
  );
}

/**
 * Hook to subscribe to window minimized state
 * Re-renders when minimized state changes
 */
export function useWindowMinimized(): boolean {
  const { subscribe, getSnapshot } = useWindowContext();

  return useSyncExternalStore(
    subscribe,
    () => getSnapshot()?.isMinimized ?? false,
    () => false,
  );
}

/**
 * Hook to subscribe to window fullscreen state
 * Re-renders when fullscreen state changes
 */
export function useWindowFullscreen(): boolean {
  const { subscribe, getSnapshot } = useWindowContext();

  return useSyncExternalStore(
    subscribe,
    () => getSnapshot()?.isFullscreen ?? false,
    () => false,
  );
}

/**
 * Hook to subscribe to window bounds
 * Re-renders when bounds change
 */
export function useWindowBounds(): Bounds {
  const { subscribe, getSnapshot } = useWindowContext();

  return useSyncExternalStore(
    subscribe,
    () => getSnapshot()?.bounds ?? DEFAULT_BOUNDS,
    () => DEFAULT_BOUNDS,
  );
}

/**
 * Hook to subscribe to full window state
 * Re-renders on any state change
 */
export function useWindowState(): WindowState | null {
  const { subscribe, getSnapshot } = useWindowContext();

  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
