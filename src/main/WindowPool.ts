import type { WindowShape, WindowPoolConfig } from "../shared/types.js";
import { generateWindowId } from "../shared/utils.js";

/**
 * Resource pool for managing reusable objects with create/destroy lifecycle
 */
export interface PoolResource<T> {
  id: string;
  resource: T;
  createdAt: number;
  lastUsedAt: number;
}

export interface Pool<T> {
  acquire(): PoolResource<T>;
  release(id: string): void;
  destroy(): void;
  getIdleCount(): number;
  getActiveCount(): number;
}

export interface PoolOptions<T> {
  /** Create a new resource */
  create: () => T;

  /** Destroy a resource */
  destroy: (resource: T) => void;

  /** Reset a resource for reuse (optional) */
  reset?: (resource: T) => void;

  /** Minimum idle resources to keep */
  minIdle?: number;

  /** Maximum idle resources to keep */
  maxIdle?: number;

  /** Time in ms before destroying idle resources */
  idleTimeout?: number;
}

/**
 * Generic resource pool implementation
 */
export class ResourcePool<T> implements Pool<T> {
  private readonly create: () => T;
  private readonly destroyResource: (resource: T) => void;
  private readonly reset?: (resource: T) => void;
  private readonly minIdle: number;
  private readonly maxIdle: number;
  private readonly idleTimeout: number;

  private readonly idle: Map<string, PoolResource<T>> = new Map();
  private readonly active: Map<string, PoolResource<T>> = new Map();
  private readonly timeoutIds: Map<string, ReturnType<typeof setTimeout>> =
    new Map();

  private isDestroyed = false;

  constructor(options: PoolOptions<T>) {
    this.create = options.create;
    this.destroyResource = options.destroy;
    this.reset = options.reset;
    this.minIdle = options.minIdle ?? 0;
    this.maxIdle = options.maxIdle ?? 5;
    this.idleTimeout = options.idleTimeout ?? 30000;

    // Pre-warm pool
    this.warmUp();
  }

  /**
   * Pre-warm the pool to minIdle
   */
  private warmUp(): void {
    while (this.idle.size < this.minIdle) {
      const resource = this.createResource();
      this.idle.set(resource.id, resource);
    }
  }

  /**
   * Create a new pool resource
   */
  private createResource(): PoolResource<T> {
    return {
      id: generateWindowId(),
      resource: this.create(),
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };
  }

  /**
   * Acquire a resource from the pool
   */
  acquire(): PoolResource<T> {
    if (this.isDestroyed) {
      throw new Error("Pool has been destroyed");
    }

    // Try to get from idle pool
    const idleEntry = this.idle.entries().next().value as
      | [string, PoolResource<T>]
      | undefined;

    if (idleEntry) {
      const [id, resource] = idleEntry;
      this.idle.delete(id);

      // Cancel any pending timeout
      const timeoutId = this.timeoutIds.get(id);
      if (timeoutId) {
        clearTimeout(timeoutId);
        this.timeoutIds.delete(id);
      }

      resource.lastUsedAt = Date.now();
      this.active.set(id, resource);

      // Reset if needed
      if (this.reset) {
        this.reset(resource.resource);
      }

      return resource;
    }

    // Create new resource
    const resource = this.createResource();
    this.active.set(resource.id, resource);
    return resource;
  }

  /**
   * Release a resource back to the pool
   */
  release(id: string): void {
    if (this.isDestroyed) return;

    const resource = this.active.get(id);
    if (!resource) return;

    this.active.delete(id);
    resource.lastUsedAt = Date.now();

    // Reset if needed
    if (this.reset) {
      this.reset(resource.resource);
    }

    // Check if we should keep it
    if (this.idle.size < this.maxIdle) {
      this.idle.set(id, resource);

      // Set timeout for destruction (unless we need minIdle)
      if (this.idle.size > this.minIdle && this.idleTimeout > 0) {
        const timeoutId = setTimeout(() => {
          this.evictIdle(id);
        }, this.idleTimeout);
        this.timeoutIds.set(id, timeoutId);
      }
    } else {
      // Pool is full, destroy immediately
      this.destroyResource(resource.resource);
    }
  }

  /**
   * Evict an idle resource
   */
  private evictIdle(id: string): void {
    // Don't evict below minIdle
    if (this.idle.size <= this.minIdle) {
      this.timeoutIds.delete(id);
      return;
    }

    const resource = this.idle.get(id);
    if (resource) {
      this.idle.delete(id);
      this.timeoutIds.delete(id);
      this.destroyResource(resource.resource);
    }
  }

  /**
   * Void a resource (remove without returning to pool)
   */
  void(id: string): void {
    const resource = this.active.get(id);
    if (resource) {
      this.active.delete(id);
      // Don't call destroy - the resource is already gone
    }
  }

  /**
   * Destroy the pool and all resources
   */
  destroy(): void {
    this.isDestroyed = true;

    // Clear all timeouts
    for (const timeoutId of this.timeoutIds.values()) {
      clearTimeout(timeoutId);
    }
    this.timeoutIds.clear();

    // Destroy all idle resources
    for (const resource of this.idle.values()) {
      this.destroyResource(resource.resource);
    }
    this.idle.clear();

    // Destroy all active resources
    for (const resource of this.active.values()) {
      this.destroyResource(resource.resource);
    }
    this.active.clear();
  }

  /**
   * Get count of idle resources
   */
  getIdleCount(): number {
    return this.idle.size;
  }

  /**
   * Get count of active resources
   */
  getActiveCount(): number {
    return this.active.size;
  }

  /**
   * Get total count
   */
  getTotalCount(): number {
    return this.idle.size + this.active.size;
  }
}

/**
 * Window-specific pool that tracks window shape
 */
export class WindowPool {
  readonly shape: WindowShape;
  private readonly pool: ResourcePool<{ destroy: () => void }>;

  constructor(
    shape: WindowShape,
    createWindow: () => { destroy: () => void },
    config: WindowPoolConfig = {},
  ) {
    this.shape = shape;

    this.pool = new ResourcePool({
      create: createWindow,
      destroy: (win) => win.destroy(),
      minIdle: config.minIdle ?? 1,
      maxIdle: config.maxIdle ?? 3,
      idleTimeout: config.idleTimeout ?? 30000,
    });
  }

  acquire(): PoolResource<{ destroy: () => void }> {
    return this.pool.acquire();
  }

  release(id: string): void {
    this.pool.release(id);
  }

  void(id: string): void {
    this.pool.void(id);
  }

  destroy(): void {
    this.pool.destroy();
  }

  getIdleCount(): number {
    return this.pool.getIdleCount();
  }

  getActiveCount(): number {
    return this.pool.getActiveCount();
  }
}

/**
 * Create a window pool with specific shape
 */
export function createWindowPool(
  shape: WindowShape,
  createWindow: () => { destroy: () => void },
  config?: WindowPoolConfig,
): WindowPool {
  return new WindowPool(shape, createWindow, config);
}
