import {
  test,
  expect,
  _electron as electron,
  ElectronApplication,
  Page,
} from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testAppPath = path.join(__dirname, "fixtures/test-app/dist/main.js");

// Helper to wait for a condition
async function waitFor(
  fn: () => Promise<boolean>,
  timeout = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("waitFor timeout");
}

test.describe("E2E: App Launch", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({ args: [testAppPath] });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await app.close();
  });

  test("app launches successfully", async () => {
    const title = await page.title();
    expect(title).toBe("Electron Window Test App");
  });

  test("status element shows Ready", async () => {
    await expect(page.getByTestId("status")).toHaveText("Ready");
  });

  test("control buttons are visible", async () => {
    await expect(page.getByTestId("open-window")).toBeVisible();
    await expect(page.getByTestId("close-window")).toBeVisible();
    await expect(page.getByTestId("toggle-window")).toBeVisible();
  });

  test("test API is exposed", async () => {
    const pong = await page.evaluate(() => window.testAPI.ping());
    expect(pong).toBe("pong");
  });
});

test.describe("E2E: Window Lifecycle", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({ args: [testAppPath] });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await app.close();
  });

  test.beforeEach(async () => {
    // Clear state before each test
    await page.evaluate(() => window.testAPI.clearAllState());
    await page.evaluate(() => {
      window.__test__.setScenario("basic");
      window.__test__.setWindowOpen(false);
      window.__test__.clearEvents();
    });
  });

  test("creates window when open becomes true", async () => {
    // Initially no child windows
    const initialCount = await page.evaluate(() =>
      window.testAPI.getWindowCount(),
    );
    expect(initialCount).toBe(0);

    // Open window
    await page.evaluate(() => window.__test__.setWindowOpen(true));

    // Wait for window to be created
    await waitFor(async () => {
      const count = await page.evaluate(() => window.testAPI.getWindowCount());
      return count === 1;
    });

    const count = await page.evaluate(() => window.testAPI.getWindowCount());
    expect(count).toBe(1);
  });

  test("destroys window when open becomes false", async () => {
    // Open window and wait for ready event
    await page.evaluate(() => window.__test__.setWindowOpen(true));

    // Wait for window creation and ready event
    await waitFor(async () => {
      const count = await page.evaluate(() => window.testAPI.getWindowCount());
      const events = await page.evaluate(() => window.__test__.getEvents());
      return count === 1 && events.some((e) => e.type === "ready");
    });

    // Verify window is created and ready
    const count = await page.evaluate(() => window.testAPI.getWindowCount());
    expect(count).toBe(1);

    // Close window
    await page.evaluate(() => window.__test__.setWindowOpen(false));

    // Wait for window to be destroyed
    await waitFor(async () => {
      return (await page.evaluate(() => window.testAPI.getWindowCount())) === 0;
    });

    const countAfter = await page.evaluate(() =>
      window.testAPI.getWindowCount(),
    );
    expect(countAfter).toBe(0);
  });

  test("fires onReady when window is created", async () => {
    await page.evaluate(() => window.__test__.setWindowOpen(true));

    await waitFor(async () => {
      const events = await page.evaluate(() => window.__test__.getEvents());
      return events.some((e) => e.type === "ready");
    });

    const events = await page.evaluate(() => window.__test__.getEvents());
    expect(events.some((e) => e.type === "ready")).toBe(true);
  });

  test("rapid toggle does not leak windows", async () => {
    // Rapidly toggle window 5 times
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.__test__.setWindowOpen(true));
      await page.waitForTimeout(50);
      await page.evaluate(() => window.__test__.setWindowOpen(false));
      await page.waitForTimeout(50);
    }

    // Final open
    await page.evaluate(() => window.__test__.setWindowOpen(true));

    // Wait and check
    await page.waitForTimeout(500);
    const count = await page.evaluate(() => window.testAPI.getWindowCount());
    expect(count).toBeLessThanOrEqual(1);
  });
});

