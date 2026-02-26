/**
 * Create a deferred promise that can be resolved/rejected externally
 */
export interface Deferred<T> extends Promise<T> {
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  isPending: () => boolean;
  isResolved: () => boolean;
  isRejected: () => boolean;
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  let status: "pending" | "resolved" | "rejected" = "pending";

  const promise = new Promise<T>((res, rej) => {
    resolve = (value) => {
      if (status === "pending") {
        status = "resolved";
        res(value);
      }
    };
    reject = (reason) => {
      if (status === "pending") {
        status = "rejected";
        rej(reason);
      }
    };
  }) as Deferred<T>;

  promise.resolve = resolve;
  promise.reject = reject;
  promise.isPending = () => status === "pending";
  promise.isResolved = () => status === "resolved";
  promise.isRejected = () => status === "rejected";

  return promise;
}

/**
 * Generate a cryptographically-random window ID. The ownership model in
 * WindowManager relies on ID unpredictability (a renderer that guesses
 * another's window ID could otherwise attempt cross-owner operations).
 *
 * `crypto.randomUUID()` is secure-context-only in browsers — fine for
 * file://, app://, https://, and http://localhost (all secure contexts).
 * For http://<remote> renderers (rare), fall back to `crypto.getRandomValues`
 * which is NOT secure-context-gated. Both are on the Web Crypto API.
 */
export function generateWindowId(): string {
  if (typeof crypto?.randomUUID === "function") {
    return `win_${crypto.randomUUID()}`;
  }
  if (typeof crypto?.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return `win_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  }
  // Never falls back to Math.random() — that would silently weaken the
  // ownership guarantee in exactly the (rare) case where a remote origin
  // is involved. Fail loudly instead.
  throw new Error(
    "@loc/electron-window requires the Web Crypto API. " +
      "Load your renderer from file://, a custom registered protocol, https://, or http://localhost.",
  );
}

/**
 * Debounce a function
 */
export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  ms: number,
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const debounced = ((...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      timeoutId = null;
      fn(...args);
    }, ms);
  }) as T & { cancel: () => void };

  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return debounced;
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if running on macOS
 */
export function isMac(): boolean {
  if (typeof process === "undefined") return false;
  return process.platform === "darwin";
}

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  if (typeof process === "undefined") return false;
  return process.platform === "win32";
}

/**
 * Check if running on Linux
 */
export function isLinux(): boolean {
  if (typeof process === "undefined") return false;
  return process.platform === "linux";
}

/**
 * Check if running in development mode
 */
export function isDev(): boolean {
  // Explicit global override (set by WindowProvider devWarnings prop)
  if (
    typeof globalThis !== "undefined" &&
    "__ELECTRON_WINDOW_DEV__" in globalThis
  ) {
    return !!(globalThis as Record<string, unknown>).__ELECTRON_WINDOW_DEV__;
  }
  // Webpack/Node
  if (typeof process !== "undefined" && process.env) {
    return (
      process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
    );
  }
  return false;
}

/**
 * Log a development warning
 */
export function devWarning(message: string): void {
  if (isDev()) {
    console.warn(`[electron-window] ${message}`);
  }
}
