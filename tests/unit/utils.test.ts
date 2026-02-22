import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createDeferred,
  generateWindowId,
  debounce,
  sleep,
  diffProps,
  shallowEqual,
  pick,
  omit,
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

describe("diffProps", () => {
  it("returns empty object for identical objects", () => {
    const obj = { a: 1, b: 2 };
    expect(diffProps(obj, obj)).toEqual({});
  });

  it("returns changed properties", () => {
    const prev = { a: 1, b: 2 };
    const next = { a: 1, b: 3 };
    expect(diffProps(prev, next)).toEqual({ b: 3 });
  });

  it("includes new properties", () => {
    const prev = { a: 1 };
    const next = { a: 1, b: 2 };
    expect(diffProps(prev, next)).toEqual({ b: 2 });
  });

  it("handles undefined prev", () => {
    const next = { a: 1, b: 2 };
    expect(diffProps(undefined, next)).toEqual({ a: 1, b: 2 });
  });
});

describe("shallowEqual", () => {
  it("returns true for identical objects", () => {
    const obj = { a: 1, b: 2 };
    expect(shallowEqual(obj, obj)).toBe(true);
  });

  it("returns true for equal objects", () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
  });

  it("returns false for different values", () => {
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("returns false for different keys", () => {
    expect(shallowEqual({ a: 1 }, { b: 1 })).toBe(false);
  });

  it("handles null and undefined", () => {
    expect(shallowEqual(null, null)).toBe(true);
    expect(shallowEqual(null, { a: 1 })).toBe(false);
    expect(shallowEqual({ a: 1 }, null)).toBe(false);
  });
});

describe("pick", () => {
  it("picks specified keys", () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(pick(obj, ["a", "c"])).toEqual({ a: 1, c: 3 });
  });

  it("ignores missing keys", () => {
    const obj = { a: 1 };
    expect(pick(obj, ["a", "b" as keyof typeof obj])).toEqual({ a: 1 });
  });
});

describe("omit", () => {
  it("omits specified keys", () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(omit(obj, ["b"])).toEqual({ a: 1, c: 3 });
  });

  it("handles missing keys", () => {
    const obj = { a: 1, b: 2 };
    expect(omit(obj, ["c" as keyof typeof obj])).toEqual({ a: 1, b: 2 });
  });
});