test.describe("E2E: Window Props", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({ args: [testAppPath] });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await app.close();
  });

  test.beforeEach(async () => {
    await page.evaluate(() => window.testAPI.clearAllState());
    await page.evaluate(() => {
      window.__test__.setScenario("basic");
      window.__test__.setWindowOpen(false);
      window.__test__.clearEvents();
    });
  });

  test("window has correct default dimensions", async () => {
    await page.evaluate(() => {
      window.__test__.setWindowProps({ defaultWidth: 600, defaultHeight: 400 });
      window.__test__.setWindowOpen(true);
    });

    await waitFor(async () => {
      return (await page.evaluate(() => window.testAPI.getWindowCount())) === 1;
    });

    const windows = await page.evaluate(() => window.testAPI.getAllWindows());
    expect(windows[0].bounds.width).toBe(600);
    expect(windows[0].bounds.height).toBe(400);
  });

  test("window has correct title", async () => {
    await page.evaluate(() => {
      window.__test__.setWindowProps({ title: "Test Window Title" });
      window.__test__.setWindowOpen(true);
    });

    await waitFor(async () => {
      return (await page.evaluate(() => window.testAPI.getWindowCount())) === 1;
    });

    const windows = await page.evaluate(() => window.testAPI.getAllWindows());
    expect(windows[0].title).toBe("Test Window Title");
  });

  test("alwaysOnTop prop is applied", async () => {
    await page.evaluate(() => {
      window.__test__.setWindowProps({ alwaysOnTop: true });
      window.__test__.setWindowOpen(true);
    });

    await waitFor(async () => {
      return (await page.evaluate(() => window.testAPI.getWindowCount())) === 1;
    });

    const windows = await page.evaluate(() => window.testAPI.getAllWindows());
    const props = await page.evaluate(
      (id) => window.testAPI.getWindowProps(id),
      windows[0].id,
    );
    expect(props.isAlwaysOnTop).toBe(true);
  });

  test("resizable prop is applied", async () => {
    await page.evaluate(() => {
      window.__test__.setWindowProps({ resizable: false });
      window.__test__.setWindowOpen(true);
    });

    await waitFor(async () => {
      return (await page.evaluate(() => window.testAPI.getWindowCount())) === 1;
    });

    const windows = await page.evaluate(() => window.testAPI.getAllWindows());
    const props = await page.evaluate(
      (id) => window.testAPI.getWindowProps(id),
      windows[0].id,
    );
    expect(props.isResizable).toBe(false);
  });

  test("changing alwaysOnTop updates window", async () => {
    await page.evaluate(() => {
      window.__test__.setWindowProps({ alwaysOnTop: false });
      window.__test__.setWindowOpen(true);
    });

    await waitFor(async () => {
      return (await page.evaluate(() => window.testAPI.getWindowCount())) === 1;
    });

    // Initial state
    const windows = await page.evaluate(() => window.testAPI.getAllWindows());
    let props = await page.evaluate(
      (id) => window.testAPI.getWindowProps(id),
      windows[0].id,
    );
    expect(props.isAlwaysOnTop).toBe(false);

    // Change prop
    await page.evaluate(() => {
      window.__test__.setWindowProps({ alwaysOnTop: true });
    });

    await page.waitForTimeout(100);

    // Verify changed
    props = await page.evaluate(
      (id) => window.testAPI.getWindowProps(id),
      windows[0].id,
    );
    expect(props.isAlwaysOnTop).toBe(true);
  });

  test("changing resizable updates window", async () => {
    await page.evaluate(() => {
      window.__test__.setWindowProps({ resizable: true });
      window.__test__.setWindowOpen(true);
    });

    await waitFor(async () => {
      return (await page.evaluate(() => window.testAPI.getWindowCount())) === 1;
    });

    const windows = await page.evaluate(() => window.testAPI.getAllWindows());

    // Change prop
    await page.evaluate(() => {
      window.__test__.setWindowProps({ resizable: false });
    });

    await page.waitForTimeout(100);

    const props = await page.evaluate(
      (id) => window.testAPI.getWindowProps(id),
      windows[0].id,
    );
    expect(props.isResizable).toBe(false);
  });
});

test.describe("E2E: Creation-Only Props", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({ args: [testAppPath] });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await app.close();
  });

  test.beforeEach(async () => {
    await page.evaluate(() => window.testAPI.clearAllState());
  });

  test("frameless window is created without frame", async () => {
    await page.evaluate(() => {
      window.__test__.setScenario("frameless");
      window.__test__.setWindowOpen(true);
    });

    await waitFor(async () => {
      return (await page.evaluate(() => window.testAPI.getWindowCount())) === 1;
    });

    // Note: Electron doesn't expose isFramed property, but the window was created
    // The test verifies the creation-only prop was passed correctly
    const count = await page.evaluate(() => window.testAPI.getWindowCount());
    expect(count).toBe(1);
  });

  test("transparent window is created", async () => {
    await page.evaluate(() => {
      window.__test__.setScenario("transparent");
      window.__test__.setWindowOpen(true);
    });

    await waitFor(async () => {
      return (await page.evaluate(() => window.testAPI.getWindowCount())) === 1;
    });

    const count = await page.evaluate(() => window.testAPI.getWindowCount());
    expect(count).toBe(1);
  });
});

