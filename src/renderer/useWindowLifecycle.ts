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
  handle: WindowHandle | null;
  contextValue: WindowContextValue;
  debouncedBoundsChange: React.MutableRefObject<
    ReturnType<typeof debounce<(bounds: Bounds) => void>>
  >;
}

export function useWindowLifecycle(
  opts: WindowLifecycleOptions,
): WindowLifecycleResult {
  const { windowId, isReady, provider, childWindowRef } = opts;

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

  // Subscribe to window events — only re-subscribes when windowId/isReady/provider changes
  useEffect(() => {
    if (!isReady || !windowId) return;

    const unsubscribe = provider.subscribeToEvents(windowId, (event) => {
      switch (event.type) {
        case "focused":
          setWindowState((prev) =>
            prev ? { ...prev, isFocused: true } : prev,
          );
          onFocusRef.current?.();
          break;
        case "blurred":
          setWindowState((prev) =>
            prev ? { ...prev, isFocused: false } : prev,
          );
          onBlurRef.current?.();
          break;
        case "maximized":
          setWindowState((prev) =>
            prev ? { ...prev, isMaximized: true } : prev,
          );
          onMaximizeRef.current?.();
          break;
        case "unmaximized":
          setWindowState((prev) =>
            prev ? { ...prev, isMaximized: false } : prev,
          );
          onUnmaximizeRef.current?.();
          break;
        case "minimized":
          setWindowState((prev) =>
            prev ? { ...prev, isMinimized: true } : prev,
          );
          onMinimizeRef.current?.();
          break;
        case "restored":
          setWindowState((prev) =>
            prev ? { ...prev, isMinimized: false } : prev,
          );
          onRestoreRef.current?.();
          break;
        case "enterFullscreen":
          setWindowState((prev) =>
            prev ? { ...prev, isFullscreen: true } : prev,
          );
          onEnterFullscreenRef.current?.();
          break;
        case "leaveFullscreen":
          setWindowState((prev) =>
            prev ? { ...prev, isFullscreen: false } : prev,
          );
          onExitFullscreenRef.current?.();
          break;
        case "boundsChanged":
          if (event.bounds) {
            const bounds = event.bounds as Bounds;
            setWindowState((prev) => (prev ? { ...prev, bounds } : prev));
            debouncedBoundsChange.current(bounds);
          }
          break;
        case "displayChanged":
          if (event.display) {
            const display = event.display as DisplayInfo;
            setDisplayInfo(display);
            onDisplayChangeRef.current?.(display);
          }
          break;
        case "userCloseRequested":
          onUserCloseRef.current?.();
          break;
        case "closed":
          setWindowState(null);
          onWindowClosedSetStateRef.current?.();
          onCloseRef.current?.();
          break;
      }
    });

    return unsubscribe;
  }, [isReady, windowId, provider]);

  // Handle for imperative access
  const handle = useMemo<WindowHandle | null>(() => {
    if (!isReady || !windowId) return null;

    return {
      id: windowId,
      isReady: true,
      isFocused: windowState?.isFocused ?? false,
      isMaximized: windowState?.isMaximized ?? false,
      isMinimized: windowState?.isMinimized ?? false,
      isFullscreen: windowState?.isFullscreen ?? false,
      bounds: windowState?.bounds ?? { x: 0, y: 0, width: 0, height: 0 },
      focus: () => void provider.windowAction(windowId, { type: "focus" }),
      blur: () => void provider.windowAction(windowId, { type: "blur" }),
      minimize: () =>
        void provider.windowAction(windowId, { type: "minimize" }),
      maximize: () =>
        void provider.windowAction(windowId, { type: "maximize" }),
      unmaximize: () =>
        void provider.windowAction(windowId, { type: "unmaximize" }),
      toggleMaximize: () =>
        void provider.windowAction(windowId, {
          type: windowState?.isMaximized ? "unmaximize" : "maximize",
        }),
      close: () => void provider.windowAction(windowId, { type: "close" }),
      forceClose: () =>
        void provider.windowAction(windowId, { type: "forceClose" }),
      setBounds: (bounds) =>
        void provider.windowAction(windowId, { type: "setBounds", bounds }),
      setTitle: (t) => {
        if (childWindowRef?.current) childWindowRef.current.document.title = t;
        void provider.windowAction(windowId, { type: "setTitle", title: t });
      },
      enterFullscreen: () =>
        void provider.windowAction(windowId, { type: "enterFullscreen" }),
      exitFullscreen: () =>
        void provider.windowAction(windowId, { type: "exitFullscreen" }),
    };
  }, [windowId, isReady, windowState, provider, childWindowRef]);

  // State subscription for useSyncExternalStore in child hooks
  const stateListeners = useRef<Set<() => void>>(new Set());

  const subscribe = useCallback((listener: () => void) => {
    stateListeners.current.add(listener);
    return () => {
      stateListeners.current.delete(listener);
    };
  }, []);

  const getSnapshot = useCallback(() => windowState, [windowState]);
  const getDisplaySnapshot = useCallback(() => displayInfo, [displayInfo]);

  // Notify useSyncExternalStore subscribers on state change
  useEffect(() => {
    for (const listener of stateListeners.current) {
      listener();
    }
  }, [windowState, displayInfo]);

  const contextValue = useMemo<WindowContextValue>(
    () => ({
      windowId,
      state: windowState,
      display: displayInfo,
      handle,
      subscribe,
      getSnapshot,
      getDisplaySnapshot,
      document: opts.childDocument ?? null,
    }),
    [
      windowId,
      windowState,
      displayInfo,
      handle,
      subscribe,
      getSnapshot,
      getDisplaySnapshot,
      opts.childDocument,
    ],
  );

  return {
    windowState,
    setWindowState,
    displayInfo,
    setDisplayInfo,
    handle,
    contextValue,
    debouncedBoundsChange,
  };
}
