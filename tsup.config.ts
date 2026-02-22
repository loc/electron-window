import { defineConfig } from "tsup";

export default defineConfig([
  // Main renderer entry (React components)
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["electron", "react", "react-dom"],
  },
  // Main process entry
  {
    entry: { "main/index": "src/main/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    platform: "node",
    external: ["electron"],
  },
  // Preload entry
  {
    entry: { "preload/index": "src/preload/index.ts" },
    format: ["esm"],
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