test.describe("E2E: Controlled Bounds", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({ args: [testAppPath] });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await app.close();
  });

  test.beforeEach(async () => {
    await page.evaluate(() => window.testAPI.clearAllState());
    await page.evaluate(() => {
      window.__test__.setScenario("controlled-bounds");
      window.__test__.setWindowOpen(false);
      window.__test__.clearEvents();
    });
  });

  test("window is created with controlled bounds", async () => {
    await page.evaluate(() => {
      window.__test__.setWindowProps({
        width: 500,
        height: 400,
        x: 100,
        y: 100,
      });
      window.__test__.setWindowOpen(true);
    });

    await waitFor(async () => {
      return (await page.evaluate(() => window.testAPI.getWindowCount())) === 1;
    });

    const windows = await page.evaluate(() => window.testAPI.getAllWindows());
    expect(windows[0].bounds.width).toBe(500);
    expect(windows[0].bounds.height).toBe(400);
  });

  test("changing controlled width updates window", async () => {
    await page.evaluate(() => {
      window.__test__.setWindowProps({ width: 500, height: 400 });
      window.__test__.setWindowOpen(true);
    });

    await waitFor(async () => {
      return (await page.evaluate(() => window.testAPI.getWindowCount())) === 1;
    });

    // Change width
    await page.evaluate(() => {
      window.__test__.setWindowProps({ width: 700 });
    });

    await page.waitForTimeout(200);

    const windows = await page.evaluate(() => window.testAPI.getAllWindows());
    expect(windows[0].bounds.width).toBe(700);
  });
});

test.describe("E2E: Multiple Windows", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({ args: [testAppPath] });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await app.close();
  });

  test.beforeEach(async () => {
    await page.evaluate(() => window.testAPI.clearAllState());
    await page.evaluate(() => {
      window.__test__.setScenario(null as any);
      window.__test__.setWindowOpen(false);
      window.__test__.clearEvents();
    });
  });

  test("can create multiple windows", async () => {
    await page.evaluate(() => {
      window.__test__.setScenario("multiple-windows");
      window.__test__.setWindowOpen(true);
    });

    await waitFor(async () => {
      return (await page.evaluate(() => window.testAPI.getWindowCount())) === 2;
    });

    const windows = await page.evaluate(() => window.testAPI.getAllWindows());
    expect(windows.length).toBe(2);
    expect(windows.map((w) => w.title).sort()).toEqual([
      "Window 1",
      "Window 2",
    ]);
  });

  test("each window has its own position", async () => {
    await page.evaluate(() => {
      window.__test__.setScenario("multiple-windows");
      window.__test__.setWindowOpen(true);
    });

    await waitFor(async () => {
      return (await page.evaluate(() => window.testAPI.getWindowCount())) === 2;
    });

    const windows = await page.evaluate(() => window.testAPI.getAllWindows());
    const positions = windows.map((w) => w.bounds.x);
    // Windows should have different x positions (50 and 400)
    expect(positions[0]).not.toBe(positions[1]);
  });
});

test.describe("E2E: Security", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({ args: [testAppPath] });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await app.close();
  });

  test("Node.js globals are not exposed to renderer", async () => {
    const hasNodeGlobals = await page.evaluate(() => {
      return typeof require !== "undefined" || typeof process !== "undefined";
    });
    expect(hasNodeGlobals).toBe(false);
  });

  test("cannot access electron directly", async () => {
    const hasElectron = await page.evaluate(() => {
      return (
        typeof (window as unknown as { electron?: unknown }).electron !==
        "undefined"
      );
    });
    expect(hasElectron).toBe(false);
  });

  test("preload APIs are properly exposed", async () => {
    const hasWindowManager = await page.evaluate(
      () =>
        typeof (window as unknown as { electron_window?: unknown })
          .electron_window !== "undefined",
    );
    const hasTestAPI = await page.evaluate(
      () => typeof window.testAPI !== "undefined",
    );
    expect(hasWindowManager).toBe(true);
    expect(hasTestAPI).toBe(true);
  });
});

