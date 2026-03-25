import { describe, it, expect, beforeEach, vi } from "vitest";
import React, { useState } from "react";
import { render, waitFor, fireEvent, act } from "@testing-library/react";
import { Window } from "../../src/renderer/Window.js";
import {
  MockWindowProvider,
  resetMockWindows,
  getMockWindows,
  simulateMockWindowEvent,
} from "../../src/testing/index.js";
import {
  useCurrentWindow,
  useWindowBounds,
  useWindowFocused,
  useWindowVisible,
  useWindowMaximized,
  useWindowMinimized,
  useWindowFullscreen,
  useWindowDisplay,
  useWindowState,
  useWindowDocument,
  useWindowSignal,
  useWindowEventListener,
  clearPersistedBounds,
  clearAllPersistedBounds,
} from "../../src/renderer/hooks/index.js";
import { useIsInsideWindow } from "../../src/renderer/context.js";
import { MockWindow } from "../../src/testing/index.js";
import { resetMockWindowsGlobal, getGlobalMockWindows } from "../setup.js";

describe("useCurrentWindow", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("throws when not inside a Window", () => {
    function TestComponent() {
      useCurrentWindow();
      return <div>Test</div>;
    }

    expect(() => {
      render(
        <MockWindowProvider>
          <TestComponent />
        </MockWindowProvider>,
      );
    }).toThrow(/useWindowContext must be used within a Window/);
  });

  it("returns window handle when inside a Window", async () => {
    let windowHandle: ReturnType<typeof useCurrentWindow> | null = null;

    function WindowContent() {
      windowHandle = useCurrentWindow();
      return <div data-testid="content">Content</div>;
    }

    render(
      <MockWindowProvider>
        <Window open>
          <WindowContent />
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Window handle should be available
    await waitFor(() => {
      expect(windowHandle).not.toBeNull();
    });

    expect(windowHandle?.id).toBeDefined();
    expect(typeof windowHandle?.focus).toBe("function");
    expect(typeof windowHandle?.close).toBe("function");
  });

  it("provides working imperative methods", async () => {
    let windowHandle: ReturnType<typeof useCurrentWindow> | null = null;

    function WindowContent() {
      windowHandle = useCurrentWindow();
      return <div>Content</div>;
    }

    render(
      <MockWindowProvider>
        <Window open>
          <WindowContent />
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(windowHandle).not.toBeNull();
    });

    // Methods should be callable without throwing
    expect(() => windowHandle?.focus()).not.toThrow();
    expect(() => windowHandle?.blur()).not.toThrow();
    expect(() => windowHandle?.minimize()).not.toThrow();
    expect(() => windowHandle?.maximize()).not.toThrow();
  });

  it("updates isFocused, isMaximized state when events fire", async () => {
    let windowHandle: ReturnType<typeof useCurrentWindow> | null = null;

    function WindowContent() {
      windowHandle = useCurrentWindow();
      return <div>Content</div>;
    }

    render(
      <MockWindowProvider>
        <Window open>
          <WindowContent />
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(windowHandle).not.toBeNull();
    });

    const mockWindows = getMockWindows();

    simulateMockWindowEvent(mockWindows[0].id, { type: "focused" });
    await waitFor(() => {
      expect(windowHandle?.isFocused).toBe(true);
    });

    simulateMockWindowEvent(mockWindows[0].id, { type: "blurred" });
    await waitFor(() => {
      expect(windowHandle?.isFocused).toBe(false);
    });

    simulateMockWindowEvent(mockWindows[0].id, { type: "maximized" });
    await waitFor(() => {
      expect(windowHandle?.isMaximized).toBe(true);
    });

    simulateMockWindowEvent(mockWindows[0].id, { type: "unmaximized" });
    await waitFor(() => {
      expect(windowHandle?.isMaximized).toBe(false);
    });
  });
});

