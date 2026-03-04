import React, { useState, useRef, useCallback } from "react";
import {
  WindowProvider,
  Window,
  PooledWindow,
  createWindowPool,
  type WindowRef,
} from "../../../../../../src/renderer/index.js";

type TestEvent = { type: string; timestamp: number; data?: unknown };

interface TestState {
  scenario: string | null;
  windowOpen: boolean;
  windowProps: Record<string, unknown>;
  events: TestEvent[];
}

// Expose test controls to Playwright
declare global {
  interface Window {
    __test__: {
      setScenario: (scenario: string) => void;
      setWindowOpen: (open: boolean) => void;
      setWindowProps: (props: Record<string, unknown>) => void;
      getEvents: () => Array<{
        type: string;
        timestamp: number;
        data?: unknown;
      }>;
      clearEvents: () => void;
      getWindowRef: () => WindowRef | null;
      // Pool ghost paint repro
      setPoolContent: (content: string) => void;
      getPoolContent: () => string;
    };
  }
}

export function App() {
  const [state, setState] = useState<TestState>({
    scenario: null,
    windowOpen: false,
    windowProps: {},
    events: [],
  });

  const windowRef = useRef<WindowRef>(null);
  // Use ref to avoid closure issues with getEvents
  const eventsRef = useRef<TestEvent[]>([]);
  const [poolContent, setPoolContent] = useState("A");
  const poolContentRef = useRef("A");

  const addEvent = useCallback((type: string, data?: unknown) => {
    const newEvent = { type, timestamp: Date.now(), data };
    eventsRef.current = [...eventsRef.current, newEvent];
    setState((prev) => ({
      ...prev,
      events: eventsRef.current,
    }));
  }, []);

  // Expose test controls
  React.useEffect(() => {
    window.__test__ = {
      setScenario: (scenario) => {
        eventsRef.current = [];
        setState((prev) => ({ ...prev, scenario, events: [] }));
      },
      setWindowOpen: (open) => {
        setState((prev) => ({ ...prev, windowOpen: open }));
      },
      setWindowProps: (props) => {
        setState((prev) => ({
          ...prev,
          windowProps: { ...prev.windowProps, ...props },
        }));
      },
      getEvents: () => eventsRef.current,
      clearEvents: () => {
        eventsRef.current = [];
        setState((prev) => ({ ...prev, events: [] }));
      },
      getWindowRef: () => windowRef.current,
      setPoolContent: (content: string) => {
        poolContentRef.current = content;
        setPoolContent(content);
      },
      getPoolContent: () => poolContentRef.current,
    };
  }, []);

  const handleUserClose = useCallback(() => {
    addEvent("userClose");
    setState((prev) => ({ ...prev, windowOpen: false }));
  }, [addEvent]);

  const handleBoundsChange = useCallback(
    (bounds: { x: number; y: number; width: number; height: number }) => {
      addEvent("boundsChange", bounds);
    },
    [addEvent],
  );

  const handleReady = useCallback(() => {
    addEvent("ready");
  }, [addEvent]);

  return (
    <WindowProvider>
      <div style={{ padding: 20, fontFamily: "system-ui, sans-serif" }}>
        <h1>Electron Window E2E Test App</h1>

        <div style={{ marginBottom: 20 }}>
          <strong>Current Scenario:</strong> {state.scenario || "none"}
        </div>

        <div style={{ marginBottom: 20 }}>
          <strong>Window State:</strong> {state.windowOpen ? "Open" : "Closed"}
        </div>

        <div style={{ marginBottom: 20 }}>
          <button
            data-testid="open-window"
            onClick={() =>
              setState((prev) => ({
                ...prev,
                windowOpen: true,
                scenario: prev.scenario || "basic",
              }))
            }
          >
            Open Window
          </button>
          <button
            data-testid="close-window"
            onClick={() => setState((prev) => ({ ...prev, windowOpen: false }))}
            style={{ marginLeft: 10 }}
          >
            Close Window
          </button>
          <button
            data-testid="toggle-window"
            onClick={() =>
              setState((prev) => ({ ...prev, windowOpen: !prev.windowOpen }))
            }
            style={{ marginLeft: 10 }}
          >
            Toggle Window
          </button>
        </div>

        <div style={{ marginBottom: 20 }}>
          <strong>Props Controls:</strong>
          <div style={{ marginTop: 10 }}>
            <button
              data-testid="toggle-always-on-top"
              onClick={() =>
                setState((prev) => ({
                  ...prev,
                  windowProps: {
                    ...prev.windowProps,
                    alwaysOnTop: !prev.windowProps.alwaysOnTop,
                  },
                }))
              }
            >
              Toggle AlwaysOnTop ({state.windowProps.alwaysOnTop ? "ON" : "OFF"}
              )
            </button>
            <button
              data-testid="toggle-resizable"
              onClick={() =>
                setState((prev) => ({
                  ...prev,
                  windowProps: {
                    ...prev.windowProps,
                    resizable:
                      prev.windowProps.resizable === false ? true : false,
                  },
                }))
              }
              style={{ marginLeft: 10 }}
            >
              Toggle Resizable (
              {state.windowProps.resizable !== false ? "ON" : "OFF"})
            </button>
          </div>
        </div>

        <div
          style={{
            marginBottom: 20,
            background: "#f0f0f0",
            padding: 10,
            borderRadius: 4,
          }}
        >
          <strong>Events:</strong>
          <pre
            data-testid="events"
            style={{ maxHeight: 200, overflow: "auto" }}
          >
            {JSON.stringify(state.events, null, 2)}
          </pre>
        </div>

        <div data-testid="status">Ready</div>

        {/* Render window based on scenario */}
        {state.scenario === "basic" && (
          <Window
            ref={windowRef}
            open={state.windowOpen}
            onUserClose={handleUserClose}
            onBoundsChange={handleBoundsChange}
            onReady={handleReady}
            title={state.windowProps.title as string}
            defaultWidth={(state.windowProps.defaultWidth as number) ?? 400}
            defaultHeight={(state.windowProps.defaultHeight as number) ?? 300}
            alwaysOnTop={state.windowProps.alwaysOnTop as boolean}
            resizable={state.windowProps.resizable as boolean}
            {...state.windowProps}
          >
            <div>Basic window content</div>
          </Window>
        )}

        {state.scenario === "persistence" && (
          <Window
            ref={windowRef}
            open={state.windowOpen}
            onUserClose={handleUserClose}
            onBoundsChange={handleBoundsChange}
            onReady={handleReady}
            defaultWidth={400}
            defaultHeight={300}
            {...state.windowProps}
          >
            <div>Persistence window content</div>
          </Window>
        )}

        {state.scenario === "frameless" && (
          <Window
            ref={windowRef}
            open={state.windowOpen}
            onUserClose={handleUserClose}
            onReady={handleReady}
            frame={false}
            defaultWidth={400}
            defaultHeight={300}
            {...state.windowProps}
          >
            <div>Frameless window content</div>
          </Window>
        )}

        {state.scenario === "transparent" && (
          <Window
            ref={windowRef}
            open={state.windowOpen}
            onUserClose={handleUserClose}
            onReady={handleReady}
            transparent={true}
            frame={false}
            defaultWidth={400}
            defaultHeight={300}
            {...state.windowProps}
          >
            <div>Transparent window content</div>
          </Window>
        )}

        {state.scenario === "controlled-bounds" && (
          <Window
            ref={windowRef}
            open={state.windowOpen}
            onUserClose={handleUserClose}
            onBoundsChange={handleBoundsChange}
            onReady={handleReady}
            width={(state.windowProps.width as number) ?? 500}
            height={(state.windowProps.height as number) ?? 400}
            x={(state.windowProps.x as number) ?? 100}
            y={(state.windowProps.y as number) ?? 100}
          >
            <div>Controlled bounds window content</div>
          </Window>
        )}

        {state.scenario === "multiple-windows" && (
          <>
            <Window
              open={state.windowOpen}
              onReady={() => addEvent("window1-ready")}
              title="Window 1"
              defaultWidth={300}
              defaultHeight={200}
              defaultX={50}
              defaultY={50}
            >
              <div>Window 1 content</div>
            </Window>
            <Window
              open={state.windowOpen}
              onReady={() => addEvent("window2-ready")}
              title="Window 2"
              defaultWidth={300}
              defaultHeight={200}
              defaultX={400}
              defaultY={50}
            >
              <div>Window 2 content</div>
            </Window>
          </>
        )}

        {state.scenario === "content-check" && (
          <Window
            open={state.windowOpen}
            onUserClose={handleUserClose}
            onReady={handleReady}
            defaultWidth={400}
            defaultHeight={300}
            title="Content Check"
          >
            <div data-testid="child-content" style={{ padding: 20 }}>
              Hello from child window
            </div>
          </Window>
        )}

        {state.scenario === "recreate-shape" && (
          <Window
            ref={windowRef}
            open={state.windowOpen}
            onUserClose={handleUserClose}
            onReady={handleReady}
            frame={state.windowProps.frame !== false}
            recreateOnShapeChange
            defaultWidth={400}
            defaultHeight={300}
            title="Recreate Shape"
          >
            <div>Recreate shape content</div>
          </Window>
        )}

        {state.scenario === "user-close" && (
          <Window
            open={state.windowOpen}
            onUserClose={handleUserClose}
            onReady={handleReady}
            defaultWidth={400}
            defaultHeight={300}
            title="User Close Test"
          >
            <div>User close content</div>
          </Window>
        )}

        {state.scenario === "bounds-change" && (
          <Window
            open={state.windowOpen}
            onUserClose={handleUserClose}
            onBoundsChange={handleBoundsChange}
            onReady={handleReady}
            defaultWidth={400}
            defaultHeight={300}
            title="Bounds Change Test"
          >
            <div>Bounds change content</div>
          </Window>
        )}

        {state.scenario === "pooled-window" && (
          <PooledWindowScenario
            open={state.windowOpen}
            poolContent={poolContent}
            onReady={handleReady}
            onUserClose={handleUserClose}
          />
        )}
      </div>
    </WindowProvider>
  );
}

