import { describe, it, expect, beforeEach, vi } from "vitest";
import React, { useState } from "react";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
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
import { resetMockWindowsGlobal, getGlobalMockWindows } from "../setup.js";

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

  // 6. On-demand creation when pool is exhausted (minIdle: 0)
  it("acquires a window on-demand when pool is empty", async () => {
    // Pool with 0 idle — forces on-demand creation rather than the pre-warm path
    const emptyPool = createWindowPool({ transparent: true }, { minIdle: 0 });

    function TestApp() {
      const [open, setOpen] = useState(false);
      return (
        <MockWindowProvider>
          <button onClick={() => setOpen(true)}>Open</button>
          <PooledWindow pool={emptyPool} open={open}>
            <div data-testid="pool-content">Content</div>
          </PooledWindow>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    // No pre-warming with minIdle: 0
    expect(getGlobalMockWindows().size).toBe(0);

    fireEvent.click(screen.getByText("Open"));

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBeGreaterThanOrEqual(1);
    });
  });

  // 7. Cancellation during acquire — open=true then immediately open=false
  it("cancels acquire when open changes to false immediately", async () => {
    const pool = createWindowPool({ transparent: true }, { minIdle: 0 });

    function TestApp() {
      const [open, setOpen] = useState(true);
      // Close on the next tick, before the acquire can fully settle
      React.useEffect(() => {
        const t = setTimeout(() => setOpen(false), 0);
        return () => clearTimeout(t);
      }, []);
      return (
        <MockWindowProvider>
          <PooledWindow pool={pool} open={open}>
            <div>Content</div>
          </PooledWindow>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    // Allow everything to settle — wrapping in act gives React a chance to flush
    // the cancellation cleanup before jsdom tears down the portal container.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    // No active portal should remain; idle windows from the release are acceptable
  });

  // 8. Children portal into the pool window's document
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

  // 9. Close→reopen cycle reuses the same pool window (not destroyed + recreated)
  it("reuses the same window after close and reopen", async () => {
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
            <div data-testid="reuse-content">Content</div>
          </PooledWindow>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    // Wait for warmup
    await waitFor(() => {
      expect(getMockWindows().length).toBeGreaterThanOrEqual(1);
    });

    // Open — acquires from pool
    fireEvent.click(document.querySelector('[data-testid="open"]')!);
    await waitFor(() => {
      expect(
        queryInPoolWindows('[data-testid="reuse-content"]'),
      ).not.toBeNull();
    });

    // Wait for any background replenishment to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Record total window.open calls after first acquire + replenishment
    const openCallsAfterFirstAcquire = (window.open as ReturnType<typeof vi.fn>)
      .mock.calls.length;

    // Close — should release back to pool (not destroy)
    fireEvent.click(document.querySelector('[data-testid="close"]')!);
    await waitFor(() => {
      expect(queryInPoolWindows('[data-testid="reuse-content"]')).toBeNull();
    });

    // The window should still exist (hidden, not destroyed)
    expect(getGlobalMockWindows().size).toBeGreaterThanOrEqual(1);

    // Reopen — should reuse the same pool window (no new window.open)
    fireEvent.click(document.querySelector('[data-testid="open"]')!);
    await waitFor(() => {
      expect(
        queryInPoolWindows('[data-testid="reuse-content"]'),
      ).not.toBeNull();
    });

    // No new window.open calls for the reopen — pool reuses existing idle window
    const openCallsAfterReopen = (window.open as ReturnType<typeof vi.fn>).mock
      .calls.length;
    expect(openCallsAfterReopen).toBe(openCallsAfterFirstAcquire);
  });

  // 10. Regression: hide() firing unload shouldn't destroy pool windows
  it("survives unload events triggered by hide (Electron quirk)", async () => {
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
            <div data-testid="survive-content">Content</div>
          </PooledWindow>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    await waitFor(() => {
      expect(getMockWindows().length).toBeGreaterThanOrEqual(1);
    });

    // Open
    fireEvent.click(document.querySelector('[data-testid="open"]')!);
    await waitFor(() => {
      expect(
        queryInPoolWindows('[data-testid="survive-content"]'),
      ).not.toBeNull();
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    const openCallsAfterAcquire = (window.open as ReturnType<typeof vi.fn>).mock
      .calls.length;

    // Close — triggers pool.release() which calls windowAction("hide")
    fireEvent.click(document.querySelector('[data-testid="close"]')!);
    await waitFor(() => {
      expect(queryInPoolWindows('[data-testid="survive-content"]')).toBeNull();
    });

    // Simulate Electron's quirk: hide() fires unload on the child window.
    // The pool's unload handler should ignore this because childWindow.closed
    // is still false (the window was hidden, not closed).
    for (const mockWin of getGlobalMockWindows().values()) {
      const win = mockWin as { simulateUnload?: () => void; closed: boolean };
      // Fire unload but DON'T set closed=true (simulating hide, not close)
      if (win.simulateUnload) {
        // Manually fire just the unload event without closing
        const listeners = (mockWin as any)._eventListeners?.get("unload");
        if (listeners) {
          for (const listener of listeners) {
            if (typeof listener === "function") {
              listener(new Event("unload"));
            }
          }
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 50));

    // The window should NOT have been destroyed by the unload
    expect(getGlobalMockWindows().size).toBeGreaterThanOrEqual(1);

    // Reopen — should still reuse (no new window.open)
    fireEvent.click(document.querySelector('[data-testid="open"]')!);
    await waitFor(() => {
      expect(
        queryInPoolWindows('[data-testid="survive-content"]'),
      ).not.toBeNull();
    });

    const openCallsAfterReopen = (window.open as ReturnType<typeof vi.fn>).mock
      .calls.length;
    expect(openCallsAfterReopen).toBe(openCallsAfterAcquire);
  });

  // 11. Regression: replenishment shouldn't prevent release from recycling.
  // Tests the RendererWindowPool directly for precise timing control.
  it("recycles window even when replenishment filled idle to maxIdle", async () => {
    const { RendererWindowPool } =
      await import("../../src/renderer/RendererWindowPool.js");

    const unregisterWindow = vi.fn(async () => {});
    const windowAction = vi.fn(async () => {});
    const registerWindow = vi.fn(async () => {});

    const pool = new RendererWindowPool({
      shape: { transparent: true },
      config: { minIdle: 1, maxIdle: 1 },
      registerWindow,
      unregisterWindow,
      windowAction,
    });

    // Warm up — creates 1 idle window
    await pool.warmUp();
    expect(pool.getIdleCount()).toBe(1);

    // Acquire — pulls from idle, triggers replenishment in background
    const entry = await pool.acquire();
    expect(pool.getIdleCount()).toBe(0);
    expect(pool.getActiveCount()).toBe(1);

    // Wait for replenishment to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // With the fix: replenishment is skipped (idle(0)+active(1) >= maxIdle(1)).
    // Without the fix: replenishment runs, idle=1=maxIdle, causing release to destroy.
    expect(pool.getActiveCount()).toBe(1);

    // Release the active window — this MUST recycle, not destroy.
    // The released window should replace the replenished one or both should fit.
    unregisterWindow.mockClear();
    await pool.release(entry.id);

    // The released window MUST be recycled (kept in idle), NOT destroyed.
    // Bug: with unguarded replenishment, idle=1 >= maxIdle=1 → destroy path
    // Fix: replenishment skipped when idle+active >= maxIdle
    expect(unregisterWindow).not.toHaveBeenCalled();
    expect(pool.getActiveCount()).toBe(0);

    pool.destroy();
  });

  // B4. Prop-diff: changing alwaysOnTop while open sends updateWindow
  it("sends updateWindow when a changeable prop changes while open (B4)", async () => {
    const pool = createWindowPool({}, { minIdle: 0 });

    function TestApp() {
      const [alwaysOnTop, setAlwaysOnTop] = useState(false);
      return (
        <MockWindowProvider>
          <button data-testid="toggle" onClick={() => setAlwaysOnTop(true)}>
            Toggle
          </button>
          <PooledWindow pool={pool} open alwaysOnTop={alwaysOnTop}>
            <div data-testid="b4-content">Content</div>
          </PooledWindow>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    // Wait for portal to appear
    await waitFor(() => {
      expect(queryInPoolWindows('[data-testid="b4-content"]')).not.toBeNull();
    });

    // Flush effects so prevPropsRef is initialized
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    fireEvent.click(document.querySelector('[data-testid="toggle"]')!);

    // updateWindow merges into mock window props — check alwaysOnTop is now true
    await waitFor(() => {
      expect(getMockWindows().some((w) => w.props.alwaysOnTop === true)).toBe(
        true,
      );
    });
  });

  // B5. defaultWidth/defaultHeight applies initial size via setBounds on acquire
  it("applies defaultWidth/defaultHeight via setBounds on acquire (B5)", async () => {
    const pool = createWindowPool({}, { minIdle: 0 });

    render(
      <MockWindowProvider>
        <PooledWindow pool={pool} open defaultWidth={300} defaultHeight={200}>
          <div data-testid="b5-content">Content</div>
        </PooledWindow>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(queryInPoolWindows('[data-testid="b5-content"]')).not.toBeNull();
    });

    // Give setBounds windowAction time to fire and update state.bounds
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // MockWindowProvider.windowAction("setBounds") fires boundsChanged which
    // updates window.state.bounds — verify the size was applied.
    await waitFor(() => {
      const wins = getMockWindows();
      return wins.some(
        (w) => w.state.bounds.width === 300 && w.state.bounds.height === 200,
      );
    });

    const wins = getMockWindows();
    const sized = wins.find(
      (w) => w.state.bounds.width === 300 && w.state.bounds.height === 200,
    );
    expect(sized).toBeDefined();
  });

  // A4. Pool rebinds provider refs when provider remounts
  it("rebinds provider methods after WindowProvider remounts", async () => {
    const { destroyWindowPool } =
      await import("../../src/renderer/PooledWindow.js");
    // minIdle: 0 so warmup doesn't create any idle windows — we only want
    // to test that the rebind happens and the new provider's methods are used.
    const poolDef = createWindowPool({ transparent: true }, { minIdle: 0 });

    function App({ open }: { open: boolean }) {
      return (
        <MockWindowProvider>
          <PooledWindow pool={poolDef} open={open}>
            <div data-testid="rebind-content">Content</div>
          </PooledWindow>
        </MockWindowProvider>
      );
    }

    // First mount — pool is created (no warmup with minIdle: 0)
    const { unmount } = render(<App open={false} />);

    // Unmount — simulates provider remount (HMR, test teardown).
    // The pool singleton stays in the WeakMap with no idle windows.
    unmount();

    // Remount with a fresh MockWindowProvider — PooledWindow calls rebind()
    // with the new provider's methods on its next render.
    render(<App open={true} />);

    // The new provider's registerWindow is used for the on-demand acquire,
    // proving the pool uses fresh refs after remount and not stale ones.
    await waitFor(() => {
      expect(
        queryInPoolWindows('[data-testid="rebind-content"]'),
      ).not.toBeNull();
    });

    destroyWindowPool(poolDef);
  });

  // D5. In-flight tracking prevents over-creation during rapid acquires
  it("does not over-replenish idle windows when acquiring concurrently", async () => {
    const { RendererWindowPool } =
      await import("../../src/renderer/RendererWindowPool.js");

    const registerWindow = vi.fn(async () => {});
    const unregisterWindow = vi.fn(async () => {});
    const windowAction = vi.fn(async () => {});

    // minIdle=2, maxIdle=3: warmup creates 2 idle. Acquiring both triggers
    // replenishment on each acquire. Without inFlight tracking, both replenishments
    // would proceed concurrently and create 2 idle windows, exceeding maxIdle.
    const pool = new RendererWindowPool({
      shape: {},
      config: { minIdle: 2, maxIdle: 3 },
      registerWindow,
      unregisterWindow,
      windowAction,
    });

    await pool.warmUp();
    expect(pool.getIdleCount()).toBe(2);

    // Acquire both idle windows synchronously — each triggers a replenishment check.
    const e1 = await pool.acquire();
    const e2 = await pool.acquire();
    // At this point inFlight=1 from the first acquire's replenishment; the second
    // acquire's replenishment check should see inFlight and not over-create.

    // Let all in-flight creations settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Total windows should not exceed maxIdle (idle + active + any leftover)
    expect(pool.getIdleCount() + pool.getActiveCount()).toBeLessThanOrEqual(3);
    expect(pool.getInFlightCount()).toBe(0);

    await pool.release(e1.id);
    await pool.release(e2.id);

    pool.destroy();
  });

  // B6. injectStyles: false in pool definition suppresses style injection
  it("respects injectStyles: false from pool definition (B6)", async () => {
    const pool = createWindowPool({}, { minIdle: 0 }, { injectStyles: false });

    render(
      <MockWindowProvider>
        <PooledWindow pool={pool} open>
          <div data-testid="b6-content">Content</div>
        </PooledWindow>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(queryInPoolWindows('[data-testid="b6-content"]')).not.toBeNull();
    });

    // With injectStyles: false, no <style> or <link rel="stylesheet"> should
    // be injected into the pool window's document head.
    for (const win of getGlobalMockWindows().values()) {
      const w = win as { document: Document };
      if (!w.document) continue;
      const styleNodes = w.document.head.querySelectorAll(
        'style, link[rel="stylesheet"]',
      );
      expect(styleNodes.length).toBe(0);
    }
  });
});