describe("useWindowBounds", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("throws when not inside a Window", () => {
    function TestComponent() {
      useWindowBounds();
      return <div>Test</div>;
    }

    expect(() => {
      render(
        <MockWindowProvider>
          <TestComponent />
        </MockWindowProvider>,
      );
    }).toThrow(/useWindowContext must be used within a Window/);
  });

  it("returns window bounds when inside a Window", async () => {
    let bounds: ReturnType<typeof useWindowBounds> | null = null;

    function WindowContent() {
      bounds = useWindowBounds();
      return <div>Content</div>;
    }

    render(
      <MockWindowProvider>
        <Window open defaultWidth={800} defaultHeight={600}>
          <WindowContent />
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Bounds should have the expected structure
    expect(bounds).toHaveProperty("x");
    expect(bounds).toHaveProperty("y");
    expect(bounds).toHaveProperty("width");
    expect(bounds).toHaveProperty("height");
  });

  it("updates when boundsChanged event fires", async () => {
    let bounds: ReturnType<typeof useWindowBounds> | null = null;

    function WindowContent() {
      bounds = useWindowBounds();
      return <div>Content</div>;
    }

    render(
      <MockWindowProvider>
        <Window open defaultWidth={800} defaultHeight={600}>
          <WindowContent />
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    simulateMockWindowEvent(mockWindows[0].id, {
      type: "boundsChanged",
      bounds: { x: 10, y: 20, width: 1024, height: 768 },
    });

    await waitFor(() => {
      expect(bounds?.width).toBe(1024);
      expect(bounds?.height).toBe(768);
      expect(bounds?.x).toBe(10);
      expect(bounds?.y).toBe(20);
    });
  });
});

describe("useWindowFocused", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("throws when not inside a Window", () => {
    function TestComponent() {
      useWindowFocused();
      return <div>Test</div>;
    }

    expect(() => {
      render(
        <MockWindowProvider>
          <TestComponent />
        </MockWindowProvider>,
      );
    }).toThrow(/useWindowContext must be used within a Window/);
  });

  it("returns focus state when inside a Window", async () => {
    let isFocused = false;

    function WindowContent() {
      isFocused = useWindowFocused();
      return <div>Content</div>;
    }

    render(
      <MockWindowProvider>
        <Window open>
          <WindowContent />
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Focus state should be a boolean
    expect(typeof isFocused).toBe("boolean");
  });

  it("updates when focus events fire", async () => {
    let focused = false;

    function WindowContent() {
      focused = useWindowFocused();
      return <div>Content</div>;
    }

    render(
      <MockWindowProvider>
        <Window open>
          <WindowContent />
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    expect(focused).toBe(false);

    const mockWindows = getMockWindows();
    simulateMockWindowEvent(mockWindows[0].id, { type: "focused" });
    await waitFor(() => {
      expect(focused).toBe(true);
    });

    simulateMockWindowEvent(mockWindows[0].id, { type: "blurred" });
    await waitFor(() => {
      expect(focused).toBe(false);
    });
  });
});

describe("useWindowVisible", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("throws when not inside a Window", () => {
    function TestComponent() {
      useWindowVisible();
      return <div>Test</div>;
    }

    expect(() => {
      render(
        <MockWindowProvider>
          <TestComponent />
        </MockWindowProvider>,
      );
    }).toThrow(/useWindowContext must be used within a Window/);
  });

  it("updates when shown/hidden events fire", async () => {
    let isVisible: boolean | undefined;
    function WindowContent() {
      isVisible = useWindowVisible();
      return <div>Content</div>;
    }

    render(
      <MockWindowProvider>
        <Window open>
          <WindowContent />
        </Window>
      </MockWindowProvider>,
    );
    await waitFor(() => expect(getGlobalMockWindows().size).toBe(1));

    const id = getMockWindows()[0].id;
    simulateMockWindowEvent(id, { type: "hidden" });
    await waitFor(() => expect(isVisible).toBe(false));

    simulateMockWindowEvent(id, { type: "shown" });
    await waitFor(() => expect(isVisible).toBe(true));
  });
});

describe("useWindowMaximized", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("throws when not inside a Window", () => {
    function TestComponent() {
      useWindowMaximized();
      return <div>Test</div>;
    }

    expect(() => {
      render(
        <MockWindowProvider>
          <TestComponent />
        </MockWindowProvider>,
      );
    }).toThrow(/useWindowContext must be used within a Window/);
  });

  it("returns maximized state when inside a Window", async () => {
    let isMaximized = true;

    function WindowContent() {
      isMaximized = useWindowMaximized();
      return <div>Content</div>;
    }

    render(
      <MockWindowProvider>
        <Window open>
          <WindowContent />
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Initially not maximized
    expect(isMaximized).toBe(false);
  });

  it("updates when maximized/unmaximized events fire", async () => {
    let isMaximized = false;

    function WindowContent() {
      isMaximized = useWindowMaximized();
      return <div>Content</div>;
    }

    render(
      <MockWindowProvider>
        <Window open>
          <WindowContent />
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    simulateMockWindowEvent(mockWindows[0].id, { type: "maximized" });
    await waitFor(() => {
      expect(isMaximized).toBe(true);
    });

    simulateMockWindowEvent(mockWindows[0].id, { type: "unmaximized" });
    await waitFor(() => {
      expect(isMaximized).toBe(false);
    });
  });
});

describe("useWindowMinimized", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("throws when not inside a Window", () => {
    function TestComponent() {
      useWindowMinimized();
      return <div>Test</div>;
    }

    expect(() => {
      render(
        <MockWindowProvider>
          <TestComponent />
        </MockWindowProvider>,
      );
    }).toThrow(/useWindowContext must be used within a Window/);
  });

  it("updates when minimized/restored events fire", async () => {
    let isMinimized = false;

    function WindowContent() {
      isMinimized = useWindowMinimized();
      return <div>Content</div>;
    }

    render(
      <MockWindowProvider>
        <Window open>
          <WindowContent />
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    simulateMockWindowEvent(mockWindows[0].id, { type: "minimized" });
    await waitFor(() => {
      expect(isMinimized).toBe(true);
    });

    simulateMockWindowEvent(mockWindows[0].id, { type: "restored" });
    await waitFor(() => {
      expect(isMinimized).toBe(false);
    });
  });
});

describe("useWindowFullscreen", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("throws when not inside a Window", () => {
    function TestComponent() {
      useWindowFullscreen();
      return <div>Test</div>;
    }

    expect(() => {
      render(
        <MockWindowProvider>
          <TestComponent />
        </MockWindowProvider>,
      );
    }).toThrow(/useWindowContext must be used within a Window/);
  });

  it("updates when enterFullscreen/leaveFullscreen events fire", async () => {
    let isFullscreen = false;

    function WindowContent() {
      isFullscreen = useWindowFullscreen();
      return <div>Content</div>;
    }

    render(
      <MockWindowProvider>
        <Window open>
          <WindowContent />
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    simulateMockWindowEvent(mockWindows[0].id, { type: "enterFullscreen" });
    await waitFor(() => {
      expect(isFullscreen).toBe(true);
    });

    simulateMockWindowEvent(mockWindows[0].id, { type: "leaveFullscreen" });
    await waitFor(() => {
      expect(isFullscreen).toBe(false);
    });
  });
});

describe("useWindowDisplay", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("throws when not inside a Window", () => {
    function TestComponent() {
      useWindowDisplay();
      return <div>Test</div>;
    }

    expect(() => {
      render(
        <MockWindowProvider>
          <TestComponent />
        </MockWindowProvider>,
      );
    }).toThrow(/useWindowContext must be used within a Window/);
  });

  // F2 regression guard: displayInfo was never cleared on teardown. Same
  // <Window> with recreateOnShapeChange — if use A was on an external
  // display, use B's children saw use A's scaleFactor until the first
  // real displayChanged event from use B.
  it("resets to null on recreateOnShapeChange (not previous window's display)", async () => {
    let observedDisplay: ReturnType<typeof useWindowDisplay> | undefined;

    function DisplayProbe() {
      observedDisplay = useWindowDisplay();
      return <div data-testid="display-probe" />;
    }

    function TestApp({ frame }: { frame: boolean }) {
      return (
        <MockWindowProvider>
          <Window open frame={frame} recreateOnShapeChange>
            <DisplayProbe />
          </Window>
        </MockWindowProvider>
      );
    }

    const { rerender } = render(<TestApp frame={true} />);
    await waitFor(() => getMockWindows().length >= 1);

    // Flush effects so subscribeToEvents is live
    await waitFor(() => {
      for (const w of getGlobalMockWindows().values()) {
        if ((w as { document: Document }).document?.querySelector('[data-testid="display-probe"]'))
          return true;
      }
      return false;
    });

    // Push a display for window A (external monitor, scaleFactor 2)
    const displayA = {
      id: 2,
      bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
      workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
      scaleFactor: 2,
    };
    const idA = getMockWindows()[0]!.id;
    await waitFor(() => {
      simulateMockWindowEvent(idA, {
        type: "displayChanged",
        display: displayA,
      });
      return observedDisplay?.scaleFactor === 2;
    });

    // Shape change → recreateOnShapeChange teardown + new window
    rerender(<TestApp frame={false} />);

    // After teardown, displayInfo should be null (not displayA).
    // It stays null until the NEW window gets a real displayChanged event.
    await waitFor(() => {
      return observedDisplay === null;
    });
    expect(observedDisplay).toBeNull();
  });
});

describe("re-render isolation", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("non-subscribing child does not re-render when boundsChanged fires", async () => {
    let renderCount = 0;

    function CountingChild() {
      renderCount++;
      return <div data-testid="child">child</div>;
    }

    render(
      <MockWindowProvider>
        <Window open>
          <CountingChild />
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    const renderCountAfterMount = renderCount;

    // Fire 3 boundsChanged events
    simulateMockWindowEvent(mockWindows[0].id, {
      type: "boundsChanged",
      bounds: { x: 0, y: 0, width: 1000, height: 700 },
    });
    simulateMockWindowEvent(mockWindows[0].id, {
      type: "boundsChanged",
      bounds: { x: 0, y: 0, width: 1100, height: 750 },
    });
    simulateMockWindowEvent(mockWindows[0].id, {
      type: "boundsChanged",
      bounds: { x: 0, y: 0, width: 1200, height: 800 },
    });

    // Give React time to flush any updates
    await new Promise((resolve) => setTimeout(resolve, 50));

    // CountingChild should not have re-rendered at all after mount
    expect(renderCount).toBe(renderCountAfterMount);
  });

  it("useWindowBounds child re-renders exactly once per boundsChanged event", async () => {
    let renderCount = 0;

    function BoundsChild() {
      renderCount++;
      useWindowBounds();
      return <div data-testid="child">child</div>;
    }

    render(
      <MockWindowProvider>
        <Window open>
          <BoundsChild />
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    const renderCountAfterMount = renderCount;

    simulateMockWindowEvent(mockWindows[0].id, {
      type: "boundsChanged",
      bounds: { x: 0, y: 0, width: 1000, height: 700 },
    });
    await waitFor(() => {
      expect(renderCount).toBe(renderCountAfterMount + 1);
    });

    simulateMockWindowEvent(mockWindows[0].id, {
      type: "boundsChanged",
      bounds: { x: 0, y: 0, width: 1100, height: 750 },
    });
    await waitFor(() => {
      expect(renderCount).toBe(renderCountAfterMount + 2);
    });

    simulateMockWindowEvent(mockWindows[0].id, {
      type: "boundsChanged",
      bounds: { x: 0, y: 0, width: 1200, height: 800 },
    });
    await waitFor(() => {
      expect(renderCount).toBe(renderCountAfterMount + 3);
    });
  });
});

// ─── Coverage gaps: hooks that had zero direct tests ───────────────────────

describe("useWindowState", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("returns full state object and updates on events", async () => {
    let state: ReturnType<typeof useWindowState> | undefined;
    function Probe() {
      state = useWindowState();
      return null;
    }

    render(
      <MockWindowProvider>
        <Window open>
          <Probe />
        </Window>
      </MockWindowProvider>,
    );
    await waitFor(() => expect(getGlobalMockWindows().size).toBe(1));
    await waitFor(() => expect(state).not.toBeNull());

    expect(state?.isFocused).toBe(false);
    expect(state?.bounds).toEqual(expect.objectContaining({ width: expect.any(Number) }));

    simulateMockWindowEvent(getMockWindows()[0].id, { type: "focused" });
    await waitFor(() => expect(state?.isFocused).toBe(true));
  });
});

describe("useWindowDocument", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("returns the child window's Document", async () => {
    let doc: Document | null | undefined;
    function Probe() {
      doc = useWindowDocument();
      return null;
    }

    render(
      <MockWindowProvider>
        <Window open>
          <Probe />
        </Window>
      </MockWindowProvider>,
    );
    await waitFor(() => expect(getGlobalMockWindows().size).toBe(1));
    await waitFor(() => expect(doc).toBeInstanceOf(Document));

    // It's the child's document, not the parent test document.
    // In dev mode, doc is a Proxy around the child document (for stale-
    // access detection), so identity comparison fails — but operations on
    // it target the child's DOM.
    expect(doc).not.toBe(document);
    const childWin = [...getGlobalMockWindows().values()][0] as {
      document: Document;
    };
    const el = doc!.createElement("div");
    el.id = "proxy-probe";
    doc!.body.appendChild(el);
    expect(childWin.document.getElementById("proxy-probe")).not.toBeNull();
    expect(document.getElementById("proxy-probe")).toBeNull();
  });
});

