import { useEffect, useLayoutEffect, useRef, useState, forwardRef } from "react";
import { createPortal } from "react-dom";
import { WindowContext, useWindowProviderContext } from "./context.js";
import type { WindowId, WindowProps, WindowHandle } from "../shared/types.js";
import {
  CREATION_ONLY_PROPS,
  RENDERER_ALLOWED_PROPS,
  CHANGEABLE_BEHAVIOR_PROPS,
} from "../shared/types.js";
import { usePersistedBounds } from "./hooks/usePersistedBounds.js";
import { devWarning, generateWindowId } from "../shared/utils.js";
import { waitForWindowReady, initWindowDocument } from "./windowUtils.js";
import { useWindowLifecycle, useWindowHandle } from "./useWindowLifecycle.js";

/**
 * Extract the window shape (creation-only props) for change detection.
 * Includes ALL creation-only props with undefined for unset ones, so that
 * `transparent: true → undefined` (removal) is detectable as a change.
 */
function getWindowShape(props: Omit<WindowProps, "children">): Record<string, unknown> {
  const shape: Record<string, unknown> = {};
  for (const prop of CREATION_ONLY_PROPS) {
    shape[prop] = props[prop as keyof typeof props];
  }
  return shape;
}

/**
 * Extract props that are safe to send to main process via IPC
 */
function extractIPCProps(props: Omit<WindowProps, "children">): Record<string, unknown> {
  const ipcProps: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (RENDERER_ALLOWED_PROPS.has(key)) {
      ipcProps[key] = (props as Record<string, unknown>)[key];
    }
  }
  // Normalize alwaysOnTop: string levels must be split into boolean + level fields
  // because the IPC schema validates alwaysOnTop as boolean only.
  if (typeof ipcProps.alwaysOnTop === "string") {
    ipcProps.alwaysOnTopLevel = ipcProps.alwaysOnTop;
    ipcProps.alwaysOnTop = true;
  }
  // Normalize targetDisplay: IPC schema expects a string; convert numeric index.
  if (typeof ipcProps.targetDisplay === "number") {
    ipcProps.targetDisplay = String(ipcProps.targetDisplay);
  }
  return ipcProps;
}

// WindowRef is the same as WindowHandle — consumers get the same API via ref or hook
export type WindowRef = WindowHandle;

/**
 * Declarative window component using createPortal.
 *
 * Children render into a native window while remaining in the parent React tree,
 * so all parent context providers (Redux, theme, etc.) are automatically available.
 */