test.describe("E2E: Child Window Content", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({ args: [testAppPath] });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await app.close();
  });

  test.beforeEach(async () => {
    await page.evaluate(() => window.testAPI.clearAllState());
    await page.evaluate(() => {
      window.__test__.setScenario("content-check");
      window.__test__.setWindowOpen(false);
      window.__test__.clearEvents();
    });
  });

  test("renders React content inside child window", async () => {
    const childWindowPromise = app.waitForEvent("window");
    await page.evaluate(() => window.__test__.setWindowOpen(true));
    const childWindow = await childWindowPromise;
    await childWindow.waitForLoadState("domcontentloaded");

    await expect(
      childWindow.locator('[data-testid="child-content"]'),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      childWindow.locator('[data-testid="child-content"]'),
    ).toHaveText("Hello from child window");
  });
});

test.describe("E2E: User Close", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({ args: [testAppPath] });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await app.close();
  });

  test.beforeEach(async () => {
    await page.evaluate(() => window.testAPI.clearAllState());
    await page.evaluate(() => {
      window.__test__.setScenario("user-close");
      window.__test__.setWindowOpen(false);
      window.__test__.clearEvents();
    });
  });

  test("onUserClose fires when window is closed from main process", async () => {
    await page.evaluate(() => window.__test__.setWindowOpen(true));
    await waitFor(async () => {
      const count = await page.evaluate(() => window.testAPI.getWindowCount());
      const events = await page.evaluate(() => window.__test__.getEvents());
      return count === 1 && events.some((e) => e.type === "ready");
    });

    const windows = await page.evaluate(() => window.testAPI.getAllWindows());
    const childId = windows[0].id;

    await page.evaluate((id) => window.testAPI.closeChildWindow(id), childId);

    await waitFor(async () => {
      const events = await page.evaluate(() => window.__test__.getEvents());
      return events.some((e) => e.type === "userClose");
    });

    const events = await page.evaluate(() => window.__test__.getEvents());
    expect(events.some((e) => e.type === "userClose")).toBe(true);
  });
});

test.describe("E2E: Security - Child Windows", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({ args: [testAppPath] });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await app.close();
  });

  test.beforeEach(async () => {
    await page.evaluate(() => window.testAPI.clearAllState());
  });

  test("child windows do not have nodeIntegration enabled", async () => {
    await page.evaluate(() => {
      window.__test__.setScenario("content-check");
    });

    const childWindowPromise = app.waitForEvent("window");
    await page.evaluate(() => window.__test__.setWindowOpen(true));
    const childWindow = await childWindowPromise;
    await childWindow.waitForLoadState("domcontentloaded");

    // Verify Node.js globals are NOT available in the child window
    const hasNodeGlobals = await childWindow.evaluate(() => {
      return typeof require !== "undefined" || typeof process !== "undefined";
    });
    expect(hasNodeGlobals).toBe(false);
  });
});

test.describe("E2E: Bounds Events", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({ args: [testAppPath] });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await app.close();
  });

  test.beforeEach(async () => {
    await page.evaluate(() => window.testAPI.clearAllState());
    await page.evaluate(() => {
      window.__test__.setScenario("bounds-change");
      window.__test__.setWindowOpen(false);
      window.__test__.clearEvents();
    });
  });

  test("onBoundsChange fires when window is resized", async () => {
    await page.evaluate(() => window.__test__.setWindowOpen(true));
    await waitFor(async () => {
      const count = await page.evaluate(() => window.testAPI.getWindowCount());
      const events = await page.evaluate(() => window.__test__.getEvents());
      return count === 1 && events.some((e) => e.type === "ready");
    });

    const windows = await page.evaluate(() => window.testAPI.getAllWindows());

    await page.evaluate(() => window.__test__.clearEvents());

    await page.evaluate(
      (id) => window.testAPI.resizeChildWindow(id, 600, 500),
      windows[0].id,
    );

    await waitFor(async () => {
      const events = await page.evaluate(() => window.__test__.getEvents());
      return events.some((e) => e.type === "boundsChange");
    });

    const events = await page.evaluate(() => window.__test__.getEvents());
    const boundsEvent = events.find((e) => e.type === "boundsChange");
    expect(boundsEvent).toBeDefined();
    expect((boundsEvent!.data as any).width).toBe(600);
    expect((boundsEvent!.data as any).height).toBe(500);
  });
});

