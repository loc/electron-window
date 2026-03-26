import { useEffect, useRef, useSyncExternalStore } from "react";
import { useWindowContext } from "../context.js";
import type { Bounds, WindowState } from "../../shared/types.js";
import { wrapDocument } from "../docProxy.js";

/**
 * Returns the child window's Document object.
 *
 * Use this to portal UI library overlays (Radix UI, Base UI, etc.) to the
 * correct document — Radix's default is the parent window's document, which
 * causes portals to render in the wrong window.
 *
 * In dev/test, the returned Document is wrapped in a Proxy that warns on
 * access after the window closes — catches the common leak of stashing
 * the document in a ref or closure past its lifecycle.
 *
 * @throws if called outside an open `<Window>` or `<PooledWindow>`
 */
export function useWindowDocument(): Document {
  const { document, windowId } = useWindowContext();
  if (!document) {
    throw new Error("useWindowDocument must be called inside an open <Window> or <PooledWindow>");
  }
  // Proxy is identity-stable per (doc, windowId) — safe to call on every render.
  return wrapDocument(document, windowId ?? "");
}

/**
 * Returns an AbortSignal that fires when the **window** closes or releases
 * back to its pool. Pass to `addEventListener`, `fetch`, observers, etc.
 * for automatic cleanup on window close.
 *
 * The signal is WINDOW-scoped, not component-scoped — if your component
 * may unmount while the window stays open (conditional rendering), you
 * still need a useEffect cleanup return. Prefer {@link useWindowEventListener}
 * which handles both cases.
 *
 * @example
 * ```ts
 * const signal = useWindowSignal();
 * const doc = useWindowDocument();
 * useEffect(() => {
 *   doc.addEventListener("keydown", onKey, { signal });
 *   // signal removes on WINDOW close. Still return cleanup for
 *   // COMPONENT unmount (e.g. conditional <Panel> inside a window):
 *   return () => doc.removeEventListener("keydown", onKey);
 * }, [signal, doc]);
 * ```
 */
export function useWindowSignal(): AbortSignal {
  const { signal } = useWindowContext();
  if (!signal) {
    throw new Error("useWindowSignal must be called inside an open <Window> or <PooledWindow>");
  }
  return signal;
}

/**
 * Attach an event listener to the window's document that is automatically
 * removed when the window closes. Wraps `addEventListener(type, handler,
 * { signal })` in a useEffect so the handler can be an inline arrow.
 *
 * Re-attaches when `type` changes. The handler is read through a ref so
 * it can change identity without re-subscribing.
 *
 * @example
 * ```ts
 * useWindowEventListener("keydown", (e) => {
 *   if (e.key === "Escape") close();
 * });
 * ```
 */
export function useWindowEventListener<K extends keyof DocumentEventMap>(
  type: K,
  handler: (event: DocumentEventMap[K]) => void,
  options?: Omit<AddEventListenerOptions, "signal">,
): void {
  const { document, signal } = useWindowContext();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const { capture, passive, once } = options ?? {};

  useEffect(() => {
    if (!document || !signal) return;
    const wrapped = (e: DocumentEventMap[K]) => handlerRef.current(e);
    document.addEventListener(type, wrapped, { capture, passive, once, signal });
    // The signal removes the listener on window close. This cleanup
    // handles the dep-change case (e.g. type change) where the window
    // is still open and the signal hasn't fired.
    return () => document.removeEventListener(type, wrapped, { capture });
  }, [document, signal, type, capture, passive, once]);
}

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
