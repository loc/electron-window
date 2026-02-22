import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import { createPortal } from "react-dom";
import {
  WindowContext,
  useWindowProviderContext,
  type WindowContextValue,
} from "./context.js";
import { RendererWindowPool, type PoolShape } from "./RendererWindowPool.js";
import type {
  WindowId,
  WindowState,
  WindowHandle,
  Bounds,
  DisplayInfo,
  WindowPoolConfig,
  BaseWindowProps,
} from "../shared/types.js";
import { CREATION_ONLY_PROPS } from "../shared/types.js";
import { debounce } from "../shared/utils.js";

// Props excluded when forwarding to the window — either owned by the pool
// (shape props) or lifecycle-only (callbacks, meta).
const EXCLUDED_ON_ACQUIRE = new Set([
  // Shape props — fixed by the pool definition
  "transparent",
  "frame",
  "titleBarStyle",
  "vibrancy",
  // Lifecycle / meta — not forwarded as IPC props
  "children",
  "open",
  "pool",
  "onUserClose",
  "onBoundsChange",
  "onReady",
  "onFocus",
  "onBlur",
  "onClose",
  "onMaximize",
  "onUnmaximize",
  "onMinimize",
  "onRestore",
  "onEnterFullscreen",
  "onExitFullscreen",
  "onDisplayChange",
  "injectStyles",
  "name",
  "recreateOnShapeChange",
  "persistBounds",
]);

/**
 * An opaque pool definition created by createWindowPool.
 * Pass this to <PooledWindow pool={...} />.
 */
export interface WindowPoolDefinition {
  shape: PoolShape;
  config?: WindowPoolConfig;
}

// Singleton pool instances keyed by pool definition. Pools outlive individual
// component mounts and are shared across all <PooledWindow> uses of the same def.
const poolInstances = new WeakMap<WindowPoolDefinition, RendererWindowPool>();

/**
 * Create a pool definition. The shape props (transparent, frame, etc.) are
 * fixed for all windows in this pool — consumers cannot override them per-use.
 *
 * Call this once at module level and reuse across renders.
 */
export function createWindowPool(
  shape: PoolShape,
  config?: WindowPoolConfig,
): WindowPoolDefinition {
  return { shape, config: config ?? {} };
}

/** @deprecated Use createWindowPool instead */
export const createWindowPoolDefinition = createWindowPool;

/**
 * Explicitly destroy a pool and remove it from the shared cache.
 * Only needed for cleanup in tests or when you're certain the pool
 * definition will never be used again.
 */
export function destroyWindowPool(poolDef: WindowPoolDefinition): void {
  const instance = poolInstances.get(poolDef);
  if (instance) {
    instance.destroy();
    poolInstances.delete(poolDef);
  }
}

// Props owned by the pool's shape definition — consumers can't override these per-use
type PoolShapeProps = "transparent" | "frame" | "titleBarStyle" | "vibrancy";
// Props that don't apply to pooled windows
type PoolExcludedProps = PoolShapeProps | "recreateOnShapeChange";

export interface PooledWindowProps
  extends Omit<BaseWindowProps, PoolExcludedProps> {
  /** Pool to acquire windows from */
  pool: WindowPoolDefinition;
  /** Content to render inside the window */
  children: React.ReactNode;
}

export type PooledWindowRef = WindowHandle;

/**
 * Declarative window component backed by a renderer-side pool.
 *
 * On open=true: acquires a pre-warmed window from the pool (instant if idle
 * windows exist), applies non-shape props, shows it, then portals children in.
 *
 * On open=false: releases back to the pool — the window is hidden but the
 * BrowserWindow stays alive for the next acquire.
 *
 * The pool's shape props (transparent, frame, titleBarStyle, vibrancy) are
 * immutable and set at pool creation time. All other props can change per use.
 */