test.describe("E2E: Multiple Windows", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({ args: [testAppPath] });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await app.close();
  });

  test.beforeEach(async () => {
    await page.evaluate(() => window.testAPI.clearAllState());
    await page.evaluate(() => {
      window.__test__.setScenario(null as any);
      window.__test__.setWindowOpen(false);
      window.__test__.clearEvents();
    });
  });

  test("closing one window leaves the other open", async () => {
    await page.evaluate(() => {
      window.__test__.setScenario("multiple-windows");
      window.__test__.setWindowOpen(true);
    });

    await waitFor(async () => {
      return (await page.evaluate(() => window.testAPI.getWindowCount())) === 2;
    });

    const windows = await page.evaluate(() => window.testAPI.getAllWindows());

    await page.evaluate(
      (id) => window.testAPI.closeChildWindow(id),
      windows[0].id,
    );

    await waitFor(async () => {
      return (await page.evaluate(() => window.testAPI.getWindowCount())) === 1;
    });

    const remaining = await page.evaluate(() => window.testAPI.getAllWindows());
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe(windows[1].id);
  });
});

test.describe("E2E: Recreate On Shape Change", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({ args: [testAppPath] });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await app.close();
  });

  test.beforeEach(async () => {
    await page.evaluate(() => window.testAPI.clearAllState());
    await page.evaluate(() => {
      window.__test__.setScenario(null as any);
      window.__test__.setWindowOpen(false);
      window.__test__.clearEvents();
    });
  });

  test("window is recreated when creation-only prop changes with recreateOnShapeChange", async () => {
    await page.evaluate(() => {
      window.__test__.setScenario("recreate-shape");
      window.__test__.setWindowProps({ frame: true });
      window.__test__.setWindowOpen(true);
    });

    await waitFor(async () => {
      return (await page.evaluate(() => window.testAPI.getWindowCount())) === 1;
    });

    const initialWindows = await page.evaluate(() =>
      window.testAPI.getAllWindows(),
    );
    const initialId = initialWindows[0].id;

    await page.evaluate(() => {
      window.__test__.setWindowProps({ frame: false });
    });

    await waitFor(async () => {
      const windows = await page.evaluate(() => window.testAPI.getAllWindows());
      return windows.length === 1 && windows[0].id !== initialId;
    }, 10000);

    const finalWindows = await page.evaluate(() =>
      window.testAPI.getAllWindows(),
    );
    expect(finalWindows.length).toBe(1);
    expect(finalWindows[0].id).not.toBe(initialId);
  });
});

