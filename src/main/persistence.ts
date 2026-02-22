import { app, screen } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Bounds } from "../shared/types.js";

const STORE_FILE_NAME = "electron-window-bounds.json";

interface PersistenceAdapter {
  get(key: string): Promise<Bounds | null>;
  set(key: string, bounds: Bounds): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Default file-based persistence adapter
 * Stores bounds in app.getPath('userData')
 */
export class FilePersistenceAdapter implements PersistenceAdapter {
  private storePath: string;
  private cache: Map<string, Bounds> = new Map();
  private isLoaded = false;

  constructor(storePath?: string) {
    this.storePath =
      storePath ?? path.join(app.getPath("userData"), STORE_FILE_NAME);
  }

  private ensureLoaded(): void {
    if (this.isLoaded) return;

    try {
      if (fs.existsSync(this.storePath)) {
        const data = fs.readFileSync(this.storePath, "utf-8");
        const parsed = JSON.parse(data) as Record<string, Bounds>;
        for (const [key, value] of Object.entries(parsed)) {
          this.cache.set(key, value);
        }
      }
    } catch {
      // Ignore errors, start with empty cache
    }

    this.isLoaded = true;
  }

  private persist(): void {
    try {
      const data: Record<string, Bounds> = {};
      for (const [key, value] of this.cache.entries()) {
        data[key] = value;
      }
      fs.writeFileSync(this.storePath, JSON.stringify(data, null, 2));
    } catch {
      // Ignore write errors
    }
  }

  async get(key: string): Promise<Bounds | null> {
    this.ensureLoaded();
    return this.cache.get(key) ?? null;
  }

  async set(key: string, bounds: Bounds): Promise<void> {
    this.ensureLoaded();
    this.cache.set(key, bounds);
    this.persist();
  }

  async delete(key: string): Promise<void> {
    this.ensureLoaded();
    this.cache.delete(key);
    this.persist();
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.persist();
  }
}

/**
 * Validate that bounds are on-screen
 * Returns null if bounds would be completely off-screen
 */
export function validateBoundsOnScreen(bounds: Bounds): Bounds | null {
  const displays = screen.getAllDisplays();

  // Check if any part of the window is visible on any display
  for (const display of displays) {
    const { x, y, width, height } = display.workArea;

    // Check if there's any overlap
    const overlapX = bounds.x < x + width && bounds.x + bounds.width > x;
    const overlapY = bounds.y < y + height && bounds.y + bounds.height > y;

    if (overlapX && overlapY) {
      // At least partially visible, return as-is
      return bounds;
    }
  }

  // Completely off-screen, return null to use defaults
  return null;
}

/**
 * Ensure bounds are within constraints
 */
export function constrainBounds(
  bounds: Bounds,
  constraints: {
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
  },
): Bounds {
  let { width, height } = bounds;

  if (constraints.minWidth !== undefined) {
    width = Math.max(width, constraints.minWidth);
  }
  if (constraints.maxWidth !== undefined) {
    width = Math.min(width, constraints.maxWidth);
  }
  if (constraints.minHeight !== undefined) {
    height = Math.max(height, constraints.minHeight);
  }
  if (constraints.maxHeight !== undefined) {
    height = Math.min(height, constraints.maxHeight);
  }

  return {
    ...bounds,
    width,
    height,
  };
}