describe("useIsInsideWindow", () => {
  // This hook is the non-throwing escape hatch for useWindowContext.
  // Lets components conditionally call the other hooks.

  it("returns false outside a Window", () => {
    let inside: boolean | undefined;
    function Probe() {
      inside = useIsInsideWindow();
      return null;
    }
    render(<Probe />);
    expect(inside).toBe(false);
  });

  it("returns true inside a Window", async () => {
    let inside: boolean | undefined;
    function Probe() {
      inside = useIsInsideWindow();
      return null;
    }

    resetMockWindows();
    resetMockWindowsGlobal();
    render(
      <MockWindowProvider>
        <Window open>
          <Probe />
        </Window>
      </MockWindowProvider>,
    );
    await waitFor(() => expect(inside).toBe(true));
  });
});

describe("MockWindow (testing export)", () => {
  // Dogfood the consumer-facing test helper — if its context shape drifts
  // from what real hooks expect, consumers' tests break but ours wouldn't.

  it("provides WindowContext such that hooks read the given state", () => {
    let focused: boolean | undefined;
    let bounds: ReturnType<typeof useWindowBounds> | undefined;
    function Probe() {
      focused = useWindowFocused();
      bounds = useWindowBounds();
      return null;
    }

    render(
      <MockWindow
        state={{
          isFocused: true,
          bounds: { x: 5, y: 10, width: 500, height: 400 },
        }}
      >
        <Probe />
      </MockWindow>,
    );

    expect(focused).toBe(true);
    expect(bounds).toEqual({ x: 5, y: 10, width: 500, height: 400 });
  });

  it("useIsInsideWindow returns true inside MockWindow", () => {
    let inside: boolean | undefined;
    function Probe() {
      inside = useIsInsideWindow();
      return null;
    }
    render(
      <MockWindow>
        <Probe />
      </MockWindow>,
    );
    expect(inside).toBe(true);
  });
});

