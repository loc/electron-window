import { useSyncExternalStore } from "react";
import { useWindowContext } from "../context.js";
import type { DisplayInfo } from "../../shared/types.js";

/**
 * Hook to subscribe to window display info
 * Re-renders when the window moves to a different display
 *
 * @returns Current display info or null if not available
 *
 * @example
 * ```tsx
 * function Content() {
 *   const display = useWindowDisplay();
 *   // { id, bounds: { x, y, width, height }, workArea, scaleFactor }
 *   if (display) {
 *     console.log(`Window is on display ${display.id} with scale ${display.scaleFactor}`);
 *   }
 * }
 * ```
 */
export function useWindowDisplay(): DisplayInfo | null {
  const { subscribe, getDisplaySnapshot } = useWindowContext();

  return useSyncExternalStore(
    subscribe,
    getDisplaySnapshot,
    () => null
  );
}
