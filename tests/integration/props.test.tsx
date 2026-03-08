import { describe, it, expect, beforeEach, vi } from "vitest";
import React, { useState } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Window } from "../../src/renderer/Window.js";
import { MockWindowProvider, resetMockWindows, getMockWindows } from "../../src/testing/index.js";
import { resetMockWindowsGlobal, getGlobalMockWindows } from "../setup.js";

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
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

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
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

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
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringMatching(/frame.*creation-only/));
    });

    consoleWarnSpy.mockRestore();
  });

  it("warns when titleBarStyle changes without recreateOnShapeChange", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

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

  it("normalizes alwaysOnTop string levels to {alwaysOnTop: true, alwaysOnTopLevel}", async () => {
    // The IPC schema validates alwaysOnTop as boolean. String z-levels
    // ("floating", "screen-saver", etc.) must be split into two fields by
    // the renderer before sending — otherwise the IPC layer rejects it.
    render(
      <MockWindowProvider>
        <Window open alwaysOnTop="screen-saver">
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => expect(getGlobalMockWindows().size).toBe(1));

    const props = getMockWindows()[0].props;
    expect(props.alwaysOnTop).toBe(true);
    expect(props.alwaysOnTopLevel).toBe("screen-saver");
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
    expect(window.open).toHaveBeenCalledWith("about:blank", expect.stringMatching(/^win_/), "");
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
    expect(window.open).toHaveBeenCalledWith("about:blank", expect.stringMatching(/^win_/), "");
  });
});

describe("<Window> injectStyles prop", () => {
  let testStyle: HTMLStyleElement;
  let testLink: HTMLLinkElement;

  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();

    // Add a <style> and <link rel="stylesheet"> to the parent document
    // so we can verify they get cloned into the child window
    testStyle = document.createElement("style");
    testStyle.textContent = ".test-class { color: red; }";
    testStyle.setAttribute("data-test", "injected-style");
    document.head.appendChild(testStyle);

    testLink = document.createElement("link");
    testLink.rel = "stylesheet";
    testLink.href = "https://example.com/test.css";
    testLink.setAttribute("data-test", "injected-link");
    document.head.appendChild(testLink);
  });

  afterEach(() => {
    testStyle.remove();
    testLink.remove();
  });

  it("auto mode clones parent stylesheets into child window", async () => {
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

    const mockWin = [...getGlobalMockWindows().values()][0] as {
      document: Document;
    };

    // The <style> tag should be cloned into the child
    const clonedStyle = mockWin.document.querySelector('style[data-test="injected-style"]');
    expect(clonedStyle).not.toBeNull();
    expect(clonedStyle?.textContent).toBe(".test-class { color: red; }");

    // The <link> tag should be cloned into the child
    const clonedLink = mockWin.document.querySelector(
      'link[data-test="injected-link"]',
    ) as HTMLLinkElement | null;
    expect(clonedLink).not.toBeNull();
    expect(clonedLink?.href).toBe("https://example.com/test.css");
  });

  it("injectStyles=false does not copy stylesheets", async () => {
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

    const mockWin = [...getGlobalMockWindows().values()][0] as {
      document: Document;
    };

    // No styles should be cloned
    expect(mockWin.document.querySelector('style[data-test="injected-style"]')).toBeNull();
    expect(mockWin.document.querySelector('link[data-test="injected-link"]')).toBeNull();
  });

  it("custom injectStyles function receives the child document", async () => {
    const customInject = vi.fn((doc: Document) => {
      const el = doc.createElement("style");
      el.textContent = ".custom { color: blue; }";
      el.setAttribute("data-test", "custom-style");
      doc.head.appendChild(el);
    });

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

    // Custom function should have been called with the child document
    expect(customInject).toHaveBeenCalledTimes(1);
    const calledWithDoc = customInject.mock.calls[0][0];
    expect(calledWithDoc).toBeInstanceOf(Document);

    // Verify the custom function's work is visible in the child document
    const mockWin = [...getGlobalMockWindows().values()][0] as {
      document: Document;
    };
    const customStyle = mockWin.document.querySelector('style[data-test="custom-style"]');
    expect(customStyle).not.toBeNull();
    expect(customStyle?.textContent).toBe(".custom { color: blue; }");

    // Auto-injection should NOT have run (custom replaces auto)
    expect(mockWin.document.querySelector('style[data-test="injected-style"]')).toBeNull();
  });

  it("auto mode syncs dynamically added styles to child window", async () => {
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

    const mockWin = [...getGlobalMockWindows().values()][0] as {
      document: Document;
    };

    // Dynamically add a new style to the parent AFTER the window opened
    const dynamicStyle = document.createElement("style");
    dynamicStyle.textContent = ".dynamic { color: green; }";
    dynamicStyle.setAttribute("data-test", "dynamic-style");
    document.head.appendChild(dynamicStyle);

    // MutationObserver is async — wait for it to fire
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The dynamic style should be cloned into the child
    const cloned = mockWin.document.querySelector('style[data-test="dynamic-style"]');
    expect(cloned).not.toBeNull();
    expect(cloned?.textContent).toBe(".dynamic { color: green; }");

    // Cleanup
    dynamicStyle.remove();
  });

  it("auto mode removes styles from child when removed from parent", async () => {
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

    const mockWin = [...getGlobalMockWindows().values()][0] as {
      document: Document;
    };

    // The testStyle from beforeEach should be in the child
    expect(mockWin.document.querySelector('style[data-test="injected-style"]')).not.toBeNull();

    // Remove it from the parent
    testStyle.remove();

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should be removed from the child too
    expect(mockWin.document.querySelector('style[data-test="injected-style"]')).toBeNull();

    // Re-add for afterEach cleanup (it expects testStyle to be in DOM)
    testStyle = document.createElement("style");
    testStyle.textContent = ".test-class { color: red; }";
    testStyle.setAttribute("data-test", "injected-style");
    document.head.appendChild(testStyle);
  });

  it("auto mode syncs modified style textContent to child window", async () => {
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

    const mockWin = [...getGlobalMockWindows().values()][0] as {
      document: Document;
    };

    // The testStyle from beforeEach should be cloned in the child
    const clonedBefore = mockWin.document.querySelector('style[data-test="injected-style"]');
    expect(clonedBefore?.textContent).toBe(".test-class { color: red; }");

    // Modify the parent style's textContent
    testStyle.textContent = ".test-class { color: blue; font-size: 16px; }";

    // Wait for MutationObserver
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The child clone should have the updated content
    const clonedAfter = mockWin.document.querySelector('style[data-test="injected-style"]');
    expect(clonedAfter?.textContent).toBe(".test-class { color: blue; font-size: 16px; }");
  });
});
