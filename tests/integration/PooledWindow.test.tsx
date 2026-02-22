import { describe, it, expect, beforeEach, vi } from "vitest";
import React, { useState } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import {
  PooledWindow,
  createWindowPoolDefinition,
} from "../../src/renderer/PooledWindow.js";
import {
  MockWindowProvider,
  resetMockWindows,
  getMockWindows,
} from "../../src/testing/index.js";
import { resetMockWindowsGlobal, simulateUserClose } from "../setup.js";

// Get mock windows from global mock
function getGlobalMockWindows(): Map<string, unknown> {
  return (
    (globalThis as unknown as Record<string, Map<string, unknown>>)
      .__mockWindows__ ?? new Map()
  );
}

describe("createWindowPoolDefinition", () => {
  it("creates a pool definition with shape and config", () => {
    const pool = createWindowPoolDefinition(
      { transparent: true, frame: false },
      { minIdle: 1, maxIdle: 3, idleTimeout: 5000 },
    );

    expect(pool).toBeDefined();
    expect(pool.shape).toEqual({ transparent: true, frame: false });
    expect(pool.config).toEqual({ minIdle: 1, maxIdle: 3, idleTimeout: 5000 });
  });

  it("creates a pool definition with defaults", () => {
    const pool = createWindowPoolDefinition({ transparent: true });

    expect(pool).toBeDefined();
    expect(pool.shape).toEqual({ transparent: true });
    expect(pool.config).toEqual({});
  });
});

describe("<PooledWindow>", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("creates window when open becomes true", async () => {
    const pool = createWindowPoolDefinition({ transparent: true });

    function TestApp() {
      const [open, setOpen] = useState(false);
      return (
        <MockWindowProvider>
          <button onClick={() => setOpen(true)}>Open</button>
          <PooledWindow pool={pool} open={open}>
            <div>Pooled Content</div>
          </PooledWindow>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    expect(getGlobalMockWindows().size).toBe(0);

    fireEvent.click(screen.getByText("Open"));

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });
  });

  it("closes window when open becomes false", async () => {
    const pool = createWindowPoolDefinition({ transparent: true });

    function TestApp() {
      const [open, setOpen] = useState(true);
      return (
        <MockWindowProvider>
          <button onClick={() => setOpen(false)}>Close</button>
          <PooledWindow pool={pool} open={open}>
            <div>Pooled Content</div>
          </PooledWindow>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    fireEvent.click(screen.getByText("Close"));

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(0);
    });
  });

  it("applies pool shape properties to window", async () => {
    const pool = createWindowPoolDefinition({
      transparent: true,
      frame: false,
    });

    render(
      <MockWindowProvider>
        <PooledWindow pool={pool} open>
          <div>Content</div>
        </PooledWindow>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.transparent).toBe(true);
    expect(mockWindows[0].props.frame).toBe(false);
  });

  it("supports onUserClose callback", async () => {
    const pool = createWindowPoolDefinition({ transparent: true });
    const onUserClose = vi.fn();

    render(
      <MockWindowProvider>
        <PooledWindow pool={pool} open onUserClose={onUserClose}>
          <div>Content</div>
        </PooledWindow>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Simulate user close via unload event
    const mockWindows = getMockWindows();
    simulateUserClose(mockWindows[0].id);

    await waitFor(() => {
      expect(onUserClose).toHaveBeenCalled();
    });
  });

  it("supports size props", async () => {
    const pool = createWindowPoolDefinition({ frame: true });

    render(
      <MockWindowProvider>
        <PooledWindow pool={pool} open defaultWidth={300} defaultHeight={200}>
          <div>Content</div>
        </PooledWindow>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.defaultWidth).toBe(300);
    expect(mockWindows[0].props.defaultHeight).toBe(200);
  });

  it("supports alwaysOnTop prop", async () => {
    const pool = createWindowPoolDefinition({ transparent: true });

    render(
      <MockWindowProvider>
        <PooledWindow pool={pool} open alwaysOnTop>
          <div>Content</div>
        </PooledWindow>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.alwaysOnTop).toBe(true);
  });

  it("supports skipTaskbar prop", async () => {
    const pool = createWindowPoolDefinition({ transparent: true });

    render(
      <MockWindowProvider>
        <PooledWindow pool={pool} open skipTaskbar>
          <div>Content</div>
        </PooledWindow>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.skipTaskbar).toBe(true);
  });
});

describe("<PooledWindow> rapid toggle", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("handles rapid open/close without leaking", async () => {
    const pool = createWindowPoolDefinition({ transparent: true });

    function TestApp() {
      const [open, setOpen] = useState(false);
      return (
        <MockWindowProvider>
          <button onClick={() => setOpen(true)}>Open</button>
          <button onClick={() => setOpen(false)}>Close</button>
          <PooledWindow pool={pool} open={open}>
            <div>Content</div>
          </PooledWindow>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    // Open
    fireEvent.click(screen.getByText("Open"));
    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Close
    fireEvent.click(screen.getByText("Close"));
    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(0);
    });

    // Open again
    fireEvent.click(screen.getByText("Open"));
    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Should have exactly 1 window
    expect(getGlobalMockWindows().size).toBe(1);
  });
});