describe("clearPersistedBounds / clearAllPersistedBounds", () => {
  const PREFIX = "electron-window:bounds:";

  beforeEach(() => {
    localStorage.clear();
  });

  it("clearPersistedBounds removes one key", () => {
    localStorage.setItem(
      `${PREFIX}settings`,
      JSON.stringify({ x: 0, y: 0, width: 800, height: 600 }),
    );
    localStorage.setItem(
      `${PREFIX}editor`,
      JSON.stringify({ x: 0, y: 0, width: 900, height: 700 }),
    );

    clearPersistedBounds("settings");

    expect(localStorage.getItem(`${PREFIX}settings`)).toBeNull();
    expect(localStorage.getItem(`${PREFIX}editor`)).not.toBeNull();
  });

  it("clearAllPersistedBounds removes every prefixed key, leaves others", () => {
    localStorage.setItem(`${PREFIX}a`, "{}");
    localStorage.setItem(`${PREFIX}b`, "{}");
    localStorage.setItem(`${PREFIX}c`, "{}");
    localStorage.setItem("unrelated-app-setting", "keep-me");

    clearAllPersistedBounds();

    expect(localStorage.getItem(`${PREFIX}a`)).toBeNull();
    expect(localStorage.getItem(`${PREFIX}b`)).toBeNull();
    expect(localStorage.getItem(`${PREFIX}c`)).toBeNull();
    expect(localStorage.getItem("unrelated-app-setting")).toBe("keep-me");
  });
});

