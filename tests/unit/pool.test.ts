import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResourcePool } from "../../src/main/WindowPool.js";

describe("ResourcePool", () => {
  interface MockResource {
    id: number;
    destroyed: boolean;
  }

  let resourceId = 0;

  const createMockResource = (): MockResource => ({
    id: ++resourceId,
    destroyed: false,
  });

  const destroyMockResource = (resource: MockResource): void => {
    resource.destroyed = true;
  };

  beforeEach(() => {
    resourceId = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("pre-warming", () => {
    it("pre-warms to minIdle on creation", () => {
      const create = vi.fn(createMockResource);
      const pool = new ResourcePool({
        create,
        destroy: destroyMockResource,
        minIdle: 2,
      });

      expect(create).toHaveBeenCalledTimes(2);
      expect(pool.getIdleCount()).toBe(2);

      pool.destroy();
    });

    it("does not pre-warm when minIdle is 0", () => {
      const create = vi.fn(createMockResource);
      const pool = new ResourcePool({
        create,
        destroy: destroyMockResource,
        minIdle: 0,
      });

      expect(create).not.toHaveBeenCalled();
      expect(pool.getIdleCount()).toBe(0);

      pool.destroy();
    });
  });

  describe("acquire", () => {
    it("returns pooled resource on acquire", () => {
      const create = vi.fn(createMockResource);
      const pool = new ResourcePool({
        create,
        destroy: destroyMockResource,
        minIdle: 1,
      });

      expect(create).toHaveBeenCalledTimes(1);

      const acquired = pool.acquire();
      expect(acquired.resource.id).toBe(1);
      expect(pool.getIdleCount()).toBe(0);
      expect(pool.getActiveCount()).toBe(1);

      // Should not create new one since we got from pool
      expect(create).toHaveBeenCalledTimes(1);

      pool.destroy();
    });

    it("creates new resource when pool is empty", () => {
      const create = vi.fn(createMockResource);
      const pool = new ResourcePool({
        create,
        destroy: destroyMockResource,
        minIdle: 0,
      });

      expect(create).not.toHaveBeenCalled();

      const acquired = pool.acquire();
      expect(acquired.resource.id).toBe(1);
      expect(create).toHaveBeenCalledTimes(1);

      pool.destroy();
    });

    it("resets resource when acquired from pool", () => {
      const reset = vi.fn();
      const pool = new ResourcePool({
        create: createMockResource,
        destroy: destroyMockResource,
        reset,
        minIdle: 1,
      });

      const acquired = pool.acquire();
      expect(reset).toHaveBeenCalledWith(acquired.resource);

      pool.destroy();
    });
  });

  describe("release", () => {
    it("returns resource to pool on release", () => {
      const pool = new ResourcePool({
        create: createMockResource,
        destroy: destroyMockResource,
        minIdle: 0,
        maxIdle: 5,
      });

      const acquired = pool.acquire();
      expect(pool.getIdleCount()).toBe(0);
      expect(pool.getActiveCount()).toBe(1);

      pool.release(acquired.id);
      expect(pool.getIdleCount()).toBe(1);
      expect(pool.getActiveCount()).toBe(0);

      pool.destroy();
    });

    it("destroys resource when pool is full", () => {
      const destroy = vi.fn(destroyMockResource);
      const pool = new ResourcePool({
        create: createMockResource,
        destroy,
        minIdle: 0,
        maxIdle: 1,
      });

      const acquired1 = pool.acquire();
      const acquired2 = pool.acquire();

      pool.release(acquired1.id);
      expect(pool.getIdleCount()).toBe(1);
      expect(destroy).not.toHaveBeenCalled();

      pool.release(acquired2.id);
      expect(pool.getIdleCount()).toBe(1); // Still 1 (maxIdle)
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(acquired2.resource.destroyed).toBe(true);

      pool.destroy();
    });
  });

  describe("idle timeout", () => {
    it("destroys idle resources after timeout", () => {
      const destroy = vi.fn(destroyMockResource);
      const pool = new ResourcePool({
        create: createMockResource,
        destroy,
        minIdle: 0,
        maxIdle: 5,
        idleTimeout: 1000,
      });

      const acquired = pool.acquire();
      pool.release(acquired.id);
      expect(pool.getIdleCount()).toBe(1);

      vi.advanceTimersByTime(500);
      expect(pool.getIdleCount()).toBe(1);
      expect(destroy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);
      expect(pool.getIdleCount()).toBe(0);
      expect(destroy).toHaveBeenCalledTimes(1);

      pool.destroy();
    });

    it("does not destroy below minIdle", () => {
      const destroy = vi.fn(destroyMockResource);
      const pool = new ResourcePool({
        create: createMockResource,
        destroy,
        minIdle: 1,
        maxIdle: 5,
        idleTimeout: 1000,
      });

      // Pool starts with 1 idle (minIdle)
      expect(pool.getIdleCount()).toBe(1);

      vi.advanceTimersByTime(2000);

      // Should still have 1 (minIdle protected)
      expect(pool.getIdleCount()).toBe(1);
      expect(destroy).not.toHaveBeenCalled();

      pool.destroy();
    });
  });

  describe("void", () => {
    it("removes resource without returning to pool", () => {
      const destroy = vi.fn(destroyMockResource);
      const pool = new ResourcePool({
        create: createMockResource,
        destroy,
        minIdle: 0,
      });

      const acquired = pool.acquire();
      expect(pool.getActiveCount()).toBe(1);

      pool.void(acquired.id);
      expect(pool.getActiveCount()).toBe(0);
      expect(pool.getIdleCount()).toBe(0);
      // Destroy should NOT be called - the resource is gone
      expect(destroy).not.toHaveBeenCalled();

      pool.destroy();
    });
  });

  describe("destroy", () => {
    it("destroys all resources", () => {
      const destroy = vi.fn(destroyMockResource);
      const pool = new ResourcePool({
        create: createMockResource,
        destroy,
        minIdle: 2,
      });

      const acquired = pool.acquire();
      expect(pool.getIdleCount()).toBe(1);
      expect(pool.getActiveCount()).toBe(1);

      pool.destroy();

      // Should destroy both idle and active
      expect(destroy).toHaveBeenCalledTimes(2);
      expect(pool.getIdleCount()).toBe(0);
      expect(pool.getActiveCount()).toBe(0);
    });

    it("clears all pending timeouts", () => {
      const destroy = vi.fn(destroyMockResource);
      const pool = new ResourcePool({
        create: createMockResource,
        destroy,
        minIdle: 0,
        idleTimeout: 1000,
      });

      const acquired = pool.acquire();
      pool.release(acquired.id);

      pool.destroy();

      // Advancing time should not cause more destroys
      const callCount = destroy.mock.calls.length;
      vi.advanceTimersByTime(2000);
      expect(destroy).toHaveBeenCalledTimes(callCount);
    });

    it("throws on acquire after destroy", () => {
      const pool = new ResourcePool({
        create: createMockResource,
        destroy: destroyMockResource,
      });

      pool.destroy();

      expect(() => pool.acquire()).toThrow("Pool has been destroyed");
    });
  });
});
