import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import type {
  WindowId,
  WindowState,
  WindowHandle,
  Bounds,
  DisplayInfo,
} from "../shared/types.js";
import type {
  WindowContextValue,
  WindowProviderContextValue,
} from "./context.js";
import { debounce } from "../shared/utils.js";
import { BOUNDS_CHANGE_DEBOUNCE_MS } from "./windowUtils.js";

/** A not-ready handle with no-op methods, used before the window is ready */
export const NOT_READY_HANDLE: WindowHandle = {
  id: "",
  isReady: false,
  isFocused: false,
  isMaximized: false,
  isMinimized: false,
  isFullscreen: false,
  bounds: { x: 0, y: 0, width: 0, height: 0 },
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
};

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
  setWindowState: React.Dispatch<React.SetStateAction<WindowState | null>>;
  displayInfo: DisplayInfo | null;
  setDisplayInfo: React.Dispatch<React.SetStateAction<DisplayInfo | null>>;
  contextValue: WindowContextValue;
  debouncedBoundsChange: React.MutableRefObject<
    ReturnType<typeof debounce<(bounds: Bounds) => void>>
  >;
}

export function useWindowLifecycle(
  opts: WindowLifecycleOptions,
): WindowLifecycleResult {
  const { windowId, isReady, provider } = opts;

  const [windowState, setWindowState] = useState<WindowState | null>(null);
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
  const windowStateRef = useRef<WindowState | null>(null);
  const displayInfoRef = useRef<DisplayInfo | null>(null);
  windowStateRef.current = windowState;
  displayInfoRef.current = displayInfo;

  // Subscribe to window events — only re-subscribes when windowId/isReady/provider changes
  useEffect(() => {
    if (!isReady || !windowId) return;

    const unsubscribe = provider.subscribeToEvents(windowId, (event) => {
      // Helper: apply a patch to windowStateRef and schedule the React state
      // update. We update the ref first so that getSnapshot() returns the new
      // value synchronously when we notify useSyncExternalStore listeners below.
      function patchState(patch: Partial<WindowState>): void {
        if (windowStateRef.current) {
          windowStateRef.current = { ...windowStateRef.current, ...patch };
        }
        setWindowState((prev) => (prev ? { ...prev, ...patch } : prev));
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
          windowStateRef.current = null;
          setWindowState(null);
          onWindowClosedSetStateRef.current?.();
          onCloseRef.current?.();
          break;
      }

      // Notify useSyncExternalStore subscribers synchronously. The refs are
      // already updated above, so getSnapshot() returns the new value here,
      // before React has committed the corresponding setState.
      for (const listener of stateListeners.current) {
        listener();
      }
    });

    return unsubscribe;
  }, [isReady, windowId, provider]);

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
    setDisplayInfo,
    contextValue,
    debouncedBoundsChange,
  };
}
