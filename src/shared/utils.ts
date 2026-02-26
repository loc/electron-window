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
 * Generate a unique window ID
 */
export function generateWindowId(): string {
  return `win_${crypto.randomUUID()}`;
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
  if (typeof process === "undefined") return false;
  return (
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
  );
}

/**
 * Log a development warning
 */
export function devWarning(message: string): void {
  if (isDev()) {
    console.warn(`[electron-window] ${message}`);
  }
}
