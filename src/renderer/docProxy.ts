import { isDev } from "../shared/utils.js";

/**
 * Dev-only Proxy wrapper for useWindowDocument().
 *
 * The common leak pattern: a component grabs `useWindowDocument()`, stashes
 * it in a ref or closure, and keeps accessing it after the window closes.
 * The Document (and thus the whole detached DOM + Window) stays alive,
 * and there's no error — just silent retention.
 *
 * This wraps the returned Document in a Proxy that console.errors on any
 * access after the window is released, printing the stack(s) where the
 * document was originally acquired so the leak is traceable.
 */

interface ProxyState {
  windowId: string;
  destroyed: boolean;
  /** Set-deduped: a component re-rendering doesn't grow this unboundedly. */
  acquisitionStacks: Set<string>;
  /** Warn once per state to avoid log spam if the stale ref is in a render loop. */
  warned: boolean;
}

interface ProxyCache {
  proxy: Document;
  /** Lazily-created proxy for doc.defaultView, so window-level access is also caught. */
  windowProxy?: globalThis.Window;
  state: ProxyState;
}

// WeakMap keyed by the real Document — when it GCs, the cache entry drops.
// The proxy→Document→WeakMap-value cycle is collectible (ephemeron semantics).
const cache = new WeakMap<Document, ProxyCache>();

// State-only map for markDocDestroyed() lookup. Holds no Document refs —
// just the small state object the proxy handler closes over. Entries are
// deleted on destroy so this doesn't grow unbounded.
const stateByWindowId = new Map<string, ProxyState>();

function captureStack(): string {
  const stack = new Error().stack ?? "";
  // Drop the first two lines (Error + captureStack itself)
  return stack.split("\n").slice(2).join("\n");
}

function warnStaleAccess(state: ProxyState, what: string): void {
  if (state.warned) return;
  state.warned = true;
  console.error(
    `[electron-window] Stale ${what} access after window "${state.windowId}" was closed/released.\n` +
      `Something is holding a reference to the child window's ${what} past its lifecycle.\n` +
      `Acquired at:\n${[...state.acquisitionStacks].map((s) => `  ${s.replace(/\n/g, "\n  ")}`).join("\n  ---\n")}`,
  );
}

function makeDocHandler(state: ProxyState, getCache: () => ProxyCache): ProxyHandler<Document> {
  // Reflect.get/set WITHOUT the receiver arg — DOM accessor properties
  // (document.body, document.cookie, window.location, etc.) do internal-slot
  // checks on `this`. Passing the Proxy as receiver makes the getter run
  // with `this = proxy` → "Illegal invocation". Omitting receiver runs them
  // with `this = target` (the real host object with the slots).
  return {
    get(target, prop) {
      if (state.destroyed) warnStaleAccess(state, "Document");
      if (prop === "defaultView") {
        // Wrap the Window too — doc.defaultView.addEventListener is a
        // common leak vector that a Document-only proxy would miss.
        const win = Reflect.get(target, prop) as globalThis.Window | null;
        if (!win) return win;
        const c = getCache();
        if (!c.windowProxy) {
          c.windowProxy = new Proxy(win, {
            get(t, p) {
              if (state.destroyed) warnStaleAccess(state, "Window (via document.defaultView)");
              const v = Reflect.get(t, p);
              // Auto-bind methods — Window methods throw "Illegal invocation"
              // when called with a Proxy as `this`.
              return typeof v === "function" ? v.bind(t) : v;
            },
          });
        }
        return c.windowProxy;
      }
      const value = Reflect.get(target, prop);
      // Auto-bind methods — Document methods (createElement, querySelector,
      // etc.) throw "Illegal invocation" when `this` is the Proxy rather
      // than the real Document.
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, prop, value) {
      if (state.destroyed) warnStaleAccess(state, "Document");
      return Reflect.set(target, prop, value);
    },
  };
}

/**
 * Wrap a Document in a dev-mode Proxy. Returns the Document unchanged
 * outside dev/test. Same (doc, windowId) pair returns the same proxy
 * (identity-stable within a mount cycle).
 *
 * A pooled window reuses the same Document across acquire/release cycles.
 * The windowId stays the same too (it's the pool entry's id), but the
 * previous cycle's state has `destroyed: true` — so a fresh acquisition
 * creates a NEW proxy. The old proxy, if still held by the previous
 * consumer's stale code, keeps warning.
 */
export function wrapDocument(doc: Document, windowId: string): Document {
  if (!isDev()) return doc;

  const existing = cache.get(doc);
  if (existing && existing.state.windowId === windowId && !existing.state.destroyed) {
    existing.state.acquisitionStacks.add(captureStack());
    return existing.proxy;
  }

  const state: ProxyState = {
    windowId,
    destroyed: false,
    acquisitionStacks: new Set([captureStack()]),
    warned: false,
  };
  let entry: ProxyCache;
  const proxy = new Proxy(
    doc,
    makeDocHandler(state, () => entry),
  ) as Document;
  entry = { proxy, state };
  cache.set(doc, entry);
  stateByWindowId.set(windowId, state);
  return proxy;
}

/**
 * Flip the destroyed flag for a window's document proxy. Subsequent
 * accesses through the proxy will console.error. Call from every
 * teardown path (resetComponentState, pool release).
 */
export function markDocDestroyed(windowId: string): void {
  if (!isDev()) return;
  const state = stateByWindowId.get(windowId);
  if (state) {
    state.destroyed = true;
    stateByWindowId.delete(windowId);
  }
}
