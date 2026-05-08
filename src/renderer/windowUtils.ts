import { sleep } from "../shared/utils.js";
import type { InjectStylesMode, WindowSetupCallback } from "../shared/types.js";

export const WINDOW_READY_TIMEOUT_MS = 4000;
export const BOUNDS_CHANGE_DEBOUNCE_MS = 100;
export const DEFAULT_WINDOW_WIDTH = 800;
export const DEFAULT_WINDOW_HEIGHT = 600;

/**
 * Wait until the child window document is accessible and has non-zero dimensions.
 */
export async function waitForWindowReady(
  win: globalThis.Window,
  isCancelled?: () => boolean,
): Promise<void> {
  const deadline = Date.now() + WINDOW_READY_TIMEOUT_MS;
  while (!win.document?.body || !win.innerWidth) {
    if (Date.now() > deadline || isCancelled?.()) {
      throw new Error("Timed out waiting for child window to be ready");
    }
    await sleep(1);
  }
}

export interface InitWindowDocumentResult {
  /** The portal container element */
  container: HTMLElement;
  /**
   * Call when the child window is destroyed. Runs the consumer's
   * `onWindowSetup` teardown (if any) and disconnects the style observer.
   * Idempotent: callers can reach teardown from multiple paths (unload
   * listener, pool eviction, external destroy) without double-running
   * consumer cleanup.
   */
  cleanup: () => void;
}

export interface InitWindowDocumentOptions {
  injectStyles?: InjectStylesMode;
  title?: string;
  /**
   * Per-window setup hook. Runs after `<base>`, styles, and the `#root`
   * portal container are in place. Additive — runs regardless of
   * `injectStyles` mode. Optionally returns a cleanup, which is folded
   * into the returned `cleanup()`.
   */
  onWindowSetup?: WindowSetupCallback;
}

/**
 * Set up a child window's document for portal rendering.
 * Clears the document, adds a base href, injects styles, creates the portal
 * container, and runs the consumer's `onWindowSetup` hook.
 *
 * When injectStyles is "auto", a MutationObserver keeps child styles in sync
 * with the parent as new styles are added/removed/modified (e.g., Tailwind JIT,
 * HMR). Call cleanup() when the child window closes to disconnect the observer
 * and run any consumer-provided teardown.
 *
 * Takes the child `Window` (not just its `Document`) so the setup hook can
 * reach realm globals — `customElements`, prototype constructors, etc. —
 * which live on the window, not the document.
 */
export function initWindowDocument(
  childWindow: globalThis.Window,
  options: InitWindowDocumentOptions = {},
): InitWindowDocumentResult {
  const doc = childWindow.document;
  doc.head.innerHTML = "";
  doc.body.innerHTML = "";

  const base = doc.createElement("base");
  base.href = window.location.origin;
  doc.head.appendChild(base);

  // `let` (not `const`) so the cleanup closure can null these out after
  // running — see the cleanup body below for why.
  let styleCleanup: (() => void) | undefined = handleStyleInjection(
    doc,
    options.injectStyles ?? "auto",
  );

  if (options.title) {
    doc.title = options.title;
  }

  const container = doc.createElement("div");
  container.id = "root";
  doc.body.appendChild(container);

  // Run consumer setup AFTER <base>, styles, and #root are in place — this
  // is the invariant the hook's contract documents, so it lives next to the
  // code that establishes it. Errors are caught so a faulty hook can't
  // poison window creation. Cast: `window.open()` is typed `Window | null`,
  // but a same-origin child window is genuinely a global object at runtime,
  // and the hook needs realm constructors (`childWindow.HTMLElement`) and
  // realm globals (`childWindow.customElements`) that only exist on the
  // global-object intersection type. This is the one place in the codebase
  // that uses `Window & typeof globalThis` instead of `globalThis.Window` —
  // the divergence is the point.
  let setupCleanup: (() => void) | undefined;
  if (options.onWindowSetup) {
    try {
      const result = options.onWindowSetup(childWindow as Window & typeof globalThis, doc);
      if (result instanceof Promise) {
        // TS's permissive `void` rule lets `async (win, doc) => ...` through
        // the type check. An async hook would (a) have its rejection escape
        // the try/catch as an unhandled rejection, and (b) silently drop any
        // cleanup it eventually resolves to (`typeof Promise !== "function"`).
        // Fail loud instead of silently mishandling both.
        console.error(
          "[electron-window] onWindowSetup must be synchronous. " +
            "An async hook's errors are not caught and its returned cleanup is dropped. " +
            "Do dynamic imports at module scope and call sync APIs in the hook.",
        );
        result.catch((err) => {
          console.error("[electron-window] async onWindowSetup rejected:", err);
        });
      } else if (typeof result === "function") {
        setupCleanup = result;
      }
    } catch (err) {
      console.error("[electron-window] onWindowSetup threw:", err);
    }
  }

  // Combined, one-shot cleanup. The style subscriber's teardown is naturally
  // idempotent (Set.delete), but a consumer's setup teardown may not be —
  // and callers can reach this from overlapping paths (unload listener +
  // notifyDestroyed + destroyEntry).
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    if (setupCleanup) {
      try {
        setupCleanup();
      } catch (err) {
        console.error("[electron-window] onWindowSetup cleanup threw:", err);
      }
    }
    styleCleanup?.();
    // Drop captured refs so a lingering reference to `cleanup` (held by the
    // unload listener, a PoolEntry, or a debounced callback) doesn't pin the
    // consumer's setup closure — which plausibly captures the child Window
    // and its detached realm. Mirrors the defensive null-out in
    // RendererWindowPool.destroyEntry.
    setupCleanup = undefined;
    styleCleanup = undefined;
  };

  return { container, cleanup };
}

