/**
 * Repro + workaround verification for React's alternate-fiber portal leak.
 *
 * FINDING (React 19.2.4): React double-buffers fibers (current + alternate).
 * After `setPortalTarget(null)` commits, the ALTERNATE fiber still holds the
 * old portalTarget via three paths:
 *
 *   1. alternate.memoizedState.baseState        — useState hook's previous value
 *   2. alternate.memoizedState.memoizedState    — same hook, different field
 *   3. alternate.memoizedProps.children.containerInfo — portal ReactElement
 *
 * All three → portalTarget.ownerDocument.defaultView → child Window.
 *
 * The alternate is only reaped when createWorkInProgress reuses its slot on
 * a subsequent commit — which never happens if the component settles after
 * close (open=false, no further renders).
 *
 * The library's workaround (useFlushAlternateOnPortalClear) forces that
 * second commit via a useEffect-triggered nonce dispatch.
 *
 * These tests use bare createPortal into an iframe's document rather than
 * the library's Window/PooledWindow — the mechanism is the same, and the
 * library's async registration dance is awkward in jsdom.
 *
 * Run with GC: `node --expose-gc ./node_modules/.bin/vitest run alternateFiberLeak`
 */

import { describe, it, expect, afterEach } from "vitest";
import { act } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { useFlushAlternateOnPortalClear } from "../../src/renderer/useWindowLifecycle.js";

// ─── React fiber internals (stable across 18/19) ─────────────────────────────

interface FiberLike {
  tag: number;
  stateNode: unknown;
  child: FiberLike | null;
  sibling: FiberLike | null;
  alternate: FiberLike | null;
  deletions: FiberLike[] | null;
  memoizedState: unknown;
  memoizedProps: unknown;
}

function getRootFiber(root: Root): FiberLike {
  const internal = (root as unknown as { _internalRoot: { current: FiberLike } })._internalRoot;
  if (!internal?.current) {
    throw new Error("React internals changed — can't find root._internalRoot.current");
  }
  return internal.current;
}

/**
 * Walk the fiber tree (including .alternate and .deletions) and scan each
 * fiber's stateNode/memoizedProps/memoizedState for references to any target.
 * Returns path + field for each hit so test failures show EXACTLY where the
 * retention is.
 */
function findRetentionPaths(
  root: FiberLike,
  targets: readonly unknown[],
  targetNames: readonly string[],
): string[] {
  const hits: string[] = [];
  const seenFibers = new WeakSet<object>();
  const seenObjs = new WeakSet<object>();

  function scan(val: unknown, path: string, depth: number): void {
    if (depth > 8 || val == null || typeof val !== "object") return;
    const idx = targets.indexOf(val);
    if (idx >= 0) {
      hits.push(`${path} → ${targetNames[idx]}`);
      return;
    }
    if (seenObjs.has(val)) return;
    seenObjs.add(val);
    // Don't recurse into DOM (blows up) or fiber-shaped objects (visit handles those)
    if ((val as { nodeType?: number }).nodeType) return;
    if ("stateNode" in val && "alternate" in val) return;
    if (Array.isArray(val)) {
      val.forEach((v, i) => scan(v, `${path}[${i}]`, depth + 1));
    } else {
      for (const k of Object.keys(val)) {
        scan((val as Record<string, unknown>)[k], `${path}.${k}`, depth + 1);
      }
    }
  }

  function visit(fiber: FiberLike | null, path: string): void {
    if (!fiber || seenFibers.has(fiber)) return;
    seenFibers.add(fiber);
    scan(fiber.stateNode, `${path}.stateNode`, 0);
    scan(fiber.memoizedProps, `${path}.memoizedProps`, 0);
    scan(fiber.memoizedState, `${path}.memoizedState`, 0);
    visit(fiber.child, `${path}.child`);
    visit(fiber.sibling, `${path}.sibling`);
    visit(fiber.alternate, `${path}.alternate`);
    fiber.deletions?.forEach((d, i) => visit(d, `${path}.deletions[${i}]`));
  }

  visit(root, "root");
  return hits;
}

