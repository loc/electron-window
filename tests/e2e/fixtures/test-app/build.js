// Build script for the test app
// Uses esbuild for fast bundling
import * as esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function build() {
  // Ensure dist directory exists
  const distDir = path.join(__dirname, "dist");
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // Build main process
  await esbuild.build({
    entryPoints: [path.join(__dirname, "src/main.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    outfile: path.join(distDir, "main.js"),
    external: ["electron"],
    format: "esm",
    sourcemap: true,
  });

  // Build preload script
  await esbuild.build({
    entryPoints: [path.join(__dirname, "src/preload.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    outfile: path.join(distDir, "preload.js"),
    external: ["electron"],
    format: "cjs", // Preload must be CJS
    sourcemap: true,
  });

  // Build renderer (React app)
  await esbuild.build({
    entryPoints: [path.join(__dirname, "src/renderer/index.tsx")],
    bundle: true,
    platform: "browser",
    target: "chrome120",
    outfile: path.join(distDir, "renderer.js"),
    format: "iife",
    sourcemap: true,
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    loader: {
      ".tsx": "tsx",
      ".ts": "ts",
    },
  });

  // Copy HTML file
  const htmlSrc = path.join(__dirname, "src/index.html");
  const htmlDest = path.join(distDir, "index.html");
  fs.copyFileSync(htmlSrc, htmlDest);

  console.log("Build complete!");
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
