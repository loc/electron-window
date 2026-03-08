import { useMemo, useSyncExternalStore } from "react";
import { useWindowContext, useWindowProviderContext } from "../context.js";
import type { WindowHandle, Bounds } from "../../shared/types.js";

/**
 * Hook to get the current window handle.
 * Provides imperative access to window methods.
 *
 * Uses useSyncExternalStore to subscribe to state changes, so this component
 * only re-renders when window state actually changes (not on every parent render).
 */
export function useCurrentWindow(): WindowHandle {
  const context = useWindowContext();
  const { windowId, subscribe, getSnapshot } = context;
  const provider = useWindowProviderContext();

  if (!windowId) {
    throw new Error("useCurrentWindow: No window ID in context");
  }

  const state = useSyncExternalStore(subscribe, getSnapshot, () => null);

  // Stable methods — only recreated when windowId or provider changes
  const methods = useMemo(
    () => ({
      focus: () => provider.windowAction(windowId, { type: "focus" }),
      blur: () => provider.windowAction(windowId, { type: "blur" }),
      minimize: () => provider.windowAction(windowId, { type: "minimize" }),
      maximize: () => provider.windowAction(windowId, { type: "maximize" }),
      unmaximize: () => provider.windowAction(windowId, { type: "unmaximize" }),
      toggleMaximize: () => {
        // Read from getSnapshot at call time — avoids stale closure
        const current = getSnapshot();
        provider.windowAction(windowId, {
          type: current?.isMaximized ? "unmaximize" : "maximize",
        });
      },
      close: () => provider.windowAction(windowId, { type: "close" }),
      forceClose: () => provider.windowAction(windowId, { type: "forceClose" }),
      setBounds: (bounds: Partial<Bounds>) =>
        provider.windowAction(windowId, { type: "setBounds", bounds }),
      setTitle: (title: string) => provider.windowAction(windowId, { type: "setTitle", title }),
      enterFullscreen: () => provider.windowAction(windowId, { type: "enterFullscreen" }),
      exitFullscreen: () => provider.windowAction(windowId, { type: "exitFullscreen" }),
    }),
    [windowId, provider, getSnapshot],
  );

  return useMemo(
    () => ({
      id: windowId,
      isReady: true,
      isFocused: state?.isFocused ?? false,
      isMaximized: state?.isMaximized ?? false,
      isMinimized: state?.isMinimized ?? false,
      isFullscreen: state?.isFullscreen ?? false,
      bounds: state?.bounds ?? { x: 0, y: 0, width: 0, height: 0 },
      ...methods,
    }),
    [state, methods, windowId],
  );
}
