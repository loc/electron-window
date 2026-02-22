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
import type {
  WindowId,
  WindowState,
  WindowProps,
  WindowHandle,
  Bounds,
  DisplayInfo,
  InjectStylesMode,
} from "../shared/types.js";
import {
  CREATION_ONLY_PROPS,
  RENDERER_ALLOWED_PROPS,
} from "../shared/types.js";
import { usePersistedBounds } from "./hooks/usePersistedBounds.js";
import {
  devWarning,
  debounce,
  generateWindowId,
  sleep,
} from "../shared/utils.js";

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
  // Communicate whether callbacks are registered so main can behave accordingly
  ipcProps.hasOnBoundsChange = !!props.onBoundsChange;
  ipcProps.hasOnUserClose = !!props.onUserClose;
  if (props.name) ipcProps.name = props.name;
  return ipcProps;
}

/**
 * Copy styles from parent document into child window document
 */
function handleStyleInjection(doc: Document, mode: InjectStylesMode): void {
  if (mode === false) return;
  if (typeof mode === "function") {
    mode(doc);
    return;
  }
  // "auto" — clone all style/link elements from parent
  const sheets = document.querySelectorAll('style, link[rel="stylesheet"]');
  for (const sheet of sheets) {
    doc.head.appendChild(sheet.cloneNode(true));
  }
}

/**
 * Wait until the child window document is accessible and has non-zero dimensions
 */
async function waitForWindowReady(win: globalThis.Window): Promise<void> {
  const deadline = Date.now() + 4000;
  while (!win.document?.body || !win.innerWidth) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for child window to be ready");
    }
    await sleep(1);
  }
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

    const [isReady, setIsReady] = useState(false);
    const [windowState, setWindowState] = useState<WindowState | null>(null);
    const [displayInfo, setDisplayInfo] = useState<DisplayInfo | null>(null);

    const childWindowRef = useRef<globalThis.Window | null>(null);
    const prevPropsRef = useRef<Omit<WindowProps, "children"> | null>(null);
    const initialShapeRef = useRef<Record<string, unknown> | null>(null);

    const debouncedBoundsChange = useRef(
      debounce((bounds: Bounds) => {
        onBoundsChange?.(bounds);
        if (persistBounds) {
          persistence.save(bounds);
        }
      }, 100),
    );

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
        setIsReady(false);
        setWindowState(null);
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
          await waitForWindowReady(win);
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
        const doc = win.document;
        doc.head.innerHTML = "";
        doc.body.innerHTML = "";

        const base = doc.createElement("base");
        base.href = window.location.origin;
        doc.head.appendChild(base);

        handleStyleInjection(doc, injectStyles);

        if (title) {
          doc.title = title;
        }

        const container = doc.createElement("div");
        container.id = "root";
        doc.body.appendChild(container);

        // 5. Handle user closing the window via OS chrome (X button)
        win.addEventListener("unload", () => {
          if (!cancelled) {
            onUserClose?.();
            childWindowRef.current = null;
            setPortalTarget(null);
            setIsReady(false);
            setWindowState(null);
          }
        });

        // Store initial shape for change detection
        initialShapeRef.current = getWindowShape(props);
        prevPropsRef.current = props;

        setWindowState({
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
        setIsReady(true);
        onReady?.();
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
            setIsReady(false);
            setWindowState(null);
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

    // Subscribe to window events from main process
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
            setPortalTarget(null);
            setIsReady(false);
            setWindowState(null);
            childWindowRef.current = null;
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

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        debouncedBoundsChange.current.cancel();
        if (childWindowRef.current && !childWindowRef.current.closed) {
          childWindowRef.current.close();
        }
        void provider.unregisterWindow(windowId);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [windowId]);

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

    // Window handle for the imperative ref
    const handle = useMemo<WindowHandle | null>(() => {
      if (!isReady) return null;

      return {
        id: windowId,
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
          if (childWindowRef.current) childWindowRef.current.document.title = t;
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
          id: windowId,
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

    // Portal keeps children in the parent React tree while rendering into the child window DOM
    if (!portalTarget) return null;

    return createPortal(
      <WindowContext.Provider value={contextValue}>
        {children}
      </WindowContext.Provider>,
      portalTarget,
    );
  },
);

Window.displayName = "Window";
