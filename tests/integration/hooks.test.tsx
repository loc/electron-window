import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, waitFor } from "@testing-library/react";
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
} from "../../src/renderer/hooks/index.js";
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
});
