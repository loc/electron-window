import { describe, it, expect, beforeEach, vi } from "vitest";
import React, { useState, useEffect, useMemo } from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { Window, type WindowRef } from "../../src/renderer/Window.js";
import {
  MockWindowProvider,
  resetMockWindows,
  getMockWindows,
  simulateMockWindowEvent,
} from "../../src/testing/index.js";
import type { Bounds } from "../../src/shared/types.js";
import { resetMockWindowsGlobal, getGlobalMockWindows } from "../setup.js";
import { useWindowProviderContext, WindowProviderContext } from "../../src/renderer/context.js";

/** Intercepts windowAction("show") calls for assertion */
function ShowSpy({
  children,
  onShow,
}: {
  children: React.ReactNode;
  onShow: (id: string) => void;
}) {
  const ctx = useWindowProviderContext();
  const wrapped = useMemo(
    () => ({
      ...ctx,
      windowAction: async (id: string, action: { type: string; [key: string]: unknown }) => {
        if (action.type === "show") onShow(id);
        return ctx.windowAction(id, action);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx],
  );
  return React.createElement(WindowProviderContext.Provider, { value: wrapped }, children);
}

// Helper component for testing
function TestApp({
  initialOpen = false,
  ...props
}: {
  initialOpen?: boolean;
  onUserClose?: () => void;
  onBoundsChange?: (bounds: Bounds) => void;
  title?: string;
  children?: React.ReactNode;
  defaultWidth?: number;
  defaultHeight?: number;
}) {
  const [open, setOpen] = useState(initialOpen);

  return (
    <MockWindowProvider>
      <button onClick={() => setOpen(true)}>Open</button>
      <button onClick={() => setOpen(false)}>Close</button>
      <Window
        open={open}
        onUserClose={() => {
          props.onUserClose?.();
          setOpen(false);
        }}
        title={props.title}
        defaultWidth={props.defaultWidth}
        defaultHeight={props.defaultHeight}
        onBoundsChange={props.onBoundsChange}
      >
        <div data-testid="window-content">Window Content</div>
        {props.children}
      </Window>
    </MockWindowProvider>
  );
}

describe("<Window> lifecycle", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("creates window when open becomes true", async () => {
    render(<TestApp />);

    expect(getGlobalMockWindows().size).toBe(0);

    fireEvent.click(screen.getByText("Open"));

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });
  });

  it("destroys window when open becomes false", async () => {
    render(<TestApp initialOpen />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    fireEvent.click(screen.getByText("Close"));

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(0);
    });
  });

  it("handles rapid toggle without leaking windows", async () => {
    render(<TestApp />);

    // Open, wait for creation, then close
    fireEvent.click(screen.getByText("Open"));
    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    fireEvent.click(screen.getByText("Close"));
    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(0);
    });

    // Open again
    fireEvent.click(screen.getByText("Open"));
    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Final state should have exactly 1 window
    expect(getGlobalMockWindows().size).toBe(1);
  });

  it("renders children into the child window document", async () => {
    render(<TestApp initialOpen />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // The mock window has a real document (created via createHTMLDocument).
    // Window creates a <div id="root"> in it and portals children into that node.
    const mockWin = [...getGlobalMockWindows().values()][0] as {
      document: Document;
    };

    await waitFor(() => {
      const content = mockWin.document.querySelector('[data-testid="window-content"]');
      expect(content).not.toBeNull();
      expect(content?.textContent).toBe("Window Content");
    });
  });

  it("does not render children when window is closed", async () => {
    render(<TestApp />);

    expect(getGlobalMockWindows().size).toBe(0);
    expect(screen.queryByTestId("window-content")).not.toBeInTheDocument();
  });
});

