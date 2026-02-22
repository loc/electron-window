import { useCallback } from "react";
import { useWindowContext, useWindowProviderContext } from "../context.js";
import type { WindowHandle, Bounds } from "../../shared/types.js";

/**
 * Hook to get the current window handle
 * Provides imperative access to window methods
 */
export function useCurrentWindow(): WindowHandle {
  const { windowId, state } = useWindowContext();
  const provider = useWindowProviderContext();

  if (!windowId) {
    throw new Error("useCurrentWindow: No window ID in context");
  }

  const focus = useCallback(() => {
    provider.windowAction(windowId, { type: "focus" });
  }, [provider, windowId]);

  const blur = useCallback(() => {
    provider.windowAction(windowId, { type: "blur" });
  }, [provider, windowId]);

  const minimize = useCallback(() => {
    provider.windowAction(windowId, { type: "minimize" });
  }, [provider, windowId]);

  const maximize = useCallback(() => {
    provider.windowAction(windowId, { type: "maximize" });
  }, [provider, windowId]);

  const unmaximize = useCallback(() => {
    provider.windowAction(windowId, { type: "unmaximize" });
  }, [provider, windowId]);

  const toggleMaximize = useCallback(() => {
    if (state?.isMaximized) {
      provider.windowAction(windowId, { type: "unmaximize" });
    } else {
      provider.windowAction(windowId, { type: "maximize" });
    }
  }, [provider, windowId, state?.isMaximized]);

  const close = useCallback(() => {
    provider.windowAction(windowId, { type: "close" });
  }, [provider, windowId]);

  const forceClose = useCallback(() => {
    provider.windowAction(windowId, { type: "forceClose" });
  }, [provider, windowId]);

  const setBounds = useCallback(
    (bounds: Partial<Bounds>) => {
      provider.windowAction(windowId, { type: "setBounds", bounds });
    },
    [provider, windowId]
  );

  const setTitle = useCallback(
    (title: string) => {
      provider.windowAction(windowId, { type: "setTitle", title });
    },
    [provider, windowId]
  );

  const enterFullscreen = useCallback(() => {
    provider.windowAction(windowId, { type: "enterFullscreen" });
  }, [provider, windowId]);

  const exitFullscreen = useCallback(() => {
    provider.windowAction(windowId, { type: "exitFullscreen" });
  }, [provider, windowId]);

  return {
    id: windowId,
    isFocused: state?.isFocused ?? false,
    isMaximized: state?.isMaximized ?? false,
    isMinimized: state?.isMinimized ?? false,
    isFullscreen: state?.isFullscreen ?? false,
    bounds: state?.bounds ?? { x: 0, y: 0, width: 0, height: 0 },
    focus,
    blur,
    minimize,
    maximize,
    unmaximize,
    toggleMaximize,
    close,
    forceClose,
    setBounds,
    setTitle,
    enterFullscreen,
    exitFullscreen,
  };
}