// ─── Test components ─────────────────────────────────────────────────────────

// Module-scope so it doesn't close over test locals.
let externalSetContainer: ((c: Element | null) => void) | null = null;

/**
 * Mirrors Window/PooledWindow WITHOUT the fix — demonstrates the leak.
 */
function PortalHostUnfixed(): ReactNode {
  const [container, setContainer] = useState<Element | null>(null);
  externalSetContainer = setContainer;
  return (
    <div data-testid="host">
      {container ? createPortal(<span>popout content</span>, container) : null}
    </div>
  );
}

/**
 * Same but WITH the library's useFlushAlternateOnPortalClear hook.
 * setContainer(null) triggers the effect post-commit, which schedules the
 * second commit that overwrites the alternate.
 */
function PortalHostFixed(): ReactNode {
  const [container, setContainer] = useState<Element | null>(null);
  useFlushAlternateOnPortalClear(container);
  externalSetContainer = setContainer;
  return (
    <div data-testid="host">
      {container ? createPortal(<span>popout content</span>, container) : null}
    </div>
  );
}

// ─── Harness ─────────────────────────────────────────────────────────────────

interface Harness {
  root: Root;
  childDoc: Document;
  childWin: Window;
  portalContainer: HTMLElement;
  iframe: HTMLIFrameElement;
  hostEl: HTMLElement;
}

/**
 * Synchronous setup — no async frame closures that could retain locals.
 * V8 can retain an async frame's locals past return when an inner arrow
 * inside an `await` captured them — verified empirically as a test artifact.
 */
function setupHarness(): Harness {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const childDoc = iframe.contentDocument;
  const childWin = iframe.contentWindow;
  if (!childDoc || !childWin) throw new Error("jsdom iframe missing document");

  const portalContainer = childDoc.createElement("div");
  portalContainer.id = "root";
  childDoc.body.appendChild(portalContainer);

  const hostEl = document.createElement("div");
  document.body.appendChild(hostEl);
  const root = createRoot(hostEl);

  return { root, childDoc, childWin, portalContainer, iframe, hostEl };
}

