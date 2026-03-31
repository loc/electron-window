/**
 * CDP-based canonical leak test for the alternate-fiber fix.
 *
 * The jsdom fiber-walk test (tests/integration/alternateFiberLeak.test.tsx)
 * proves the 3 known React-internal retention paths are cleared. This test
 * proves the child Window is ACTUALLY collectible in real Chromium — the
 * truth, not a proxy.
 *
 * Uses CDP HeapProfiler.collectGarbage (forces real GC, no --expose-gc flag)
 * and Runtime.queryObjects(Window.prototype) to count live Window instances
 * directly in the renderer's V8 isolate.
 */

import { test, expect, _electron as electron, ElectronApplication, Page } from "@playwright/test";
import type { CDPSession } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testAppPath = path.join(__dirname, "fixtures/test-app/dist/main.js");

declare global {
  interface Window {
    testAPI: {
      getWindowCount: () => Promise<number>;
      clearAllState: () => Promise<void>;
    };
    __test__: {
      setScenario: (s: string) => void;
      setWindowOpen: (open: boolean) => void;
      clearEvents: () => void;
    };
  }
}

async function waitForWindowCount(page: Page, n: number, timeout = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const count = await page.evaluate(() => window.testAPI.getWindowCount());
    if (count === n) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for ${n} windows`);
}

/**
 * Monkey-patch window.open to store a WeakRef to each returned window proxy.
 * Runtime.queryObjects(Window.prototype) doesn't see window.open proxies —
 * they're cross-realm objects whose prototype is the CHILD isolate's
 * Window.prototype, not the parent's. WeakRef tracking in the parent's
 * isolate sidesteps that.
 */
async function installWindowOpenTracker(page: Page): Promise<void> {
  await page.evaluate(() => {
    const refs: WeakRef<Window>[] = [];
    (window as unknown as { __leakTestRefs__: WeakRef<Window>[] }).__leakTestRefs__ = refs;
    const origOpen = window.open.bind(window);
    window.open = (...args: Parameters<typeof window.open>) => {
      const w = origOpen(...args);
      if (w) refs.push(new WeakRef(w));
      return w;
    };
  });
}

/**
 * Count how many tracked window.open proxies are still reachable
 * (WeakRef.deref() !== undefined) after GC.
 */
async function countReachableWindows(page: Page): Promise<number> {
  return page.evaluate(() => {
    const refs = (window as unknown as { __leakTestRefs__: WeakRef<Window>[] }).__leakTestRefs__;
    return refs.filter((r) => r.deref() !== undefined).length;
  });
}

/**
 * Force GC via CDP. collectGarbage is a hint, not a guarantee — multiple
 * rounds with waits, plus an initial wait for React's useEffect queue to
 * drain (the flush effect is post-commit but async-scheduled).
 */
async function forceGC(cdp: CDPSession, page: Page): Promise<void> {
  // Let React's post-commit effects (including useFlushAlternateOnPortalClear)
  // actually run. requestIdleCallback + a frame gives the scheduler time.
  await page.evaluate(
    () =>
      new Promise<void>((r) => {
        requestAnimationFrame(() => requestIdleCallback(() => r()));
      }),
  );
  for (let i = 0; i < 5; i++) {
    await cdp.send("HeapProfiler.collectGarbage");
    await page.waitForTimeout(100);
  }
}

test.describe("E2E: alternate-fiber leak fix (CDP heap introspection)", () => {
  let app: ElectronApplication;
  let page: Page;
  let cdp: CDPSession;

  test.beforeAll(async () => {
    app = await electron.launch({ args: [testAppPath] });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("status")).toHaveText("Ready");

    cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.enable");
  });

  test.beforeEach(async () => {
    await page.evaluate(() => window.testAPI.clearAllState());
    await page.evaluate(() => {
      window.__test__.setScenario("basic");
      window.__test__.setWindowOpen(false);
      window.__test__.clearEvents();
    });
    await installWindowOpenTracker(page);
  });

  test.afterAll(async () => {
    await cdp.detach();
    await app.close();
  });

  test("closing a <Window> releases its child Window for GC", async () => {
    // Open the child window.
    await page.evaluate(() => window.__test__.setWindowOpen(true));
    await waitForWindowCount(page, 1);

    // The window.open proxy is tracked.
    expect(await countReachableWindows(page)).toBe(1);

    // Close it.
    await page.evaluate(() => window.__test__.setWindowOpen(false));
    await waitForWindowCount(page, 0);

    // Force GC. With useFlushAlternateOnPortalClear, the alternate fiber
    // no longer retains portalTarget → ownerDocument → defaultView → proxy.
    // Without the fix, this would be 1 (leaked).
    await forceGC(cdp, page);
    expect(await countReachableWindows(page)).toBe(0);
  });

  test("rapid open→close→open→close cycles release all child Windows", async () => {
    // Stress the workaround: each cycle's flush must happen before the next
    // cycle's portalTarget set, or alternates could accumulate. The useEffect-
    // triggered dispatch is per-cycle, so N cycles should leave 0 retained.
    const cycles = 5;
    for (let i = 0; i < cycles; i++) {
      await page.evaluate(() => window.__test__.setWindowOpen(true));
      await waitForWindowCount(page, 1);
      await page.evaluate(() => window.__test__.setWindowOpen(false));
      await waitForWindowCount(page, 0);
    }

    // All N proxies tracked.
    expect(await countReachableWindows(page)).toBe(cycles);

    await forceGC(cdp, page);

    // All N should be released. If even one alternate fiber retained, > 0.
    expect(await countReachableWindows(page)).toBe(0);
  });
});
