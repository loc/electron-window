/**
 * Patches the @marshallofsound/ipc-generated validator functions to call our
 * consumer-configurable __originHook AFTER the main-frame check passes.
 *
 * Runs as `postgenerate:ipc` (npm lifecycle hook — auto-runs after generate:ipc).
 *
 * The transformation is minimal: it replaces the validator's `return true`
 * (which fires when the main-frame check passes) with `return __originHook(...)`.
 * The original main-frame check expression is preserved exactly as generated —
 * if @marshallofsound/ipc changes its main-frame detection logic, we inherit it.
 *
 * FAILS THE BUILD if either patch target isn't found. This is intentional:
 * a silent failure would mean the origin hook never runs, silently downgrading
 * security to permissive. We want CI to catch @marshallofsound/ipc format changes.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const BROWSER_FILE = path.join(
  root,
  "src/generated-ipc/_internal/browser/electron_window.ts",
);
const PRELOAD_FILE = path.join(
  root,
  "src/generated-ipc/_internal/preload/electron_window.ts",
);

// Matches the validator body structure: `if (<condition>) return true;`
// We only replace the `return true` — the condition (main-frame check) is
// preserved verbatim. The `s` flag allows the condition to span lines.
const VALIDATOR_RETURN_TRUE =
  /(function \$eipc_event_validator\$_AppOrigin\([^)]*\)\s*\{\s*if\s*\(.*?\))\s*return true;/s;

function die(msg) {
  console.error(`\n[patch-ipc-validators] FAILED: ${msg}\n`);
  process.exit(1);
}

function patchFile(filePath, importLine, hookCallArgs) {
  if (!fs.existsSync(filePath)) {
    die(
      `${filePath} does not exist. Did generate:ipc run? ` +
        `This script must run after IPC codegen.`,
    );
  }

  const original = fs.readFileSync(filePath, "utf8");

  // Idempotency: if already patched (re-run without clean), skip.
  if (original.includes("__originHook")) {
    console.log(
      `[patch-ipc-validators] ${path.relative(root, filePath)}: already patched, skipping`,
    );
    return;
  }

  // Apply the return-true → return __originHook(...) swap
  const patched = original.replace(
    VALIDATOR_RETURN_TRUE,
    (_match, prefix) => `${prefix} return __originHook(${hookCallArgs});`,
  );

  if (patched === original) {
    die(
      `Validator function not found in ${path.relative(root, filePath)}. ` +
        `The @marshallofsound/ipc codegen output may have changed format. ` +
        `Expected pattern: function $eipc_event_validator$_AppOrigin(...) { if (...) return true; ... }`,
    );
  }

  // Add the import after the eslint-disable header
  const withImport = patched.replace(
    /^(\/\* eslint-disable \*\/\s*\n)/,
    `$1${importLine}\n`,
  );

  if (withImport === patched) {
    die(
      `Could not find insertion point for import in ${path.relative(root, filePath)}. ` +
        `Expected file to start with "/* eslint-disable */".`,
    );
  }

  fs.writeFileSync(filePath, withImport);
  console.log(
    `[patch-ipc-validators] ${path.relative(root, filePath)}: patched`,
  );
}

// Browser (main process): validator receives the IPC event, we pass
// event.senderFrame?.url to the hook for origin matching.
patchFile(
  BROWSER_FILE,
  `import { __originHook } from '../../../main/__originHook.js';`,
  `event.senderFrame?.url`,
);

// Preload: validator takes no args, runs once at module eval. The hook
// reads window.location.href internally.
patchFile(
  PRELOAD_FILE,
  `import { __originHook } from '../../../preload/__originHook.js';`,
  ``,
);

console.log(
  `[patch-ipc-validators] Done. Origin checks will read __ELECTRON_WINDOW_ALLOWED_ORIGINS__ ` +
    `if consumers define it in their bundler.`,
);
