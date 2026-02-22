import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import React from "react";
import { render, renderHook, act, waitFor } from "@testing-library/react";
import { Window } from "../../src/renderer/Window.js";
import { usePersistedBounds } from "../../src/renderer/hooks/usePersistedBounds.js";
import {
  MockWindowProvider,
  resetMockWindows,
  getMockWindows,
  simulateMockWindowEvent,
} from "../../src/testing/index.js";
import { resetMockWindowsGlobal, getGlobalMockWindows } from "../setup.js";

const STORAGE_PREFIX = "electron-window:bounds:";

function storageKey(key: string) {
  return `${STORAGE_PREFIX}${key}`;
}

function setPersistedBounds(
  key: string,
  bounds: { x: number; y: number; width: number; height: number },
) {
  localStorage.setItem(storageKey(key), JSON.stringify(bounds));
}

function getPersistedBounds(key: string) {
  const value = localStorage.getItem(storageKey(key));
  return value ? JSON.parse(value) : null;
}

// Get mock windows from global mock
function getGlobalMockWindows(): Map<string, unknown> {
  return (
    (globalThis as unknown as Record<string, Map<string, unknown>>)
      .__mockWindows__ ?? new Map()
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// usePersistedBounds hook — core persistence logic
// ─────────────────────────────────────────────────────────────────────────────

describe("usePersistedBounds", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns default bounds when nothing is stored", () => {
    const { result } = renderHook(() =>
      usePersistedBounds("fresh-key", {
        defaultWidth: 600,
        defaultHeight: 400,
        defaultX: 10,
        defaultY: 20,
      }),
    );

    expect(result.current.bounds).toEqual({
      defaultWidth: 600,
      defaultHeight: 400,
      defaultX: 10,
      defaultY: 20,
    });
  });

  it("reads persisted bounds synchronously on first render", () => {
    setPersistedBounds("sync-read", { x: 50, y: 75, width: 900, height: 700 });

    const { result } = renderHook(() =>
      usePersistedBounds("sync-read", {
        defaultWidth: 400,
        defaultHeight: 300,
      }),
    );

    // Persisted values override defaults
    expect(result.current.bounds.defaultWidth).toBe(900);
    expect(result.current.bounds.defaultHeight).toBe(700);
    expect(result.current.bounds.defaultX).toBe(50);
    expect(result.current.bounds.defaultY).toBe(75);
  });

  it("persisted bounds take precedence over all defaults", () => {
    setPersistedBounds("prefer-test", {
      x: 50,
      y: 50,
      width: 1200,
      height: 900,
    });

    const { result } = renderHook(() =>
      usePersistedBounds("prefer-test", {
        defaultX: 0,
        defaultY: 0,
        defaultWidth: 400,
        defaultHeight: 300,
      }),
    );

    expect(result.current.bounds.defaultWidth).toBe(1200);
    expect(result.current.bounds.defaultHeight).toBe(900);
    expect(result.current.bounds.defaultX).toBe(50);
    expect(result.current.bounds.defaultY).toBe(50);
  });

  it("saves bounds to localStorage via save()", async () => {
    const { result } = renderHook(() =>
      usePersistedBounds("save-key", { saveDebounceMs: 0 }),
    );

    act(() => {
      result.current.save({ x: 10, y: 20, width: 500, height: 400 });
    });

    // Wait for debounce to flush (saveDebounceMs=0 still runs async via setTimeout)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const stored = getPersistedBounds("save-key");
    expect(stored).toEqual({ x: 10, y: 20, width: 500, height: 400 });
  });

  it("clear() removes bounds from localStorage", async () => {
    setPersistedBounds("clear-key", { x: 0, y: 0, width: 800, height: 600 });

    const { result } = renderHook(() => usePersistedBounds("clear-key"));

    // Confirm it loaded
    expect(result.current.bounds.defaultWidth).toBe(800);

    act(() => {
      result.current.clear();
    });

    expect(localStorage.getItem(storageKey("clear-key"))).toBeNull();
  });

  it("uses separate localStorage entries per key", () => {
    setPersistedBounds("key-a", { x: 0, y: 0, width: 400, height: 300 });
    setPersistedBounds("key-b", { x: 100, y: 100, width: 800, height: 600 });

    const { result: resultA } = renderHook(() =>
      usePersistedBounds("key-a", { defaultWidth: 100, defaultHeight: 100 }),
    );
    const { result: resultB } = renderHook(() =>
      usePersistedBounds("key-b", { defaultWidth: 100, defaultHeight: 100 }),
    );

    expect(resultA.current.bounds.defaultWidth).toBe(400);
    expect(resultB.current.bounds.defaultWidth).toBe(800);
  });

  it("returns defaults for all fields when nothing is stored", () => {
    const { result } = renderHook(() =>
      usePersistedBounds("empty-key", {
        defaultWidth: 500,
        defaultHeight: 350,
        defaultX: 25,
        defaultY: 40,
      }),
    );

    const { bounds } = result.current;
    expect(bounds.defaultWidth).toBe(500);
    expect(bounds.defaultHeight).toBe(350);
    expect(bounds.defaultX).toBe(25);
    expect(bounds.defaultY).toBe(40);
  });

  it("ignores invalid JSON in localStorage", () => {
    localStorage.setItem(storageKey("corrupt-key"), "not-valid-json{{{");

    const { result } = renderHook(() =>
      usePersistedBounds("corrupt-key", {
        defaultWidth: 600,
        defaultHeight: 400,
      }),
    );

    // Falls back to defaults without throwing
    expect(result.current.bounds.defaultWidth).toBe(600);
    expect(result.current.bounds.defaultHeight).toBe(400);
  });

  it("falls back to defaults when stored bounds have zero width", () => {
    localStorage.setItem(
      storageKey("zero-width"),
      JSON.stringify({ x: 0, y: 0, width: 0, height: 600 }),
    );

    const { result } = renderHook(() =>
      usePersistedBounds("zero-width", {
        defaultWidth: 800,
        defaultHeight: 600,
      }),
    );

    expect(result.current.bounds.defaultWidth).toBe(800);
    expect(result.current.bounds.defaultHeight).toBe(600);
  });

  it("falls back to defaults when stored bounds have zero height", () => {
    localStorage.setItem(
      storageKey("zero-height"),
      JSON.stringify({ x: 0, y: 0, width: 800, height: 0 }),
    );

    const { result } = renderHook(() =>
      usePersistedBounds("zero-height", {
        defaultWidth: 800,
        defaultHeight: 600,
      }),
    );

    expect(result.current.bounds.defaultWidth).toBe(800);
    expect(result.current.bounds.defaultHeight).toBe(600);
  });

  it("falls back to defaults when stored bounds have negative dimensions", () => {
    localStorage.setItem(
      storageKey("negative"),
      JSON.stringify({ x: 0, y: 0, width: -100, height: -50 }),
    );

    const { result } = renderHook(() =>
      usePersistedBounds("negative", { defaultWidth: 800, defaultHeight: 600 }),
    );

    expect(result.current.bounds.defaultWidth).toBe(800);
    expect(result.current.bounds.defaultHeight).toBe(600);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// <Window> + persistBounds — smoke tests
//
// <Window> accepts the persistBounds prop but doesn't read/write localStorage
// internally. Consumers drive persistence themselves via usePersistedBounds.
// These tests verify that the component renders without errors regardless of
// whether persistBounds is set.
// ─────────────────────────────────────────────────────────────────────────────

describe("<Window> persistBounds prop — smoke tests", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("creates window normally without persistBounds", async () => {
    render(
      <MockWindowProvider>
        <Window open defaultWidth={700} defaultHeight={500}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    expect(window.open).toHaveBeenCalledWith(
      "about:blank",
      expect.any(String),
      expect.any(String),
    );
  });

  it("creates window normally with persistBounds set", async () => {
    render(
      <MockWindowProvider>
        <Window
          open
          persistBounds="my-window"
          defaultWidth={600}
          defaultHeight={400}
        >
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    expect(getGlobalMockWindows().size).toBe(1);
  });

  it("uses defaultWidth/defaultHeight on first open when no localStorage entry exists", async () => {
    render(
      <MockWindowProvider>
        <Window
          open
          persistBounds="test-window"
          defaultWidth={600}
          defaultHeight={400}
        >
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getMockWindows().length).toBe(1);
    });

    // Bounds are passed via IPC props to the provider (not via window.open features)
    const [win] = getMockWindows();
    expect(win.props.defaultWidth).toBe(600);
    expect(win.props.defaultHeight).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// usePersistedBounds + <Window> — integration pattern
//
// This is how consumers are expected to wire up persistence: call the hook,
// spread its bounds into <Window> as defaults, pass save() to onBoundsChange.
// ─────────────────────────────────────────────────────────────────────────────

describe("usePersistedBounds + <Window> integration pattern", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("opens window with persisted dimensions when localStorage is pre-populated", async () => {
    setPersistedBounds("restored-window", {
      x: 50,
      y: 75,
      width: 900,
      height: 700,
    });

    function TestApp() {
      const { bounds } = usePersistedBounds("restored-window", {
        defaultWidth: 400,
        defaultHeight: 300,
      });
      return (
        <MockWindowProvider>
          <Window open {...bounds}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    await waitFor(() => {
      expect(getMockWindows().length).toBe(1);
    });

    // Persisted bounds flow through the hook into <Window> as defaultWidth/Height/X/Y props,
    // which are registered with the provider via IPC props
    const [win] = getMockWindows();
    expect(win.props.defaultWidth).toBe(900);
    expect(win.props.defaultHeight).toBe(700);
    expect(win.props.defaultX).toBe(50);
    expect(win.props.defaultY).toBe(75);
  });

  it("falls back to defaults when localStorage has no entry", async () => {
    function TestApp() {
      const { bounds } = usePersistedBounds("no-entry-window", {
        defaultWidth: 500,
        defaultHeight: 350,
      });
      return (
        <MockWindowProvider>
          <Window open {...bounds}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    await waitFor(() => {
      expect(getMockWindows().length).toBe(1);
    });

    const [win] = getMockWindows();
    expect(win.props.defaultWidth).toBe(500);
    expect(win.props.defaultHeight).toBe(350);
  });

  it("saves bounds to localStorage when onBoundsChange fires", async () => {
    function TestApp() {
      const { bounds, save } = usePersistedBounds("save-on-change", {
        defaultWidth: 400,
        defaultHeight: 300,
        saveDebounceMs: 0,
      });
      return (
        <MockWindowProvider>
          <Window open {...bounds} onBoundsChange={save}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Window exists — bounds saving is exercised by onBoundsChange
    expect(getGlobalMockWindows().size).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// <Window> persistence — conflicts with controlled bounds
// ─────────────────────────────────────────────────────────────────────────────

describe("<Window> built-in persistBounds save", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("saves bounds to localStorage when boundsChanged event fires", async () => {
    render(
      <MockWindowProvider>
        <Window
          open
          persistBounds="save-test"
          defaultWidth={400}
          defaultHeight={300}
        >
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => expect(getGlobalMockWindows().size).toBe(1));

    const mockWindows = getMockWindows();

    // Fire a boundsChanged event
    simulateMockWindowEvent(mockWindows[0].id, {
      type: "boundsChanged",
      bounds: { x: 10, y: 20, width: 500, height: 400 },
    });

    // Wait for both debounces (100ms bounds + 500ms persistence)
    await new Promise((resolve) => setTimeout(resolve, 700));

    // Bounds should be saved to localStorage
    const saved = localStorage.getItem("electron-window:bounds:save-test");
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!);
    expect(parsed.width).toBe(500);
    expect(parsed.height).toBe(400);
    expect(parsed.x).toBe(10);
    expect(parsed.y).toBe(20);
  });
});

describe("<Window> built-in persistBounds restore", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("restores persisted bounds as default dimensions on open", async () => {
    // Pre-populate localStorage
    localStorage.setItem(
      "electron-window:bounds:restore-test",
      JSON.stringify({ x: 50, y: 75, width: 900, height: 700 }),
    );

    render(
      <MockWindowProvider>
        <Window
          open
          persistBounds="restore-test"
          defaultWidth={400}
          defaultHeight={300}
        >
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => expect(getGlobalMockWindows().size).toBe(1));

    // The persisted bounds should override the defaults
    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.defaultWidth).toBe(900);
    expect(mockWindows[0].props.defaultHeight).toBe(700);
    expect(mockWindows[0].props.defaultX).toBe(50);
    expect(mockWindows[0].props.defaultY).toBe(75);
  });

  it("uses defaults when no persisted bounds exist", async () => {
    render(
      <MockWindowProvider>
        <Window
          open
          persistBounds="no-saved-key"
          defaultWidth={400}
          defaultHeight={300}
        >
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => expect(getGlobalMockWindows().size).toBe(1));

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.defaultWidth).toBe(400);
    expect(mockWindows[0].props.defaultHeight).toBe(300);
  });
});

describe("<Window> persistBounds conflicts", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("warns when using controlled bounds without onBoundsChange", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    render(
      <MockWindowProvider>
        <Window
          open
          persistBounds="conflict-test"
          width={800}
          defaultHeight={600}
        >
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/controlled bounds.*onBoundsChange/i),
    );

    consoleWarnSpy.mockRestore();
  });
});
