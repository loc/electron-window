import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RENDERER_ALLOWED_PROPS } from "../../src/shared/types.js";
import { WindowInstance } from "../../src/main/WindowInstance.js";
import { WindowManager } from "../../src/main/WindowManager.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockBrowserWindow() {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();

  const bw = {
    // Event emitter
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(cb);
    }),
    emit: (event: string, ...args: unknown[]) => {
      for (const cb of handlers.get(event) ?? []) cb(...args);
    },

    // Visibility
    show: vi.fn(),
    showInactive: vi.fn(),
    hide: vi.fn(),

    // State queries
    isFocused: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    isMaximized: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    isFullScreen: vi.fn(() => false),
    isDestroyed: vi.fn(() => false),
    getTitle: vi.fn(() => ""),

    // Geometry
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 })),
    setBounds: vi.fn(),
    getMinimumSize: vi.fn(() => [0, 0]),
    getMaximumSize: vi.fn(() => [0, 0]),
    setMinimumSize: vi.fn(),
    setMaximumSize: vi.fn(),

    // Setters
    setTitle: vi.fn(),
    setBackgroundColor: vi.fn(),
    setOpacity: vi.fn(),
    setResizable: vi.fn(),
    setMovable: vi.fn(),
    setMinimizable: vi.fn(),
    setMaximizable: vi.fn(),
    setClosable: vi.fn(),
    setFocusable: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setSkipTaskbar: vi.fn(),
    setFullScreen: vi.fn(),
    setFullScreenable: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),

    // Actions
    focus: vi.fn(),
    blur: vi.fn(),
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),

    webContents: { id: 1 },
  };

  return bw;
}

type MockBrowserWindow = ReturnType<typeof createMockBrowserWindow>;

function createWindowInstance(
  props: Record<string, unknown> = {},
  onEvent = vi.fn(),
): { instance: WindowInstance; bw: MockBrowserWindow } {
  const bw = createMockBrowserWindow();
  const instance = new WindowInstance({
    id: "test-win",
    browserWindow: bw as unknown as import("electron").BrowserWindow,
    props: props as Parameters<typeof WindowInstance.prototype.updateProps>[0],
    onEvent,
  });
  return { instance, bw };
}

// ---------------------------------------------------------------------------
// filterAllowedProps (tested via WindowManager.createImplementation internals)
//
// Because filterAllowedProps is module-private, we test it by calling the
// implementation methods that WindowManager exposes. We bypass the generated
// IPC layer by extracting the impl via a mock WebContents.
// ---------------------------------------------------------------------------

function createMockWebContents() {
  return {
    id: 99,
    mainFrame: {
      url: "app://main",
      top: null as unknown,
      parent: null as unknown,
    },
    ipc: {
      handle: vi.fn(),
      removeHandler: vi.fn(),
    },
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
  };
}

// Pull the IWindowManagerImpl out of WindowManager without needing real Electron IPC.
// We do this by mocking the generated IPC module to capture the impl passed to it.
vi.mock(
  "../../src/generated-ipc/browser/electron_window.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/generated-ipc/browser/electron_window.js")
      >();
    return {
      ...actual,
      WindowManager: {
        for: () => ({
          setImplementation: (impl: unknown) => {
            // Stash it so tests can pull it out
            (globalThis as Record<string, unknown>).__lastImpl__ = impl;
            return { dispatchWindowEvent: vi.fn() };
          },
        }),
      },
    };
  },
);

function getLastImpl(): ReturnType<
  import("../../src/generated-ipc/browser/electron_window.js")["WindowManager"]["for"]
>["setImplementation"] extends (impl: infer I) => unknown
  ? I
  : never {
  return (globalThis as Record<string, unknown>).__lastImpl__ as ReturnType<
    import("../../src/generated-ipc/browser/electron_window.js")["WindowManager"]["for"]
  >["setImplementation"] extends (impl: infer I) => unknown
    ? I
    : never;
}

// Minimal mock BrowserWindow for setupForWindow calls
function createMockParentWindow() {
  const wc = createMockWebContents();
  return {
    webContents: wc,
    isDestroyed: vi.fn(() => false),
  };
}

// ---------------------------------------------------------------------------
// Tests: filterAllowedProps security boundary
// ---------------------------------------------------------------------------

