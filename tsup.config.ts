import { defineConfig } from "tsup";

export default defineConfig([
  // Main renderer entry (React components)
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: true,
    external: ["electron", "react", "react-dom"],
  },
  // Main process + preload entries — dual ESM/CJS (many Electron apps use a
  // CJS main process; sandboxed preloads require CJS). Merged into one config
  // block because the settings are identical. Each config block in the array
  // runs a separate DTS worker in parallel — 4 parallel workers hit
  // STATUS_HEAP_CORRUPTION on Windows CI (tsup#10662). 3 blocks survives.
  {
    entry: {
      "main/index": "src/main/index.ts",
      "preload/index": "src/preload/index.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    platform: "node",
    external: ["electron"],
  },
  // Testing entry — externalizes @loc/electron-window so MockWindowProvider
  // uses the SAME React context instances as the real package. Without this,
  // the relative context import would be inlined → duplicate createContext()
  // → mocks and real components see different contexts.
  {
    entry: { "testing/index": "src/testing/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    external: ["react", "react-dom", "@loc/electron-window"],
  },
]);
