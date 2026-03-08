import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDeferred, generateWindowId, debounce, sleep } from "../../src/shared/utils.js";
import { handleStyleInjection, __getStyleSubscriberCount } from "../../src/renderer/windowUtils.js";

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

describe("handleStyleInjection — subscriber cleanup (memory leak guard)", () => {
  // Each call to handleStyleInjection in 'auto' mode adds a Subscriber holding
  // a strong reference to the child window's Document. If cleanup isn't called,
  // the Document (and transitively its Window) leaks. This test guards the fix
  // where Window.tsx's unmount cleanup now calls styleCleanup directly rather
  // than relying on the unload event (which BrowserWindow.destroy() skips).

  function makeFakeDoc(): Document {
    // jsdom provides a usable Document via document.implementation
    return document.implementation.createHTMLDocument("child");
  }

  it("cleanup removes the subscriber", () => {
    const before = __getStyleSubscriberCount();
    const cleanup = handleStyleInjection(makeFakeDoc(), "auto");
    expect(__getStyleSubscriberCount()).toBe(before + 1);

    cleanup();
    expect(__getStyleSubscriberCount()).toBe(before);
  });

  it("cleanup is idempotent (double-call is safe)", () => {
    // The fix calls styleCleanup from both the unmount effect AND the unload
    // handler — whichever fires first wins, the second is a no-op.
    const before = __getStyleSubscriberCount();
    const cleanup = handleStyleInjection(makeFakeDoc(), "auto");
    cleanup();
    cleanup(); // no-op
    expect(__getStyleSubscriberCount()).toBe(before);
  });

  it("multiple subscribers are tracked independently", () => {
    const before = __getStyleSubscriberCount();
    const c1 = handleStyleInjection(makeFakeDoc(), "auto");
    const c2 = handleStyleInjection(makeFakeDoc(), "auto");
    expect(__getStyleSubscriberCount()).toBe(before + 2);
    c1();
    expect(__getStyleSubscriberCount()).toBe(before + 1);
    c2();
    expect(__getStyleSubscriberCount()).toBe(before);
  });

  it("mode=false does not add a subscriber", () => {
    const before = __getStyleSubscriberCount();
    const cleanup = handleStyleInjection(makeFakeDoc(), false);
    expect(__getStyleSubscriberCount()).toBe(before);
    cleanup(); // no-op
    expect(__getStyleSubscriberCount()).toBe(before);
  });
});

describe("__originHook — build-time origin allowlist", () => {
  // The hooks read __ELECTRON_WINDOW_ALLOWED_ORIGINS__ via `typeof`, which
  // at runtime (no bundler define) evaluates to "undefined" → permissive.
  // To test the active path, we set the constant as a global before importing
  // the hook, then import fresh via vi.resetModules() + dynamic import. Each
  // test cleans up the global so tests don't leak into each other.

  const CONST = "__ELECTRON_WINDOW_ALLOWED_ORIGINS__";

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[CONST];
    vi.resetModules();
  });

  async function loadMainHook() {
    const mod = await import("../../src/main/__originHook.js");
    return mod.__originHook;
  }

  it("permissive when constant is undefined (consumer did not define)", async () => {
    // Without define, typeof __ELECTRON_WINDOW_ALLOWED_ORIGINS__ is "undefined"
    const hook = await loadMainHook();
    expect(hook("https://any.example")).toBe(true);
    expect(hook(undefined)).toBe(true);
  });

  it("allows origins in the allowlist", async () => {
    (globalThis as Record<string, unknown>)[CONST] = ["https://trusted.example"];
    vi.resetModules();
    const hook = await loadMainHook();
    expect(hook("https://trusted.example/page")).toBe(true);
    expect(hook("https://trusted.example/other?q=1")).toBe(true);
  });

  it("rejects origins not in the allowlist", async () => {
    (globalThis as Record<string, unknown>)[CONST] = ["https://trusted.example"];
    vi.resetModules();
    const hook = await loadMainHook();
    expect(hook("https://evil.example/page")).toBe(false);
    expect(hook("http://trusted.example/")).toBe(false); // wrong protocol
  });

  it("rejects undefined url when allowlist is configured", async () => {
    (globalThis as Record<string, unknown>)[CONST] = ["app://main"];
    vi.resetModules();
    const hook = await loadMainHook();
    expect(hook(undefined)).toBe(false);
  });

  it("handles custom protocols (file://, app://) via origin 'null' fallback", async () => {
    (globalThis as Record<string, unknown>)[CONST] = ["file://", "app://main"];
    vi.resetModules();
    const hook = await loadMainHook();
    expect(hook("file:///Users/app/index.html")).toBe(true);
    expect(hook("app://main/page")).toBe(true);
    expect(hook("app://other/page")).toBe(false);
  });

  it("rejects malformed URLs", async () => {
    (globalThis as Record<string, unknown>)[CONST] = ["https://trusted.example"];
    vi.resetModules();
    const hook = await loadMainHook();
    expect(hook("not a url")).toBe(false);
  });
});
