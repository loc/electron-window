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
  return `win_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Debounce a function
 */
export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  ms: number
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
 * Get current platform
 */
export function getPlatform(): "darwin" | "win32" | "linux" {
  return process.platform as "darwin" | "win32" | "linux";
}

/**
 * Check if running on macOS
 */
export function isMac(): boolean {
  return process.platform === "darwin";
}

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return process.platform === "win32";
}

/**
 * Check if running on Linux
 */
export function isLinux(): boolean {
  return process.platform === "linux";
}

/**
 * Check if running in development mode
 */
export function isDev(): boolean {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
}

/**
 * Log a development warning
 */
export function devWarning(message: string): void {
  if (isDev()) {
    console.warn(`[electron-window] ${message}`);
  }
}

/**
 * Compare two objects for shallow equality
 */
export function shallowEqual<T extends Record<string, unknown>>(
  a: T | undefined | null,
  b: T | undefined | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }

  return true;
}

/**
 * Diff two prop objects and return changed keys with their new values
 */
export function diffProps<T extends Record<string, unknown>>(
  prev: T | undefined,
  next: T
): Partial<T> {
  const changes: Partial<T> = {};

  for (const key of Object.keys(next) as (keyof T)[]) {
    if (prev?.[key] !== next[key]) {
      changes[key] = next[key];
    }
  }

  return changes;
}

/**
 * Pick specific keys from an object
 */
export function pick<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Omit specific keys from an object
 */
export function omit<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result as Omit<T, K>;
}

/**
 * Noop function
 */
export function noop(): void {
  // intentionally empty
}
