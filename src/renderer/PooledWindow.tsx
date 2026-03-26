import { useEffect, useLayoutEffect, useRef, useState, useMemo, forwardRef } from "react";
import { createPortal } from "react-dom";
import { WindowContext, useWindowProviderContext } from "./context.js";
import { RendererWindowPool, type PoolShape } from "./RendererWindowPool.js";
import type {
  WindowId,
  WindowHandle,
  WindowPoolConfig,
  BaseWindowProps,
  InjectStylesMode,
} from "../shared/types.js";
import {
  CREATION_ONLY_PROPS,
  POOL_SHAPE_PROPS,
  CHANGEABLE_BEHAVIOR_PROPS,
} from "../shared/types.js";
import { useWindowLifecycle, useWindowHandle } from "./useWindowLifecycle.js";
import { devWarning } from "../shared/utils.js";

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
  "defaultWidth",
  "defaultHeight",
  "defaultX",
  "defaultY",
]);

/**
 * An opaque pool definition created by createWindowPool.
 * Pass this to <PooledWindow pool={...} />.
 */
export interface WindowPoolDefinition {
  shape: PoolShape;
  config?: WindowPoolConfig;
  debug?: boolean;
  injectStyles?: InjectStylesMode;
}

// Singleton pool instances keyed by pool definition. Pools outlive individual
// component mounts and are shared across all <PooledWindow> uses of the same def.
const poolInstances = new WeakMap<WindowPoolDefinition, RendererWindowPool>();

/**
 * Create a pool definition. The shape props (transparent, frame, etc.) are
 * fixed for all windows in this pool — consumers cannot override them per-use.
 *
 * Call this once at module level and reuse across renders.
 *
 * @param shape - Immutable creation-only props shared by all pool windows
 * @param config - Pool sizing and eviction config
 * @param options - Additional options
 * @param options.injectStyles - How to inject styles into pool windows.
 *   - "auto": Copy <style> and <link> tags from parent (default)
 *   - false: No injection (for CSS-in-JS frameworks)
 *   - function: Custom injection
 */