export const PooledWindow = forwardRef<PooledWindowRef, PooledWindowProps>(
  function PooledWindow(
    {
      pool: poolDef,
      open,
      children,
      onUserClose,
      onBoundsChange,
      onReady,
      onFocus,
      onBlur,
      onClose,
      onMaximize,
      onUnmaximize,
      onMinimize,
      onRestore,
      onEnterFullscreen,
      onExitFullscreen,
      onDisplayChange,
      title,
      ...rest
    },
    ref,
  ) {
    const provider = useWindowProviderContext();

    // Share one pool instance per pool definition across all mounts.
    // The pool captures provider methods at creation time — stable in practice
    // since the provider comes from context and doesn't change across renders.
    const pool = useMemo(() => {
      let instance = poolInstances.get(poolDef);
      if (!instance) {
        instance = new RendererWindowPool({
          shape: poolDef.shape,
          config: poolDef.config,
          registerWindow: provider.registerWindow,
          unregisterWindow: provider.unregisterWindow,
          windowAction: provider.windowAction,
        });
        poolInstances.set(poolDef, instance);
        void instance.warmUp();
      }
      return instance;
    }, [poolDef]); // eslint-disable-line react-hooks/exhaustive-deps

    const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
    const [windowId, setWindowId] = useState<WindowId | null>(null);
    const [windowState, setWindowState] = useState<WindowState | null>(null);
    const [displayInfo, setDisplayInfo] = useState<DisplayInfo | null>(null);
    const [isReady, setIsReady] = useState(false);

    // Tracks the currently-acquired pool entry so release() has the right id
    const entryRef = useRef<{
      id: string;
      childWindow: globalThis.Window;
    } | null>(null);

    const debouncedBoundsChange = useRef(
      debounce((bounds: Bounds) => {
        onBoundsChange?.(bounds);
      }, 100),
    );

    // Acquire on open=true, release on open=false
    useEffect(() => {
      if (!open) {
        if (entryRef.current) {
          const idToRelease = entryRef.current.id;
          entryRef.current = null;
          setPortalTarget(null);
          setWindowId(null);
          setIsReady(false);
          setWindowState(null);
          void pool.release(idToRelease);
        }
        return;
      }

      let cancelled = false;

      async function acquireWindow() {
        const entry = await pool.acquire();
        if (cancelled) {
          void pool.release(entry.id);
          return;
        }

        entryRef.current = entry;

        // Forward changeable (non-shape, non-lifecycle) props via IPC
        const changeableProps: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(rest)) {
          if (
            !EXCLUDED_ON_ACQUIRE.has(key) &&
            !CREATION_ONLY_PROPS.has(key) &&
            value !== undefined
          ) {
            changeableProps[key] = value;
          }
        }
        if (Object.keys(changeableProps).length > 0) {
          void provider.updateWindow(entry.id, changeableProps);
        }

        if (title && entry.childWindow.document) {
          entry.childWindow.document.title = title;
        }

        await provider.windowAction(entry.id, { type: "show" });

        if (cancelled) {
          void pool.release(entry.id);
          return;
        }

        setWindowId(entry.id);
        setWindowState({
          id: entry.id,
          isFocused: false,
          isVisible: true,
          isMaximized: false,
          isMinimized: false,
          isFullscreen: false,
          bounds: {
            x: entry.childWindow.screenX,
            y: entry.childWindow.screenY,
            width: entry.childWindow.outerWidth,
            height: entry.childWindow.outerHeight,
          },
          title: title ?? "",
        });
        setPortalTarget(entry.portalTarget);
        setIsReady(true);
        onReady?.();
      }

      acquireWindow();
      return () => {
        cancelled = true;
      };
      // Intentionally minimal — prop changes are handled by a separate effect
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Subscribe to main-process window events
    useEffect(() => {
      if (!isReady || !windowId) return;

      const unsubscribe = provider.subscribeToEvents(windowId, (event) => {
        switch (event.type) {
          case "focused":
            setWindowState((prev) =>
              prev ? { ...prev, isFocused: true } : prev,
            );
            onFocus?.();
            break;
          case "blurred":
            setWindowState((prev) =>
              prev ? { ...prev, isFocused: false } : prev,
            );
            onBlur?.();
            break;
          case "maximized":
            setWindowState((prev) =>
              prev ? { ...prev, isMaximized: true } : prev,
            );
            onMaximize?.();
            break;
          case "unmaximized":
            setWindowState((prev) =>
              prev ? { ...prev, isMaximized: false } : prev,
            );
            onUnmaximize?.();
            break;
          case "minimized":
            setWindowState((prev) =>
              prev ? { ...prev, isMinimized: true } : prev,
            );
            onMinimize?.();
            break;
          case "restored":
            setWindowState((prev) =>
              prev ? { ...prev, isMinimized: false } : prev,
            );
            onRestore?.();
            break;
          case "enterFullscreen":
            setWindowState((prev) =>
              prev ? { ...prev, isFullscreen: true } : prev,
            );
            onEnterFullscreen?.();
            break;
          case "leaveFullscreen":
            setWindowState((prev) =>
              prev ? { ...prev, isFullscreen: false } : prev,
            );
            onExitFullscreen?.();
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
              onDisplayChange?.(display);
            }
            break;
          case "userCloseRequested":
            onUserClose?.();
            break;
          case "closed":
            // Window was destroyed externally (e.g., OS close button)
            entryRef.current = null;
            setPortalTarget(null);
            setWindowId(null);
            setIsReady(false);
            setWindowState(null);
            onClose?.();
            break;
        }
      });

      return unsubscribe;
    }, [
      isReady,
      windowId,
      provider,
      onFocus,
      onBlur,
      onClose,
      onMaximize,
      onUnmaximize,
      onMinimize,
      onRestore,
      onEnterFullscreen,
      onExitFullscreen,
      onDisplayChange,
      onUserClose,
    ]);

    // Notify useSyncExternalStore subscribers in child hooks on state change
    const stateListeners = useRef<Set<() => void>>(new Set());

    useEffect(() => {
      for (const listener of stateListeners.current) {
        listener();
      }
    }, [windowState, displayInfo]);

    // Release and cancel debounce on unmount
    useEffect(() => {
      return () => {
        debouncedBoundsChange.current.cancel();
        if (entryRef.current) {
          void pool.release(entryRef.current.id);
          entryRef.current = null;
        }
        // Intentionally do NOT destroy the pool — it outlives individual mounts
      };
    }, [pool]);

    const subscribe = useCallback((listener: () => void) => {
      stateListeners.current.add(listener);
      return () => {
        stateListeners.current.delete(listener);
      };
    }, []);

    const getSnapshot = useCallback(() => windowState, [windowState]);
    const getDisplaySnapshot = useCallback(() => displayInfo, [displayInfo]);

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
          if (entryRef.current?.childWindow) {
            entryRef.current.childWindow.document.title = t;
          }
          void provider.windowAction(windowId, { type: "setTitle", title: t });
        },
        enterFullscreen: () =>
          void provider.windowAction(windowId, { type: "enterFullscreen" }),
        exitFullscreen: () =>
          void provider.windowAction(windowId, { type: "exitFullscreen" }),
      };
    }, [windowId, isReady, windowState, provider]);

    useImperativeHandle(
      ref,
      () =>
        handle ?? {
          id: windowId ?? "",
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
        },
      [handle, windowId],
    );

    const contextValue = useMemo<WindowContextValue>(
      () => ({
        windowId,
        state: windowState,
        display: displayInfo,
        handle,
        subscribe,
        getSnapshot,
        getDisplaySnapshot,
      }),
      [
        windowId,
        windowState,
        displayInfo,
        handle,
        subscribe,
        getSnapshot,
        getDisplaySnapshot,
      ],
    );

    if (!portalTarget) return null;

    return createPortal(
      <WindowContext.Provider value={contextValue}>
        {children}
      </WindowContext.Provider>,
      portalTarget,
    );
  },
);

PooledWindow.displayName = "PooledWindow";