// ─── Pool ghost paint repro ─────────────────────────────────────────────────
//
// Creates a pool with minIdle=1. When open=true, acquires a window and renders
// high-contrast content (red for "A", blue for "B"). The ghost paint manifests
// as a flash of the OLD color when switching content after a release/re-acquire.

const ghostPool = createWindowPool({}, { minIdle: 1, maxIdle: 2 });

function PooledWindowScenario({
  open,
  poolContent,
  onReady,
  onUserClose,
}: {
  open: boolean;
  poolContent: string;
  onReady: () => void;
  onUserClose: () => void;
}) {
  const isA = poolContent === "A";
  const bg = isA ? "#ff0000" : "#0000ff";
  const label = isA ? "CONTENT A (RED)" : "CONTENT B (BLUE)";

  // Generate a heavy DOM to make paint time noticeable.
  // 500 grid items with box-shadows + border-radius force compositing work.
  const heavyItems = [];
  for (let i = 0; i < 500; i++) {
    heavyItems.push(
      <div
        key={i}
        style={{
          width: 60,
          height: 60,
          background: isA
            ? `hsl(${(i * 3) % 360}, 80%, 50%)`
            : `hsl(${(i * 3 + 180) % 360}, 80%, 50%)`,
          borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontSize: 10,
          fontWeight: "bold",
        }}
      >
        {i}
      </div>,
    );
  }

  return (
    <PooledWindow
      pool={ghostPool}
      open={open}
      onReady={onReady}
      onUserClose={onUserClose}
      defaultWidth={800}
      defaultHeight={600}
      title={`Pool: ${poolContent}`}
    >
      <div
        data-testid="pool-content"
        data-content={poolContent}
        style={{
          width: "100%",
          height: "100%",
          background: bg,
          padding: 20,
          overflow: "auto",
        }}
      >
        <h1
          style={{
            color: "white",
            fontSize: 48,
            fontWeight: "bold",
            fontFamily: "system-ui, sans-serif",
            textAlign: "center",
            marginBottom: 20,
            textShadow: "0 2px 4px rgba(0,0,0,0.5)",
          }}
        >
          {label}
        </h1>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))",
            gap: 8,
          }}
        >
          {heavyItems}
        </div>
      </div>
    </PooledWindow>
  );
}
