import { describe, it, expect, beforeEach, vi } from "vitest";
import React, { useState } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Window } from "../../src/renderer/Window.js";
import {
  MockWindowProvider,
  resetMockWindows,
  getMockWindows,
  simulateMockWindowEvent,
} from "../../src/testing/index.js";
import type { Bounds } from "../../src/shared/types.js";
import { resetMockWindowsGlobal, getGlobalMockWindows } from "../setup.js";

describe("<Window> default bounds (uncontrolled)", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("applies defaultWidth/defaultHeight on creation", async () => {
    render(
      <MockWindowProvider>
        <Window open defaultWidth={400} defaultHeight={300}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.defaultWidth).toBe(400);
    expect(mockWindows[0].props.defaultHeight).toBe(300);
  });

  it("applies defaultX/defaultY on creation", async () => {
    render(
      <MockWindowProvider>
        <Window
          open
          defaultX={50}
          defaultY={100}
          defaultWidth={400}
          defaultHeight={300}
        >
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.defaultX).toBe(50);
    expect(mockWindows[0].props.defaultY).toBe(100);
  });

  it("does not re-apply default bounds when props change", async () => {
    function TestWithChangingDefaults() {
      const [size, setSize] = useState(400);
      return (
        <MockWindowProvider>
          <button onClick={() => setSize(600)}>Change Size</button>
          <Window open defaultWidth={size} defaultHeight={300}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithChangingDefaults />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Initial creation with 400
    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.defaultWidth).toBe(400);

    // Clear and change
    (window.open as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(screen.getByText("Change Size"));

    // Wait a bit for any potential re-creation
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Window should NOT be recreated (default bounds don't trigger recreation)
    expect(window.open).not.toHaveBeenCalled();
  });
});

describe("<Window> controlled bounds", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("warns when using controlled bounds without onBoundsChange", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    render(
      <MockWindowProvider>
        <Window open width={800} height={600}>
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

  it("does not warn when using controlled bounds with onBoundsChange", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    const onBoundsChange = vi.fn();

    render(
      <MockWindowProvider>
        <Window open width={800} height={600} onBoundsChange={onBoundsChange}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Should not warn about controlled bounds
    const controlledBoundsWarning = consoleWarnSpy.mock.calls.find((call) =>
      call[0]?.includes?.("controlled bounds"),
    );
    expect(controlledBoundsWarning).toBeUndefined();

    consoleWarnSpy.mockRestore();
  });

  it("warns when using controlled bounds with persistBounds but no onBoundsChange", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    render(
      <MockWindowProvider>
        <Window open width={800} height={600} persistBounds="test">
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // persistBounds no longer acts as onBoundsChange — the warning fires
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/controlled bounds.*onBoundsChange/i),
    );

    consoleWarnSpy.mockRestore();
  });

  it("updates window size when controlled width/height change", async () => {
    function TestWithControlledSize() {
      const [width, setWidth] = useState(400);
      const onBoundsChange = vi.fn();

      return (
        <MockWindowProvider>
          <button onClick={() => setWidth(600)}>Resize</button>
          <Window
            open
            width={width}
            height={300}
            onBoundsChange={onBoundsChange}
          >
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithControlledSize />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Change the controlled width
    fireEvent.click(screen.getByText("Resize"));

    // Window should be resized via provider.updateWindow
    await waitFor(() => {
      const mockWindows = getMockWindows();
      expect(mockWindows[0].props.width).toBe(600);
    });
  });

  it("updates window position when controlled x/y change", async () => {
    function TestWithControlledPosition() {
      const [x, setX] = useState(100);
      const onBoundsChange = vi.fn();

      return (
        <MockWindowProvider>
          <button onClick={() => setX(200)}>Move</button>
          <Window
            open
            x={x}
            y={50}
            defaultWidth={400}
            defaultHeight={300}
            onBoundsChange={onBoundsChange}
          >
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithControlledPosition />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Change the controlled x
    fireEvent.click(screen.getByText("Move"));

    // Window should be moved via provider.updateWindow
    await waitFor(() => {
      const mockWindows = getMockWindows();
      expect(mockWindows[0].props.x).toBe(200);
    });
  });
});

describe("<Window> bounds constraints", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("applies minWidth/minHeight constraints", async () => {
    render(
      <MockWindowProvider>
        <Window
          open
          defaultWidth={800}
          defaultHeight={600}
          minWidth={400}
          minHeight={300}
        >
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.minWidth).toBe(400);
    expect(mockWindows[0].props.minHeight).toBe(300);
  });

  it("applies maxWidth/maxHeight constraints", async () => {
    render(
      <MockWindowProvider>
        <Window
          open
          defaultWidth={800}
          defaultHeight={600}
          maxWidth={1200}
          maxHeight={900}
        >
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.maxWidth).toBe(1200);
    expect(mockWindows[0].props.maxHeight).toBe(900);
  });
});

describe("<Window> onBoundsChange", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("calls onBoundsChange when boundsChanged event fires", async () => {
    const onBoundsChange = vi.fn();

    render(
      <MockWindowProvider>
        <Window
          open
          defaultWidth={400}
          defaultHeight={300}
          onBoundsChange={onBoundsChange}
        >
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Simulate a boundsChanged event from the main process via the mock provider
    const mockWindows = getMockWindows();
    const { simulateMockWindowEvent } =
      await import("../../src/testing/index.js");
    simulateMockWindowEvent(mockWindows[0].id, {
      type: "boundsChanged",
      bounds: { x: 0, y: 0, width: 500, height: 400 },
    });

    // onBoundsChange should have been called (debounced)
    await waitFor(() => {
      expect(onBoundsChange).toHaveBeenCalled();
    });
  });

  it("debounces onBoundsChange calls", async () => {
    const onBoundsChange = vi.fn();

    render(
      <MockWindowProvider>
        <Window
          open
          defaultWidth={400}
          defaultHeight={300}
          onBoundsChange={onBoundsChange}
        >
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();

    // Fire multiple boundsChanged events rapidly
    for (let i = 0; i < 10; i++) {
      simulateMockWindowEvent(mockWindows[0].id, {
        type: "boundsChanged",
        bounds: { x: 0, y: 0, width: 400 + i * 10, height: 300 },
      });
    }

    // Wait for debounce to settle (debounce is 100ms in Window.tsx)
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Should have been called, but fewer than 10 times due to debouncing
    expect(onBoundsChange).toHaveBeenCalled();
    expect(onBoundsChange.mock.calls.length).toBeLessThan(10);
    // The last call should have the final bounds
    const lastCall =
      onBoundsChange.mock.calls[onBoundsChange.mock.calls.length - 1];
    expect(lastCall[0].width).toBe(490); // 400 + 9*10
  });
});
