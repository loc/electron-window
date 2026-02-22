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
import { createWindowManager } from "@loc/electron-window/main";

const manager = createWindowManager({
  defaultWindowOptions: {
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  },
});

app.on("browser-window-created", (_, win) => {
  manager.setupForWindow(win);
});
```

### Preload Script

```ts
// preload.ts
import "@loc/electron-window/preload";
```

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

## API Reference

### `<Window>`

The main component for creating windows.

```tsx
<Window
  // Lifecycle
  open={boolean}                    // Required: whether window should be visible
  onUserClose={() => void}          // Called when user closes window
  closable={boolean}                // Can user close? (default: true)
  keepMounted={boolean}             // Hide instead of destroy when open=false

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
>
  {children}
</Window>
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
