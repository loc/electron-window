import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDeferred, generateWindowId, debounce, sleep } from "../../src/shared/utils.js";
import { handleStyleInjection, __getStyleSubscriberCount } from "../../src/renderer/windowUtils.js";
import { wrapDocument, markDocDestroyed } from "../../src/renderer/docProxy.js";
import { trackWindow, markExpectedDead } from "../../src/renderer/leakTracking.js";

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

describe("preload __originHook — reads window.location.href", () => {
  // The preload hook gates contextBridge.exposeInMainWorld — if it returns
  // false, the renderer never sees the API. Unlike the main-side hook which
  // receives event.senderFrame.url, this reads window.location directly
  // (preload runs after document commit, so location is final).

  const CONST = "__ELECTRON_WINDOW_ALLOWED_ORIGINS__";
  let originalHref: string;

  beforeEach(() => {
    originalHref = window.location.href;
  });

  afterEach(() => {
    // jsdom's location isn't writable by default; reconfigure it
    Object.defineProperty(window, "location", {
      value: new URL(originalHref),
      writable: true,
      configurable: true,
    });
    delete (globalThis as Record<string, unknown>)[CONST];
    vi.resetModules();
  });

  function setLocation(href: string) {
    Object.defineProperty(window, "location", {
      value: new URL(href),
      writable: true,
      configurable: true,
    });
  }

  async function loadPreloadHook() {
    const mod = await import("../../src/preload/__originHook.js");
    return mod.__originHook;
  }

  it("permissive when constant is undefined", async () => {
    setLocation("https://any.example/page");
    const hook = await loadPreloadHook();
    expect(hook()).toBe(true);
  });

  it("allows when window.location origin is in allowlist", async () => {
    (globalThis as Record<string, unknown>)[CONST] = ["https://trusted.example"];
    setLocation("https://trusted.example/some/path");
    vi.resetModules();
    const hook = await loadPreloadHook();
    expect(hook()).toBe(true);
  });

  it("rejects when window.location origin is not in allowlist", async () => {
    (globalThis as Record<string, unknown>)[CONST] = ["https://trusted.example"];
    setLocation("https://attacker.example/");
    vi.resetModules();
    const hook = await loadPreloadHook();
    expect(hook()).toBe(false);
  });

  it("handles file:// via origin === 'null' fallback", async () => {
    (globalThis as Record<string, unknown>)[CONST] = ["file://"];
    setLocation("file:///Users/app/index.html");
    vi.resetModules();
    const hook = await loadPreloadHook();
    expect(hook()).toBe(true);
  });
});

describe("docProxy — stale-access detection", () => {
  function makeDoc(): Document {
    return document.implementation.createHTMLDocument("child");
  }

  it("warns once on access after markDocDestroyed", () => {
    const doc = makeDoc();
    const proxy = wrapDocument(doc, "win_abc");

    // Pre-destroy: normal access works, no warning.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(proxy.body).toBeDefined();
    expect(errSpy).not.toHaveBeenCalled();

    // Post-destroy: access warns (once, even for multiple accesses).
    markDocDestroyed("win_abc");
    void proxy.body;
    void proxy.title;
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toMatch(/Stale Document access.*win_abc/);
    expect(errSpy.mock.calls[0][0]).toMatch(/Acquired at:/);

    errSpy.mockRestore();
  });

  it("document methods work through the proxy (no Illegal invocation)", () => {
    // DOM methods internal-slot-check `this`. The proxy auto-binds so
    // proxy.createElement("div") doesn't throw.
    const doc = makeDoc();
    const proxy = wrapDocument(doc, "win_methods");

    expect(() => proxy.createElement("div")).not.toThrow();
    expect(() => proxy.querySelector("body")).not.toThrow();
    const el = proxy.createElement("span");
    expect(el.tagName).toBe("SPAN");
  });

  it("returns the same proxy for the same (doc, windowId) within a cycle", () => {
    // Identity stability — consumers can use it as an effect dep.
    const doc = makeDoc();
    const p1 = wrapDocument(doc, "win_stable");
    const p2 = wrapDocument(doc, "win_stable");
    expect(p1).toBe(p2);
  });

  it("returns a fresh proxy after destroy (pool reuse case)", () => {
    // Same Document, same windowId, but previous cycle was destroyed —
    // the old proxy keeps warning, the new one starts fresh.
    const doc = makeDoc();
    // Spy BEFORE any proxy access — vitest's expect() serializer may
    // touch proxy properties during diff formatting, which would fire
    // the once-only warning and set state.warned before we can observe it.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const oldProxy = wrapDocument(doc, "win_pool");
    markDocDestroyed("win_pool");
    const newProxy = wrapDocument(doc, "win_pool");

    // Identity check via Object.is directly (avoids serializer).
    expect(Object.is(newProxy, oldProxy)).toBe(false);

    errSpy.mockClear();
    void newProxy.body; // fresh proxy, no warning
    expect(errSpy).not.toHaveBeenCalled();
    void oldProxy.body; // stale proxy still warns
    expect(errSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it("defaultView (Window) access is also proxied and caught after destroy", () => {
    // createHTMLDocument gives defaultView=null; use an iframe for a real one.
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const childDoc = iframe.contentDocument!;

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const proxy = wrapDocument(childDoc, "win_dv");

    // Pre-destroy: defaultView is a proxied Window, methods work.
    const win = proxy.defaultView!;
    expect(win).not.toBeNull();
    expect(() => win.addEventListener("resize", () => {})).not.toThrow();
    expect(errSpy).not.toHaveBeenCalled();
    // Identity-stable within a cycle.
    expect(proxy.defaultView).toBe(win);

    // Post-destroy: Window access warns. This is the leak path a
    // Document-only proxy would miss — consumer stashes doc.defaultView
    // and calls addEventListener on it after close.
    markDocDestroyed("win_dv");
    void win.innerWidth;
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toMatch(/Window \(via document\.defaultView\).*win_dv/);

    errSpy.mockRestore();
    iframe.remove();
  });

  it("defaultView null-passthrough doesn't crash", () => {
    // createHTMLDocument has no browsing context → defaultView is null.
    const doc = makeDoc();
    const proxy = wrapDocument(doc, "win_dvnull");
    expect(proxy.defaultView).toBeNull();
  });
});

describe("leakTracking — trackWindow", () => {
  it("pushes a WeakRef to the global array", () => {
    const key = "__ELECTRON_WINDOW_TRACKED__";
    const before =
      ((globalThis as Record<string, unknown>)[key] as unknown[] | undefined)?.length ?? 0;

    // Any object works for WeakRef; cast a plain object as Window.
    const fakeWin = {} as unknown as globalThis.Window;
    trackWindow(fakeWin);

    const arr = (globalThis as Record<string, unknown>)[key] as WeakRef<object>[];
    expect(arr.length).toBe(before + 1);
    expect(arr[arr.length - 1].deref()).toBe(fakeWin);
  });

  it("markExpectedDead returns unique tokens for the same windowId", () => {
    // windowId is stable across open→close→open (only regenerated on
    // recreateOnShapeChange). Without per-call tokens, the second close's
    // pendingGC entry overwrites the first, and the first's FR callback
    // deletes the second's entry — masking a real leak.
    const win1 = {} as unknown as globalThis.Window;
    const win2 = {} as unknown as globalThis.Window;

    const t1 = markExpectedDead(win1, "win_same");
    const t2 = markExpectedDead(win2, "win_same");

    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    expect(t1).not.toBe(t2);
    // Both include the original id for diagnostics
    expect(t1).toContain("win_same");
    expect(t2).toContain("win_same");
  });
});
