/**
 * Consumer-configurable origin check, called from the generated IPC validator
 * AFTER the main-frame check passes. The generated validator already verified
 * `event.senderFrame?.parent === null`, so `url` here is the top-level frame's
 * URL — the correct origin to validate.
 *
 * Consumers configure this by defining a build-time constant in their bundler:
 *
 *   // vite.config.ts / esbuild / webpack DefinePlugin
 *   define: {
 *     __ELECTRON_WINDOW_ALLOWED_ORIGINS__: JSON.stringify(["app://main", "file://"])
 *   }
 *
 * Their bundler processes our dist/main/index.js as part of their main bundle,
 * replacing the constant. Without the define, the `typeof` guard evaluates to
 * "undefined" at runtime → permissive (same as the runtime allowedOrigins default).
 *
 * This hook is patched into the generated IPC validator by
 * scripts/patch-ipc-validators.mjs at our build time.
 */

// Consumer's bundler replaces this if they set `define`. Without the define,
// `typeof __ELECTRON_WINDOW_ALLOWED_ORIGINS__` is "undefined" at runtime.
declare const __ELECTRON_WINDOW_ALLOWED_ORIGINS__:
  | readonly string[]
  | undefined;

export function __originHook(url: string | undefined): boolean {
  if (typeof __ELECTRON_WINDOW_ALLOWED_ORIGINS__ === "undefined") return true;
  if (!url) return false;
  try {
    const u = new URL(url);
    // Custom protocols (app://, file://) produce origin "null" in some engines —
    // reconstruct as protocol+host so "file://" and "app://main" can be matched.
    const origin =
      u.origin === "null" || u.origin === null
        ? `${u.protocol}//${u.host}`
        : u.origin;
    return __ELECTRON_WINDOW_ALLOWED_ORIGINS__.includes(origin);
  } catch {
    return false;
  }
}
