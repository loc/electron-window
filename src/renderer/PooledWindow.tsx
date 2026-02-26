import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import { createPortal } from "react-dom";
import { WindowContext, useWindowProviderContext } from "./context.js";
import { RendererWindowPool, type PoolShape } from "./RendererWindowPool.js";
import type {
  WindowId,
  WindowHandle,
  WindowPoolConfig,
  BaseWindowProps,
} from "../shared/types.js";
import { CREATION_ONLY_PROPS, POOL_SHAPE_PROPS } from "../shared/types.js";
import { useWindowLifecycle, NOT_READY_HANDLE } from "./useWindowLifecycle.js";

// Lifecycle / meta props that are never forwarded as IPC props on acquire.
// Shape props (transparent, frame, titleBarStyle, vibrancy) are excluded
// separately via POOL_SHAPE_PROPS so adding a new creation-only allowed prop
// automatically excludes it here too.
const LIFECYCLE_EXCLUDED_ON_ACQUIRE = new Set([
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
  debug?: boolean;
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

export interface PooledWindowProps extends Omit<
  BaseWindowProps,
  PoolExcludedProps
> {
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
          debug: poolDef.debug,
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
    const [childDocument, setChildDocument] = useState<Document | null>(null);
    const [windowId, setWindowId] = useState<WindowId | null>(null);
    const [isReady, setIsReady] = useState(false);
    const pendingShowRef = useRef<string | null>(null);

    // Tracks the currently-acquired pool entry so release() has the right id
    const entryRef = useRef<{
      id: string;
      childWindow: globalThis.Window;
    } | null>(null);
    // Mirrors entryRef.current?.childWindow as a ref object for useWindowLifecycle
    const childWindowRef = useRef<globalThis.Window | null>(null);

    const lifecycle = useWindowLifecycle({
      windowId,
      isReady,
      provider,
      childWindowRef,
      childDocument,
      onBoundsChange,
      onUserClose,
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
      onWindowClosedSetState: () => {
        entryRef.current = null;
        childWindowRef.current = null;
        setPortalTarget(null);
        setChildDocument(null);
        setWindowId(null);
        setIsReady(false);
        // Hook resets its own windowState internally via the 'closed' case
      },
    });

    // Acquire on open=true, release on open=false
    useEffect(() => {
      if (!open) {
        if (entryRef.current) {
          const idToRelease = entryRef.current.id;
          entryRef.current = null;
          childWindowRef.current = null;
          setPortalTarget(null);
          setChildDocument(null);
          setWindowId(null);
          setIsReady(false);
          lifecycle.setWindowState(null);
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
        childWindowRef.current = entry.childWindow;

        // Forward changeable (non-shape, non-lifecycle) props via IPC
        const changeableProps: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(rest)) {
          if (
            !LIFECYCLE_EXCLUDED_ON_ACQUIRE.has(key) &&
            !POOL_SHAPE_PROPS.has(key) &&
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

        // Set portal target BEFORE showing the window — React starts rendering
        // immediately so content is already in the DOM when the window appears.
        // This eliminates the blank-window flash on acquire.
        setWindowId(entry.id);
        lifecycle.setWindowState({
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
        setChildDocument(entry.childWindow.document);
        setIsReady(true);

        // Defer show to useLayoutEffect — React must commit the portal content
        // to the DOM before the window becomes visible. The layout effect fires
        // after React's commit phase, guaranteeing content is painted.
        pendingShowRef.current = entry.id;
      }

      acquireWindow();
      return () => {
        cancelled = true;
      };
      // Intentionally minimal — prop changes are handled by a separate effect
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Show the window AFTER React has committed portal content to the DOM.
    // useLayoutEffect fires synchronously after commit, before browser paint —
    // the window becomes visible with content already rendered.
    useLayoutEffect(() => {
      const showId = pendingShowRef.current;
      if (showId) {
        pendingShowRef.current = null;
        void provider.windowAction(showId, { type: "show" });
        onReady?.();
      }
    });

    // Release and cancel debounce on unmount
    useEffect(() => {
      return () => {
        lifecycle.debouncedBoundsChange.current.cancel();
        if (entryRef.current) {
          void pool.release(entryRef.current.id);
          entryRef.current = null;
        }
        // Intentionally do NOT destroy the pool — it outlives individual mounts
      };
    }, [pool]);

    useImperativeHandle(ref, () => lifecycle.handle ?? NOT_READY_HANDLE, [
      lifecycle.handle,
    ]);

    if (!portalTarget) return null;

    return createPortal(
      <WindowContext.Provider value={lifecycle.contextValue}>
        {children}
      </WindowContext.Provider>,
      portalTarget,
    );
  },
);

PooledWindow.displayName = "PooledWindow";
