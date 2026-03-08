import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import type { WindowId, WindowState, WindowHandle, Bounds, DisplayInfo } from "../shared/types.js";
import type { WindowContextValue, WindowProviderContextValue } from "./context.js";
import { debounce } from "../shared/utils.js";
import { BOUNDS_CHANGE_DEBOUNCE_MS } from "./windowUtils.js";

/**
 * A not-ready handle with no-op methods, used before the window is ready.
 * Frozen — this is a shared singleton across all windows; mutation would
 * affect every window's pre-ready ref.
 */
export const NOT_READY_HANDLE: WindowHandle = Object.freeze({
  id: "",
  isReady: false,
  isFocused: false,
  isMaximized: false,
  isMinimized: false,
  isFullscreen: false,
  bounds: Object.freeze({ x: 0, y: 0, width: 0, height: 0 }),
  focus: () => {},
  blur: () => {},
  minimize: () => {},
  maximize: () => {},
  unmaximize: () => {},
  toggleMaximize: () => {},
  close: () => {},
  forceClose: () => {},
  setBounds: () => {},
  setTitle: () => {},
  enterFullscreen: () => {},
  exitFullscreen: () => {},
});

export interface WindowLifecycleOptions {
  windowId: WindowId | null;
  isReady: boolean;
  provider: WindowProviderContextValue;
  /** Ref to the child window (for setTitle via document.title) */
  childWindowRef?: React.RefObject<globalThis.Window | null>;
  /** The child window's Document, for portaling UI library overlays */
  childDocument?: Document | null;
  /** Callbacks — all optional */
  onBoundsChange?: (bounds: Bounds) => void;
  onUserClose?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onClose?: () => void;
  onMaximize?: () => void;
  onUnmaximize?: () => void;
  onMinimize?: () => void;
  onRestore?: () => void;
  onEnterFullscreen?: () => void;
  onExitFullscreen?: () => void;
  onDisplayChange?: (display: DisplayInfo) => void;
  /** Optional persistence */
  persistBoundsKey?: string;
  persistenceSave?: (bounds: Bounds) => void;
  /**
   * Called when the 'closed' event fires so the caller can reset its own
   * component-owned state (portalTarget, isReady, childWindowRef, etc.).
   * The hook resets its own windowState internally.
   */
  onWindowClosedSetState?: () => void;
}

export interface WindowLifecycleResult {
  windowState: WindowState | null;
  setWindowState: (next: WindowState | null) => void;
  displayInfo: DisplayInfo | null;
  contextValue: WindowContextValue;
  debouncedBoundsChange: React.MutableRefObject<
    ReturnType<typeof debounce<(bounds: Bounds) => void>>
  >;
  /**
   * Reset ALL hook-owned state: windowState, displayInfo, and cancel the
   * pending debounced onBoundsChange. Call this from every teardown path
   * (open=false, shape-change, onWindowClosedSetState, unload, unmount).
   * Component-owned state (refs, portalTarget, isReady) is the caller's job.
   *
   * Introduced after the FOURTH teardown-asymmetry bug — each teardown
   * path was resetting a slightly different subset, and each miss was
   * either a stale-state leak (displayInfo) or a late-firing callback
   * (debounced onBoundsChange firing after release).
   */
  resetLifecycle: () => void;
}