async function openPortal(h: Harness, Host: () => ReactNode): Promise<void> {
  await act(async () => h.root.render(<Host />));
  await act(async () => externalSetContainer!(h.portalContainer));
  expect(h.childDoc.querySelector("span")?.textContent).toBe("popout content");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("React alternate-fiber portal leak", () => {
  afterEach(() => {
    externalSetContainer = null;
  });

  // it.fails: test is EXPECTED to fail. CI stays green while the bug exists;
  // if React fixes this upstream, the test flips red and we know to drop the
  // workaround.
  it.fails("UNFIXED: after setPortalTarget(null), fiber tree should not retain child-doc container", async () => {
    const h = setupHarness();
    await openPortal(h, PortalHostUnfixed);

    await act(async () => externalSetContainer!(null));
    expect(h.childDoc.querySelector("span")).toBeNull();

    const leaks = findRetentionPaths(
      getRootFiber(h.root),
      [h.portalContainer, h.childDoc, h.childDoc.body],
      ["portalContainer", "childDoc", "childDoc.body"],
    );

    // THIS ASSERTION FAILS on React 18/19. Expected paths:
    //   root.child.alternate.memoizedState.memoizedState → portalContainer
    //   root.child.alternate.memoizedState.baseState → portalContainer
    //   root.child.child.alternate.memoizedProps.children.containerInfo → portalContainer
    expect(leaks).toEqual([]);

    act(() => h.root.unmount());
    h.iframe.remove();
    h.hostEl.remove();
  });

  // GC test only meaningful with --expose-gc. Skip (not fail) without it —
  // it.fails expects a throw; early-return would report "unexpectedly passed".
  const gcIt = typeof (globalThis as { gc?: unknown }).gc === "function" ? it.fails : it.skip;
  gcIt(
    "UNFIXED: after setPortalTarget(null) + destroy child, child Window should be GC-able",
    async () => {
      const gc = (globalThis as { gc: () => void }).gc;

      const h = setupHarness();
      await openPortal(h, PortalHostUnfixed);
      await act(async () => externalSetContainer!(null));

      const winRef = new WeakRef(h.childWin);
      const docRef = new WeakRef(h.childDoc);
      const containerRef = new WeakRef(h.portalContainer);

      h.iframe.remove();
      // jsdom does NOT clear iframe.contentDocument after .remove() — null
      // h.iframe too or it independently retains childDoc.
      (h as { childWin?: unknown }).childWin = undefined;
      (h as { childDoc?: unknown }).childDoc = undefined;
      (h as { portalContainer?: unknown }).portalContainer = undefined;
      (h as { iframe?: unknown }).iframe = undefined;
      externalSetContainer = null;

      for (let i = 0; i < 20; i++) {
        gc();
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((r) => setTimeout(r, 0));
      }

      // THIS ASSERTION FAILS — alternate fiber retains container → doc → window.
      expect(containerRef.deref()).toBeUndefined();
      expect(docRef.deref()).toBeUndefined();
      expect(winRef.deref()).toBeUndefined();

      act(() => h.root.unmount());
      h.hostEl.remove();
    },
  );

  it("WORKAROUND: useFlushAlternateOnPortalClear clears the alternate", async () => {
    // The library's fix: useEffect watches portalTarget; when it transitions
    // to null, dispatch a nonce to force a SECOND commit. Must be post-commit
    // (useEffect) — React 18+ auto-batches same-tick setState into one commit,
    // so a sync call in resetComponentState() wouldn't help.
    const h = setupHarness();
    await openPortal(h, PortalHostFixed);

    // Single act() — mirrors resetComponentState() where setPortalTarget(null)
    // is one sync call. The effect-scheduled flush happens on the NEXT commit,
    // which act() also flushes.
    await act(async () => externalSetContainer!(null));

    const leaks = findRetentionPaths(
      getRootFiber(h.root),
      [h.portalContainer],
      ["portalContainer"],
    );
    expect(leaks).toEqual([]);

    act(() => h.root.unmount());
    h.iframe.remove();
    h.hostEl.remove();
  });

  // GC proof for the workaround. SKIPPED — jsdom's GC is sensitive to
  // V8 async-frame closure retention and jsdom-internal refs (e.g.,
  // iframe._ownerDocument not cleared on remove) in ways that are test
  // artifacts, not React bugs. The fiber-walk test above is the
  // deterministic gate: it proves the known React-internal paths are
  // clear. For "is the Window actually collectible" under production
  // conditions, use Playwright + CDP:
  //   cdp.send("HeapProfiler.collectGarbage")
  //   cdp.send("Runtime.queryObjects", {prototypeObjectId: Window.prototype})
  // against a real Chromium window.open(). See the e2e suite.
  it.skip("WORKAROUND: child Window is GC-able after useFlushAlternateOnPortalClear", async () => {
    const gc = (globalThis as { gc: () => void }).gc;

    const h = setupHarness();
    await openPortal(h, PortalHostFixed);
    await act(async () => externalSetContainer!(null));

    const winRef = new WeakRef(h.childWin);
    const docRef = new WeakRef(h.childDoc);
    const containerRef = new WeakRef(h.portalContainer);

    h.iframe.remove();
    (h as { childWin?: unknown }).childWin = undefined;
    (h as { childDoc?: unknown }).childDoc = undefined;
    (h as { portalContainer?: unknown }).portalContainer = undefined;
    (h as { iframe?: unknown }).iframe = undefined;
    externalSetContainer = null;

    for (let i = 0; i < 20; i++) {
      gc();
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((r) => setTimeout(r, 0));
    }

    // With the fix, these should be collected.
    expect(containerRef.deref()).toBeUndefined();
    expect(docRef.deref()).toBeUndefined();
    expect(winRef.deref()).toBeUndefined();

    act(() => h.root.unmount());
    h.hostEl.remove();
  });
});
