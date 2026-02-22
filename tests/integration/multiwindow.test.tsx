import { describe, it, expect, beforeEach, vi } from "vitest";
import React, { useState } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Window } from "../../src/renderer/Window.js";
import {
  MockWindowProvider,
  resetMockWindows,
  getMockWindows,
  getMockWindowByName,
  simulateMockWindowEvent,
} from "../../src/testing/index.js";
import { resetMockWindowsGlobal } from "../setup.js";

// Get mock windows from global mock
function getGlobalMockWindows(): Map<string, unknown> {
  return (
    (globalThis as unknown as Record<string, Map<string, unknown>>)
      .__mockWindows__ ?? new Map()
  );
}

describe("Multiple windows", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("can open multiple windows simultaneously", async () => {
    render(
      <MockWindowProvider>
        <Window open name="window-a" title="Window A">
          <div>Content A</div>
        </Window>
        <Window open name="window-b" title="Window B">
          <div>Content B</div>
        </Window>
        <Window open name="window-c" title="Window C">
          <div>Content C</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(3);
    });
  });

  it("each window has unique ID", async () => {
    render(
      <MockWindowProvider>
        <Window open title="Window A">
          <div>Content A</div>
        </Window>
        <Window open title="Window B">
          <div>Content B</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(2);
    });

    const ids = [...getGlobalMockWindows().keys()];
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("can open and close windows independently", async () => {
    function TestApp() {
      const [showA, setShowA] = useState(true);
      const [showB, setShowB] = useState(true);

      return (
        <MockWindowProvider>
          <button onClick={() => setShowA(!showA)}>Toggle A</button>
          <button onClick={() => setShowB(!showB)}>Toggle B</button>
          <Window open={showA} name="window-a">
            <div>Content A</div>
          </Window>
          <Window open={showB} name="window-b">
            <div>Content B</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    // Both open initially
    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(2);
    });

    // Close A
    fireEvent.click(screen.getByText("Toggle A"));
    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Close B
    fireEvent.click(screen.getByText("Toggle B"));
    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(0);
    });

    // Reopen A
    fireEvent.click(screen.getByText("Toggle A"));
    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });
  });

  it("windows can have different configurations", async () => {
    render(
      <MockWindowProvider>
        <Window
          open
          defaultWidth={800}
          defaultHeight={600}
          title="Large Window"
        >
          <div>Large</div>
        </Window>
        <Window
          open
          defaultWidth={300}
          defaultHeight={200}
          title="Small Window"
        >
          <div>Small</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(2);
    });

    const mockWindows = getMockWindows();
    const sizes = mockWindows.map((w) => w.props.defaultWidth);
    expect(sizes).toContain(800);
    expect(sizes).toContain(300);
  });

  it("each window gets independent onUserClose", async () => {
    const onCloseA = vi.fn();
    const onCloseB = vi.fn();

    render(
      <MockWindowProvider>
        <Window open name="window-a" onUserClose={onCloseA}>
          <div>Content A</div>
        </Window>
        <Window open name="window-b" onUserClose={onCloseB}>
          <div>Content B</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(2);
    });

    // Simulate user close via IPC event (the real path in Electron)
    const windowA = getMockWindowByName("window-a");
    if (windowA) {
      simulateMockWindowEvent(windowA.id, { type: "userCloseRequested" });
    }

    await waitFor(() => {
      expect(onCloseA).toHaveBeenCalled();
      expect(onCloseB).not.toHaveBeenCalled();
    });
  });
});

describe("Window ref", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("exposes window methods via ref", async () => {
    const ref =
      React.createRef<import("../../src/shared/types.js").WindowHandle>();

    render(
      <MockWindowProvider>
        <Window ref={ref} open>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    await waitFor(() => {
      expect(ref.current).not.toBeNull();
    });

    expect(ref.current?.id).toBeDefined();
    expect(typeof ref.current?.focus).toBe("function");
    expect(typeof ref.current?.blur).toBe("function");
    expect(typeof ref.current?.minimize).toBe("function");
    expect(typeof ref.current?.maximize).toBe("function");
    expect(typeof ref.current?.close).toBe("function");
    expect(ref.current?.bounds).toBeDefined();
  });

  it("ref methods are callable", async () => {
    const ref = React.createRef<{
      focus: () => void;
      blur: () => void;
    }>();

    render(
      <MockWindowProvider>
        <Window ref={ref} open>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(ref.current).not.toBeNull();
    });

    // Methods should not throw
    expect(() => ref.current?.focus()).not.toThrow();
    expect(() => ref.current?.blur()).not.toThrow();
  });
});
