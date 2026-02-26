import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { createPortal } from "react-dom";
import { WindowContext, useWindowProviderContext } from "./context.js";
import type { WindowId, WindowProps, WindowHandle } from "../shared/types.js";
import {
  CREATION_ONLY_PROPS,
  RENDERER_ALLOWED_PROPS,
} from "../shared/types.js";
import { usePersistedBounds } from "./hooks/usePersistedBounds.js";
import { devWarning, generateWindowId } from "../shared/utils.js";
import { waitForWindowReady, initWindowDocument } from "./windowUtils.js";
import { useWindowLifecycle, NOT_READY_HANDLE } from "./useWindowLifecycle.js";

/**
 * Changeable behavior props that can be updated after window creation via IPC
 */
const CHANGEABLE_BEHAVIOR_PROPS = new Set([
  "resizable",
  "movable",
  "minimizable",
  "maximizable",
  "closable",
  "focusable",
  "alwaysOnTop",
  "skipTaskbar",
  "fullscreen",
  "fullscreenable",
  "ignoreMouseEvents",
  "visibleOnAllWorkspaces",
  "backgroundColor",
  "opacity",
  "trafficLightPosition",
  "titleBarOverlay",
  "visible",
]);

/**
 * Extract the window shape (creation-only props) for change detection
 */
function getWindowShape(
  props: Omit<WindowProps, "children">,
): Record<string, unknown> {
  const shape: Record<string, unknown> = {};
  for (const prop of CREATION_ONLY_PROPS) {
    if (prop in props) {
      shape[prop] = props[prop as keyof typeof props];
    }
  }
  return shape;
}

/**
 * Extract props that are safe to send to main process via IPC
 */