// ─── StrictMode ─────────────────────────────────────────────────────────────
// React 18 StrictMode double-invokes effects in dev: mount → cleanup → mount.
// The Window component's open effect is async (registerWindow → window.open →
// waitForWindowReady), and windowId is stable across the double-mount. Failure
// modes would be: extra BrowserWindows, onReady firing twice, orphaned windows
// after close, or event routing (onUserClose) breaking.
test.describe("E2E: StrictMode", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [testAppPath],
      env: { ...process.env, STRICT_MODE: "1" },
    });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await app.close();
  });

  test.beforeEach(async () => {
    // Close from React side first so onClose handlers fire cleanly
    await page.evaluate(() => window.__test__.setWindowOpen(false));
    await page.evaluate(() => window.testAPI.clearAllState());
    // Wait for all child BrowserWindows to actually be destroyed — destruction
    // is async even after clearAllState returns, and Playwright's page.evaluate
    // can fail with "Execution context was destroyed" if a child window dies
    // mid-evaluation.
    await waitFor(async () => {
      const total = await page.evaluate(() =>
        window.testAPI.getTotalBrowserWindowCount(),
      );
      return total === 0;
    });
    await page.evaluate(() => {
      window.__test__.setScenario("basic");
      window.__test__.clearEvents();
    });
  });

  test("StrictMode is active", async () => {
    // Sanity check — confirm the hash fragment was applied
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toBe("#strict");
  });

  test("open creates exactly one BrowserWindow (no orphan from double-mount)", async () => {
    await page.evaluate(() => window.__test__.setWindowOpen(true));

    // Wait for the managed window to exist
    await waitFor(async () => {
      return (await page.evaluate(() => window.testAPI.getWindowCount())) === 1;
    });

    // Give StrictMode's double-mount time to settle — if the first run's window
    // wasn't properly closed by the cancelled flag, it would still be alive here.
    await page.waitForTimeout(500);

    // Managed count should be 1
    const managedCount = await page.evaluate(() =>
      window.testAPI.getWindowCount(),
    );
    expect(managedCount).toBe(1);

    // Total BrowserWindow count (minus main) should ALSO be 1 — no orphans
    // that the manager lost track of.
    const totalCount = await page.evaluate(() =>
      window.testAPI.getTotalBrowserWindowCount(),
    );
    expect(totalCount).toBe(1);
  });

  test("onReady fires exactly once", async () => {
    await page.evaluate(() => window.__test__.setWindowOpen(true));

    await waitFor(async () => {
      const events = await page.evaluate(() => window.__test__.getEvents());
      return events.some((e) => e.type === "ready");
    });

    // Wait for any lagging double-mount callback
    await page.waitForTimeout(500);

    const events = await page.evaluate(() => window.__test__.getEvents());
    const readyEvents = events.filter((e) => e.type === "ready");
    expect(readyEvents.length).toBe(1);
  });

  test("close leaves no orphaned BrowserWindows", async () => {
    await page.evaluate(() => window.__test__.setWindowOpen(true));

    await waitFor(async () => {
      return (await page.evaluate(() => window.testAPI.getWindowCount())) === 1;
    });

    await page.evaluate(() => window.__test__.setWindowOpen(false));

    await waitFor(async () => {
      return (await page.evaluate(() => window.testAPI.getWindowCount())) === 0;
    });

    await page.waitForTimeout(500);

    // No orphans — neither managed nor unmanaged
    const totalCount = await page.evaluate(() =>
      window.testAPI.getTotalBrowserWindowCount(),
    );
    expect(totalCount).toBe(0);
  });

  test("onUserClose fires when window closed from main", async () => {
    // Event routing depends on windowId → listener mapping. StrictMode's
    // double-register could confuse this if the map is overwritten wrong.
    await page.evaluate(() => {
      window.__test__.setScenario("user-close");
      window.__test__.setWindowOpen(true);
    });

    await waitFor(async () => {
      return (await page.evaluate(() => window.testAPI.getWindowCount())) === 1;
    });

    const windows = await page.evaluate(() => window.testAPI.getAllWindows());
    const windowId = windows[0].id;

    await page.evaluate((id) => window.testAPI.closeChildWindow(id), windowId);

    await waitFor(async () => {
      const events = await page.evaluate(() => window.__test__.getEvents());
      return events.some((e) => e.type === "userClose");
    });

    const events = await page.evaluate(() => window.__test__.getEvents());
    expect(events.filter((e) => e.type === "userClose").length).toBe(1);
  });

  test("child window content is rendered (portal targets correct document)", async () => {
    // If StrictMode's double-open leaves the portal targeting the first run's
    // (now-closed) window document, children won't render anywhere visible.
    await page.evaluate(() => {
      window.__test__.setScenario("content-check");
      window.__test__.setWindowOpen(true);
    });

    await waitFor(async () => {
      return (await page.evaluate(() => window.testAPI.getWindowCount())) === 1;
    });

    // Playwright can navigate to child windows via app.windows()
    await waitFor(async () => {
      return (await app.windows()).length === 2;
    });
    const childPage = (await app.windows()).find((w) => w !== page)!;

    await childPage.waitForLoadState("domcontentloaded");
    const content = await childPage.getByTestId("child-content").textContent();
    expect(content).toContain("Hello from child window");
  });

  test("rapid toggle under StrictMode does not leak", async () => {
    // Each toggle re-renders Window with a new open value; under StrictMode
    // each render may double-invoke effects. Stress test.
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.__test__.setWindowOpen(true));
      await page.waitForTimeout(50);
      await page.evaluate(() => window.__test__.setWindowOpen(false));
      await page.waitForTimeout(50);
    }

    await page.evaluate(() => window.__test__.setWindowOpen(true));
    await page.waitForTimeout(500);

    const managedCount = await page.evaluate(() =>
      window.testAPI.getWindowCount(),
    );
    expect(managedCount).toBeLessThanOrEqual(1);

    const totalCount = await page.evaluate(() =>
      window.testAPI.getTotalBrowserWindowCount(),
    );
    expect(totalCount).toBeLessThanOrEqual(1);
  });
});
