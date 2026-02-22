# @loc/electron-window

Declarative React components for Electron window management. Opens native windows with `<Window open>`, renders children via portals so your React context (providers, themes, state) works inside child windows without any extra wiring.

## Install

```bash
npm install @loc/electron-window
```

## Setup

Three files — one per Electron process:

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
manager.setupForWindow(mainWindow);
```

```ts
// preload.ts — must be bundled (esbuild, webpack, etc.)
import "@loc/electron-window/preload";
```

```tsx
// renderer
import { WindowProvider, Window } from "@loc/electron-window";

function App() {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <WindowProvider>
      <button onClick={() => setShowSettings(true)}>Settings</button>
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

Children of `<Window>` are in the parent React tree. Redux stores, theme providers, routers — they all work inside child windows automatically.

## `<Window>` Props

### Lifecycle

| Prop          | Type         | Default  | Description                                                 |
| ------------- | ------------ | -------- | ----------------------------------------------------------- |
| `open`        | `boolean`    | required | Whether the window exists. `false` destroys it.             |
| `visible`     | `boolean`    | `true`   | Show/hide without destroying. State is preserved.           |
| `closable`    | `boolean`    | `true`   | Whether the user can close the window.                      |
| `onUserClose` | `() => void` | —        | User clicked X. Fires once; sync your state here.           |
| `onClose`     | `() => void` | —        | Window destroyed (any reason: user, programmatic, unmount). |
| `onReady`     | `() => void` | —        | Window ready and content mounted.                           |

`open` controls existence. `visible` controls visibility. `open={true} visible={false}` creates a hidden window with state preserved. `open={false}` destroys everything.

### Geometry

| Prop                             | Type               | Description                                                            |
| -------------------------------- | ------------------ | ---------------------------------------------------------------------- |
| `defaultWidth` / `defaultHeight` | `number`           | Initial size. Applied once on creation. User can resize freely.        |
| `defaultX` / `defaultY`          | `number`           | Initial position. Applied once on creation.                            |
| `width` / `height`               | `number`           | Controlled size. Changes resize the window. Use with `onBoundsChange`. |
| `x` / `y`                        | `number`           | Controlled position. Changes move the window.                          |
| `onBoundsChange`                 | `(bounds) => void` | Fires on resize/move. Debounced internally (100ms).                    |
| `minWidth` / `maxWidth`          | `number`           | Size constraints.                                                      |
| `minHeight` / `maxHeight`        | `number`           | Size constraints.                                                      |
| `center`                         | `boolean`          | Center on creation. Default `true` when no position specified.         |

The `default*` / controlled split follows React's `defaultValue` / `value` pattern. Use `defaultWidth` for fire-and-forget, `width` + `onBoundsChange` for two-way sync.

### Appearance

| Prop              | Type      | Default | Description                                          |
| ----------------- | --------- | ------- | ---------------------------------------------------- |
| `title`           | `string`  | `""`    | Window title.                                        |
| `transparent`     | `boolean` | `false` | Transparent background. **Creation-only.**           |
| `frame`           | `boolean` | `true`  | Show window chrome. **Creation-only.**               |
| `titleBarStyle`   | `string`  | —       | `"hidden"`, `"hiddenInset"`, etc. **Creation-only.** |
| `vibrancy`        | `string`  | —       | macOS vibrancy effect. **Creation-only.**            |
| `backgroundColor` | `string`  | —       | Background color.                                    |
| `opacity`         | `number`  | —       | Window opacity (0.0–1.0).                            |

**Creation-only** props can't change after the window is created. Changing them logs a dev warning. Set `recreateOnShapeChange` to destroy and recreate the window instead.

### Behavior

| Prop                     | Type      | Default |
| ------------------------ | --------- | ------- |
| `resizable`              | `boolean` | `true`  |
| `movable`                | `boolean` | `true`  |
| `minimizable`            | `boolean` | `true`  |
| `maximizable`            | `boolean` | `true`  |
| `focusable`              | `boolean` | `true`  |
| `alwaysOnTop`            | `boolean` | `false` |
| `skipTaskbar`            | `boolean` | `false` |
| `fullscreen`             | `boolean` | `false` |
| `fullscreenable`         | `boolean` | `true`  |
| `showInactive`           | `boolean` | `false` |
| `ignoreMouseEvents`      | `boolean` | `false` |
| `visibleOnAllWorkspaces` | `boolean` | `false` |

### Events

| Prop                                     | Fires when                          |
| ---------------------------------------- | ----------------------------------- |
| `onFocus`                                | Window gains focus                  |
| `onBlur`                                 | Window loses focus                  |
| `onMaximize` / `onUnmaximize`            | Maximize state changes              |
| `onMinimize` / `onRestore`               | Minimize state changes              |
| `onEnterFullscreen` / `onExitFullscreen` | Fullscreen changes                  |
| `onDisplayChange`                        | Window moves to a different monitor |
| `onBoundsChange`                         | Window resized or moved             |

### Platform

| Prop                   | Platform | Description                                    |
| ---------------------- | -------- | ---------------------------------------------- |
| `trafficLightPosition` | macOS    | `{ x, y }` for close/minimize/maximize buttons |
| `titleBarOverlay`      | Windows  | `{ color, symbolColor, height }`               |
| `targetDisplay`        | all      | `"primary"`, `"cursor"`, or display index      |

### Advanced

| Prop                    | Type                               | Default  | Description                                                      |
| ----------------------- | ---------------------------------- | -------- | ---------------------------------------------------------------- |
| `persistBounds`         | `string`                           | —        | Unique key. Saves bounds to localStorage, restores on reopen.    |
| `recreateOnShapeChange` | `boolean`                          | `false`  | Recreate window when creation-only props change.                 |
| `name`                  | `string`                           | —        | Debug label for DevTools and warning messages.                   |
| `injectStyles`          | `"auto" \| false \| (doc) => void` | `"auto"` | How to copy styles into the child window. `false` for CSS-in-JS. |

## Hooks

All hooks must be called inside a `<Window>`'s children.

```tsx
function WindowContent() {
  // Imperative handle — stable callbacks, state as snapshot
  const win = useCurrentWindow();
  win.focus();
  win.close();
  win.setBounds({ width: 800, height: 600 });

  // Reactive state — each re-renders only when its value changes
  const isFocused = useWindowFocused();
  const isMaximized = useWindowMaximized();
  const isMinimized = useWindowMinimized();
  const isFullscreen = useWindowFullscreen();
  const isVisible = useWindowVisible();
  const bounds = useWindowBounds(); // { x, y, width, height }
  const display = useWindowDisplay(); // { id, bounds, workArea, scaleFactor }
  const state = useWindowState(); // full WindowState object
}
```

`useCurrentWindow()` returns a `WindowHandle` with stable method references — `focus`, `close`, etc. won't change identity across renders.

## Bounds Persistence

```tsx
// Simple — just add a key
<Window
  open={show}
  persistBounds="settings"
  defaultWidth={600}
  defaultHeight={400}
>
  <Settings />
</Window>
```

First open uses defaults. User resizes/moves, bounds save to localStorage. Next open restores them.

For manual control, use the hook directly:

```tsx
import { usePersistedBounds } from "@loc/electron-window";

function PersistentWindow({ children }) {
  const { bounds, save, clear } = usePersistedBounds("my-window", {
    defaultWidth: 800,
    defaultHeight: 600,
  });

  return (
    <Window open {...bounds} onBoundsChange={save}>
      {children}
      <button onClick={clear}>Reset Position</button>
    </Window>
  );
}
```

## Pooled Windows

For windows that appear/disappear frequently (overlays, HUDs, menus), pool pre-warms hidden windows for instant display:

```tsx
import { PooledWindow, createWindowPool } from "@loc/electron-window";

// Create once at module level
const overlayPool = createWindowPool(
  { transparent: true, frame: false }, // shape (creation-only props)
  { minIdle: 1, maxIdle: 3, idleTimeout: 5000 }, // pool config
);

function App() {
  const [show, setShow] = useState(false);
  return (
    <PooledWindow pool={overlayPool} open={show} alwaysOnTop>
      <Overlay />
    </PooledWindow>
  );
}
```

On `open={true}`: acquires a pre-warmed window from the pool (instant). On `open={false}`: hides and returns to pool (no destroy/recreate cost).

Shape props (`transparent`, `frame`, `titleBarStyle`, `vibrancy`) are fixed by the pool. All other props can change per use.

## Common Patterns

### Unsaved changes — prevent close while dirty

```tsx
<Window
  open={showEditor}
  closable={!hasUnsavedChanges}
  onUserClose={() => setShowEditor(false)}
>
  <Editor />
  {hasUnsavedChanges && <SavePrompt />}
</Window>
```

### Window ref — control from parent

```tsx
const ref = useRef<WindowRef>(null);

<Window ref={ref} open={show}>
  <Content />
</Window>;

// Later
ref.current?.focus();
ref.current?.setBounds({ width: 1024, height: 768 });
```

### Multiple independent windows

```tsx
<Window open={showA} title="Window A">
  <ContentA />
</Window>
<Window open={showB} title="Window B">
  <ContentB />
</Window>
```

Each `<Window>` manages its own lifecycle independently.

## Testing

```tsx
import {
  MockWindowProvider,
  MockWindow,
  getMockWindows,
  resetMockWindows,
  simulateMockWindowEvent,
} from "@loc/electron-window/testing";

// Test window management
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

// Test components that use useCurrentWindow()
test("shows focused indicator", () => {
  render(
    <MockWindow state={{ isFocused: true }}>
      <StatusBar />
    </MockWindow>,
  );
  expect(screen.getByText("Focused")).toBeInTheDocument();
});

// Simulate events
test("handles bounds change", async () => {
  resetMockWindows();
  render(
    <MockWindowProvider>
      <MyApp />
    </MockWindowProvider>,
  );
  // ... open window ...
  simulateMockWindowEvent(getMockWindows()[0].id, {
    type: "boundsChanged",
    bounds: { x: 0, y: 0, width: 500, height: 400 },
  });
});
```

## Security

- `webPreferences` cannot be set from the renderer — only via `setupWindowManager` in the main process
- All renderer-supplied props are filtered through an allowlist before reaching `BrowserWindow`
- Child windows can only open `about:blank` — arbitrary URLs are rejected
- IPC validated via schema with origin and frame checks
- Rate limits on window creation (configurable `maxPendingWindows` and `maxWindows`)

## Entry Points

| Import                         | Use                                 |
| ------------------------------ | ----------------------------------- |
| `@loc/electron-window`         | Components, hooks (renderer)        |
| `@loc/electron-window/main`    | `setupWindowManager` (main process) |
| `@loc/electron-window/preload` | IPC bridge (preload script)         |
| `@loc/electron-window/testing` | Mocks for unit tests                |

## License

MIT