export function useWindowLifecycle(opts: WindowLifecycleOptions): WindowLifecycleResult {
  const { windowId, isReady, provider } = opts;

  const [windowState, _setWindowState] = useState<WindowState | null>(null);
  const [displayInfo, setDisplayInfo] = useState<DisplayInfo | null>(null);

  // Store all callbacks in refs to avoid re-subscription when callbacks change
  const onBoundsChangeRef = useRef(opts.onBoundsChange);
  onBoundsChangeRef.current = opts.onBoundsChange;
  const onUserCloseRef = useRef(opts.onUserClose);
  onUserCloseRef.current = opts.onUserClose;
  const onFocusRef = useRef(opts.onFocus);
  onFocusRef.current = opts.onFocus;
  const onBlurRef = useRef(opts.onBlur);
  onBlurRef.current = opts.onBlur;
  const onCloseRef = useRef(opts.onClose);
  onCloseRef.current = opts.onClose;
  const onMaximizeRef = useRef(opts.onMaximize);
  onMaximizeRef.current = opts.onMaximize;
  const onUnmaximizeRef = useRef(opts.onUnmaximize);
  onUnmaximizeRef.current = opts.onUnmaximize;
  const onMinimizeRef = useRef(opts.onMinimize);
  onMinimizeRef.current = opts.onMinimize;
  const onRestoreRef = useRef(opts.onRestore);
  onRestoreRef.current = opts.onRestore;
  const onEnterFullscreenRef = useRef(opts.onEnterFullscreen);
  onEnterFullscreenRef.current = opts.onEnterFullscreen;
  const onExitFullscreenRef = useRef(opts.onExitFullscreen);
  onExitFullscreenRef.current = opts.onExitFullscreen;
  const onDisplayChangeRef = useRef(opts.onDisplayChange);
  onDisplayChangeRef.current = opts.onDisplayChange;
  const persistBoundsKeyRef = useRef(opts.persistBoundsKey);
  persistBoundsKeyRef.current = opts.persistBoundsKey;
  const persistenceSaveRef = useRef(opts.persistenceSave);
  persistenceSaveRef.current = opts.persistenceSave;
  const onWindowClosedSetStateRef = useRef(opts.onWindowClosedSetState);
  onWindowClosedSetStateRef.current = opts.onWindowClosedSetState;

  // Stable debounced bounds handler — reads latest callbacks via refs
  const debouncedBoundsChange = useRef(
    debounce((bounds: Bounds) => {
      onBoundsChangeRef.current?.(bounds);
      if (persistBoundsKeyRef.current && persistenceSaveRef.current) {
        persistenceSaveRef.current(bounds);
      }
    }, BOUNDS_CHANGE_DEBOUNCE_MS),
  );

  // State subscription for useSyncExternalStore in child hooks
  const stateListeners = useRef<Set<() => void>>(new Set());

  // Refs holding latest snapshots — allows getSnapshot/getDisplaySnapshot to
  // be stable (no deps) while still returning up-to-date values.
  //
  // THE REF IS THE SINGLE SOURCE OF TRUTH. React state mirrors it (to drive
  // renders) but is never read back. Every write path — the wrapper below,
  // patchState, resetLifecycle — writes ref FIRST, then copies ref → React
  // state. No render-body re-sync needed; nothing bails on React's queued
  // state (which can lag behind the ref during batching).
  const windowStateRef = useRef<WindowState | null>(null);
  const displayInfoRef = useRef<DisplayInfo | null>(null);

  // Wrapped setter: ref → React state → notify, in that order.
  const setWindowState = useCallback((next: WindowState | null) => {
    windowStateRef.current = next;
    _setWindowState(next);
    for (const l of stateListeners.current) l();
  }, []);

  // Reset ALL hook-owned state. Cancel the debounce BEFORE nulling state —
  // otherwise a pending timer could fire the consumer's onBoundsChange
  // after the window is released. Update both refs BEFORE the single notify
  // so getSnapshot/getDisplaySnapshot both return null when listeners run.
  const resetLifecycle = useCallback(() => {
    debouncedBoundsChange.current.cancel();
    displayInfoRef.current = null;
    setDisplayInfo(null);
    windowStateRef.current = null;
    _setWindowState(null);
    for (const l of stateListeners.current) l();
  }, []);

  // Subscribe to window events — only re-subscribes when windowId/isReady/provider changes
  useEffect(() => {
    if (!isReady || !windowId) return;

    const unsubscribe = provider.subscribeToEvents(windowId, (event) => {
      // Apply a patch to the ref, then mirror ref → React state.
      //
      // Bails ONLY on the ref. No functional updater — that would bail on
      // React's queued `s`, which can disagree with the ref when a wrapper
      // call queued `null` that hasn't committed yet (late IPC event would
      // resurrect the old state through the updater).
      //
      // Preserves `bounds` reference when the patch doesn't touch it, so
      // useWindowBounds() doesn't re-render on focus/blur/etc.
      //
      // Listener notify is at the end of the event handler, not here —
      // multiple patchState calls per event would double-notify.
      function patchState(patch: Partial<WindowState>): void {
        const prev = windowStateRef.current;
        if (!prev) return;
        const next = { ...prev, ...patch };
        if (patch.bounds === undefined) next.bounds = prev.bounds;
        windowStateRef.current = next;
        _setWindowState(next);
      }

      switch (event.type) {
        case "focused":
          patchState({ isFocused: true });
          onFocusRef.current?.();
          break;
        case "blurred":
          patchState({ isFocused: false });
          onBlurRef.current?.();
          break;
        case "maximized":
          patchState({ isMaximized: true });
          onMaximizeRef.current?.();
          break;
        case "unmaximized":
          patchState({ isMaximized: false });
          onUnmaximizeRef.current?.();
          break;
        case "minimized":
          patchState({ isMinimized: true });
          onMinimizeRef.current?.();
          break;
        case "restored":
          patchState({ isMinimized: false });
          onRestoreRef.current?.();
          break;
        case "shown":
          patchState({ isVisible: true });
          break;
        case "hidden":
          patchState({ isVisible: false });
          break;
        case "enterFullscreen":
          patchState({ isFullscreen: true });
          onEnterFullscreenRef.current?.();
          break;
        case "leaveFullscreen":
          patchState({ isFullscreen: false });
          onExitFullscreenRef.current?.();
          break;
        case "boundsChanged":
          if (event.bounds) {
            const bounds = event.bounds as Bounds;
            patchState({ bounds });
            debouncedBoundsChange.current(bounds);
          }
          break;
        case "displayChanged":
          if (event.display) {
            const display = event.display as DisplayInfo;
            displayInfoRef.current = display;
            setDisplayInfo(display);
            onDisplayChangeRef.current?.(display);
          }
          break;
        case "userCloseRequested":
          onUserCloseRef.current?.();
          break;
        case "closed":
          // resetLifecycle handles refs + state + debounce cancel. It also
          // notifies listeners, so return early — don't fall through to the
          // second notify at the end of the handler.
          resetLifecycle();
          onWindowClosedSetStateRef.current?.();
          onCloseRef.current?.();
          return;
      }

      // Notify useSyncExternalStore subscribers synchronously. The refs are
      // already updated above, so getSnapshot() returns the new value here,
      // before React has committed the corresponding setState.
      for (const listener of stateListeners.current) {
        listener();
      }
    });

    return unsubscribe;
  }, [isReady, windowId, provider, resetLifecycle]);

  const subscribe = useCallback((listener: () => void) => {
    stateListeners.current.add(listener);
    return () => {
      stateListeners.current.delete(listener);
    };
  }, []);

  // Stable snapshots — read from refs, no deps needed
  const getSnapshot = useCallback(() => windowStateRef.current, []);
  const getDisplaySnapshot = useCallback(() => displayInfoRef.current, []);

  // contextValue is stable as long as windowId, subscribe, and document don't change.
  // State is no longer in the value, so boundsChanged / focus events don't
  // cause a new context object and don't force all portal children to re-render.
  const contextValue = useMemo<WindowContextValue>(
    () => ({
      windowId,
      subscribe,
      getSnapshot,
      getDisplaySnapshot,
      document: opts.childDocument ?? null,
    }),
    [windowId, subscribe, getSnapshot, getDisplaySnapshot, opts.childDocument],
  );

  return {
    windowState,
    setWindowState,
    displayInfo,
    contextValue,
    debouncedBoundsChange,
    resetLifecycle,
  };
}