export function createWindowPool(
  shape: PoolShape,
  config?: WindowPoolConfig,
  options?: { injectStyles?: InjectStylesMode },
): WindowPoolDefinition {
  return { shape, config: config ?? {}, injectStyles: options?.injectStyles };
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

// Props owned by the pool's shape definition — consumers can't override these
// per-use. DERIVED from PoolShape (the interface is the source of truth) so
// adding a prop there automatically excludes it here. There's also a runtime
// set POOL_SHAPE_PROPS in shared/types.ts derived from PROP_REGISTRY — a test
// asserts these three stay in sync.
type PoolShapeProps = keyof PoolShape;
// Props that don't apply to pooled windows:
// - recreateOnShapeChange: pool shape is immutable
// - targetDisplay: pool windows are pre-created; only affects creation-time placement
// - persistBounds: pool windows are reused; per-key persistence doesn't fit
// - injectStyles: fixed at pool creation time (third arg to createWindowPool)
type PoolExcludedProps =
  | PoolShapeProps
  | "recreateOnShapeChange"
  | "targetDisplay"
  | "persistBounds"
  | "injectStyles";

export interface PooledWindowProps extends Omit<BaseWindowProps, PoolExcludedProps> {
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
export const PooledWindow = forwardRef<PooledWindowRef, PooledWindowProps>(function PooledWindow(
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
    visible,
    name,
    ...rest
  },
  ref,
) {
  const provider = useWindowProviderContext();

  // Detect unstable poolDef identity (inline/useMemo-with-deps/HMR). Each
  // identity change creates a NEW RendererWindowPool + warmUp() → N hidden
  // BrowserWindows. The OLD pool is GC'd but its windows are main-process
  // owned — nothing unregisters them. Eventual symptom: "hit maxWindows
  // (50)", miles from the root cause. Warn on the SECOND distinct poolDef
  // this component instance sees.
  const hasCreatedPoolRef = useRef(false);
  const hasWarnedPoolChurnRef = useRef(false);

  // Share one pool instance per pool definition across all mounts.
  const pool = useMemo(() => {
    let instance = poolInstances.get(poolDef);
    if (!instance) {
      if (hasCreatedPoolRef.current && !hasWarnedPoolChurnRef.current) {
        hasWarnedPoolChurnRef.current = true;
        devWarning(
          `${name ? `[${name}] ` : ""}PooledWindow \`pool\` prop identity changed. ` +
            "Each change leaks hidden BrowserWindows (old pool's idle windows are never unregistered). " +
            "Define the pool at module scope, not inline: " +
            "`const myPool = createWindowPool(...)` outside any component. " +
            "If this is HMR, add `import.meta.hot?.dispose(() => destroyWindowPool(myPool))`.",
        );
      }
      hasCreatedPoolRef.current = true;
      instance = new RendererWindowPool({
        shape: poolDef.shape,
        config: poolDef.config,
        debug: poolDef.debug,
        injectStyles: poolDef.injectStyles,
        registerWindow: provider.registerWindow,
        unregisterWindow: provider.unregisterWindow,
        updateWindow: provider.updateWindow,
        windowAction: provider.windowAction,
      });
      poolInstances.set(poolDef, instance);
      void instance.warmUp();
    }
    // Always rebind provider refs — the pool outlives individual mounts and
    // needs fresh references if WindowProvider remounts (HMR, test teardown).
    instance.rebind({
      registerWindow: provider.registerWindow,
      unregisterWindow: provider.unregisterWindow,
      updateWindow: provider.updateWindow,
      windowAction: provider.windowAction,
    });
    return instance;
  }, [poolDef]); // eslint-disable-line react-hooks/exhaustive-deps -- provider rebind is handled above

  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [childDocument, setChildDocument] = useState<Document | null>(null);
  const [windowId, setWindowId] = useState<WindowId | null>(null);
  const [isReady, setIsReady] = useState(false);
  // AbortController per acquisition — exposed via context as `signal`.
  // Aborted on release so consumers' addEventListener/fetch calls clean
  // up automatically, even though the underlying Document stays alive
  // in the pool for the next consumer.
  const abortControllerRef = useRef<AbortController | null>(null);
  const [windowSignal, setWindowSignal] = useState<AbortSignal | null>(null);
  const pendingShowRef = useRef<string | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const prevPropsRef = useRef<Record<string, unknown> | null>(null);

  const hasWarnedAboutControlledBoundsRef = useRef(false);
  useEffect(() => {
    if (hasWarnedAboutControlledBoundsRef.current) return;
    const r = rest as Record<string, unknown>;
    const hasControlledBounds =
      r.width !== undefined || r.height !== undefined || r.x !== undefined || r.y !== undefined;
    if (hasControlledBounds && !onBoundsChange) {
      devWarning(
        `${name ? `[${name}] ` : ""}Using controlled bounds (width/height/x/y) without onBoundsChange.\n` +
          "The window will revert to prop values when user resizes.\n" +
          "Use defaultWidth/defaultHeight for initial-only bounds, or add onBoundsChange for two-way sync.",
      );
      hasWarnedAboutControlledBoundsRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rest, onBoundsChange]);

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
    signal: windowSignal,
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
      // BrowserWindow.destroy() skips unload, so the pool's unload listener
      // won't run — explicitly notify. resetLifecycle ran in the hook already.
      const destroyedId = entryRef.current?.id;
      resetComponentState();
      if (destroyedId) pool.notifyDestroyed(destroyedId);
    },
  });

  // Single place that resets PooledWindow-owned state. Call this from
  // EVERY teardown path. Hook-owned state (windowState, displayInfo,
  // debounce) is reset by lifecycle.resetLifecycle() — call both.
  function resetComponentState(): void {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    entryRef.current = null;
    pendingShowRef.current = null;
    prevPropsRef.current = null;
    childWindowRef.current = null;
    setPortalTarget(null);
    setChildDocument(null);
    setWindowSignal(null);
    setWindowId(null);
    setIsReady(false);
  }

  useEffect(() => {
    if (!open) {
      if (entryRef.current) {
        const idToRelease = entryRef.current.id;
        resetComponentState();
        lifecycle.resetLifecycle();
        void pool.release(idToRelease);
      }
      return;
    }

    let cancelled = false;

    async function acquireWindow() {
      let entry;
      try {
        entry = await pool.acquire();
      } catch (err) {
        devWarning(
          `${name ? `[${name}] ` : ""}PooledWindow: pool.acquire() failed — ${err instanceof Error ? err.message : String(err)}`,
        );
        // State was never set (acquire is the first async op) — component
        // is already in a clean state. Toggling open will retry.
        return;
      }

      if (cancelled) {
        void pool.release(entry.id);
        return;
      }

      entryRef.current = entry;
      childWindowRef.current = entry.childWindow;

      // defaultWidth/Height/X/Y have no setter in main — use setBounds instead.
      const { defaultWidth, defaultHeight, defaultX, defaultY } = rest as Record<
        string,
        number | undefined
      >;
      if (
        defaultWidth !== undefined ||
        defaultHeight !== undefined ||
        defaultX !== undefined ||
        defaultY !== undefined
      ) {
        const bounds: Record<string, number> = {};
        if (defaultWidth !== undefined) bounds.width = defaultWidth;
        if (defaultHeight !== undefined) bounds.height = defaultHeight;
        if (defaultX !== undefined) bounds.x = defaultX;
        if (defaultY !== undefined) bounds.y = defaultY;
        void provider.windowAction(entry.id, { type: "setBounds", bounds });
      }

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
      // visible was destructured separately to create visibleRef, but it
      // is still a changeable prop that should be forwarded on acquire.
      if (visible !== undefined) {
        changeableProps.visible = visible;
      }
      // Normalize alwaysOnTop string levels for IPC (schema validates alwaysOnTop as boolean)
      if (typeof changeableProps.alwaysOnTop === "string") {
        changeableProps.alwaysOnTopLevel = changeableProps.alwaysOnTop;
        changeableProps.alwaysOnTop = true;
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
      const ac = new AbortController();
      abortControllerRef.current = ac;
      setPortalTarget(entry.portalTarget);
      setChildDocument(entry.childWindow.document);
      setWindowSignal(ac.signal);
      setIsReady(true);
      prevPropsRef.current = { ...rest, title, visible };

      // Defer show to useLayoutEffect — React must commit the portal content
      // before the window becomes visible. Skip if initially hidden.
      if (visibleRef.current !== false) {
        pendingShowRef.current = entry.id;
      }
    }

    acquireWindow();
    // Release to the captured `pool` (the OLD pool on pool-change — correct,
    // that's where this entry belongs).
    return () => {
      cancelled = true;
      if (entryRef.current) {
        const idToRelease = entryRef.current.id;
        resetComponentState();
        lifecycle.resetLifecycle();
        void pool.release(idToRelease);
      }
    };
    // Minimal deps — prop changes are handled by the diff effect below.
    // `pool` is included so changing the pool prop releases the old
    // window and acquires from the new pool.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pool]);

  // Fire onReady and (if visible) show the window AFTER React has committed
  // portal content. onReady is decoupled from show — a window mounted with
  // visible={false} still fires onReady when the portal is live.
  const onReadyFiredRef = useRef(false);
  useLayoutEffect(() => {
    if (!isReady) {
      onReadyFiredRef.current = false;
      return;
    }
    if (!onReadyFiredRef.current) {
      onReadyFiredRef.current = true;
      onReady?.();
    }
    const showId = pendingShowRef.current;
    if (showId) {
      pendingShowRef.current = null;
      void provider.windowAction(showId, { type: "show" });
    }
  }, [isReady]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isReady || !windowId || !prevPropsRef.current) return;

    const prevProps = prevPropsRef.current;
    const currentProps: Record<string, unknown> = { ...rest, title, visible };

    // Title is set directly on the document (renderer-side, no IPC needed)
    if (title !== prevProps.title && title && childWindowRef.current) {
      childWindowRef.current.document.title = title;
    }

    // Diff changeable behavior props. `visible` defaults to true when
    // undefined (respects documented default), so false→undefined re-shows.
    const changedBehaviorProps: Record<string, unknown> = {};
    for (const prop of CHANGEABLE_BEHAVIOR_PROPS) {
      const prevValue = prevProps[prop];
      let currentValue = currentProps[prop];
      if (prop === "visible" && currentValue === undefined) {
        currentValue = true;
      }
      if (prevValue !== currentValue && currentValue !== undefined) {
        changedBehaviorProps[prop] = currentValue;
      }
    }

    // Normalize alwaysOnTop string levels for IPC (schema validates alwaysOnTop as boolean)
    if (typeof changedBehaviorProps.alwaysOnTop === "string") {
      changedBehaviorProps.alwaysOnTopLevel = changedBehaviorProps.alwaysOnTop;
      changedBehaviorProps.alwaysOnTop = true;
    }

    const boundsUpdate: Record<string, unknown> = {};
    const r = rest as Record<string, unknown>;
    if (r.width !== undefined && r.width !== prevProps.width) boundsUpdate.width = r.width;
    if (r.height !== undefined && r.height !== prevProps.height) boundsUpdate.height = r.height;
    if (r.x !== undefined && r.x !== prevProps.x) boundsUpdate.x = r.x;
    if (r.y !== undefined && r.y !== prevProps.y) boundsUpdate.y = r.y;

    const allChanges = { ...changedBehaviorProps, ...boundsUpdate };
    if (Object.keys(allChanges).length > 0) {
      void provider.updateWindow(windowId, allChanges);
    }

    prevPropsRef.current = currentProps;
    // `rest` is a new object every render, so this effect runs per-render
    // once isReady. The diff above short-circuits (no IPC when nothing
    // changed), so the overhead is ~20 shallow compares. Intentional —
    // listing every changeable prop individually would be brittle against
    // PROP_REGISTRY additions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, windowId, provider, rest, title, visible]);

  // Unmount cleanup: just cancel the debounce timer. Refs are GC'd with
  // the fiber; React setters are no-ops on unmounted components. The
  // acquire effect's cleanup handles pool.release(). resetLifecycle()
  // is for lifecycle teardown (open=false) where the component stays
  // mounted — don't call it here, the extra setState scheduling adds
  // latency that can delay a subsequent mount.
  useEffect(() => {
    return () => {
      lifecycle.debouncedBoundsChange.current.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useWindowHandle(ref, {
    windowId,
    isReady,
    provider,
    windowState: lifecycle.windowState,
    childWindowRef,
  });

  if (!portalTarget) return null;

  return createPortal(
    <WindowContext.Provider value={lifecycle.contextValue}>{children}</WindowContext.Provider>,
    portalTarget,
  );
});

PooledWindow.displayName = "PooledWindow";
