import { describe, it, expect, beforeEach, vi } from "vitest";
import React, { useState } from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
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
  simulateMockWindowEvent,
} from "../../src/testing/index.js";
import {
  useCurrentWindow,
  useWindowFocused,
  useWindowSignal,
} from "../../src/renderer/hooks/index.js";
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

  it("RendererWindowPool throws when maxIdle < minIdle", async () => {
    // Without this guard, release()'s single-shift eviction leaves the
    // pool permanently above maxIdle — fail fast at construction instead.
    const { RendererWindowPool } = await import("../../src/renderer/RendererWindowPool.js");
    expect(
      () =>
        new RendererWindowPool({
          shape: {},
          config: { minIdle: 5, maxIdle: 2 },
          registerWindow: vi.fn(async () => true),
          unregisterWindow: vi.fn(async () => {}),
          updateWindow: vi.fn(async () => {}),
          windowAction: vi.fn(async () => {}),
        }),
    ).toThrow(/maxIdle.*must be >= minIdle/);
  });

  it("evicts idle windows after idleTimeout, but never below minIdle", async () => {
    // Timer-driven eviction path. Only scheduled when idle.length > minIdle
    // at release time — so we need to acquire+release enough to cross that.
    const { RendererWindowPool } = await import("../../src/renderer/RendererWindowPool.js");

    vi.useFakeTimers();
    const unregisterWindow = vi.fn(async () => {});
    const pool = new RendererWindowPool({
      shape: {},
      config: { minIdle: 1, maxIdle: 3, idleTimeout: 5000 },
      registerWindow: vi.fn(async () => true),
      unregisterWindow,
      updateWindow: vi.fn(async () => {}),
      windowAction: vi.fn(async () => {}),
    });

    // Warm to minIdle (1), then acquire it + create 2 more on-the-fly
    await pool.warmUp();
    const e1 = await pool.acquire();
    const e2 = await pool.acquire();
    const e3 = await pool.acquire();
    // Let any in-flight replenishment settle
    await vi.runOnlyPendingTimersAsync();

    // Release all 3 → idle = 3 > minIdle (1), timers scheduled for e2 and e3
    // (e1 release brings idle to 1 = minIdle, no timer for it)
    await pool.release(e1.id);
    await pool.release(e2.id);
    await pool.release(e3.id);
    expect(pool.getIdleCount()).toBe(3);

    unregisterWindow.mockClear();
    vi.advanceTimersByTime(5001);

    // evictIdle guards idle > minIdle, so it stops at 1
    expect(pool.getIdleCount()).toBe(1);
    expect(unregisterWindow).toHaveBeenCalledTimes(2);

    pool.destroy();
    vi.useRealTimers();
  });

  it("PoolShape interface keys match POOL_SHAPE_PROPS runtime set", async () => {
    // Completeness trap guard: there are THREE places defining "pool shape
    // props" — the PoolShape interface (RendererWindowPool.ts), the
    // PoolShapeProps type (PooledWindow.tsx, now derived from PoolShape),
    // and the POOL_SHAPE_PROPS runtime set (types.ts, derived from
    // PROP_REGISTRY). This test ties the interface to the runtime set so
    // adding a new `allowed && creationOnly` prop to PROP_REGISTRY forces
    // you to also update PoolShape — otherwise the prop is silently
    // dropped at the !POOL_SHAPE_PROPS.has(key) filter on acquire.
    const { POOL_SHAPE_PROPS } = await import("../../src/shared/types.js");
    // Construct a PoolShape with ALL keys set to probe the interface.
    // If you add a key to PoolShape, add it here too.
    const allShapeKeys: Record<
      keyof import("../../src/renderer/RendererWindowPool.js").PoolShape,
      true
    > = {
      transparent: true,
      frame: true,
      titleBarStyle: true,
      vibrancy: true,
    };
    const interfaceKeys = new Set(Object.keys(allShapeKeys));

    // Runtime set must equal interface keys (both directions)
    for (const k of POOL_SHAPE_PROPS) {
      expect(interfaceKeys.has(k)).toBe(true);
    }
    for (const k of interfaceKeys) {
      expect(POOL_SHAPE_PROPS.has(k)).toBe(true);
    }
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
      expect(queryInPoolWindows('[data-testid="pooled-content"]')).not.toBeNull();
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
      expect(queryInPoolWindows('[data-testid="pooled-content"]')).not.toBeNull();
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
    const pool = createWindowPool({ transparent: true }, { minIdle: 1, maxIdle: 2 });

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
    const pool = createWindowPool({ transparent: true }, { minIdle: 1, maxIdle: 2 });

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
      expect(queryInPoolWindows('[data-testid="reuse-content"]')).not.toBeNull();
    });

    // Wait for any background replenishment to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Record total window.open calls after first acquire + replenishment
    const openCallsAfterFirstAcquire = (window.open as ReturnType<typeof vi.fn>).mock.calls.length;

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
      expect(queryInPoolWindows('[data-testid="reuse-content"]')).not.toBeNull();
    });

    // No new window.open calls for the reopen — pool reuses existing idle window
    const openCallsAfterReopen = (window.open as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(openCallsAfterReopen).toBe(openCallsAfterFirstAcquire);
  });

  // 10. Regression: hide() firing unload shouldn't destroy pool windows
  it("survives unload events triggered by hide (Electron quirk)", async () => {
    const pool = createWindowPool({ transparent: true }, { minIdle: 1, maxIdle: 2 });

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
      expect(queryInPoolWindows('[data-testid="survive-content"]')).not.toBeNull();
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    const openCallsAfterAcquire = (window.open as ReturnType<typeof vi.fn>).mock.calls.length;

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
      expect(queryInPoolWindows('[data-testid="survive-content"]')).not.toBeNull();
    });

    const openCallsAfterReopen = (window.open as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(openCallsAfterReopen).toBe(openCallsAfterAcquire);
  });

  // 11. Regression: replenishment shouldn't prevent release from recycling.
  // Tests the RendererWindowPool directly for precise timing control.
  it("recycles window even when replenishment filled idle to maxIdle", async () => {
    const { RendererWindowPool } = await import("../../src/renderer/RendererWindowPool.js");

    const unregisterWindow = vi.fn(async () => {});
    const updateWindow = vi.fn(async () => {});
    const windowAction = vi.fn(async () => {});
    const registerWindow = vi.fn(async () => true);

    const pool = new RendererWindowPool({
      shape: { transparent: true },
      config: { minIdle: 1, maxIdle: 1 },
      registerWindow,
      unregisterWindow,
      updateWindow,
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
      expect(getMockWindows().some((w) => w.props.alwaysOnTop === true)).toBe(true);
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
      return wins.some((w) => w.state.bounds.width === 300 && w.state.bounds.height === 200);
    });

    const wins = getMockWindows();
    const sized = wins.find((w) => w.state.bounds.width === 300 && w.state.bounds.height === 200);
    expect(sized).toBeDefined();
  });

  // A4. Pool rebinds provider refs when provider remounts
  it("rebinds provider methods after WindowProvider remounts", async () => {
    const { destroyWindowPool } = await import("../../src/renderer/PooledWindow.js");
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
      expect(queryInPoolWindows('[data-testid="rebind-content"]')).not.toBeNull();
    });

    destroyWindowPool(poolDef);
  });

  // D5. In-flight tracking prevents over-creation during rapid acquires
  it("does not over-replenish idle windows when acquiring concurrently", async () => {
    const { RendererWindowPool } = await import("../../src/renderer/RendererWindowPool.js");

    const registerWindow = vi.fn(async () => true);
    const unregisterWindow = vi.fn(async () => {});
    const updateWindow = vi.fn(async () => {});
    const windowAction = vi.fn(async () => {});

    // minIdle=2, maxIdle=3: warmup creates 2 idle. Acquiring both triggers
    // replenishment on each acquire. Without inFlight tracking, both replenishments
    // would proceed concurrently and create 2 idle windows, exceeding maxIdle.
    const pool = new RendererWindowPool({
      shape: {},
      config: { minIdle: 2, maxIdle: 3 },
      registerWindow,
      unregisterWindow,
      updateWindow,
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

  // C1 regression guard: release() must NOT include visible:true in the
  // prop-reset payload — WindowInstance.updateProps treats visible:true as
  // a show() call, which would un-hide the released window (idle pool
  // windows visible on screen).
  it("release() prop-reset payload excludes visible (idle windows stay hidden)", async () => {
    const { RendererWindowPool } = await import("../../src/renderer/RendererWindowPool.js");
    const { POOL_RELEASE_PROP_DEFAULTS } = await import("../../src/shared/types.js");

    // The defaults object must NOT contain visible — this is the primary
    // guard against regressing the show-on-release bug.
    expect(POOL_RELEASE_PROP_DEFAULTS).not.toHaveProperty("visible");

    // And verify release() actually sends this payload (not a stale copy).
    const registerWindow = vi.fn(async () => true);
    const unregisterWindow = vi.fn(async () => {});
    const updateWindow = vi.fn(async () => {});
    const windowAction = vi.fn(async () => {});

    const pool = new RendererWindowPool({
      shape: {},
      config: { minIdle: 1, maxIdle: 2 },
      registerWindow,
      unregisterWindow,
      updateWindow,
      windowAction,
    });

    await pool.warmUp();
    const entry = await pool.acquire();
    await pool.release(entry.id);

    // updateWindow should have been called with the reset defaults
    const resetCall = updateWindow.mock.calls.find(
      (c) => c[0] === entry.id && typeof c[1] === "object",
    );
    expect(resetCall).toBeDefined();
    const payload = resetCall![1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("visible");
    // Spot-check that the reset DOES include the props that prevent leaks
    expect(payload.closable).toBe(true);
    expect(payload.alwaysOnTop).toBe(false);
    expect(payload.opacity).toBe(1);

    pool.destroy();
  });

  // C2 regression guard: behavior props must reset on release. Snapshot the
  // defaults keys so removals break this test.
  it("POOL_RELEASE_PROP_DEFAULTS covers every CHANGEABLE_BEHAVIOR_PROP (except documented exclusions)", async () => {
    // Systematic invariant check: every prop that can change live must
    // either have a reset default OR be documented as non-resettable OR
    // be `visible` (excluded for the show()-on-release reason).
    //
    // If you add a prop to CHANGEABLE_BEHAVIOR_PROPS (via PROP_REGISTRY),
    // this test forces you to decide which bucket it belongs in — it won't
    // pass until you either add a default or add to the non-resettable set.
    const { POOL_RELEASE_PROP_DEFAULTS, POOL_NON_RESETTABLE_PROPS, CHANGEABLE_BEHAVIOR_PROPS } =
      await import("../../src/shared/types.js");

    const defaultKeys = new Set(Object.keys(POOL_RELEASE_PROP_DEFAULTS));
    const uncovered: string[] = [];
    for (const prop of CHANGEABLE_BEHAVIOR_PROPS) {
      if (prop === "visible") continue; // intentional — see C1 fix
      if (defaultKeys.has(prop)) continue;
      if (POOL_NON_RESETTABLE_PROPS.has(prop)) continue;
      uncovered.push(prop);
    }

    // If this fails, a prop leaks across pool uses. Add it to
    // POOL_RELEASE_PROP_DEFAULTS (with its neutral default) or to
    // POOL_NON_RESETTABLE_PROPS (with a comment explaining why it
    // can't be reset).
    expect(uncovered).toEqual([]);
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
      const styleNodes = w.document.head.querySelectorAll('style, link[rel="stylesheet"]');
      expect(styleNodes.length).toBe(0);
    }
  });

  // ─── Fifth-round regression guards ─────────────────────────────────────────

  // M4: External destruction while no <PooledWindow> is mounted → dead entry
  // left in idle[]. acquire() must skip it rather than hand out a closed window.
  it("acquire() skips dead idle entries (externally destroyed while unmounted)", async () => {
    const { RendererWindowPool } = await import("../../src/renderer/RendererWindowPool.js");

    const pool = new RendererWindowPool({
      shape: {},
      config: { minIdle: 1, maxIdle: 2 },
      registerWindow: vi.fn(async () => true),
      unregisterWindow: vi.fn(async () => {}),
      updateWindow: vi.fn(async () => {}),
      windowAction: vi.fn(async () => {}),
    });

    await pool.warmUp();
    expect(pool.getIdleCount()).toBe(1);

    // Simulate external destruction (e.g., test clearAllState, or consumer's
    // "close all windows" menu) while no PooledWindow is mounted to receive
    // the `closed` IPC event.
    for (const win of getGlobalMockWindows().values()) {
      (win as { destroy: () => void }).destroy();
    }

    // Pool still thinks it has 1 idle — nobody told it
    expect(pool.getIdleCount()).toBe(1);

    // acquire() should detect the dead entry and fall through to on-the-fly
    const entry = await pool.acquire();
    expect(entry.childWindow.closed).toBe(false);
    expect(pool.getIdleCount()).toBe(0); // dead entry was discarded, not returned

    pool.destroy();
  });

  // E4: release() must guard .document access against .closed=true after the
  // IPC awaits. Without this, accessing .document on a closed window throws
  // and the styleCleanup leaks.
  it("release() handles window destroyed during IPC awaits without unhandled rejection", async () => {
    const { RendererWindowPool } = await import("../../src/renderer/RendererWindowPool.js");

    const unregisterWindow = vi.fn(async () => {});
    // Make windowAction("hide") slow so we can destroy the window mid-release
    let resolveHide: () => void;
    const hideCalled = new Promise<void>((resolveCalled) => {
      // windowAction isn't reached until release's first await (updateWindow)
      // resolves (microtask). We need to wait for that before resolving hide.
      resolveHide = resolveCalled;
    });
    const windowAction = vi.fn(async (_id: string, action: { type: string }) => {
      if (action.type === "hide") {
        await hideCalled;
      }
    });

    // maxIdle=1 suppresses acquire-time replenishment (idle+active >= maxIdle)
    // so the idle count after release is purely from THIS entry (or not).
    const pool = new RendererWindowPool({
      shape: {},
      config: { minIdle: 1, maxIdle: 1 },
      registerWindow: vi.fn(async () => true),
      unregisterWindow,
      updateWindow: vi.fn(async () => {}),
      windowAction,
    });

    await pool.warmUp();
    const entry = await pool.acquire();

    // Start release — it awaits updateWindow, then windowAction("hide")
    const releasePromise = pool.release(entry.id);

    // Wait for release to reach windowAction("hide")
    await vi.waitFor(() => expect(windowAction).toHaveBeenCalledWith(entry.id, { type: "hide" }));

    // Destroy the window while release is awaiting hide
    (entry.childWindow as unknown as { destroy: () => void }).destroy();
    expect(entry.childWindow.closed).toBe(true);

    // Let hide resolve — release continues, reaches the .closed check
    resolveHide!();

    // If the .closed guard is missing, release()'s .document access throws
    // and this promise rejects. We expect clean resolution.
    await expect(releasePromise).resolves.toBeUndefined();

    // destroyEntry ran: styleCleanup + unregisterWindow, entry NOT pushed to idle
    expect(unregisterWindow).toHaveBeenCalledWith(entry.id);
    expect(pool.getIdleCount()).toBe(0);

    pool.destroy();
  });

  // F3: Debounced onBoundsChange must be cancelled on open=false, not just
  // unmount. Otherwise a pending debounce fires the consumer's callback for
  // a window that was already released.
  it("cancels pending onBoundsChange debounce when open goes false", async () => {
    const { BOUNDS_CHANGE_DEBOUNCE_MS } = await import("../../src/renderer/windowUtils.js");
    const { simulateMockWindowEvent, getMockWindows } = await import("../../src/testing/index.js");

    vi.useFakeTimers();
    const pool = createWindowPool({}, { minIdle: 0 });
    const onBoundsChange = vi.fn();

    function TestApp() {
      const [open, setOpen] = useState(true);
      return (
        <MockWindowProvider>
          <button data-testid="close" onClick={() => setOpen(false)}>
            Close
          </button>
          <PooledWindow pool={pool} open={open} onBoundsChange={onBoundsChange}>
            <div data-testid="f3-content">Content</div>
          </PooledWindow>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    // Flush warmup/acquire with fake timers — setTimeout(0) won't fire on its own
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(queryInPoolWindows('[data-testid="f3-content"]')).not.toBeNull();

    // Fire a bounds event → starts debounce timer
    const windowId = getMockWindows()[0]!.id;
    act(() => {
      simulateMockWindowEvent(windowId, {
        type: "boundsChanged",
        bounds: { x: 100, y: 100, width: 500, height: 400 },
      });
    });

    // Halfway through debounce, close the window
    act(() => {
      vi.advanceTimersByTime(BOUNDS_CHANGE_DEBOUNCE_MS / 2);
    });
    fireEvent.click(document.querySelector('[data-testid="close"]')!);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    // Advance past where the debounce WOULD have fired
    act(() => {
      vi.advanceTimersByTime(BOUNDS_CHANGE_DEBOUNCE_MS);
    });

    // onBoundsChange should NOT have fired — resetLifecycle() cancelled it
    expect(onBoundsChange).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  // C1: Unstable poolDef identity (inline/useMemo-with-deps/HMR) should warn.
  // Each identity change leaks hidden BrowserWindows.
  it("dev-warns when pool prop identity changes (leaks BrowserWindows)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    function TestApp({ tick }: { tick: number }) {
      // Deliberately WRONG — new poolDef each render
      const pool = React.useMemo(() => createWindowPool({}, { minIdle: 0 }), [tick]);
      return (
        <MockWindowProvider>
          <PooledWindow pool={pool} open={false}>
            <div>Content</div>
          </PooledWindow>
        </MockWindowProvider>
      );
    }

    const { rerender } = render(<TestApp tick={0} />);
    // First render creates the pool — no warning yet
    expect(
      warnSpy.mock.calls.some((c) => String(c[0]).includes("pool` prop identity changed")),
    ).toBe(false);

    rerender(<TestApp tick={1} />);
    // Second distinct poolDef → warning
    expect(
      warnSpy.mock.calls.some((c) => String(c[0]).includes("pool` prop identity changed")),
    ).toBe(true);

    warnSpy.mockRestore();
  });

  // ─── Hooks inside <PooledWindow> ──────────────────────────────────────────
  //
  // All hook tests in hooks.test.tsx use <Window>. PooledWindow wires its own
  // lifecycle.contextValue into WindowContext.Provider — same hook, different
  // call site. A regression in PooledWindow's contextValue (stale subscribe,
  // missing field) would break hooks ONLY here and every existing test would
  // still pass. Two probes cover the contract:
  // - useCurrentWindow: the static read (handle id + methods)
  // - useWindowFocused: the reactive subscribe/getSnapshot path

  it("useCurrentWindow works inside <PooledWindow> children", async () => {
    // minIdle: 0 → no warm-up → exactly one window (the on-the-fly acquire).
    // With minIdle > 0, warm-up + replenish create extra windows and
    // getMockWindows()[0] becomes ambiguous.
    const pool = createWindowPool({}, { minIdle: 0 });
    let handle: ReturnType<typeof useCurrentWindow> | null = null;
    const onReady = vi.fn();

    function Child() {
      handle = useCurrentWindow();
      return <div data-testid="child">child</div>;
    }

    render(
      <MockWindowProvider>
        <PooledWindow pool={pool} open onReady={onReady}>
          <Child />
        </PooledWindow>
      </MockWindowProvider>,
    );

    await waitFor(() => expect(onReady).toHaveBeenCalled());
    await waitFor(() => expect(handle).not.toBeNull());

    expect(handle!.id).toBeDefined();
    // Methods are wired, not the NOT_READY_HANDLE no-ops — focus dispatches
    // a real windowAction. (Checking it's callable is enough; the dispatch
    // target is covered by the handle-dispatch-correctness test in Window.test.)
    expect(typeof handle!.focus).toBe("function");
    expect(() => handle!.focus()).not.toThrow();
  });

  it("useWindowFocused reacts to events inside <PooledWindow> children", async () => {
    const pool = createWindowPool({}, { minIdle: 0 });
    let focused: boolean | null = null;
    let handleId: string | null = null;
    const onReady = vi.fn();

    function Child() {
      focused = useWindowFocused();
      handleId = useCurrentWindow().id;
      return <div>{String(focused)}</div>;
    }

    render(
      <MockWindowProvider>
        <PooledWindow pool={pool} open onReady={onReady}>
          <Child />
        </PooledWindow>
      </MockWindowProvider>,
    );

    await waitFor(() => expect(onReady).toHaveBeenCalled());
    await waitFor(() => expect(focused).toBe(false));
    // Fire at the id the PooledWindow actually subscribed to — not
    // getMockWindows()[0], which may be a replenishment window.
    await waitFor(() => expect(handleId).not.toBeNull());

    // The hook subscribed via contextValue.subscribe. If PooledWindow's
    // contextValue.subscribe is stale (wrong stateListeners ref, wrong
    // windowStateRef), the event fires but the hook doesn't re-render.
    act(() => simulateMockWindowEvent(handleId!, { type: "focused" }));
    await waitFor(() => expect(focused).toBe(true));

    act(() => simulateMockWindowEvent(handleId!, { type: "blurred" }));
    await waitFor(() => expect(focused).toBe(false));
  });

  it("useWindowSignal aborts per-acquisition, fresh on next acquire", async () => {
    // The distinguishing pooled-window case: the same BrowserWindow is
    // reused across open→false→open, but the signal must be per-ACQUISITION
    // so listeners from the previous use don't survive.
    const pool = createWindowPool({}, { minIdle: 0 });
    const signals: AbortSignal[] = [];
    const onReady = vi.fn();

    function Child() {
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
          <PooledWindow pool={pool} open={open} onReady={onReady}>
            <Child />
          </PooledWindow>
        </MockWindowProvider>
      );
    }

    render(<App />);
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(signals).toHaveLength(1));
    const first = signals[0];
    expect(first.aborted).toBe(false);

    // Release → abort fires. The underlying BrowserWindow stays alive
    // in the pool (minIdle:0 but we just released, idle=1).
    fireEvent.click(screen.getByTestId("toggle"));
    expect(first.aborted).toBe(true);

    // Re-acquire → fresh signal, not the old aborted one.
    fireEvent.click(screen.getByTestId("toggle"));
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(signals.length).toBeGreaterThanOrEqual(2));
    const second = signals[signals.length - 1];
    expect(second).not.toBe(first);
    expect(second.aborted).toBe(false);
  });
});