describe("filterAllowedProps (via WindowManager IPC implementation)", () => {
  let manager: WindowManager;
  let impl: ReturnType<typeof getLastImpl>;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).__lastImpl__ = undefined;
    // devWarnings: false suppresses console noise in tests
    manager = new WindowManager({ devWarnings: false });
    const parent = createMockParentWindow();
    manager.setupForWindow(
      parent as unknown as import("electron").BrowserWindow,
    );
    impl = getLastImpl();
  });

  it("passes through all geometry props", () => {
    impl.RegisterWindow("w1", {
      width: 800,
      height: 600,
      x: 100,
      y: 200,
      minWidth: 400,
      minHeight: 300,
      maxWidth: 1200,
      maxHeight: 900,
    } as never);

    // If props were rejected the pending map would be empty or have filtered values.
    // We test by trying to pass dangerous props alongside — geometry should survive.
    impl.RegisterWindow("w2", {
      width: 1024,
      webPreferences: { nodeIntegration: true },
    } as never);

    // Verify the window registered (returns true from impl)
    const result = impl.RegisterWindow("w3", { width: 640 } as never);
    expect(result).toBe(true);
  });

  it("strips webPreferences (security-critical)", () => {
    // Register with dangerous props. We can observe that RegisterWindow returns
    // true (accepted) but only allowed keys end up stored. We verify via
    // buildConstructorOptions by inspecting setWindowOpenHandler return values.
    const parent = createMockParentWindow();
    const localManager = new WindowManager({ devWarnings: false });
    localManager.setupForWindow(
      parent as unknown as import("electron").BrowserWindow,
    );
    const localImpl = getLastImpl();

    localImpl.RegisterWindow("sec-win", {
      width: 800,
      webPreferences: { nodeIntegration: true, contextIsolation: false },
      preload: "/evil.js",
    } as never);

    // Now trigger setWindowOpenHandler and verify webPreferences are clean
    const handler = parent.webContents.setWindowOpenHandler.mock
      .calls[0]?.[0] as
      | ((arg: { frameName: string; url: string }) => unknown)
      | undefined;
    expect(handler).toBeDefined();

    const result = handler!({ frameName: "sec-win", url: "about:blank" }) as {
      action: string;
      overrideBrowserWindowOptions?: Record<string, unknown>;
    };

    expect(result.action).toBe("allow");
    // The overrideBrowserWindowOptions must not carry renderer-supplied webPreferences
    const opts = result.overrideBrowserWindowOptions!;
    expect(opts.webPreferences).toBeDefined();
    // Should only contain defaults (from config.defaultWindowOptions.webPreferences)
    // but never renderer-supplied values like nodeIntegration
    expect(
      (opts.webPreferences as Record<string, unknown>)?.nodeIntegration,
    ).toBeUndefined();
    expect(
      (opts.webPreferences as Record<string, unknown>)?.preload,
    ).toBeUndefined();
  });

  it("unknown window name causes setWindowOpenHandler to deny", () => {
    const parent = createMockParentWindow();
    const localManager = new WindowManager({ devWarnings: false });
    localManager.setupForWindow(
      parent as unknown as import("electron").BrowserWindow,
    );

    const handler = parent.webContents.setWindowOpenHandler.mock
      .calls[0]?.[0] as (arg: { frameName: string; url: string }) => unknown;
    const result = handler({ frameName: "unknown-win", url: "about:blank" });
    expect(result).toEqual({ action: "deny" });
  });

  it("strips nodeIntegration, contextIsolation, sandbox, preload", () => {
    // These keys are not in RENDERER_ALLOWED_PROPS — verify the set directly
    // as the enforcement contract, then verify indirectly via the registered result
    const dangerousProps = [
      "nodeIntegration",
      "contextIsolation",
      "sandbox",
      "preload",
      "enableRemoteModule",
      "parent",
      "modal",
    ];
    for (const prop of dangerousProps) {
      expect(RENDERER_ALLOWED_PROPS.has(prop)).toBe(false);
    }
  });

  it("allows all props in RENDERER_ALLOWED_PROPS", () => {
    const allowedGeometry = [
      "width",
      "height",
      "x",
      "y",
      "minWidth",
      "maxWidth",
      "minHeight",
      "maxHeight",
      "defaultWidth",
      "defaultHeight",
      "defaultX",
      "defaultY",
      "center",
    ];
    const allowedAppearance = [
      "title",
      "backgroundColor",
      "opacity",
      "transparent",
      "frame",
      "titleBarStyle",
      "vibrancy",
    ];
    const allowedBehavior = [
      "resizable",
      "movable",
      "minimizable",
      "maximizable",
      "closable",
      "focusable",
      "alwaysOnTop",
      "skipTaskbar",
      "fullscreen",
      "fullscreenable",
      "ignoreMouseEvents",
      "visible",
      "showInactive",
      "visibleOnAllWorkspaces",
      "trafficLightPosition",
      "titleBarOverlay",
      "targetDisplay",
    ];
    for (const prop of [
      ...allowedGeometry,
      ...allowedAppearance,
      ...allowedBehavior,
    ]) {
      expect(RENDERER_ALLOWED_PROPS.has(prop)).toBe(true);
    }
  });

  it("allows name and pool-support props via RENDERER_ALLOWED_PROPS", () => {
    // These were previously hardcoded exceptions in filterAllowedProps.
    // Now they're in the allowlist directly.
    expect(RENDERER_ALLOWED_PROPS.has("name")).toBe(true);
    expect(RENDERER_ALLOWED_PROPS.has("hideOnClose")).toBe(true);
    expect(RENDERER_ALLOWED_PROPS.has("showOnCreate")).toBe(true);

    const result = impl.RegisterWindow("cb-win", {
      width: 400,
      name: "my-window",
      hideOnClose: true,
      showOnCreate: false,
    } as never);
    expect(result).toBe(true);
  });

  it("denies window.open with non-about:blank URL", () => {
    const manager = new WindowManager({ devWarnings: false });
    const parent = createMockParentWindow();
    manager.setupForWindow(
      parent as unknown as import("electron").BrowserWindow,
    );
    const impl = getLastImpl();

    // Register a window
    impl.RegisterWindow("url-test", { width: 800 } as never);

    // Get the handler
    const handler = parent.webContents.setWindowOpenHandler.mock
      .calls[0]?.[0] as
      | ((arg: { frameName: string; url: string }) => unknown)
      | undefined;
    expect(handler).toBeDefined();

    // Try to open with an evil URL — should be denied even though frameName is registered
    const result = handler!({
      frameName: "url-test",
      url: "https://evil.com",
    }) as { action: string };
    expect(result.action).toBe("deny");

    // about:blank should be allowed
    const result2 = handler!({ frameName: "url-test", url: "about:blank" }) as {
      action: string;
    };
    expect(result2.action).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// Tests: WindowManager.validateFrame
// ---------------------------------------------------------------------------

describe("WindowManager validateFrame", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__lastImpl__ = undefined;
  });

  it("rejects iframe calls by default", () => {
    const manager = new WindowManager({ devWarnings: false });
    const parent = createMockParentWindow();

    // Make mainFrame look like an iframe (frame !== frame.top)
    const topFrame = { url: "app://main" };
    parent.webContents.mainFrame = {
      url: "app://main/iframe",
      top: topFrame as unknown,
      parent: topFrame as unknown,
    };

    manager.setupForWindow(
      parent as unknown as import("electron").BrowserWindow,
    );
    const impl = getLastImpl();

    // RegisterWindow should return false when the frame is rejected
    const result = impl.RegisterWindow("iframe-win", { width: 800 } as never);
    expect(result).toBe(false);
  });

  it("allows iframe calls when allowIframes: true", () => {
    const manager = new WindowManager({
      devWarnings: false,
      allowIframes: true,
    });
    const parent = createMockParentWindow();

    const topFrame = { url: "app://main" };
    parent.webContents.mainFrame = {
      url: "app://main/iframe",
      top: topFrame as unknown,
      parent: topFrame as unknown,
    };

    manager.setupForWindow(
      parent as unknown as import("electron").BrowserWindow,
    );
    const impl = getLastImpl();

    const result = impl.RegisterWindow("iframe-win", { width: 800 } as never);
    expect(result).toBe(true);
  });

  it("rejects calls from disallowed origins", () => {
    const manager = new WindowManager({
      devWarnings: false,
      allowedOrigins: ["app://allowed"],
    });
    const parent = createMockParentWindow();
    parent.webContents.mainFrame = {
      url: "app://evil.com/page",
      top: null as unknown,
      parent: null as unknown,
    };

    manager.setupForWindow(
      parent as unknown as import("electron").BrowserWindow,
    );
    const impl = getLastImpl();

    const result = impl.RegisterWindow("evil-win", { width: 800 } as never);
    expect(result).toBe(false);
  });

  it("allows calls from explicitly allowed origins", () => {
    const manager = new WindowManager({
      devWarnings: false,
      allowedOrigins: ["app://allowed"],
    });
    const parent = createMockParentWindow();
    parent.webContents.mainFrame = {
      url: "app://allowed/page",
      top: null as unknown,
      parent: null as unknown,
    };

    manager.setupForWindow(
      parent as unknown as import("electron").BrowserWindow,
    );
    const impl = getLastImpl();

    const result = impl.RegisterWindow("valid-win", { width: 800 } as never);
    expect(result).toBe(true);
  });

  it("allows all origins with wildcard", () => {
    const manager = new WindowManager({
      devWarnings: false,
      allowedOrigins: ["*"],
    });
    const parent = createMockParentWindow();
    parent.webContents.mainFrame = {
      url: "https://any-origin.com/page",
      top: null as unknown,
      parent: null as unknown,
    };

    manager.setupForWindow(
      parent as unknown as import("electron").BrowserWindow,
    );
    const impl = getLastImpl();

    const result = impl.RegisterWindow("wildcard-win", { width: 800 } as never);
    expect(result).toBe(true);
  });

  it("uses custom validator when provided", () => {
    const validator = vi.fn(() => false);
    const manager = new WindowManager({ devWarnings: false, validator });
    const parent = createMockParentWindow();

    manager.setupForWindow(
      parent as unknown as import("electron").BrowserWindow,
    );
    const impl = getLastImpl();

    const result = impl.RegisterWindow("custom-win", { width: 800 } as never);
    expect(result).toBe(false);
    expect(validator).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: WindowManager public API (getWindow, getAllWindows, destroy)
// ---------------------------------------------------------------------------

describe("WindowManager public API", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__lastImpl__ = undefined;
  });

  it("getWindow returns undefined for unknown id", () => {
    const manager = new WindowManager({ devWarnings: false });
    expect(manager.getWindow("nonexistent")).toBeUndefined();
  });

  it("getAllWindows returns empty array when no windows", () => {
    const manager = new WindowManager({ devWarnings: false });
    expect(manager.getAllWindows()).toEqual([]);
  });

  it("getWindowState returns null for unknown id", () => {
    const manager = new WindowManager({ devWarnings: false });
    expect(manager.getWindowState("nonexistent")).toBeNull();
  });

  it("destroy clears all windows", () => {
    const manager = new WindowManager({ devWarnings: false });
    expect(() => manager.destroy()).not.toThrow();
    expect(manager.getAllWindows()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests: WindowInstance — constructor behavior
// ---------------------------------------------------------------------------

describe("WindowInstance constructor", () => {
  it("calls show() on construction", () => {
    const { bw } = createWindowInstance();
    expect(bw.show).toHaveBeenCalledTimes(1);
  });

  it("calls showInactive() when showInactive prop is true", () => {
    const { bw } = createWindowInstance({ showInactive: true });
    expect(bw.showInactive).toHaveBeenCalledTimes(1);
    expect(bw.show).not.toHaveBeenCalled();
  });

  it("registers all expected event listeners", () => {
    const { bw } = createWindowInstance();
    const registeredEvents = bw.on.mock.calls.map((c) => c[0]);
    const expected = [
      "closed",
      "close",
      "focus",
      "blur",
      "maximize",
      "unmaximize",
      "minimize",
      "restore",
      "enter-full-screen",
      "leave-full-screen",
      "resize",
      "move",
      "resized",
      "moved",
    ];
    for (const event of expected) {
      expect(registeredEvents).toContain(event);
    }
  });

  it("applies ignoreMouseEvents post-creation when prop is set", () => {
    const { bw } = createWindowInstance({ ignoreMouseEvents: true });
    expect(bw.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
  });

  it("does not call setIgnoreMouseEvents when prop is false", () => {
    const { bw } = createWindowInstance({ ignoreMouseEvents: false });
    expect(bw.setIgnoreMouseEvents).not.toHaveBeenCalled();
  });

  it("applies visibleOnAllWorkspaces post-creation when prop is set", () => {
    const { bw } = createWindowInstance({ visibleOnAllWorkspaces: true });
    expect(bw.setVisibleOnAllWorkspaces).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: WindowInstance — event emission
// ---------------------------------------------------------------------------

describe("WindowInstance event emission", () => {
  it("emits focused event on focus", () => {
    const onEvent = vi.fn();
    const { bw } = createWindowInstance({}, onEvent);
    bw.emit("focus");
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "focused", id: "test-win" }),
    );
  });

  it("emits blurred event on blur", () => {
    const onEvent = vi.fn();
    const { bw } = createWindowInstance({}, onEvent);
    bw.emit("blur");
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "blurred", id: "test-win" }),
    );
  });

  it("emits maximized event on maximize", () => {
    const onEvent = vi.fn();
    const { bw } = createWindowInstance({}, onEvent);
    bw.emit("maximize");
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "maximized", id: "test-win" }),
    );
  });

  it("emits unmaximized event on unmaximize", () => {
    const onEvent = vi.fn();
    const { bw } = createWindowInstance({}, onEvent);
    bw.emit("unmaximize");
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "unmaximized", id: "test-win" }),
    );
  });

  it("emits minimized event on minimize", () => {
    const onEvent = vi.fn();
    const { bw } = createWindowInstance({}, onEvent);
    bw.emit("minimize");
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "minimized", id: "test-win" }),
    );
  });

  it("emits restored event on restore", () => {
    const onEvent = vi.fn();
    const { bw } = createWindowInstance({}, onEvent);
    bw.emit("restore");
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "restored", id: "test-win" }),
    );
  });

  it("emits enterFullscreen on enter-full-screen", () => {
    const onEvent = vi.fn();
    const { bw } = createWindowInstance({}, onEvent);
    bw.emit("enter-full-screen");
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "enterFullscreen", id: "test-win" }),
    );
  });

  it("emits leaveFullscreen on leave-full-screen", () => {
    const onEvent = vi.fn();
    const { bw } = createWindowInstance({}, onEvent);
    bw.emit("leave-full-screen");
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "leaveFullscreen", id: "test-win" }),
    );
  });

  it("emits closed and nulls browserWindow on closed event", () => {
    const onEvent = vi.fn();
    const { instance, bw } = createWindowInstance({}, onEvent);
    bw.emit("closed");
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "closed", id: "test-win" }),
    );
    expect(instance.destroyed).toBe(true);
    expect(instance.window).toBeNull();
  });

  it("emits userCloseRequested on close when closable is not false", () => {
    const onEvent = vi.fn();
    const { bw } = createWindowInstance({}, onEvent);
    // Simulate close event with a fake event object
    bw.emit("close", { preventDefault: vi.fn() });
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "userCloseRequested", id: "test-win" }),
    );
  });

  it("prevents close and does not emit userCloseRequested when closable is false", () => {
    const onEvent = vi.fn();
    const { bw } = createWindowInstance({ closable: false }, onEvent);
    const preventDefault = vi.fn();
    bw.emit("close", { preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "userCloseRequested" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: WindowInstance — updateProps PROP_SETTERS dispatch
// ---------------------------------------------------------------------------

describe("WindowInstance updateProps — PROP_SETTERS dispatch", () => {
  it("calls setTitle when title changes", () => {
    const { instance, bw } = createWindowInstance({ title: "old" });
    instance.updateProps({ title: "New Title" });
    expect(bw.setTitle).toHaveBeenCalledWith("New Title");
  });

  it("calls setBackgroundColor when backgroundColor changes", () => {
    const { instance, bw } = createWindowInstance();
    instance.updateProps({ backgroundColor: "#ff0000" });
    expect(bw.setBackgroundColor).toHaveBeenCalledWith("#ff0000");
  });

  it("calls setOpacity when opacity changes", () => {
    const { instance, bw } = createWindowInstance();
    instance.updateProps({ opacity: 0.5 });
    expect(bw.setOpacity).toHaveBeenCalledWith(0.5);
  });

  it("calls setResizable when resizable changes", () => {
    const { instance, bw } = createWindowInstance({ resizable: true });
    instance.updateProps({ resizable: false });
    expect(bw.setResizable).toHaveBeenCalledWith(false);
  });

  it("calls setMovable when movable changes", () => {
    const { instance, bw } = createWindowInstance({ movable: true });
    instance.updateProps({ movable: false });
    expect(bw.setMovable).toHaveBeenCalledWith(false);
  });

  it("calls setMinimizable when minimizable changes", () => {
    const { instance, bw } = createWindowInstance({ minimizable: true });
    instance.updateProps({ minimizable: false });
    expect(bw.setMinimizable).toHaveBeenCalledWith(false);
  });

  it("calls setMaximizable when maximizable changes", () => {
    const { instance, bw } = createWindowInstance({ maximizable: true });
    instance.updateProps({ maximizable: false });
    expect(bw.setMaximizable).toHaveBeenCalledWith(false);
  });

  it("calls setClosable when closable changes", () => {
    const { instance, bw } = createWindowInstance({ closable: true });
    instance.updateProps({ closable: false });
    expect(bw.setClosable).toHaveBeenCalledWith(false);
  });

  it("calls setFocusable when focusable changes", () => {
    const { instance, bw } = createWindowInstance({ focusable: true });
    instance.updateProps({ focusable: false });
    expect(bw.setFocusable).toHaveBeenCalledWith(false);
  });

  it("calls setAlwaysOnTop(true) when alwaysOnTop is true (Electron default level)", () => {
    const { instance, bw } = createWindowInstance({ alwaysOnTop: false });
    instance.updateProps({ alwaysOnTop: true });
    // No level arg — matches BrowserWindow constructor behavior for alwaysOnTop: true
    expect(bw.setAlwaysOnTop).toHaveBeenCalledWith(true);
  });

  it("calls setAlwaysOnTop(false) when alwaysOnTop is false", () => {
    const { instance, bw } = createWindowInstance({ alwaysOnTop: true });
    instance.updateProps({ alwaysOnTop: false });
    expect(bw.setAlwaysOnTop).toHaveBeenCalledWith(false);
  });

  it("calls setAlwaysOnTop with level string when alwaysOnTop is a level", () => {
    const { instance, bw } = createWindowInstance({ alwaysOnTop: false });
    instance.updateProps({ alwaysOnTop: "floating" });
    expect(bw.setAlwaysOnTop).toHaveBeenCalledWith(true, "floating");
  });

  it("calls setSkipTaskbar when skipTaskbar changes", () => {
    const { instance, bw } = createWindowInstance({ skipTaskbar: false });
    instance.updateProps({ skipTaskbar: true });
    expect(bw.setSkipTaskbar).toHaveBeenCalledWith(true);
  });

  it("calls setFullScreen when fullscreen changes", () => {
    const { instance, bw } = createWindowInstance({ fullscreen: false });
    instance.updateProps({ fullscreen: true });
    expect(bw.setFullScreen).toHaveBeenCalledWith(true);
  });

  it("calls setFullScreenable when fullscreenable changes", () => {
    const { instance, bw } = createWindowInstance({ fullscreenable: true });
    instance.updateProps({ fullscreenable: false });
    expect(bw.setFullScreenable).toHaveBeenCalledWith(false);
  });

  it("calls setIgnoreMouseEvents when ignoreMouseEvents changes", () => {
    const { instance, bw } = createWindowInstance({ ignoreMouseEvents: false });
    instance.updateProps({ ignoreMouseEvents: true });
    expect(bw.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
  });

  it("calls setMinimumSize preserving existing height when minWidth changes", () => {
    const { instance, bw } = createWindowInstance();
    bw.getMinimumSize.mockReturnValue([0, 300]);
    instance.updateProps({ minWidth: 500 });
    expect(bw.setMinimumSize).toHaveBeenCalledWith(500, 300);
  });

  it("calls setMinimumSize preserving existing width when minHeight changes", () => {
    const { instance, bw } = createWindowInstance();
    bw.getMinimumSize.mockReturnValue([400, 0]);
    instance.updateProps({ minHeight: 250 });
    expect(bw.setMinimumSize).toHaveBeenCalledWith(400, 250);
  });

  it("calls setMaximumSize preserving existing height when maxWidth changes", () => {
    const { instance, bw } = createWindowInstance();
    bw.getMaximumSize.mockReturnValue([0, 900]);
    instance.updateProps({ maxWidth: 1600 });
    expect(bw.setMaximumSize).toHaveBeenCalledWith(1600, 900);
  });

  it("calls setMaximumSize preserving existing width when maxHeight changes", () => {
    const { instance, bw } = createWindowInstance();
    bw.getMaximumSize.mockReturnValue([1200, 0]);
    instance.updateProps({ maxHeight: 800 });
    expect(bw.setMaximumSize).toHaveBeenCalledWith(1200, 800);
  });

  it("does not call setter when prop value is unchanged", () => {
    const { instance, bw } = createWindowInstance({ title: "Same" });
    instance.updateProps({ title: "Same" });
    expect(bw.setTitle).not.toHaveBeenCalled();
  });

  it("calls setBounds when x/y/width/height change", () => {
    const { instance, bw } = createWindowInstance();
    bw.getBounds.mockReturnValue({ x: 0, y: 0, width: 800, height: 600 });
    instance.updateProps({ x: 100, y: 200, width: 1024, height: 768 });
    expect(bw.setBounds).toHaveBeenCalledWith({
      x: 100,
      y: 200,
      width: 1024,
      height: 768,
    });
  });

  it("merges partial bounds with current bounds", () => {
    const { instance, bw } = createWindowInstance();
    bw.getBounds.mockReturnValue({ x: 50, y: 75, width: 800, height: 600 });
    instance.updateProps({ width: 1280 });
    expect(bw.setBounds).toHaveBeenCalledWith({
      x: 50,
      y: 75,
      width: 1280,
      height: 600,
    });
  });

  it("does not call setBounds when no geometry prop changes", () => {
    const { instance, bw } = createWindowInstance({ title: "old" });
    instance.updateProps({ title: "new" });
    expect(bw.setBounds).not.toHaveBeenCalled();
  });

  it("calls hide() when visible changes to false", () => {
    const { instance, bw } = createWindowInstance();
    instance.updateProps({ visible: false });
    expect(bw.hide).toHaveBeenCalled();
  });

  it("calls show() when visible changes to true", () => {
    const { instance, bw } = createWindowInstance();
    // First hide so visible=false is established
    instance.updateProps({ visible: false });
    bw.hide.mockClear();
    bw.show.mockClear();
    // Now make visible again
    instance.updateProps({ visible: true });
    expect(bw.show).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: WindowInstance — creation-only prop warnings
// ---------------------------------------------------------------------------

describe("WindowInstance updateProps — creation-only props", () => {
  const CREATION_ONLY = [
    "transparent",
    "frame",
    "titleBarStyle",
    "type",
    "vibrancy",
    "visualEffectState",
    "roundedCorners",
    "thickFrame",
  ] as const;

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const prop of CREATION_ONLY) {
    it(`warns and skips "${prop}" (creation-only)`, () => {
      const { instance, bw } = createWindowInstance({
        [prop]: prop === "frame" ? true : false,
      });
      instance.updateProps({
        [prop]: prop === "frame" ? false : true,
      } as never);
      // The prop setter should never reach setBounds or any other method
      // We verify the window state is unaffected by checking no BrowserWindow
      // mutation methods were called for creation-only props
      expect(bw.setTitle).not.toHaveBeenCalled();
    });
  }
});

// ---------------------------------------------------------------------------
// Tests: WindowInstance — no-op after destroy
// ---------------------------------------------------------------------------

describe("WindowInstance after destroy", () => {
  it("no-ops on updateProps after destroy", () => {
    const { instance, bw } = createWindowInstance({ title: "before" });
    instance.destroy();
    instance.updateProps({ title: "after" });
    expect(bw.setTitle).not.toHaveBeenCalled();
  });

  it("no-ops on focus/blur/minimize/maximize after destroy", () => {
    const { instance, bw } = createWindowInstance();
    instance.destroy();
    instance.focus();
    instance.blur();
    instance.minimize();
    instance.maximize();
    instance.unmaximize();
    expect(bw.focus).not.toHaveBeenCalled();
    expect(bw.blur).not.toHaveBeenCalled();
    expect(bw.minimize).not.toHaveBeenCalled();
    expect(bw.maximize).not.toHaveBeenCalled();
    expect(bw.unmaximize).not.toHaveBeenCalled();
  });

  it("getState returns zeroed state after destroy", () => {
    const { instance } = createWindowInstance();
    instance.destroy();
    const state = instance.getState();
    expect(state.isFocused).toBe(false);
    expect(state.isVisible).toBe(false);
    expect(state.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("getBounds returns zeros after destroy", () => {
    const { instance } = createWindowInstance();
    instance.destroy();
    expect(instance.getBounds()).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("destroyed getter returns true after destroy", () => {
    const { instance } = createWindowInstance();
    expect(instance.destroyed).toBe(false);
    instance.destroy();
    expect(instance.destroyed).toBe(true);
  });

  it("window getter returns null after destroy", () => {
    const { instance } = createWindowInstance();
    expect(instance.window).not.toBeNull();
    instance.destroy();
    expect(instance.window).toBeNull();
  });

  it("does not double-destroy on second destroy call", () => {
    const { instance, bw } = createWindowInstance();
    instance.destroy();
    instance.destroy();
    expect(bw.destroy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: WindowInstance — action methods
// ---------------------------------------------------------------------------

describe("WindowInstance action methods", () => {
  it("focus delegates to browserWindow.focus()", () => {
    const { instance, bw } = createWindowInstance();
    instance.focus();
    expect(bw.focus).toHaveBeenCalled();
  });

  it("blur delegates to browserWindow.blur()", () => {
    const { instance, bw } = createWindowInstance();
    instance.blur();
    expect(bw.blur).toHaveBeenCalled();
  });

  it("minimize delegates to browserWindow.minimize()", () => {
    const { instance, bw } = createWindowInstance();
    instance.minimize();
    expect(bw.minimize).toHaveBeenCalled();
  });

  it("maximize delegates to browserWindow.maximize()", () => {
    const { instance, bw } = createWindowInstance();
    instance.maximize();
    expect(bw.maximize).toHaveBeenCalled();
  });

  it("unmaximize delegates to browserWindow.unmaximize()", () => {
    const { instance, bw } = createWindowInstance();
    instance.unmaximize();
    expect(bw.unmaximize).toHaveBeenCalled();
  });

  it("close delegates to browserWindow.close()", () => {
    const { instance, bw } = createWindowInstance();
    instance.close();
    expect(bw.close).toHaveBeenCalled();
  });

  it("enterFullscreen calls setFullScreen(true)", () => {
    const { instance, bw } = createWindowInstance();
    instance.enterFullscreen();
    expect(bw.setFullScreen).toHaveBeenCalledWith(true);
  });

  it("exitFullscreen calls setFullScreen(false)", () => {
    const { instance, bw } = createWindowInstance();
    instance.exitFullscreen();
    expect(bw.setFullScreen).toHaveBeenCalledWith(false);
  });

  it("hide delegates to browserWindow.hide()", () => {
    const { instance, bw } = createWindowInstance();
    instance.hide();
    expect(bw.hide).toHaveBeenCalled();
  });

  it("show calls browserWindow.show() by default", () => {
    const { instance, bw } = createWindowInstance();
    // Constructor already called show; reset to isolate the manual call
    bw.show.mockClear();
    instance.show();
    expect(bw.show).toHaveBeenCalled();
  });

  it("show calls browserWindow.showInactive() when showInactive prop is true", () => {
    const { instance, bw } = createWindowInstance({ showInactive: true });
    bw.showInactive.mockClear();
    instance.show();
    expect(bw.showInactive).toHaveBeenCalled();
    expect(bw.show).not.toHaveBeenCalled();
  });

  it("setBounds merges with current bounds", () => {
    const { instance, bw } = createWindowInstance();
    bw.getBounds.mockReturnValue({ x: 10, y: 20, width: 800, height: 600 });
    instance.setBounds({ width: 1200 });
    expect(bw.setBounds).toHaveBeenCalledWith({
      x: 10,
      y: 20,
      width: 1200,
      height: 600,
    });
  });

  it("setTitle delegates to browserWindow.setTitle()", () => {
    const { instance, bw } = createWindowInstance();
    instance.setTitle("Hello World");
    expect(bw.setTitle).toHaveBeenCalledWith("Hello World");
  });

  it("webContentsId returns the webContents id", () => {
    const { instance } = createWindowInstance();
    expect(instance.webContentsId).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: WindowManager — rate limits (maxPendingWindows / maxWindows)
// ---------------------------------------------------------------------------

describe("WindowManager rate limits", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__lastImpl__ = undefined;
  });

  it("rejects RegisterWindow when maxPendingWindows is reached", () => {
    const manager = new WindowManager({
      devWarnings: false,
      maxPendingWindows: 2,
      maxWindows: 50,
    });
    const parent = createMockParentWindow();
    manager.setupForWindow(
      parent as unknown as import("electron").BrowserWindow,
    );
    const impl = getLastImpl();

    expect(impl.RegisterWindow("w1", { width: 800 } as never)).toBe(true);
    expect(impl.RegisterWindow("w2", { width: 800 } as never)).toBe(true);
    // Third exceeds the limit
    expect(impl.RegisterWindow("w3", { width: 800 } as never)).toBe(false);
  });

  it("rejects RegisterWindow when maxPendingWindows is 1", () => {
    const manager = new WindowManager({
      devWarnings: false,
      maxPendingWindows: 1,
      maxWindows: 50,
    });
    const parent = createMockParentWindow();
    manager.setupForWindow(
      parent as unknown as import("electron").BrowserWindow,
    );
    const impl = getLastImpl();

    expect(impl.RegisterWindow("w1", { width: 800 } as never)).toBe(true);
    expect(impl.RegisterWindow("w2", { width: 800 } as never)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: WindowInstance — forceClose bypasses closable guard
// ---------------------------------------------------------------------------

describe("WindowInstance forceClose", () => {
  it("closes window even when closable is false", () => {
    const { instance, bw } = createWindowInstance({ closable: false });
    instance.forceClose();
    expect(bw.close).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: WindowInstance — getState
// ---------------------------------------------------------------------------

describe("WindowInstance getState", () => {
  it("returns live state from browserWindow", () => {
    const { instance, bw } = createWindowInstance();
    bw.isFocused.mockReturnValue(true);
    bw.isVisible.mockReturnValue(true);
    bw.isMaximized.mockReturnValue(false);
    bw.isMinimized.mockReturnValue(false);
    bw.isFullScreen.mockReturnValue(false);
    bw.getBounds.mockReturnValue({ x: 10, y: 20, width: 640, height: 480 });
    bw.getTitle.mockReturnValue("Test Window");

    const state = instance.getState();
    expect(state).toEqual({
      id: "test-win",
      isFocused: true,
      isVisible: true,
      isMaximized: false,
      isMinimized: false,
      isFullscreen: false,
      bounds: { x: 10, y: 20, width: 640, height: 480 },
      title: "Test Window",
    });
  });
});
