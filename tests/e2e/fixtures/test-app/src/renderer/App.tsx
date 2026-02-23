import React, { useState, useRef, useCallback } from "react";
import {
  WindowProvider,
  Window,
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
      </div>
    </WindowProvider>
  );
}
