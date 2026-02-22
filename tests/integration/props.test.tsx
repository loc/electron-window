import { describe, it, expect, beforeEach, vi } from "vitest";
import React, { useState } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Window } from "../../src/renderer/Window.js";
import {
  MockWindowProvider,
  resetMockWindows,
  getMockWindows,
} from "../../src/testing/index.js";
import { resetMockWindowsGlobal } from "../setup.js";

// Get mock windows from global mock
function getGlobalMockWindows(): Map<string, unknown> {
  return (
    (globalThis as unknown as Record<string, Map<string, unknown>>)
      .__mockWindows__ ?? new Map()
  );
}

describe("<Window> creation-only props", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("applies transparent prop on creation", async () => {
    render(
      <MockWindowProvider>
        <Window open transparent>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.transparent).toBe(true);
  });

  it("applies frame prop on creation", async () => {
    render(
      <MockWindowProvider>
        <Window open frame={false}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.frame).toBe(false);
  });

  it("applies titleBarStyle prop on creation", async () => {
    render(
      <MockWindowProvider>
        <Window open titleBarStyle="hidden">
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.titleBarStyle).toBe("hidden");
  });

  it("applies vibrancy prop on creation", async () => {
    render(
      <MockWindowProvider>
        <Window open vibrancy="sidebar">
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.vibrancy).toBe("sidebar");
  });

  it("warns when transparent changes without recreateOnShapeChange", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    function TestWithTransparent() {
      const [transparent, setTransparent] = useState(false);
      return (
        <MockWindowProvider>
          <button onClick={() => setTransparent(true)}>Toggle</button>
          <Window open transparent={transparent}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithTransparent />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    fireEvent.click(screen.getByText("Toggle"));

    await waitFor(() => {
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/transparent.*creation-only/),
      );
    });

    consoleWarnSpy.mockRestore();
  });

  it("warns when frame changes without recreateOnShapeChange", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    function TestWithFrame() {
      const [frame, setFrame] = useState(true);
      return (
        <MockWindowProvider>
          <button onClick={() => setFrame(false)}>Toggle</button>
          <Window open frame={frame}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithFrame />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    fireEvent.click(screen.getByText("Toggle"));

    await waitFor(() => {
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/frame.*creation-only/),
      );
    });

    consoleWarnSpy.mockRestore();
  });

  it("warns when titleBarStyle changes without recreateOnShapeChange", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    function TestWithTitleBarStyle() {
      const [style, setStyle] = useState<"default" | "hidden">("default");
      return (
        <MockWindowProvider>
          <button onClick={() => setStyle("hidden")}>Toggle</button>
          <Window open titleBarStyle={style}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithTitleBarStyle />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    fireEvent.click(screen.getByText("Toggle"));

    await waitFor(() => {
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/titleBarStyle.*creation-only/),
      );
    });

    consoleWarnSpy.mockRestore();
  });
});

describe("<Window> changeable props", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("applies resizable prop", async () => {
    render(
      <MockWindowProvider>
        <Window open resizable={false}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.resizable).toBe(false);
  });

  it("applies movable prop", async () => {
    render(
      <MockWindowProvider>
        <Window open movable={false}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.movable).toBe(false);
  });

  it("applies minimizable prop", async () => {
    render(
      <MockWindowProvider>
        <Window open minimizable={false}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.minimizable).toBe(false);
  });

  it("applies maximizable prop", async () => {
    render(
      <MockWindowProvider>
        <Window open maximizable={false}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.maximizable).toBe(false);
  });

  it("applies focusable prop", async () => {
    render(
      <MockWindowProvider>
        <Window open focusable={false}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.focusable).toBe(false);
  });

  it("applies alwaysOnTop prop", async () => {
    render(
      <MockWindowProvider>
        <Window open alwaysOnTop>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.alwaysOnTop).toBe(true);
  });

  it("applies skipTaskbar prop", async () => {
    render(
      <MockWindowProvider>
        <Window open skipTaskbar>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.skipTaskbar).toBe(true);
  });

  it("applies fullscreenable prop", async () => {
    render(
      <MockWindowProvider>
        <Window open fullscreenable={false}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.fullscreenable).toBe(false);
  });

  it("applies backgroundColor prop", async () => {
    render(
      <MockWindowProvider>
        <Window open backgroundColor="#ff0000">
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.backgroundColor).toBe("#ff0000");
  });
});

describe("<Window> name prop", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("uses name prop as window name", async () => {
    render(
      <MockWindowProvider>
        <Window open name="settings-window">
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // windowId (win_xxx) is used as second arg; name prop is sent via IPC
    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.name).toBe("settings-window");
    expect(window.open).toHaveBeenCalledWith(
      "about:blank",
      expect.stringMatching(/^win_/),
      "",
    );
  });

  it("generates unique name when name prop is not provided", async () => {
    render(
      <MockWindowProvider>
        <Window open>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Should use generated window ID with empty features string
    expect(window.open).toHaveBeenCalledWith(
      "about:blank",
      expect.stringMatching(/^win_/),
      "",
    );
  });
});

describe("<Window> injectStyles prop", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("creates window with default style injection without error", async () => {
    // Style injection ("auto") clones stylesheets from the parent document.
    // In jsdom there are no stylesheets to clone, so we can only verify that
    // the window is created successfully without throwing.
    render(
      <MockWindowProvider>
        <Window open>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });
  });

  it("creates window with injectStyles=false without error", async () => {
    // injectStyles=false skips all stylesheet cloning. Verify the window
    // still opens successfully when style injection is disabled.
    render(
      <MockWindowProvider>
        <Window open injectStyles={false}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });
  });

  it("accepts custom injectStyles function", async () => {
    const customInject = vi.fn();

    render(
      <MockWindowProvider>
        <Window open injectStyles={customInject}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Custom function should be called with the document
    await waitFor(() => {
      expect(customInject).toHaveBeenCalledWith(expect.any(Object));
    });
  });
});
