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
  // Main process entry — dual ESM/CJS because many Electron apps still use
  // a CJS main process (electron-forge/electron-builder defaults).
  {
    entry: { "main/index": "src/main/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    platform: "node",
    external: ["electron"],
  },
  // Preload entry — dual ESM/CJS because sandboxed preloads require CJS.
  // Consumers should still bundle this, but the CJS build makes direct use
  // possible in non-sandboxed setups.
  {
    entry: { "preload/index": "src/preload/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    platform: "node",
    external: ["electron"],
  },
  // Testing entry
  {
    entry: { "testing/index": "src/testing/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    external: ["react", "react-dom"],
  },
]);
