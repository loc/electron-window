import { describe, it, expect, beforeEach, vi } from "vitest";
import React, { useState } from "react";
import { render, waitFor, fireEvent, act } from "@testing-library/react";
import {
  PooledWindow,
  createWindowPool,
  createWindowPoolDefinition,
} from "../../src/renderer/PooledWindow.js";
import {
  MockWindowProvider,
  resetMockWindows,
  getMockWindows,
  simulateMockUserClose,
} from "../../src/testing/index.js";
import { resetMockWindowsGlobal } from "../setup.js";

function getGlobalMockWindows(): Map<string, unknown> {
  return (
    (globalThis as unknown as Record<string, Map<string, unknown>>)
      .__mockWindows__ ?? new Map()
  );
}

// Query content from the pool window's document (portals render there, not in
// the test document body).
function queryInPoolWindows(selector: string): Element | null {
  for (const win of getGlobalMockWindows().values()) {
    const w = win as { document: Document };
    const el = w.document?.querySelector(selector);
    if (el) return el;
  }
  return null;
}

// ─── createWindowPool ────────────────────────────────────────────────────────

describe("createWindowPool", () => {
  it("returns a pool definition with the given shape and config", () => {
    const pool = createWindowPool(
      { transparent: true, frame: false },
      { minIdle: 2, maxIdle: 5, idleTimeout: 10000 },
    );

    expect(pool.shape).toEqual({ transparent: true, frame: false });
    expect(pool.config).toEqual({ minIdle: 2, maxIdle: 5, idleTimeout: 10000 });
  });

  it("defaults config to an empty object when omitted", () => {
    const pool = createWindowPool({ transparent: true });

    expect(pool.shape).toEqual({ transparent: true });
    expect(pool.config).toEqual({});
  });

  it("createWindowPoolDefinition is a deprecated alias for createWindowPool", () => {
    const a = createWindowPool({ frame: false });
    const b = createWindowPoolDefinition({ frame: false });

    expect(a.shape).toEqual(b.shape);
    expect(a.config).toEqual(b.config);
  });
});

// ─── <PooledWindow> ──────────────────────────────────────────────────────────