function isStyleNode(node: Node): node is HTMLStyleElement | HTMLLinkElement {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as Element;
  return (
    el.tagName === "STYLE" || (el.tagName === "LINK" && el.getAttribute("rel") === "stylesheet")
  );
}

interface Subscriber {
  targetDoc: Document;
  cloneMap: WeakMap<Node, Node>;
}

const subscribers = new Set<Subscriber>();
let sharedObserver: MutationObserver | null = null;

function applyMutationToSubscriber(sub: Subscriber, mutations: MutationRecord[]): void {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (isStyleNode(node) && !sub.cloneMap.has(node)) {
        const clone = node.cloneNode(true);
        sub.cloneMap.set(node, clone);
        sub.targetDoc.head.appendChild(clone);
      }
    }

    for (const node of mutation.removedNodes) {
      const clone = sub.cloneMap.get(node);
      if (clone) {
        clone.parentNode?.removeChild(clone);
        sub.cloneMap.delete(node);
      }
    }

    if (mutation.type === "characterData" || mutation.type === "childList") {
      const target =
        mutation.type === "characterData" ? mutation.target.parentNode : mutation.target;
      if (target && isStyleNode(target)) {
        const clone = sub.cloneMap.get(target);
        if (clone && clone instanceof HTMLStyleElement) {
          clone.textContent = (target as HTMLStyleElement).textContent;
        }
      }
    }
  }
}

/**
 * Inject styles from parent document into child window document.
 * In "auto" mode, a single shared MutationObserver fans out style changes
 * to all subscribed child documents. Returns a cleanup function to unsubscribe.
 */
export function handleStyleInjection(doc: Document, mode: InjectStylesMode): () => void {
  if (mode === false) return () => {};
  if (typeof mode === "function") {
    mode(doc);
    return () => {};
  }

  // "auto" — clone existing styles and subscribe to shared observer
  const cloneMap = new WeakMap<Node, Node>();

  const existing = document.querySelectorAll('style, link[rel="stylesheet"]');
  for (const sheet of existing) {
    const clone = sheet.cloneNode(true);
    cloneMap.set(sheet, clone);
    doc.head.appendChild(clone);
  }

  const sub: Subscriber = { targetDoc: doc, cloneMap };
  subscribers.add(sub);

  if (sharedObserver === null) {
    sharedObserver = new MutationObserver((mutations) => {
      for (const s of subscribers) {
        try {
          applyMutationToSubscriber(s, mutations);
        } catch {
          subscribers.delete(s);
        }
      }
    });
    sharedObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  return () => {
    subscribers.delete(sub);
    if (subscribers.size === 0) {
      sharedObserver?.disconnect();
      sharedObserver = null;
    }
  };
}

/** @internal Test-only: returns the number of style-sync subscribers. */
export function __getStyleSubscriberCount(): number {
  return subscribers.size;
}