describe("useWindowSignal", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("throws when signal is null (window not yet open)", () => {
    // MockWindow provides the context but signal: null — simulates the
    // window-mounting-but-not-ready case. useWindowContext passes (we're
    // inside a context) but useWindowSignal's own guard fires.
    function Probe() {
      useWindowSignal();
      return null;
    }
    expect(() =>
      render(
        <MockWindowProvider>
          <MockWindow id="test">
            <Probe />
          </MockWindow>
        </MockWindowProvider>,
      ),
    ).toThrow(/useWindowSignal must be called inside an open/);
  });

  it("returns an AbortSignal that aborts when the window closes", async () => {
    let signal: AbortSignal | undefined;
    const onAbort = vi.fn();

    function Probe() {
      signal = useWindowSignal();
      React.useEffect(() => {
        signal?.addEventListener("abort", onAbort);
      }, [signal]);
      return null;
    }

    function App() {
      const [open, setOpen] = useState(true);
      return (
        <MockWindowProvider>
          <button onClick={() => setOpen(false)}>close</button>
          <Window open={open}>
            <Probe />
          </Window>
        </MockWindowProvider>
      );
    }

    render(<App />);
    await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
    expect(signal!.aborted).toBe(false);
    expect(onAbort).not.toHaveBeenCalled();

    fireEvent.click(document.querySelector("button")!);

    // Signal aborts synchronously in resetComponentState on open→false
    expect(signal!.aborted).toBe(true);
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it("provides a fresh signal on each open cycle", async () => {
    // The signal is per-open-cycle, not per-component-instance. A
    // toggle should give a NEW unaborted signal.
    const signals: AbortSignal[] = [];

    function Probe() {
      const s = useWindowSignal();
      React.useEffect(() => {
        signals.push(s);
      }, [s]);
      return null;
    }

    function App() {
      const [open, setOpen] = useState(true);
      return (
        <MockWindowProvider>
          <button data-testid="toggle" onClick={() => setOpen((o) => !o)} />
          <Window open={open}>
            <Probe />
          </Window>
        </MockWindowProvider>
      );
    }

    render(<App />);
    await waitFor(() => expect(signals).toHaveLength(1));
    const first = signals[0];

    fireEvent.click(document.querySelector('[data-testid="toggle"]')!);
    expect(first.aborted).toBe(true);

    fireEvent.click(document.querySelector('[data-testid="toggle"]')!);
    await waitFor(() => expect(signals.length).toBeGreaterThanOrEqual(2));

    const second = signals[signals.length - 1];
    expect(second).not.toBe(first);
    expect(second.aborted).toBe(false);
  });
});

describe("useWindowEventListener", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("attaches to the child document and fires on events", async () => {
    const handler = vi.fn();

    function Probe() {
      useWindowEventListener("keydown", handler);
      return null;
    }

    render(
      <MockWindowProvider>
        <Window open>
          <Probe />
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => expect(getGlobalMockWindows().size).toBe(1));
    // Wait for the effect to attach
    await waitFor(() => {
      const childDoc = ([...getGlobalMockWindows().values()][0] as { document: Document }).document;
      act(() => childDoc.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })));
      expect(handler).toHaveBeenCalled();
    });
  });

  it("removes listener when the window closes (via AbortSignal)", async () => {
    const handler = vi.fn();
    let childDoc: Document | undefined;

    function Probe() {
      useWindowEventListener("click", handler);
      childDoc = useWindowDocument();
      return null;
    }

    function App() {
      const [open, setOpen] = useState(true);
      return (
        <MockWindowProvider>
          <button data-testid="close" onClick={() => setOpen(false)} />
          <Window open={open}>
            <Probe />
          </Window>
        </MockWindowProvider>
      );
    }

    render(<App />);
    await waitFor(() => expect(childDoc).toBeInstanceOf(Document));

    const doc = childDoc!;
    act(() => doc.dispatchEvent(new MouseEvent("click")));
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

    fireEvent.click(document.querySelector('[data-testid="close"]')!);

    // After close, events on the (now-stale) doc don't fire the handler —
    // the AbortSignal removed the listener.
    handler.mockClear();
    act(() => doc.dispatchEvent(new MouseEvent("click")));
    expect(handler).not.toHaveBeenCalled();
  });

  it("reads handler through a ref — inline arrows don't re-subscribe", async () => {
    // If the hook put `handler` in the effect deps, every render with an
    // inline arrow would remove+re-add the listener. The ref pattern means
    // the wrapped listener persists and reads the latest handler.
    let childDoc: Document | undefined;
    let received: string | undefined;

    function Probe({ suffix }: { suffix: string }) {
      childDoc = useWindowDocument();
      useWindowEventListener("keydown", (e) => {
        received = e.key + suffix;
      });
      return null;
    }

    const { rerender } = render(
      <MockWindowProvider>
        <Window open>
          <Probe suffix="-first" />
        </Window>
      </MockWindowProvider>,
    );
    await waitFor(() => expect(childDoc).toBeInstanceOf(Document));
    const doc = childDoc!;
    const addSpy = vi.spyOn(doc, "addEventListener");

    // Re-render with a NEW inline arrow — handler identity changes.
    rerender(
      <MockWindowProvider>
        <Window open>
          <Probe suffix="-second" />
        </Window>
      </MockWindowProvider>,
    );

    // No re-subscription on the child document.
    expect(addSpy).not.toHaveBeenCalled();

    // The latest handler runs (reads "-second", not "-first").
    act(() => doc.dispatchEvent(new KeyboardEvent("keydown", { key: "x" })));
    await waitFor(() => expect(received).toBe("x-second"));
  });
});
