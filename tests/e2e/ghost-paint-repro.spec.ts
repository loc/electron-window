/**
 * Ghost paint reproduction script.
 *
 * Run with: npx playwright test tests/e2e/ghost-paint-repro.ts --headed
 *
 * Watch the pool window: it opens RED (content A), closes, then reopens as BLUE
 * (content B). The ghost paint bug manifests as a ~500ms flash of RED before
 * BLUE appears on the reopen.
 *
 * The script pauses at key moments so you can observe visually.
 */
import {
  test,
  _electron as electron,
  ElectronApplication,
  Page,
} from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testAppPath = path.join(__dirname, "fixtures/test-app/dist/main.js");

async function waitFor(
  fn: () => Promise<boolean>,
  timeout = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitFor timeout");
}

test.describe("Ghost Paint Repro", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({ args: [testAppPath] });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    // Clear all managed windows first (pool keeps hidden windows alive)
    await page.evaluate(() => window.testAPI.clearAllState());
    await page.waitForTimeout(500);
    await app.close().catch(() => {});
  });

  test("pool window ghost paint on content switch", async () => {
    // Set up the pooled-window scenario with content A
    await page.evaluate(() => {
      window.__test__.setScenario("pooled-window");
      window.__test__.setPoolContent("A");
    });

    // --- Step 1: Open with content A (RED) ---
    console.log("\n>>> Opening pool window with content A (RED)...");
    await page.evaluate(() => window.__test__.setWindowOpen(true));

    // Wait for the pool window to appear
    await waitFor(async () => {
      const count = await page.evaluate(() => window.testAPI.getWindowCount());
      return count >= 1;
    });

    // Wait for ready event
    await waitFor(async () => {
      const events = await page.evaluate(() => window.__test__.getEvents());
      return events.some((e) => e.type === "ready");
    });

    console.log(">>> Content A (RED) is visible. Pausing 2s...");
    await page.waitForTimeout(2000);

    // --- Step 2: Close (release back to pool) ---
    console.log(">>> Closing pool window (releasing to pool)...");
    await page.evaluate(() => window.__test__.setWindowOpen(false));
    await page.waitForTimeout(500);

    // --- Step 3: Switch content to B ---
    console.log(">>> Switching content to B (BLUE)...");
    await page.evaluate(() => {
      window.__test__.setPoolContent("B");
      window.__test__.clearEvents();
    });
    await page.waitForTimeout(200);

    // --- Step 4: Reopen — WATCH FOR THE GHOST ---
    console.log(
      ">>> Reopening pool window — WATCH FOR RED FLASH before BLUE...",
    );
    await page.evaluate(() => window.__test__.setWindowOpen(true));

    // Wait for the window to be shown
    await waitFor(async () => {
      const events = await page.evaluate(() => window.__test__.getEvents());
      return events.some((e) => e.type === "ready");
    });

    console.log(">>> Content B (BLUE) should be visible now.");
    console.log(
      ">>> If you saw a brief RED flash, that's the ghost paint bug.",
    );
    console.log(">>> Pausing 3s so you can observe...");
    await page.waitForTimeout(3000);

    // --- Step 5: Do it again to make it really obvious ---
    console.log("\n>>> Cycling again: close, switch to A, reopen...");
    await page.evaluate(() => window.__test__.setWindowOpen(false));
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      window.__test__.setPoolContent("A");
      window.__test__.clearEvents();
    });
    await page.waitForTimeout(200);

    console.log(">>> Reopening — WATCH FOR BLUE FLASH before RED...");
    await page.evaluate(() => window.__test__.setWindowOpen(true));

    await waitFor(async () => {
      const events = await page.evaluate(() => window.__test__.getEvents());
      return events.some((e) => e.type === "ready");
    });

    console.log(
      ">>> Content A (RED) should be visible. If you saw BLUE flash, that's the ghost.",
    );
    await page.waitForTimeout(3000);

    console.log("\n>>> Done. Close the app window to finish the test.");
  });
});
