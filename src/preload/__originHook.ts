/**
 * Preload-side origin gate, called from the EIPC-generated preload validator
 * AFTER the main-frame check passes. Runs once at preload-evaluation time —
 * if it returns false, `contextBridge.exposeInMainWorld("electron_window", ...)`
 * is skipped and the renderer never sees the API surface.
 *
 * Configured by the same __ELECTRON_WINDOW_ALLOWED_ORIGINS__ bundler define
 * as the main-process hook. Consumers set it in their preload bundler config:
 *
 *   // esbuild preload build
 *   define: {
 *     __ELECTRON_WINDOW_ALLOWED_ORIGINS__: JSON.stringify(["app://main", "file://"])
 *   }
 *
 * Patched into the generated preload validator by scripts/patch-ipc-validators.mjs.
 */

declare const __ELECTRON_WINDOW_ALLOWED_ORIGINS__:
  | readonly string[]
  | undefined;

export function __originHook(): boolean {
  if (typeof __ELECTRON_WINDOW_ALLOWED_ORIGINS__ === "undefined") return true;
  // Preload runs after the document is committed — window.location is the
  // final URL (loadFile → file://…, loadURL → that URL, custom protocol → app://…).
  try {
    const u = new URL(window.location.href);
    const origin =
      u.origin === "null" || u.origin === null
        ? `${u.protocol}//${u.host}`
        : u.origin;
    return __ELECTRON_WINDOW_ALLOWED_ORIGINS__.includes(origin);
  } catch {
    return false;
  }
}
