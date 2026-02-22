# @loc/electron-window

Declarative React components for Electron window management.

## Installation

```bash
npm install @loc/electron-window
# or
yarn add @loc/electron-window
```

## Quick Start

### Main Process

```ts
// main.ts
import { setupWindowManager } from "@loc/electron-window/main";

const manager = setupWindowManager({
  defaultWindowOptions: {
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  },
});

// Register your main window (and any other BrowserWindows you create)
manager.setupForWindow(mainWindow);
```

### Preload Script

```ts
// preload.ts
import "@loc/electron-window/preload";
```

> **Note:** The preload import must be bundled (esbuild, webpack, etc.) before use. Do not point Electron directly at `node_modules/@loc/electron-window/dist/preload/index.js`.

### Renderer Process

```tsx
// App.tsx
import { WindowProvider, Window } from "@loc/electron-window";

function App() {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <WindowProvider>
      <button onClick={() => setShowSettings(true)}>Open Settings</button>

      <Window
        open={showSettings}
        onUserClose={() => setShowSettings(false)}
        title="Settings"
        defaultWidth={600}
        defaultHeight={400}
      >
        <SettingsPanel />
      </Window>
    </WindowProvider>
  );
}
```

## Features

- **Declarative API**: Manage windows with React components and props
- **Type-safe**: Full TypeScript support with comprehensive types
- **Two-intent model**: Clean separation of app intent vs user actions
- **Context preservation**: Children of `<Window>` share the parent React tree — your providers, themes, and state are all available inside child windows without any extra wiring
- **Bounds persistence**: Window positions and sizes are saved to localStorage by default; no server or file I/O required
- **Hooks**: `useCurrentWindow`, `useWindowFocused`, `useWindowBounds`, etc.
- **Testing utilities**: Mock providers for unit testing without Electron

## How it works

1. The renderer calls `window.open()` to create a child `BrowserWindow`
2. The main process intercepts it via `setWindowOpenHandler` + `did-create-window`
3. Child window content is rendered via `createPortal`, preserving the parent React context (providers, themes, state)
4. Props are sent from the renderer to the main process over type-safe IPC to configure the `BrowserWindow`

## API Reference

### `<Window>`

The main component for creating windows.

```tsx
<Window
  // Lifecycle
  open={boolean}                    // Required: whether window should exist
  onUserClose={() => void}          // Called when user closes window
  closable={boolean}                // Can user close? (default: true)
  keepMounted={boolean}             // Hide instead of destroy when open=false

  // Visibility
  visible={boolean}                 // Show/hide without destroying (default: true)
                                    // Unlike `open`, the window stays mounted when false

  // Geometry (initial)
  defaultWidth={number}             // Initial width (creation-only)
  defaultHeight={number}            // Initial height (creation-only)
  defaultX={number}                 // Initial x position (creation-only)
  defaultY={number}                 // Initial y position (creation-only)

  // Geometry (controlled)
  width={number}                    // Controlled width
  height={number}                   // Controlled height
  onBoundsChange={(bounds) => void} // Called on resize/move

  // Appearance
  title={string}
  transparent={boolean}             // Creation-only
  frame={boolean}                   // Creation-only
  backgroundColor={string}

  // Behavior
  resizable={boolean}
  movable={boolean}
  alwaysOnTop={boolean}

  // Persistence
  persistBounds="unique-key"        // Auto-save/restore bounds

  // Security note: webPreferences is main-process-only and cannot be set
  // from the renderer. Configure it in setupWindowManager's defaultWindowOptions.
>
  {children}
</Window>
```

#### `visible` vs `open`

- `open={false}` — destroys the window (or hides it if `keepMounted` is set)
- `visible={false}` — hides the window while keeping it alive and mounted; state is preserved

#### `webPreferences` is main-process-only

`webPreferences` (and other sensitive `BrowserWindow` options) cannot be set from the renderer. This is intentional — only the main process can configure security-sensitive options. Set them in `setupWindowManager`'s `defaultWindowOptions`:

```ts
setupWindowManager({
  defaultWindowOptions: {
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: true,
    },
  },
});
```

### `<PooledWindow>`

Pre-warms windows for instant display. Useful for overlays and panels that appear frequently.

```tsx
import { PooledWindow, createWindowPool } from "@loc/electron-window";

const overlayPool = createWindowPool(
  { transparent: true, frame: false },
  { minIdle: 1, maxIdle: 3, idleTimeout: 5000 },
);

function App() {
  const [showOverlay, setShowOverlay] = useState(false);
  return (
    <PooledWindow pool={overlayPool} open={showOverlay}>
      <OverlayContent />
    </PooledWindow>
  );
}
```

### Hooks

```tsx
// Inside a Window's children
function SettingsPanel() {
  // Imperative access
  const window = useCurrentWindow();
  window.focus();
  window.minimize();
  window.close();

  // Reactive state (re-renders on change)
  const isFocused = useWindowFocused();
  const bounds = useWindowBounds();
  const isMaximized = useWindowMaximized();
}
```

### Testing

```tsx
import {
  MockWindowProvider,
  MockWindow,
  getMockWindows,
  resetMockWindows,
} from "@loc/electron-window/testing";

test("opens settings window", async () => {
  resetMockWindows();

  render(
    <MockWindowProvider>
      <MyApp />
    </MockWindowProvider>,
  );

  fireEvent.click(screen.getByText("Open Settings"));

  await waitFor(() => {
    expect(getMockWindows()).toHaveLength(1);
    expect(getMockWindows()[0].props.title).toBe("Settings");
  });
});

// Test components that use useCurrentWindow() directly:
test("panel renders focused state", () => {
  render(
    <MockWindow state={{ isFocused: true }}>
      <SettingsPanel />
    </MockWindow>,
  );

  expect(screen.getByText("Focused")).toBeInTheDocument();
});
```

## Entry Points

| Import                         | Use                        |
| ------------------------------ | -------------------------- |
| `@loc/electron-window`         | React components, hooks    |
| `@loc/electron-window/main`    | Main process setup         |
| `@loc/electron-window/preload` | Preload script setup       |
| `@loc/electron-window/testing` | Mock providers for testing |

## License

MIT
