import { useState, useCallback, useMemo } from "react";
import type { Bounds } from "../../shared/types.js";
import { debounce } from "../../shared/utils.js";

export interface UsePersistedBoundsOptions {
  /** Default width if no persisted bounds */
  defaultWidth?: number;
  /** Default height if no persisted bounds */
  defaultHeight?: number;
  /** Default x position if no persisted bounds */
  defaultX?: number;
  /** Default y position if no persisted bounds */
  defaultY?: number;
  /** Debounce time for saving (ms) */
  saveDebounceMs?: number;
}

export interface UsePersistedBoundsResult {
  /** Current bounds (persisted or defaults) */
  bounds: {
    defaultWidth?: number;
    defaultHeight?: number;
    defaultX?: number;
    defaultY?: number;
  };
  /** Save current bounds (debounced) */
  save: (bounds: Bounds) => void;
  /** Clear persisted bounds */
  clear: () => void;
}

const STORAGE_PREFIX = "electron-window:bounds:";

function readFromStorage(storageKey: string): Bounds | null {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Bounds;
    if (parsed.width > 0 && parsed.height > 0) return parsed;
  } catch {
    // Ignore parse errors
  }
  return null;
}

/**
 * Hook for managing persisted window bounds via localStorage.
 * Bounds load synchronously on first render (no async fetch).
 */
export function usePersistedBounds(
  key: string,
  options: UsePersistedBoundsOptions = {},
): UsePersistedBoundsResult {
  const {
    defaultWidth,
    defaultHeight,
    defaultX,
    defaultY,
    saveDebounceMs = 500,
  } = options;

  const storageKey = `${STORAGE_PREFIX}${key}`;

  const [persistedBounds, setPersistedBounds] = useState<Bounds | null>(() =>
    readFromStorage(storageKey),
  );

  const debouncedSave = useMemo(
    () =>
      debounce((newBounds: Bounds) => {
        try {
          localStorage.setItem(storageKey, JSON.stringify(newBounds));
          setPersistedBounds(newBounds);
        } catch {
          // Ignore storage errors (e.g., private browsing quota)
        }
      }, saveDebounceMs),
    // Recreate debounced fn when key or debounce time changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageKey, saveDebounceMs],
  );

  const save = useCallback(
    (bounds: Bounds) => {
      debouncedSave(bounds);
    },
    [debouncedSave],
  );

  const clear = useCallback(() => {
    debouncedSave.cancel();
    localStorage.removeItem(storageKey);
    setPersistedBounds(null);
  }, [storageKey, debouncedSave]);

  const bounds = useMemo(
    () => ({
      defaultWidth: persistedBounds?.width ?? defaultWidth,
      defaultHeight: persistedBounds?.height ?? defaultHeight,
      defaultX: persistedBounds?.x ?? defaultX,
      defaultY: persistedBounds?.y ?? defaultY,
    }),
    [persistedBounds, defaultWidth, defaultHeight, defaultX, defaultY],
  );

  return { bounds, save, clear };
}

/**
 * Clear persisted bounds for a specific key
 */
export function clearPersistedBounds(key: string): void {
  localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
}

/**
 * Clear all persisted bounds stored by this library
 */
export function clearAllPersistedBounds(): void {
  const keys = Object.keys(localStorage).filter((k) =>
    k.startsWith(STORAGE_PREFIX),
  );
  for (const k of keys) {
    localStorage.removeItem(k);
  }
}
