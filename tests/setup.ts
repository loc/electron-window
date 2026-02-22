import { vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// Track mock windows for testing
const mockWindows = new Map<string, MockWindow>();

class MockWindow {
  innerWidth = 800;
  innerHeight = 600;
  screenX = 100;
  screenY = 100;
  outerWidth = 800;
  outerHeight = 600;
  closed = false;
  document: Document;
  onbeforeunload: (() => void) | null = null;

  private _eventListeners = new Map<
    string,
    Set<EventListenerOrEventListenerObject>
  >();

  // Make these spies so tests can check if they were called
  focus = vi.fn();
  blur = vi.fn();
  resizeTo = vi.fn((width: number, height: number) => {
    this.outerWidth = width;
    this.outerHeight = height;
  });
  moveTo = vi.fn((x: number, y: number) => {
    this.screenX = x;
    this.screenY = y;
  });

  constructor(public name: string) {
    // createHTMLDocument returns a real DOM document supporting createElement,
    // appendChild, innerHTML, head, body, and title getter/setter.
    this.document = window.document.implementation.createHTMLDocument(name);
    this.document.body.innerHTML = "";
    mockWindows.set(name, this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (!this._eventListeners.has(type)) {
      this._eventListeners.set(type, new Set());
    }
    this._eventListeners.get(type)!.add(listener);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) {
    this._eventListeners.get(type)?.delete(listener);
  }

  // Simulate the user closing the window via OS chrome (fires unload handlers then marks closed)
  simulateUnload() {
    const listeners = this._eventListeners.get("unload");
    if (listeners) {
      for (const listener of listeners) {
        if (typeof listener === "function") {
          listener(new Event("unload"));
        } else {
          listener.handleEvent(new Event("unload"));
        }
      }
    }
    this.onbeforeunload?.();
    this.close();
  }

  close() {
    this.closed = true;
    mockWindows.delete(this.name);
  }
}

// Mock window.open for testing
const originalOpen = window.open;
window.open = vi.fn((url?: string, target?: string, features?: string) => {
  const name = target || `mock-window-${Date.now()}`;
  return new MockWindow(name) as unknown as Window;
});

// Export for test assertions
(globalThis as unknown as Record<string, unknown>).__mockWindows__ =
  mockWindows;

/** Get the global map of mock windows created by window.open */
export function getGlobalMockWindows(): Map<string, unknown> {
  return mockWindows as Map<string, unknown>;
}

// Helper to reset mock windows between tests
export function resetMockWindowsGlobal() {
  for (const win of mockWindows.values()) {
    win.close();
  }
  mockWindows.clear();
}

// Simulate the user closing a named window (fires unload listeners then closes)
export function simulateUserClose(windowName: string) {
  const win = mockWindows.get(windowName);
  if (!win) {
    throw new Error(`No mock window found with name "${windowName}"`);
  }
  win.simulateUnload();
}

// Mock Electron in test environment
vi.mock("electron", () => ({
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
  contextBridge: {
    exposeInMainWorld: vi.fn(),
  },
  screen: {
    getPrimaryDisplay: vi.fn(() => ({
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      scaleFactor: 1,
    })),
    getAllDisplays: vi.fn(() => []),
    getDisplayMatching: vi.fn(),
    getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
  },
}));
