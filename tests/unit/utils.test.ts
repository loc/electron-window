import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createDeferred,
  generateWindowId,
  debounce,
  sleep,
} from "../../src/shared/utils.js";

describe("createDeferred", () => {
  it("creates a promise that can be resolved externally", async () => {
    const deferred = createDeferred<string>();
    expect(deferred.isPending()).toBe(true);

    deferred.resolve("test");
    expect(deferred.isResolved()).toBe(true);

    const result = await deferred;
    expect(result).toBe("test");
  });

  it("creates a promise that can be rejected externally", async () => {
    const deferred = createDeferred<string>();
    expect(deferred.isPending()).toBe(true);

    deferred.reject(new Error("test error"));
    expect(deferred.isRejected()).toBe(true);

    await expect(deferred).rejects.toThrow("test error");
  });

  it("ignores subsequent resolve calls", async () => {
    const deferred = createDeferred<string>();
    deferred.resolve("first");
    deferred.resolve("second");

    const result = await deferred;
    expect(result).toBe("first");
  });
});

describe("generateWindowId", () => {
  it("generates unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateWindowId());
    }
    expect(ids.size).toBe(100);
  });

  it("generates IDs with win_ prefix", () => {
    const id = generateWindowId();
    expect(id.startsWith("win_")).toBe(true);
  });
});

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays function execution", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("resets timer on subsequent calls", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    vi.advanceTimersByTime(50);
    debounced();
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("can be cancelled", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    vi.advanceTimersByTime(50);
    debounced.cancel();
    vi.advanceTimersByTime(100);

    expect(fn).not.toHaveBeenCalled();
  });
});

describe("sleep", () => {
  it("resolves after the specified time", async () => {
    vi.useFakeTimers();

    const promise = sleep(100);
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);

    vi.advanceTimersByTime(100);
    await Promise.resolve(); // Flush microtasks

    expect(resolved).toBe(true);

    vi.useRealTimers();
  });
});