function extractIPCProps(
  props: Omit<WindowProps, "children">,
): Record<string, unknown> {
  const ipcProps: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (RENDERER_ALLOWED_PROPS.has(key)) {
      ipcProps[key] = (props as Record<string, unknown>)[key];
    }
  }
  if (props.name) ipcProps.name = props.name;
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
export const Window = forwardRef<WindowRef, WindowProps>(
  function Window(props, ref) {
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
    const [windowId, setWindowId] = useState<WindowId>(() =>
      generateWindowId(),
    );

    // The DOM element in the child window that React portals into
    const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
    const [childDocument, setChildDocument] = useState<Document | null>(null);

    const [isReady, setIsReady] = useState(false);
    const pendingShowRef = useRef<string | null>(null);

    const childWindowRef = useRef<globalThis.Window | null>(null);
    const prevPropsRef = useRef<Omit<WindowProps, "children"> | null>(null);
    const initialShapeRef = useRef<Record<string, unknown> | null>(null);
    const persistenceRef = useRef(persistence);
    persistenceRef.current = persistence;

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
      persistenceSave: persistBounds
        ? (bounds) => persistenceRef.current.save(bounds)
        : undefined,
      onWindowClosedSetState: () => {
        childWindowRef.current = null;
        setPortalTarget(null);
        setChildDocument(null);
        setIsReady(false);
        // Hook resets its own windowState internally via the 'closed' case
      },
    });

    // Warn about controlled bounds without onBoundsChange
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

    // Open/close the child window
    useEffect(() => {
      if (!open) {
        if (childWindowRef.current && !childWindowRef.current.closed) {
          childWindowRef.current.close();
        }
        childWindowRef.current = null;
        setPortalTarget(null);
        setChildDocument(null);
        setIsReady(false);
        lifecycle.setWindowState(null);
        void provider.unregisterWindow(windowId);
        return;
      }

      let cancelled = false;

      async function openWindow() {
        // 1. Pre-register props so main process can configure the BrowserWindow
        //    before window.open triggers setWindowOpenHandler
        const ipcProps = extractIPCProps(props);
        // Apply persisted bounds if persistence is enabled
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
        await provider.registerWindow(windowId, ipcProps);
        if (cancelled) return;

        // 2. Open the window — Electron's setWindowOpenHandler intercepts this
        const win = window.open("about:blank", windowId, "");
        if (!win) {
          devWarning(
            `[electron-window] window.open blocked for window "${windowId}"`,
          );
          void provider.unregisterWindow(windowId);
          return;
        }
        if (cancelled) {
          win.close();
          return;
        }
        childWindowRef.current = win;

        // 3. Wait for the child window document to be accessible
        try {
          await waitForWindowReady(win, () => cancelled);
        } catch (err) {
          devWarning(`[electron-window] ${(err as Error).message}`);
          win.close();
          void provider.unregisterWindow(windowId);
          return;
        }
        if (cancelled) {
          win.close();
          return;
        }

        // 4. Set up document for portal rendering
        const { container, cleanup: styleCleanup } = initWindowDocument(
          win.document,
          { injectStyles, title },
        );

        // 5. Handle user closing the window via OS chrome (X button)
        win.addEventListener("unload", () => {
          styleCleanup();
          if (!cancelled) {
            childWindowRef.current = null;
            setPortalTarget(null);
            setChildDocument(null);
            setIsReady(false);
            lifecycle.setWindowState(null);
          }
        });

        // Store initial shape for change detection
        initialShapeRef.current = getWindowShape(props);
        prevPropsRef.current = props;

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
        // before the window becomes visible.
        pendingShowRef.current = windowId;
      }

      openWindow();

      return () => {
        cancelled = true;
      };
      // Intentionally minimal deps — prop changes are handled in a separate effect
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, windowId]);

    // Send prop updates to main process when changeable props change
    useEffect(() => {
      if (!isReady || !prevPropsRef.current) return;

      const prevProps = prevPropsRef.current;

      // Check for creation-only prop changes
      if (initialShapeRef.current) {
        const currentShape = getWindowShape(props);
        const changedCreationOnlyProps: string[] = [];

        for (const [key, value] of Object.entries(currentShape)) {
          if (initialShapeRef.current[key] !== value) {
            changedCreationOnlyProps.push(key);
          }
        }

        if (changedCreationOnlyProps.length > 0) {
          if (recreateOnShapeChange) {
            if (childWindowRef.current && !childWindowRef.current.closed) {
              childWindowRef.current.close();
            }
            childWindowRef.current = null;
            setPortalTarget(null);
            setChildDocument(null);
            setIsReady(false);
            lifecycle.setWindowState(null);
            setWindowId(generateWindowId());
            initialShapeRef.current = null;
            prevPropsRef.current = null;
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
      if (
        props.title !== prevProps.title &&
        props.title &&
        childWindowRef.current
      ) {
        childWindowRef.current.document.title = props.title;
      }

      // Collect changeable behavior prop updates for IPC
      const changedBehaviorProps: Record<string, unknown> = {};
      for (const prop of CHANGEABLE_BEHAVIOR_PROPS) {
        const prevValue = prevProps[prop as keyof typeof prevProps];
        const currentValue = props[prop as keyof typeof props];
        if (prevValue !== currentValue && currentValue !== undefined) {
          changedBehaviorProps[prop] = currentValue;
        }
      }

      // Collect controlled bounds changes
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

      // Merge behavior props and bounds into a single IPC update
      const allChanges = { ...changedBehaviorProps, ...boundsUpdate };
      if (Object.keys(allChanges).length > 0) {
        void provider.updateWindow(windowId, allChanges);
      }

      prevPropsRef.current = props;
    }, [props, isReady, recreateOnShapeChange, provider, windowId]);

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        lifecycle.debouncedBoundsChange.current.cancel();
        if (childWindowRef.current && !childWindowRef.current.closed) {
          childWindowRef.current.close();
        }
        void provider.unregisterWindow(windowId);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [windowId]);

    // Show the window AFTER React has committed portal content to the DOM.
    useLayoutEffect(() => {
      const showId = pendingShowRef.current;
      if (showId) {
        pendingShowRef.current = null;
        void provider.windowAction(showId, { type: "show" });
        onReady?.();
      }
    });

    useImperativeHandle(ref, () => lifecycle.handle ?? NOT_READY_HANDLE, [
      lifecycle.handle,
    ]);

    // Portal keeps children in the parent React tree while rendering into the child window DOM
    if (!portalTarget) return null;

    return createPortal(
      <WindowContext.Provider value={lifecycle.contextValue}>
        {children}
      </WindowContext.Provider>,
      portalTarget,
    );
  },
);

Window.displayName = "Window";
