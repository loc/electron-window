import { sleep } from "../shared/utils.js";
import type { InjectStylesMode } from "../shared/types.js";

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
  /** Call to disconnect the style observer and clean up */
  cleanup: () => void;
}

/**
 * Set up a child window's document for portal rendering.
 * Clears the document, adds a base href, injects styles, creates the portal container.
 *
 * When injectStyles is "auto", a MutationObserver keeps child styles in sync
 * with the parent as new styles are added/removed/modified (e.g., Tailwind JIT, HMR).
 * Call cleanup() when the child window closes to disconnect the observer.
 */
export function initWindowDocument(
  doc: Document,
  options: { injectStyles?: InjectStylesMode; title?: string } = {},
): InitWindowDocumentResult {
  doc.head.innerHTML = "";
  doc.body.innerHTML = "";

  const base = doc.createElement("base");
  base.href = window.location.origin;
  doc.head.appendChild(base);

  const cleanup = handleStyleInjection(doc, options.injectStyles ?? "auto");

  if (options.title) {
    doc.title = options.title;
  }

  const container = doc.createElement("div");
  container.id = "root";
  doc.body.appendChild(container);

  return { container, cleanup };
}

function isStyleNode(node: Node): node is HTMLStyleElement | HTMLLinkElement {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as Element;
  return (
    el.tagName === "STYLE" ||
    (el.tagName === "LINK" && el.getAttribute("rel") === "stylesheet")
  );
}

interface Subscriber {
  targetDoc: Document;
  cloneMap: WeakMap<Node, Node>;
}

const subscribers = new Set<Subscriber>();
let sharedObserver: MutationObserver | null = null;

function applyMutationToSubscriber(
  sub: Subscriber,
  mutations: MutationRecord[],
): void {
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
        mutation.type === "characterData"
          ? mutation.target.parentNode
          : mutation.target;
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
export function handleStyleInjection(
  doc: Document,
  mode: InjectStylesMode,
): () => void {
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
