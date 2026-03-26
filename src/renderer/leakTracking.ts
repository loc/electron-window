import { isDev } from "../shared/utils.js";

const TRACKED_KEY = "__ELECTRON_WINDOW_TRACKED__";

/**
 * Dev-only tracking of child windows for leak detection.
 *
 * Each opened/acquired child Window gets a WeakRef pushed onto a global
 * array. Test code snapshots the array length before an open/close cycle
 * and asserts all refs added during the cycle have been GC'd afterward.
 *
 * Stored on globalThis so the /testing entry (a separate bundle) reads
 * the same array the renderer pushes to — inlining would give it a
 * distinct, always-empty copy.
 *
 * The array only grows during a session — entries are never spliced out.
 * Tests assert on a *slice* (refs added during `track()`), so earlier
 * collected entries don't interfere. Compaction would require strong
 * refs to identify dead entries, defeating the purpose.
 */
function getTrackedArray(): WeakRef<globalThis.Window>[] {
  const g = globalThis as Record<string, unknown>;
  let arr = g[TRACKED_KEY] as WeakRef<globalThis.Window>[] | undefined;
  if (!arr) {
    arr = [];
    g[TRACKED_KEY] = arr;
  }
  return arr;
}

/**
 * Register a child Window for leak tracking. No-op outside dev/test.
 * Call once per window.open() / pool creation.
 */
export function trackWindow(win: globalThis.Window): void {
  if (!isDev()) return;
  getTrackedArray().push(new WeakRef(win));
}

/**
 * Read the live tracking array. For the /testing entry's createLeakTester().
 * @internal
 */
export function getTrackedWindowRefs(): readonly WeakRef<globalThis.Window>[] {
  return getTrackedArray();
}

// ─── Silent-retention detector ───────────────────────────────────────────────

/**
 * Windows that have been closed but whose FinalizationRegistry callback
 * hasn't fired yet. If an entry lingers past the GC-check timeout, the
 * window is being retained by something.
 */
const pendingGC = new Map<string, { closedAt: number; id: string }>();

// Per-call sequence so scheduleLeakCheck entries don't collide when the
// same windowId is reused across open→close→open (windowId is stable in
// Window.tsx, only regenerated on recreateOnShapeChange).
let checkSeq = 0;

/**
 * FinalizationRegistry callback clears pendingGC when the Window is
 * collected. Lazy-init — FinalizationRegistry isn't available in every
 * JS environment (though it is in all Electron renderers).
 */
let gcRegistry: FinalizationRegistry<string> | undefined;
function getRegistry(): FinalizationRegistry<string> | undefined {
  if (gcRegistry) return gcRegistry;
  if (typeof FinalizationRegistry === "undefined") return undefined;
  gcRegistry = new FinalizationRegistry<string>((token) => {
    pendingGC.delete(token);
  });
  return gcRegistry;
}

/**
 * Mark a window as closed-and-expected-to-GC. The FinalizationRegistry
 * callback removes it from pendingGC when the Window is actually
 * collected. Anything still in pendingGC after a reasonable delay is
 * a leak candidate.
 *
 * No-op outside dev/test.
 */
export function markExpectedDead(win: globalThis.Window, id: string): string | undefined {
  if (!isDev()) return;
  const registry = getRegistry();
  if (!registry) return;
  const token = `${id}:${checkSeq++}`;
  pendingGC.set(token, { closedAt: Date.now(), id });
  registry.register(win, token);
  return token;
}

/**
 * Schedule a forced-GC leak check for a closed window. ~5s after close
 * (forced gc at 4s, check at 5s), logs an error if the window hasn't
 * been collected.
 *
 * Requires `globalThis.gc` — without it, V8 may simply not have
 * collected yet and the warning would false-positive, so this no-ops.
 * Run Electron with `--js-flags=--expose-gc` to enable.
 *
 * Calls markExpectedDead() internally, so callers don't need both.
 */
export function scheduleLeakCheck(win: globalThis.Window, id: string): void {
  if (!isDev()) return;
  const token = markExpectedDead(win, id);
  if (!token) return;

  const g = globalThis as Record<string, unknown>;
  if (typeof g.gc !== "function") return;

  setTimeout(() => {
    (g.gc as () => void)();
    setTimeout(() => {
      const entry = pendingGC.get(token);
      if (entry) {
        pendingGC.delete(token);
        const ageMs = Date.now() - entry.closedAt;
        console.error(
          `[electron-window] Window "${entry.id}" was closed ${ageMs}ms ago but has not been ` +
            `garbage-collected. Something is retaining a reference to the child Window, ` +
            `its Document, or a DOM node inside it. Common causes: event listeners ` +
            `added via useWindowDocument() without cleanup, refs holding DOM nodes, ` +
            `closures capturing the document.`,
        );
      }
    }, 1000);
  }, 4000);
}