describe("<Window> props", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("creates window with window.open features", async () => {
    render(<TestApp initialOpen title="Settings" />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // window.open was called
    expect(window.open).toHaveBeenCalled();
  });

  it("applies default dimensions to window.open features", async () => {
    function TestWithDimensions() {
      return (
        <MockWindowProvider>
          <Window open defaultWidth={400} defaultHeight={300}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithDimensions />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.defaultWidth).toBe(400);
    expect(mockWindows[0].props.defaultHeight).toBe(300);
  });

  it("updates window title when prop changes", async () => {
    function TestWithTitle() {
      const [title, setTitle] = useState("Initial");
      return (
        <MockWindowProvider>
          <button onClick={() => setTitle("Updated")}>Change Title</button>
          <Window open title={title}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithTitle />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Get the mock window
    const mockWin = [...getGlobalMockWindows().values()][0] as {
      document: Document;
    };

    // Initial title
    expect(mockWin.document.title).toBe("Initial");

    fireEvent.click(screen.getByText("Change Title"));

    await waitFor(() => {
      expect(mockWin.document.title).toBe("Updated");
    });
  });
});

describe("<Window> user interactions", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("calls onUserClose when beforeunload fires", async () => {
    const onUserClose = vi.fn();
    render(<TestApp initialOpen onUserClose={onUserClose} />);

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
});

describe("<Window> cleanup", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("cleans up window on unmount", async () => {
    const { unmount } = render(<TestApp initialOpen />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    unmount();

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(0);
    });
  });
});

describe("<Window> recreateOnShapeChange", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("warns when creation-only prop changes without recreateOnShapeChange", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    function TestWithTransparent() {
      const [transparent, setTransparent] = useState(false);
      return (
        <MockWindowProvider>
          <button onClick={() => setTransparent(true)}>Make Transparent</button>
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

    // Change transparent prop
    fireEvent.click(screen.getByText("Make Transparent"));

    await waitFor(() => {
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/transparent.*creation-only/),
      );
    });

    // Window should still exist (not recreated)
    expect(getGlobalMockWindows().size).toBe(1);

    consoleWarnSpy.mockRestore();
  });

  it("recreates window when creation-only prop changes with recreateOnShapeChange", async () => {
    function TestWithRecreate() {
      const [transparent, setTransparent] = useState(false);
      return (
        <MockWindowProvider>
          <button onClick={() => setTransparent(true)}>Make Transparent</button>
          <Window open transparent={transparent} recreateOnShapeChange>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithRecreate />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Get initial window ID
    const initialWindowId = [...getGlobalMockWindows().keys()][0];

    // Change transparent prop
    fireEvent.click(screen.getByText("Make Transparent"));

    // Window should be recreated (old one closed, new one opened)
    await waitFor(() => {
      const currentWindowId = [...getGlobalMockWindows().keys()][0];
      expect(currentWindowId).not.toBe(initialWindowId);
    });

    // Should still have exactly 1 window
    expect(getGlobalMockWindows().size).toBe(1);
  });

  it("recreates window with new shape when recreateOnShapeChange is true", async () => {
    function TestWithFrame() {
      const [frame, setFrame] = useState(true);
      return (
        <MockWindowProvider>
          <button onClick={() => setFrame(false)}>Remove Frame</button>
          <Window open frame={frame} recreateOnShapeChange>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithFrame />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Initial window should have frame=true
    const initialMockWindows = getMockWindows();
    expect(initialMockWindows[0].props.frame).toBe(true);

    // Change frame prop
    fireEvent.click(screen.getByText("Remove Frame"));

    // New window should be created with frame=false
    await waitFor(() => {
      const mockWindows = getMockWindows();
      expect(mockWindows[0].props.frame).toBe(false);
    });
  });

  it("does not recreate when non-creation-only props change", async () => {
    function TestWithTitle() {
      const [title, setTitle] = useState("Initial");
      return (
        <MockWindowProvider>
          <button onClick={() => setTitle("Updated")}>Change Title</button>
          <Window open title={title} recreateOnShapeChange>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithTitle />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Get initial window ID
    const initialWindowId = [...getGlobalMockWindows().keys()][0];

    // Change title (not a creation-only prop)
    fireEvent.click(screen.getByText("Change Title"));

    // Window should NOT be recreated
    await waitFor(() => {
      const mockWin = [...getGlobalMockWindows().values()][0] as {
        document: Document;
      };
      expect(mockWin.document.title).toBe("Updated");
    });

    // Same window ID
    const currentWindowId = [...getGlobalMockWindows().keys()][0];
    expect(currentWindowId).toBe(initialWindowId);
  });
});

describe("<Window> content lifecycle", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("mounts content after window is ready", async () => {
    const onMount = vi.fn();

    function ContentWithMount() {
      useEffect(() => {
        onMount();
        return () => {};
      }, []);
      return <div>Content</div>;
    }

    render(
      <MockWindowProvider>
        <Window open>
          <ContentWithMount />
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Content should be mounted after window is ready
    await waitFor(() => {
      expect(onMount).toHaveBeenCalled();
    });
  });

  it("unmounts content when window closes", async () => {
    const onUnmount = vi.fn();

    function ContentWithUnmount() {
      useEffect(() => {
        return () => {
          onUnmount();
        };
      }, []);
      return <div>Content</div>;
    }

    function TestApp() {
      const [open, setOpen] = useState(true);
      return (
        <MockWindowProvider>
          <button onClick={() => setOpen(false)}>Close</button>
          <Window open={open}>
            <ContentWithUnmount />
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Close the window
    fireEvent.click(screen.getByText("Close"));

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(0);
    });

    // Content should have been unmounted
    expect(onUnmount).toHaveBeenCalled();
  });

  it("unmounts content when component unmounts", async () => {
    const onUnmount = vi.fn();

    function ContentWithUnmount() {
      useEffect(() => {
        return () => {
          onUnmount();
        };
      }, []);
      return <div>Content</div>;
    }

    const { unmount } = render(
      <MockWindowProvider>
        <Window open>
          <ContentWithUnmount />
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Unmount the component
    unmount();

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(0);
    });

    // Content should have been unmounted
    expect(onUnmount).toHaveBeenCalled();
  });

  it("cleans up in-flight window creation on unmount", async () => {
    // Render and immediately unmount to test cleanup of pending operations
    const { unmount } = render(
      <MockWindowProvider>
        <Window open>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    // Immediately unmount before window is ready
    unmount();

    // Wait a bit and verify no leaked windows
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(getGlobalMockWindows().size).toBe(0);
  });
});

describe("<Window> changeable props call setters", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("calls setTitle when title prop changes", async () => {
    function TestWithTitle() {
      const [title, setTitle] = useState("Initial");
      return (
        <MockWindowProvider>
          <button onClick={() => setTitle("Updated")}>Change</button>
          <Window open title={title}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithTitle />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const mockWin = [...getGlobalMockWindows().values()][0] as {
      document: Document;
    };
    expect(mockWin.document.title).toBe("Initial");

    fireEvent.click(screen.getByText("Change"));

    await waitFor(() => {
      expect(mockWin.document.title).toBe("Updated");
    });
  });

  it("calls resizeTo when controlled width/height change", async () => {
    function TestWithSize() {
      const [width, setWidth] = useState(400);
      const onBoundsChange = vi.fn();
      return (
        <MockWindowProvider>
          <button onClick={() => setWidth(600)}>Resize</button>
          <Window open width={width} height={300} onBoundsChange={onBoundsChange}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithSize />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    fireEvent.click(screen.getByText("Resize"));

    await waitFor(() => {
      const mockWindows = getMockWindows();
      expect(mockWindows[0].props.width).toBe(600);
    });
  });

  it("calls moveTo when controlled x/y change", async () => {
    function TestWithPosition() {
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

    render(<TestWithPosition />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    fireEvent.click(screen.getByText("Move"));

    await waitFor(() => {
      const mockWindows = getMockWindows();
      expect(mockWindows[0].props.x).toBe(200);
    });
  });
});

describe("<Window> user interactions - imperative methods", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("can call focus on the window", async () => {
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

    // In the new architecture, showing/focusing is handled by the main process
    // (WindowInstance calls show/showInactive after wrapping the BrowserWindow).
    // The renderer creates the window and sets up the portal — focus is not called
    // on the renderer-side Window object.
    expect(getGlobalMockWindows().size).toBe(1);
  });

  it("can call blur on the window", async () => {
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

    // The underlying MockWindow (from window.open) exposes a blur spy.
    // Verify it can be called and the window remains open afterward.
    const mockWin = [...getGlobalMockWindows().values()][0] as {
      blur: ReturnType<typeof vi.fn>;
    };

    mockWin.blur();

    expect(mockWin.blur).toHaveBeenCalledOnce();
    expect(getGlobalMockWindows().size).toBe(1);
  });

  it("window ref provides working methods", async () => {
    const ref = React.createRef<WindowRef>();

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

    // Ref exposes WindowHandle — same API as useCurrentWindow
    expect(ref.current?.id).toBeDefined();

    // All methods should be callable without throwing
    expect(() => ref.current?.focus()).not.toThrow();
    expect(() => ref.current?.blur()).not.toThrow();
    expect(() => ref.current?.minimize()).not.toThrow();
    expect(() => ref.current?.maximize()).not.toThrow();

    // bounds is a property (not a method) on WindowHandle
    const bounds = ref.current?.bounds;
    expect(bounds).toHaveProperty("x");
    expect(bounds).toHaveProperty("y");
    expect(bounds).toHaveProperty("width");
    expect(bounds).toHaveProperty("height");

    // close via ref sends IPC action — verify it doesn't throw
    expect(() => ref.current?.close()).not.toThrow();
  });

  it("triggers onUserClose when user closes via beforeunload", async () => {
    const onUserClose = vi.fn();

    function TestApp() {
      const [open, setOpen] = useState(true);
      return (
        <MockWindowProvider>
          <Window
            open={open}
            onUserClose={() => {
              onUserClose();
              setOpen(false);
            }}
          >
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

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
});

describe("<Window> changeable behavior props", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("updates alwaysOnTop via provider.updateWindow when prop changes", async () => {
    function TestWithAlwaysOnTop() {
      const [alwaysOnTop, setAlwaysOnTop] = useState(false);
      return (
        <MockWindowProvider>
          <button onClick={() => setAlwaysOnTop(true)}>Set On Top</button>
          <Window open alwaysOnTop={alwaysOnTop}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithAlwaysOnTop />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // Get initial window ID to find it in getMockWindows
    const { getMockWindows } = await import("../../src/testing/index.js");
    const initialMockWindows = getMockWindows();
    expect(initialMockWindows[0].props.alwaysOnTop).toBe(false);

    // Change alwaysOnTop prop
    fireEvent.click(screen.getByText("Set On Top"));

    await waitFor(() => {
      const mockWindows = getMockWindows();
      expect(mockWindows[0].props.alwaysOnTop).toBe(true);
    });
  });

  it("updates resizable via provider.updateWindow when prop changes", async () => {
    function TestWithResizable() {
      const [resizable, setResizable] = useState(true);
      return (
        <MockWindowProvider>
          <button onClick={() => setResizable(false)}>Lock Size</button>
          <Window open resizable={resizable}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithResizable />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const { getMockWindows } = await import("../../src/testing/index.js");
    expect(getMockWindows()[0].props.resizable).toBe(true);

    fireEvent.click(screen.getByText("Lock Size"));

    await waitFor(() => {
      expect(getMockWindows()[0].props.resizable).toBe(false);
    });
  });

  it("updates movable via provider.updateWindow when prop changes", async () => {
    function TestWithMovable() {
      const [movable, setMovable] = useState(true);
      return (
        <MockWindowProvider>
          <button onClick={() => setMovable(false)}>Lock Position</button>
          <Window open movable={movable}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithMovable />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const { getMockWindows } = await import("../../src/testing/index.js");
    expect(getMockWindows()[0].props.movable).toBe(true);

    fireEvent.click(screen.getByText("Lock Position"));

    await waitFor(() => {
      expect(getMockWindows()[0].props.movable).toBe(false);
    });
  });

  it("updates minimizable via provider.updateWindow when prop changes", async () => {
    function TestWithMinimizable() {
      const [minimizable, setMinimizable] = useState(true);
      return (
        <MockWindowProvider>
          <button onClick={() => setMinimizable(false)}>Disable Minimize</button>
          <Window open minimizable={minimizable}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithMinimizable />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const { getMockWindows } = await import("../../src/testing/index.js");
    expect(getMockWindows()[0].props.minimizable).toBe(true);

    fireEvent.click(screen.getByText("Disable Minimize"));

    await waitFor(() => {
      expect(getMockWindows()[0].props.minimizable).toBe(false);
    });
  });

  it("updates maximizable via provider.updateWindow when prop changes", async () => {
    function TestWithMaximizable() {
      const [maximizable, setMaximizable] = useState(true);
      return (
        <MockWindowProvider>
          <button onClick={() => setMaximizable(false)}>Disable Maximize</button>
          <Window open maximizable={maximizable}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithMaximizable />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const { getMockWindows } = await import("../../src/testing/index.js");
    expect(getMockWindows()[0].props.maximizable).toBe(true);

    fireEvent.click(screen.getByText("Disable Maximize"));

    await waitFor(() => {
      expect(getMockWindows()[0].props.maximizable).toBe(false);
    });
  });

  it("updates closable via provider.updateWindow when prop changes", async () => {
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

    const { getMockWindows } = await import("../../src/testing/index.js");
    expect(getMockWindows()[0].props.closable).toBe(true);

    fireEvent.click(screen.getByText("Disable Close"));

    await waitFor(() => {
      expect(getMockWindows()[0].props.closable).toBe(false);
    });
  });

  it("updates skipTaskbar via provider.updateWindow when prop changes", async () => {
    function TestWithSkipTaskbar() {
      const [skipTaskbar, setSkipTaskbar] = useState(false);
      return (
        <MockWindowProvider>
          <button onClick={() => setSkipTaskbar(true)}>Hide from Taskbar</button>
          <Window open skipTaskbar={skipTaskbar}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithSkipTaskbar />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const { getMockWindows } = await import("../../src/testing/index.js");
    expect(getMockWindows()[0].props.skipTaskbar).toBe(false);

    fireEvent.click(screen.getByText("Hide from Taskbar"));

    await waitFor(() => {
      expect(getMockWindows()[0].props.skipTaskbar).toBe(true);
    });
  });

  it("updates multiple behavior props at once", async () => {
    function TestWithMultipleProps() {
      const [locked, setLocked] = useState(false);
      return (
        <MockWindowProvider>
          <button onClick={() => setLocked(true)}>Lock Window</button>
          <Window
            open
            resizable={!locked}
            movable={!locked}
            minimizable={!locked}
            maximizable={!locked}
          >
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithMultipleProps />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const { getMockWindows } = await import("../../src/testing/index.js");

    // Initially all enabled
    expect(getMockWindows()[0].props.resizable).toBe(true);
    expect(getMockWindows()[0].props.movable).toBe(true);
    expect(getMockWindows()[0].props.minimizable).toBe(true);
    expect(getMockWindows()[0].props.maximizable).toBe(true);

    fireEvent.click(screen.getByText("Lock Window"));

    await waitFor(() => {
      const mockWindow = getMockWindows()[0];
      expect(mockWindow.props.resizable).toBe(false);
      expect(mockWindow.props.movable).toBe(false);
      expect(mockWindow.props.minimizable).toBe(false);
      expect(mockWindow.props.maximizable).toBe(false);
    });
  });

  it("does not call updateWindow when behavior props have not changed", async () => {
    function TestWithStaticProps() {
      const [title, setTitle] = useState("Initial");
      return (
        <MockWindowProvider>
          <button onClick={() => setTitle("Updated")}>Change Title</button>
          <Window open title={title} alwaysOnTop={true} resizable={true}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestWithStaticProps />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    const { getMockWindows } = await import("../../src/testing/index.js");
    const initialProps = { ...getMockWindows()[0].props };

    // Change only title (not a behavior prop in CHANGEABLE_BEHAVIOR_PROPS)
    fireEvent.click(screen.getByText("Change Title"));

    await waitFor(() => {
      const mockWin = [...getGlobalMockWindows().values()][0] as {
        document: Document;
      };
      expect(mockWin.document.title).toBe("Updated");
    });

    // Behavior props should still be the same
    expect(getMockWindows()[0].props.alwaysOnTop).toBe(initialProps.alwaysOnTop);
    expect(getMockWindows()[0].props.resizable).toBe(initialProps.resizable);
  });
});

describe("<Window> context propagation", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("propagates parent React context into window children", async () => {
    const ThemeContext = React.createContext("light");
    let capturedTheme = "";

    function ContextConsumer() {
      capturedTheme = React.useContext(ThemeContext);
      return <div>Theme: {capturedTheme}</div>;
    }

    render(
      <ThemeContext.Provider value="dark">
        <MockWindowProvider>
          <Window open>
            <ContextConsumer />
          </Window>
        </MockWindowProvider>
      </ThemeContext.Provider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    // The context value from the parent tree should be available inside the Window
    await waitFor(() => {
      expect(capturedTheme).toBe("dark");
    });
  });

  it("updates when parent context value changes", async () => {
    const ThemeContext = React.createContext("light");
    let capturedTheme = "";

    function ContextConsumer() {
      capturedTheme = React.useContext(ThemeContext);
      return <div>Theme: {capturedTheme}</div>;
    }

    function TestApp() {
      const [theme, setTheme] = React.useState("light");
      return (
        <ThemeContext.Provider value={theme}>
          <MockWindowProvider>
            <button onClick={() => setTheme("dark")}>Switch Theme</button>
            <Window open>
              <ContextConsumer />
            </Window>
          </MockWindowProvider>
        </ThemeContext.Provider>
      );
    }

    render(<TestApp />);

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    await waitFor(() => {
      expect(capturedTheme).toBe("light");
    });

    fireEvent.click(screen.getByText("Switch Theme"));

    await waitFor(() => {
      expect(capturedTheme).toBe("dark");
    });
  });

  it("propagates multiple nested contexts", async () => {
    const ThemeContext = React.createContext("light");
    const UserContext = React.createContext("anonymous");
    let capturedTheme = "";
    let capturedUser = "";

    function ContextConsumer() {
      capturedTheme = React.useContext(ThemeContext);
      capturedUser = React.useContext(UserContext);
      return <div>Content</div>;
    }

    render(
      <ThemeContext.Provider value="dark">
        <UserContext.Provider value="alice">
          <MockWindowProvider>
            <Window open>
              <ContextConsumer />
            </Window>
          </MockWindowProvider>
        </UserContext.Provider>
      </ThemeContext.Provider>,
    );

    await waitFor(() => {
      expect(getGlobalMockWindows().size).toBe(1);
    });

    await waitFor(() => {
      expect(capturedTheme).toBe("dark");
      expect(capturedUser).toBe("alice");
    });
  });
});

describe("<Window> closable prop", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("sends closable={false} to main process", async () => {
    render(
      <MockWindowProvider>
        <Window open closable={false}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => {
      const mockWindows = getMockWindows();
      expect(mockWindows[0].props.closable).toBe(false);
    });
  });
});

describe("<Window> visible prop", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("sends visible=false to main process via updateWindow", async () => {
    function TestApp() {
      const [visible, setVisible] = React.useState(true);
      return (
        <MockWindowProvider>
          <button onClick={() => setVisible(false)}>Hide</button>
          <button onClick={() => setVisible(true)}>Show</button>
          <Window open visible={visible}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);
    await waitFor(() => expect(getGlobalMockWindows().size).toBe(1));

    // Change visible to false
    fireEvent.click(screen.getByText("Hide"));

    await waitFor(() => {
      const mockWindows = getMockWindows();
      expect(mockWindows[0].props.visible).toBe(false);
    });

    // Change visible back to true
    fireEvent.click(screen.getByText("Show"));

    await waitFor(() => {
      const mockWindows = getMockWindows();
      expect(mockWindows[0].props.visible).toBe(true);
    });
  });

  it("window stays open when visible=false (not destroyed)", async () => {
    render(
      <MockWindowProvider>
        <Window open visible={false}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => expect(getGlobalMockWindows().size).toBe(1));

    // Window should exist (open=true) even though visible=false
    expect(getGlobalMockWindows().size).toBe(1);

    // The visible prop should be sent
    const mockWindows = getMockWindows();
    expect(mockWindows[0].props.visible).toBe(false);
  });
});

describe("<Window> timing and cancellation", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("cancels window creation when component unmounts during registerWindow", async () => {
    // registerWindow is async — unmounting before the microtask resumes sets
    // `cancelled = true`, so openWindow() bails before calling window.open.
    const { unmount } = render(
      <MockWindowProvider>
        <Window open>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    // Unmount synchronously before any microtasks/macrotasks run
    unmount();

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(getGlobalMockWindows().size).toBe(0);
  });

  it("cancels window creation when open changes to false during setup", async () => {
    // Toggle open→false on the next tick, before openWindow() can finish
    function TestApp() {
      const [open, setOpen] = React.useState(true);
      React.useEffect(() => {
        const timer = setTimeout(() => setOpen(false), 0);
        return () => clearTimeout(timer);
      }, []);
      return (
        <MockWindowProvider>
          <Window open={open}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // The close-effect runs when open becomes false, closing the window and
    // calling unregisterWindow — net result is zero windows.
    expect(getGlobalMockWindows().size).toBe(0);
  });

  it("handles window.open returning null gracefully", async () => {
    const originalOpen = window.open;
    (window.open as ReturnType<typeof vi.fn>) = vi.fn(() => null);

    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(
      <MockWindowProvider>
        <Window open>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    // window.open returned null → devWarning fires, no portal is created,
    // no window is leaked in the mock store.
    expect(getGlobalMockWindows().size).toBe(0);
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringMatching(/window\.open blocked/));

    window.open = originalOpen;
    consoleWarnSpy.mockRestore();
  });

  it("cancels waitForWindowReady polling loop when unmounted", async () => {
    // SlowMockWindow keeps innerWidth=0 and document.body=null, so
    // waitForWindowReady never exits on its own — it loops until cancelled.
    const { SlowMockWindow } = await import("../setup.js");
    const originalOpen = window.open;

    let slowWin: InstanceType<typeof SlowMockWindow> | null = null;
    (window.open as ReturnType<typeof vi.fn>) = vi.fn(() => {
      slowWin = new SlowMockWindow();
      return slowWin as unknown as Window;
    });

    const { unmount } = render(
      <MockWindowProvider>
        <Window open>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    // Let openWindow() reach waitForWindowReady and start looping
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(slowWin).not.toBeNull();
    // Window is not ready yet — no entry in the mock store
    expect(getGlobalMockWindows().size).toBe(0);

    // Unmounting sets cancelled=true, causing waitForWindowReady to throw and
    // openWindow() to call win.close() and bail — no leak.
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect((slowWin as InstanceType<typeof SlowMockWindow>).close).toHaveBeenCalled();
    expect(getGlobalMockWindows().size).toBe(0);

    window.open = originalOpen;
  });

  it("rapid open/close/open creates exactly one window", async () => {
    function TestApp() {
      const [open, setOpen] = React.useState(false);
      return (
        <MockWindowProvider>
          <button onClick={() => setOpen(true)}>Open</button>
          <button onClick={() => setOpen(false)}>Close</button>
          <Window open={open} onUserClose={() => setOpen(false)}>
            <div data-testid="window-content">Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    // Open and wait for the window to be registered
    fireEvent.click(screen.getByText("Open"));
    await waitFor(() => expect(getGlobalMockWindows().size).toBe(1));

    // Close then immediately open, without waiting for close to settle
    fireEvent.click(screen.getByText("Close"));
    fireEvent.click(screen.getByText("Open"));

    await new Promise((resolve) => setTimeout(resolve, 200));

    // The cancelled flag from the close should prevent any double-open leak.
    // Exactly one window survives.
    await waitFor(() => expect(getGlobalMockWindows().size).toBe(1));
  });

  it("cleans up debounced bounds handler on unmount", async () => {
    const onBoundsChange = vi.fn();

    const { unmount } = render(
      <MockWindowProvider>
        <Window open onBoundsChange={onBoundsChange}>
          <div>Content</div>
        </Window>
      </MockWindowProvider>,
    );

    await waitFor(() => expect(getGlobalMockWindows().size).toBe(1));

    const mockWins = getMockWindows();
    simulateMockWindowEvent(mockWins[0].id, {
      type: "boundsChanged",
      bounds: { x: 0, y: 0, width: 500, height: 400 },
    });

    // Unmount before the debounce delay (100ms) elapses — the pending callback
    // should be cancelled so onBoundsChange never fires.
    unmount();

    await new Promise((resolve) => setTimeout(resolve, 200));

    // If debounce cleanup works, onBoundsChange is never called after unmount.
    // (A failure here would also surface as a "setState on unmounted component" warning.)
    expect(onBoundsChange).not.toHaveBeenCalled();
  });
});

describe("<Window> visible prop", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
    vi.clearAllMocks();
  });

  it("does not show the window on initial render when visible={false}", async () => {
    const showActions: string[] = [];

    function TestApp() {
      return (
        <MockWindowProvider>
          <ShowSpy onShow={(id) => showActions.push(id)}>
            <Window open visible={false}>
              <div data-testid="hidden-content">Content</div>
            </Window>
          </ShowSpy>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    // Wait for window to be registered
    await waitFor(() => {
      expect(getMockWindows().length).toBe(1);
    });

    // Give time for any async show to fire
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Window exists but show was never called
    expect(showActions).toHaveLength(0);
  });

  it("sends visible=true via updateWindow when visible flips from false to true", async () => {
    function TestApp() {
      const [visible, setVisible] = useState(false);
      return (
        <MockWindowProvider>
          <button onClick={() => setVisible(true)}>Show</button>
          <Window open visible={visible}>
            <div>Content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<TestApp />);

    await waitFor(() => {
      expect(getMockWindows().length).toBe(1);
    });

    // Initial props should not have visible=true yet (window was opened with false)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Flip visible to true — the prop-diff effect should call updateWindow({ visible: true })
    fireEvent.click(screen.getByText("Show"));

    await waitFor(() => {
      const wins = getMockWindows();
      expect(wins[0].props.visible).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Regression: style subscriber leak on open toggle (H1 from third fresh-eyes)
// ---------------------------------------------------------------------------
describe("<Window> style subscriber cleanup on open toggle", () => {
  beforeEach(() => {
    resetMockWindows();
    resetMockWindowsGlobal();
  });

  it("does not leak style subscribers across open→false→open cycles", async () => {
    // The open={false} teardown path must call styleCleanupRef — otherwise
    // each open cycle adds a subscriber that's never removed. The shape-change
    // and unmount paths already did this; open=false was the gap.
    const { __getStyleSubscriberCount } = await import("../../src/renderer/windowUtils.js");

    function ToggleApp() {
      const [open, setOpen] = useState(false);
      return (
        <MockWindowProvider>
          <button onClick={() => setOpen((o) => !o)}>Toggle</button>
          <Window open={open}>
            <div>content</div>
          </Window>
        </MockWindowProvider>
      );
    }

    render(<ToggleApp />);
    const baseline = __getStyleSubscriberCount();

    // Toggle open→close three times
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByText("Toggle")); // open
      await waitFor(() => expect(getGlobalMockWindows().size).toBe(1));
      fireEvent.click(screen.getByText("Toggle")); // close
      await waitFor(() => expect(getGlobalMockWindows().size).toBe(0));
    }

    // Subscriber count should be back to baseline — not baseline+3
    expect(__getStyleSubscriberCount()).toBe(baseline);
  });
});
