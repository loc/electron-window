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
import { resetMockWindowsGlobal } from "../setup.js";

// Get mock windows from global mock
function getGlobalMockWindows(): Map<string, unknown> {
  return (
    (globalThis as unknown as Record<string, Map<string, unknown>>)
      .__mockWindows__ ?? new Map()
  );
}

describe("<Window> state events", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("calls onReady when window is ready", async () => {
    const onReady = vi.fn();

    render(
      <MockWindowProvider>
        <Window open onReady={onReady}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    await waitFor(() => {
      expect(onReady).toHaveBeenCalled();
    });
  });

  it("calls onUserClose when user closes window", async () => {
    const onUserClose = vi.fn();

    render(
      <MockWindowProvider>
        <Window open onUserClose={onUserClose}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Simulate user close via IPC event (the real path in Electron)
    const mockWindows = getMockWindows();
    simulateMockWindowEvent(mockWindows[0].id, { type: "userCloseRequested" });

    await waitFor(() => {
      expect(onUserClose).toHaveBeenCalled();
    });
  });

  it("calls onMaximize when maximized event fires", async () => {
    const onMaximize = vi.fn();

    render(
      <MockWindowProvider>
        <Window open onMaximize={onMaximize}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => expect(getMockWindows().length).toBe(1));

    simulateMockWindowEvent(getMockWindows()[0].id, { type: "maximized" });

    await waitFor(() => expect(onMaximize).toHaveBeenCalledOnce());
  });

  it("calls onUnmaximize when unmaximized event fires", async () => {
    const onUnmaximize = vi.fn();

    render(
      <MockWindowProvider>
        <Window open onUnmaximize={onUnmaximize}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => expect(getMockWindows().length).toBe(1));

    simulateMockWindowEvent(getMockWindows()[0].id, { type: "unmaximized" });

    await waitFor(() => expect(onUnmaximize).toHaveBeenCalledOnce());
  });

  it("calls onMinimize when minimized event fires", async () => {
    const onMinimize = vi.fn();

    render(
      <MockWindowProvider>
        <Window open onMinimize={onMinimize}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => expect(getMockWindows().length).toBe(1));

    simulateMockWindowEvent(getMockWindows()[0].id, { type: "minimized" });

    await waitFor(() => expect(onMinimize).toHaveBeenCalledOnce());
  });

  it("calls onRestore when restored event fires", async () => {
    const onRestore = vi.fn();

    render(
      <MockWindowProvider>
        <Window open onRestore={onRestore}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => expect(getMockWindows().length).toBe(1));

    simulateMockWindowEvent(getMockWindows()[0].id, { type: "restored" });

    await waitFor(() => expect(onRestore).toHaveBeenCalledOnce());
  });

  it("calls onEnterFullscreen when enterFullscreen event fires", async () => {
    const onEnterFullscreen = vi.fn();

    render(
      <MockWindowProvider>
        <Window open onEnterFullscreen={onEnterFullscreen}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => expect(getMockWindows().length).toBe(1));

    simulateMockWindowEvent(getMockWindows()[0].id, {
      type: "enterFullscreen",
    });

    await waitFor(() => expect(onEnterFullscreen).toHaveBeenCalledOnce());
  });

  it("calls onExitFullscreen when leaveFullscreen event fires", async () => {
    const onExitFullscreen = vi.fn();

    render(
      <MockWindowProvider>
        <Window open onExitFullscreen={onExitFullscreen}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => expect(getMockWindows().length).toBe(1));

    simulateMockWindowEvent(getMockWindows()[0].id, {
      type: "leaveFullscreen",
    });

    await waitFor(() => expect(onExitFullscreen).toHaveBeenCalledOnce());
  });

  it("calls onDisplayChange with display info when displayChanged event fires", async () => {
    const onDisplayChange = vi.fn();
    const display = {
      id: 1,
      bounds: { x: 0, y: 0, width: 2560, height: 1440 },
      workArea: { x: 0, y: 25, width: 2560, height: 1415 },
      scaleFactor: 2,
    };

    render(
      <MockWindowProvider>
        <Window open onDisplayChange={onDisplayChange}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => expect(getMockWindows().length).toBe(1));

    // SimulatedEvent doesn't include displayChanged yet, but the listener
    // receives the raw event object so we can dispatch it directly.
    simulateMockWindowEvent(getMockWindows()[0].id, {
      type: "displayChanged",
      display,
    } as Parameters<typeof simulateMockWindowEvent>[1]);

    await waitFor(() => {
      expect(onDisplayChange).toHaveBeenCalledOnce();
      expect(onDisplayChange).toHaveBeenCalledWith(display);
    });
  });
});

describe("<Window> closable prop", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("creates window with closable=true by default", async () => {
    render(
      <MockWindowProvider>
        <Window open>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getMockWindows().length).toBe(1);
    });

    // closable defaults to true — it should not be explicitly set to false
    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.closable).not.toBe(false);
  });

  it("creates window with closable=false", async () => {
    render(
      <MockWindowProvider>
        <Window open closable={false}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.closable).toBe(false);
  });

  it("can change closable prop dynamically", async () => {
    function TestWithClosable() {
      const [closable, setClosable] = useState(true);
      return (
        <MockWindowProvider>
          <button onClick={() => setClosable(false)}>Disable Close</button>
          <Window open closable={closable}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithClosable />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Initial with closable=true
    expect(getMockWindows()[0].props.closable).toBe(true);

    // Change to closable=false
    fireEvent.click(screen.getByText("Disable Close"));

    // The prop update flows through provider.updateWindow, which patches mockStore
    await waitFor(() => {
      expect(getMockWindows()[0].props.closable).toBe(false);
    });
  });
});

describe("<Window> focus/blur", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("focused event sets isFocused state on mock window", async () => {
    render(
      <MockWindowProvider>
        <Window open>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => expect(getMockWindows().length).toBe(1));
    expect(getMockWindows()[0].state.isFocused).toBe(false);

    simulateMockWindowEvent(getMockWindows()[0].id, { type: "focused" });

    await waitFor(() => expect(getMockWindows()[0].state.isFocused).toBe(true));
  });

  it("blurred event clears isFocused state on mock window", async () => {
    render(
      <MockWindowProvider>
        <Window open>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => expect(getMockWindows().length).toBe(1));

    // First focus, then blur
    simulateMockWindowEvent(getMockWindows()[0].id, { type: "focused" });
    await waitFor(() => expect(getMockWindows()[0].state.isFocused).toBe(true));

    simulateMockWindowEvent(getMockWindows()[0].id, { type: "blurred" });
    await waitFor(() =>
      expect(getMockWindows()[0].state.isFocused).toBe(false),
    );
  });
});

describe("<Window> showInactive", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("passes showInactive prop through to mock window", async () => {
    render(
      <MockWindowProvider>
        <Window open showInactive>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => expect(getMockWindows().length).toBe(1));

    expect(getMockWindows()[0].props.showInactive).toBe(true);
  });
});
