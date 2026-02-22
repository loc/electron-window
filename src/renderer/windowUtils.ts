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

/**
 * Set up a child window's document for portal rendering.
 * Clears the document, adds a base href, injects styles, creates the portal container.
 */
export function initWindowDocument(
  doc: Document,
  options: { injectStyles?: InjectStylesMode; title?: string } = {},
): HTMLElement {
  doc.head.innerHTML = "";
  doc.body.innerHTML = "";

  const base = doc.createElement("base");
  base.href = window.location.origin;
  doc.head.appendChild(base);

  handleStyleInjection(doc, options.injectStyles ?? "auto");

  if (options.title) {
    doc.title = options.title;
  }

  const container = doc.createElement("div");
  container.id = "root";
  doc.body.appendChild(container);

  return container;
}

/**
 * Copy styles from parent document into child window document.
 */
export function handleStyleInjection(
  doc: Document,
  mode: InjectStylesMode,
): void {
  if (mode === false) return;
  if (typeof mode === "function") {
    mode(doc);
    return;
  }
  // "auto" — clone all style/link elements from parent
  const sheets = document.querySelectorAll('style, link[rel="stylesheet"]');
  for (const sheet of sheets) {
    doc.head.appendChild(sheet.cloneNode(true));
  }
}