describe("<PooledWindow>", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  // 1. Creates window when open becomes true
  it("acquires a window from the pool when open becomes true", async () => {
    const pool = createWindowPool({ transparent: true }, { minIdle: 1 });

    function TestApp() {
      const [open, setOpen] = useState(false);
      return (
        <MockWindowProvider>
          <button onClick={() => setOpen(true)}>Open</button>
          <PooledWindow pool={pool} open={open}>
            <div data-testid="pooled-content">Pooled Content</div>
          </PooledWindow>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    // Pool pre-warms 1 window on construction — wait for warmup.
    await waitFor(() => {
      expect(getMockWindows().length).toBe(1);
    });

    fireEvent.click(document.querySelector("button")!);

    // After acquire, the pool window's document should contain the portal.
    await waitFor(() => {
      expect(
        queryInPoolWindows('[data-testid="pooled-content"]'),
      ).not.toBeNull();
    });
  });

  // 2. Hides (not destroys) window when open becomes false
  it("releases the window back to the pool when open becomes false", async () => {
    const pool = createWindowPool({ transparent: true }, { minIdle: 1 });
    const onReady = vi.fn();

    function TestApp() {
      const [open, setOpen] = useState(true);
      return (
        <MockWindowProvider>
          <button onClick={() => setOpen(false)}>Close</button>
          <PooledWindow pool={pool} open={open} onReady={onReady}>
            <div data-testid="pooled-content">Content</div>
          </PooledWindow>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    // Wait until the window is acquired and shown (portal appears).
    await waitFor(() => {
      expect(
        queryInPoolWindows('[data-testid="pooled-content"]'),
      ).not.toBeNull();
    });

    const globalCountAfterOpen = getGlobalMockWindows().size;
    expect(globalCountAfterOpen).toBeGreaterThanOrEqual(1);

    fireEvent.click(document.querySelector("button")!);

    // Portal is torn down (PooledWindow returns null when portalTarget is null).
    await waitFor(() => {
      expect(queryInPoolWindows('[data-testid="pooled-content"]')).toBeNull();
    });

    // The underlying window is hidden, not destroyed — release() calls
    // windowAction("hide"), which doesn't close the MockWindow. The pool keeps
    // the window alive for the next acquire.
    expect(getGlobalMockWindows().size).toBeGreaterThanOrEqual(1);
  });

  // 3. Pool shape props are applied to every registered window
  it("registers pool windows with the pool's shape props", async () => {
    const pool = createWindowPool({ transparent: true, frame: false });

    render(
      <MockWindowProvider>
        <PooledWindow pool={pool} open>
          <div>Content</div>
        </PooledWindow>
      </MockWindowProvider>,
    );

    // Wait for warmup registration.
    await waitFor(() => {
      expect(getMockWindows().length).toBeGreaterThanOrEqual(1);
    });

    // The warmup window carries the pool's shape props.
    const win = getMockWindows()[0]!;
    expect(win.props.transparent).toBe(true);
    expect(win.props.frame).toBe(false);
  });

  // 4. Non-shape props are forwarded to the acquired window via updateWindow
  it("forwards non-shape props (alwaysOnTop) to the acquired window", async () => {
    const pool = createWindowPool({ transparent: true });

    render(
      <MockWindowProvider>
        <PooledWindow pool={pool} open alwaysOnTop>
          <div>Content</div>
        </PooledWindow>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getMockWindows().length).toBeGreaterThanOrEqual(1);
    });

    // Wait for acquire + updateWindow to complete.
    await waitFor(() => {
      const wins = getMockWindows();
      return wins.some((w) => w.props.alwaysOnTop === true);
    });

    const wins = getMockWindows();
    const acquired = wins.find((w) => w.props.alwaysOnTop === true);
    expect(acquired).toBeDefined();
  });

  // 5. onUserClose callback fires when a userCloseRequested event is dispatched
  it("calls onUserClose when the window emits userCloseRequested", async () => {
    const pool = createWindowPool({ transparent: true });
    const onUserClose = vi.fn();

    // Start closed so warmup completes before acquire — the pool will have an
    // idle window ready, avoiding the warmup/acquire race that could create a
    // second window as the active one.
    function TestApp() {
      const [open, setOpen] = useState(false);
      return (
        <MockWindowProvider>
          <button data-testid="open-btn" onClick={() => setOpen(true)}>
            Open
          </button>
          <PooledWindow pool={pool} open={open} onUserClose={onUserClose}>
            <div data-testid="uc-content">Content</div>
          </PooledWindow>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    // Wait for warmup to register the idle window.
    await waitFor(() => {
      expect(getMockWindows().length).toBeGreaterThanOrEqual(1);
    });

    // Now open — acquire grabs the pre-warmed window (first in idle queue).
    fireEvent.click(document.querySelector('[data-testid="open-btn"]')!);

    // Wait for the portal to appear — isReady=true committed, effects running.
    await waitFor(() => {
      expect(queryInPoolWindows('[data-testid="uc-content"]')).not.toBeNull();
    });

    // Flush effects (subscribeToEvents runs after the render with isReady=true).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // The warmup window is acquired (it was first in the idle queue) and has
    // the active subscribeToEvents listener. It's the first registered window.
    const windowId = getMockWindows()[0]!.id;
    simulateMockUserClose(windowId);

    await waitFor(() => {
      expect(onUserClose).toHaveBeenCalledTimes(1);
    });
  });

  // 6. Rapid toggle doesn't leak — acquire/release cycle stays balanced
  it("handles rapid open/close cycles without leaking windows", async () => {
    const pool = createWindowPool(
      { transparent: true },
      { minIdle: 1, maxIdle: 2 },
    );

    function TestApp() {
      const [open, setOpen] = useState(false);
      return (
        <MockWindowProvider>
          <button data-testid="open" onClick={() => setOpen(true)}>
            Open
          </button>
          <button data-testid="close" onClick={() => setOpen(false)}>
            Close
          </button>
          <PooledWindow pool={pool} open={open}>
            <div data-testid="content">Content</div>
          </PooledWindow>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    // Wait for warmup.
    await waitFor(() => {
      expect(getMockWindows().length).toBeGreaterThanOrEqual(1);
    });

    // Cycle 1: open → close
    fireEvent.click(document.querySelector('[data-testid="open"]')!);
    await waitFor(() => {
      expect(queryInPoolWindows('[data-testid="content"]')).not.toBeNull();
    });

    fireEvent.click(document.querySelector('[data-testid="close"]')!);
    await waitFor(() => {
      expect(queryInPoolWindows('[data-testid="content"]')).toBeNull();
    });

    // Cycle 2: open → close
    fireEvent.click(document.querySelector('[data-testid="open"]')!);
    await waitFor(() => {
      expect(queryInPoolWindows('[data-testid="content"]')).not.toBeNull();
    });

    fireEvent.click(document.querySelector('[data-testid="close"]')!);
    await waitFor(() => {
      expect(queryInPoolWindows('[data-testid="content"]')).toBeNull();
    });

    // Pool reuses windows — should stay within maxIdle bounds.
    expect(getGlobalMockWindows().size).toBeLessThanOrEqual(3);
  });

  // 7. Children portal into the pool window's document
  it("renders children into the pool window's document via createPortal", async () => {
    const pool = createWindowPool({ frame: false });

    render(
      <MockWindowProvider>
        <PooledWindow pool={pool} open>
          <span data-testid="portal-child">Hello from pool</span>
        </PooledWindow>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      const el = queryInPoolWindows('[data-testid="portal-child"]');
      expect(el).not.toBeNull();
      expect(el?.textContent).toBe("Hello from pool");
    });
  });
});
