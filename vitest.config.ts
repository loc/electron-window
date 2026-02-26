import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Resolve the self-import used by src/testing/index.ts so MockWindowProvider
  // and the real Window share the same React context instances under test.
  // In the published dist this is an external import; in source/tests it
  // needs to map to the source entry.
  resolve: {
    alias: {
      "@loc/electron-window": path.resolve(__dirname, "src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts"],
    },
    setupFiles: ["./tests/setup.ts"],
  },
});