export const Window = forwardRef<WindowRef, WindowProps>(function Window(props, ref) {
  const {
    open,
    children,
    onUserClose,
    onBoundsChange,
    onReady,
    onMaximize,
    onUnmaximize,
    onMinimize,
    onRestore,
    onEnterFullscreen,
    onExitFullscreen,
    onDisplayChange,
    onFocus,
    onBlur,
    onClose,
    injectStyles = "auto",
    name,
    title,
    recreateOnShapeChange = false,
    persistBounds,
    visible = true,
  } = props;

  const provider = useWindowProviderContext();

  // Persistence support — hook always called, only has effect when key is provided
  const persistence = usePersistedBounds(persistBounds ?? "", {
    defaultWidth: props.defaultWidth,
    defaultHeight: props.defaultHeight,
    defaultX: props.defaultX,
    defaultY: props.defaultY,
  });

  // Stable window ID — only regenerated when window is recreated due to shape change
  const [windowId, setWindowId] = useState<WindowId>(() => generateWindowId());
  // Ref mirror of windowId for stable-closure cleanup (unmount effect has
  // empty deps; closure would otherwise capture the initial ID only).
  const windowIdRef = useRef(windowId);
  windowIdRef.current = windowId;

  // The DOM element in the child window that React portals into
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [childDocument, setChildDocument] = useState<Document | null>(null);

  const [isReady, setIsReady] = useState(false);
  const pendingShowRef = useRef<string | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  // Tracks whether registerWindow actually succeeded for the current windowId.
  // Gates cleanup paths so we don't unregister never-registered IDs (e.g.,
  // initial mount with open={false}) or double-unregister.
  const hasRegisteredRef = useRef(false);

  const childWindowRef = useRef<globalThis.Window | null>(null);
  // Stores the style-injection cleanup returned by initWindowDocument so
  // the unmount path can release the child Document from the shared style
  // subscriber set. The unload handler also calls this, but
  // BrowserWindow.destroy() (used by unregisterWindow) doesn't fire unload.
  const styleCleanupRef = useRef<(() => void) | null>(null);
  const prevPropsRef = useRef<Omit<WindowProps, "children"> | null>(null);
  const initialShapeRef = useRef<Record<string, unknown> | null>(null);
  const persistenceRef = useRef(persistence);
  persistenceRef.current = persistence;
  // Fresh-props ref for reads inside openWindow()'s async body — avoids
  // capturing stale props from the effect-closure snapshot when
  // waitForWindowReady is polling and props change mid-flight (which
  // would set initialShapeRef to a stale shape → spurious recreate on
  // the very next render).
  const propsRef = useRef(props);
  propsRef.current = props;

  const lifecycle = useWindowLifecycle({
    windowId: isReady ? windowId : null,
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
    persistBoundsKey: persistBounds,
    persistenceSave: persistBounds ? (bounds) => persistenceRef.current.save(bounds) : undefined,
    onWindowClosedSetState: () => {
      // Window destroyed from main side — it no longer exists in the
      // main process's map, so clear hasRegisteredRef so subsequent
      // open=false / unmount doesn't try to unregister a dead ID.
      // The hook already called resetLifecycle() internally for 'closed' —
      // we only reset our own component-owned state here.
      hasRegisteredRef.current = false;
      resetComponentState();
    },
  });

  // Single place that resets Window-owned state. Call this from EVERY
  // teardown path. Hook-owned state (windowState, displayInfo, debounce)
  // is reset separately by lifecycle.resetLifecycle(). hasRegisteredRef
  // is NOT reset here — each call site needs to decide whether to
  // unregister before or after (depends on whether main already knows).
  function resetComponentState(): void {
    styleCleanupRef.current?.();
    styleCleanupRef.current = null;
    pendingShowRef.current = null;
    childWindowRef.current = null;
    initialShapeRef.current = null;
    prevPropsRef.current = null;
    setPortalTarget(null);
    setChildDocument(null);
    setIsReady(false);
  }

  const hasWarnedAboutControlledBoundsRef = useRef(false);
  useEffect(() => {
    if (hasWarnedAboutControlledBoundsRef.current) return;
    const hasControlledBounds =
      props.width !== undefined ||
      props.height !== undefined ||
      props.x !== undefined ||
      props.y !== undefined;
    if (hasControlledBounds && !onBoundsChange) {
      devWarning(
        `${name ? `[${name}] ` : ""}Using controlled bounds (width/height/x/y) without onBoundsChange.\n` +
          "The window will revert to prop values when user resizes.\n" +
          "Use defaultWidth/defaultHeight for initial-only bounds, or add onBoundsChange for two-way sync.",
      );
      hasWarnedAboutControlledBoundsRef.current = true;
    }
  }, [props.width, props.height, props.x, props.y, onBoundsChange]);

  useEffect(() => {
    if (!open) {
      // Only tear down if we actually opened something. Initial mount with
      // open={false} has nothing to clean up.
      if (childWindowRef.current || hasRegisteredRef.current) {
        // Don't call childWindow.close() — with closable={false} it's
        // preventDefaulted (no-op). unregisterWindow → destroy() bypasses
        // the close handler and is the authoritative teardown path.
        resetComponentState();
        lifecycle.resetLifecycle();
        if (hasRegisteredRef.current) {
          hasRegisteredRef.current = false;
          void provider.unregisterWindow(windowId);
        }
      }
      return;
    }

    let cancelled = false;

    async function openWindow() {
      // 1. Pre-register props so main process can configure the BrowserWindow
      //    before window.open triggers setWindowOpenHandler
      const ipcProps = extractIPCProps(props);
      if (persistBounds && persistence.bounds) {
        if (persistence.bounds.defaultWidth)
          ipcProps.defaultWidth = persistence.bounds.defaultWidth;
        if (persistence.bounds.defaultHeight)
          ipcProps.defaultHeight = persistence.bounds.defaultHeight;
        if (persistence.bounds.defaultX !== undefined)
          ipcProps.defaultX = persistence.bounds.defaultX;
        if (persistence.bounds.defaultY !== undefined)
          ipcProps.defaultY = persistence.bounds.defaultY;
      }
      // showOnCreate: false prevents the main process from showing the window
      // before React has rendered content into it. We show it ourselves after
      // setting the portal target, eliminating the blank-window flash.
      ipcProps.showOnCreate = false;
      const registered = await provider.registerWindow(windowId, ipcProps);
      if (!registered) {
        // If the bridge is missing, the provider already warned — don't
        // pile on with a misleading "maxWindows" message.
        if (provider.hasBridge) {
          devWarning(
            `${name ? `[${name}] ` : ""}RegisterWindow rejected by main process — ` +
              `likely hit maxWindows (50) or maxPendingWindows (100) limit.`,
          );
        }
        return;
      }
      hasRegisteredRef.current = true;
      if (cancelled) {
        // Effect cleanup already fired (synchronously on open→false), but
        // its unregister found nothing because the register hadn't completed
        // yet. Clean up the now-stale pending entry.
        hasRegisteredRef.current = false;
        void provider.unregisterWindow(windowId);
        return;
      }

      // 2. Open the window — Electron's setWindowOpenHandler intercepts this
      const win = window.open("about:blank", windowId, "");
      if (!win) {
        devWarning(`[electron-window] window.open blocked for window "${windowId}"`);
        hasRegisteredRef.current = false;
        void provider.unregisterWindow(windowId);
        return;
      }
      if (cancelled) {
        // Close this specific Window object — don't use unregisterWindow
        // by ID here because windowId is stable across open cycles, and
        // the next open cycle's register might land before this async
        // unregister completes (destroying the new window). win.close()
        // targets THIS window specifically. closable=false isn't a concern
        // mid-creation — the window hasn't processed initial props yet.
        win.close();
        hasRegisteredRef.current = false;
        void provider.unregisterWindow(windowId);
        return;
      }
      childWindowRef.current = win;

      try {
        await waitForWindowReady(win, () => cancelled);
      } catch (err) {
        devWarning(`[electron-window] ${(err as Error).message}`);
        win.close();
        hasRegisteredRef.current = false;
        childWindowRef.current = null;
        void provider.unregisterWindow(windowId);
        return;
      }
      if (cancelled) {
        win.close();
        hasRegisteredRef.current = false;
        childWindowRef.current = null;
        void provider.unregisterWindow(windowId);
        return;
      }

      const { container, cleanup: styleCleanup } = initWindowDocument(win.document, {
        injectStyles,
        title,
      });

      // Stored in ref for unmount — destroy() doesn't fire unload.
      styleCleanupRef.current = styleCleanup;
      win.addEventListener("unload", () => {
        if (!cancelled) {
          resetComponentState();
          lifecycle.resetLifecycle();
        } else {
          // cancelled=true means another teardown path owns state reset;
          // we only need to ensure styleCleanup ran (the other path
          // handles this via resetComponentState, but unload can race
          // the cancelled→close sequence).
          styleCleanupRef.current?.();
          styleCleanupRef.current = null;
        }
      });

      // Store initial shape for change detection. Read from propsRef
      // (not closure `props`) so mid-open prop changes don't set a
      // stale baseline → spurious recreate on first diff.
      initialShapeRef.current = getWindowShape(propsRef.current);
      prevPropsRef.current = propsRef.current;

      lifecycle.setWindowState({
        id: windowId,
        isFocused: false,
        isVisible: true,
        isMaximized: false,
        isMinimized: false,
        isFullscreen: false,
        bounds: {
          x: win.screenX,
          y: win.screenY,
          width: win.outerWidth,
          height: win.outerHeight,
        },
        title: title ?? "",
      });

      setPortalTarget(container);
      setChildDocument(win.document);
      setIsReady(true);

      // Defer show to useLayoutEffect — React must commit the portal content
      // before the window becomes visible. Skip if initially hidden.
      if (visibleRef.current !== false) {
        pendingShowRef.current = windowId;
      }
    }

    openWindow();

    return () => {
      cancelled = true;
    };
    // Intentionally minimal deps — prop changes are handled in a separate effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, windowId]);

  useEffect(() => {
    if (!isReady || !prevPropsRef.current) return;

    const prevProps = prevPropsRef.current;

    if (initialShapeRef.current) {
      const currentShape = getWindowShape(props);
      const changedCreationOnlyProps: string[] = [];
      for (const key of CREATION_ONLY_PROPS) {
        if (initialShapeRef.current[key] !== currentShape[key]) {
          changedCreationOnlyProps.push(key);
        }
      }

      if (changedCreationOnlyProps.length > 0) {
        if (recreateOnShapeChange) {
          // Don't call childWindow.close() — closable={false} would block it.
          // unregisterWindow → destroy() is the reliable teardown path.
          resetComponentState();
          lifecycle.resetLifecycle();
          if (hasRegisteredRef.current) {
            hasRegisteredRef.current = false;
            void provider.unregisterWindow(windowId);
          }
          setWindowId(generateWindowId());
          return;
        } else {
          for (const key of changedCreationOnlyProps) {
            devWarning(
              `${name ? `[${name}] ` : ""}"${key}" is a creation-only prop and cannot be changed after window creation. ` +
                `Use recreateOnShapeChange prop to allow recreation.`,
            );
          }
        }
      }
    }

    // Title is set directly on the document (renderer-side, no IPC needed)
    if (props.title !== prevProps.title && props.title && childWindowRef.current) {
      childWindowRef.current.document.title = props.title;
    }

    // Collect changeable behavior prop updates for IPC.
    // `visible` uses its default (true) when prop is undefined — so going
    // from false→undefined means "show" (respects the documented default),
    // not "no change". Other props treat undefined as "don't send".
    const changedBehaviorProps: Record<string, unknown> = {};
    for (const prop of CHANGEABLE_BEHAVIOR_PROPS) {
      const prevValue = prevProps[prop as keyof typeof prevProps];
      let currentValue = props[prop as keyof typeof props];
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
    if (props.width !== undefined && props.width !== prevProps.width) {
      boundsUpdate.width = props.width;
    }
    if (props.height !== undefined && props.height !== prevProps.height) {
      boundsUpdate.height = props.height;
    }
    if (props.x !== undefined && props.x !== prevProps.x) {
      boundsUpdate.x = props.x;
    }
    if (props.y !== undefined && props.y !== prevProps.y) {
      boundsUpdate.y = props.y;
    }

    const allChanges = { ...changedBehaviorProps, ...boundsUpdate };
    if (Object.keys(allChanges).length > 0) {
      void provider.updateWindow(windowId, allChanges);
    }

    prevPropsRef.current = props;
  }, [props, isReady, recreateOnShapeChange, provider, windowId]);

  // Cleanup on unmount only (empty deps). The open effect handles windowId
  // changes — having windowId in deps here would fire cleanup during
  // recreateOnShapeChange when the shape-change handler already cleaned up.
  useEffect(() => {
    return () => {
      // Unmount cleanup is minimal — React setters are no-ops on an
      // unmounted component and component-owned refs are GC'd with the
      // fiber. Only do what actually leaks across the unmount boundary:
      // the style subscriber (module-level Set), the debounce timer,
      // and the main-process window registration.
      // resetComponentState()/resetLifecycle() are for LIFECYCLE teardown
      // (open=false, shape-change) where the component stays mounted.
      styleCleanupRef.current?.();
      styleCleanupRef.current = null;
      lifecycle.debouncedBoundsChange.current.cancel();
      if (hasRegisteredRef.current) {
        hasRegisteredRef.current = false;
        void provider.unregisterWindow(windowIdRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fire onReady and (if visible) show the window AFTER React has committed
  // portal content to the DOM. onReady is decoupled from show — a window
  // mounted with visible={false} still fires onReady when the portal is live.
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

Window.displayName = "Window";
