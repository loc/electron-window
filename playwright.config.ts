import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // Manual repro harnesses — run via `npx playwright test ghost-paint --headed`
  testIgnore: ["**/ghost-paint-repro.spec.ts"],
  timeout: 30000,
  fullyParallel: false, // Electron tests can be flaky with parallelism
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for Electron
  reporter: "html",
  use: {
    trace: "on-first-retry",
  },
});
