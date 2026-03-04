# @loc/electron-window

Declarative React components for Electron window management. Opens native windows with `<Window open>`, renders children via portals so your React context (providers, themes, state) works inside child windows without any extra wiring.

**[Full documentation →](https://loc.github.io/electron-window/)**

## Install

```bash
npm install @loc/electron-window
```

## Setup

Three files — one per Electron process:

```ts
// main.ts
import path from "node:path";
import { app, BrowserWindow } from "electron";
import { setupWindowManager } from "@loc/electron-window/main";

const manager = setupWindowManager({
  defaultWindowOptions: {
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  },
});

app.whenReady().then(() => {
  const mainWindow = new BrowserWindow({
    /* ... */
  });
  manager.setupForWindow(mainWindow);
  mainWindow.loadFile("index.html");
});
```

### `setupWindowManager` options

| Option                 | Type                                                                       | Default       | Description                                                                                            |
| ---------------------- | -------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------ |
| `defaultWindowOptions` | `BrowserWindowConstructorOptions \| () => BrowserWindowConstructorOptions` | `{}`          | Applied to every child window. Use a function for dynamic values (e.g. theme-aware `backgroundColor`). |
| `allowedOrigins`       | `string[]`                                                                 | unset (allow) | Restrict which parent renderer origins may use this library's IPC. `["*"]` explicitly allows all.      |
| `devWarnings`          | `boolean`                                                                  | `true` in dev | Log warnings for misuse (blocked props, shape changes, etc.).                                          |
| `maxPendingWindows`    | `number`                                                                   | `100`         | Max windows awaiting creation. Prevents runaway open loops.                                            |
| `maxWindows`           | `number`                                                                   | `50`          | Max total open windows. Registrations beyond this are rejected.                                        |
| `debug`                | `boolean`                                                                  | `false`       | Log every IPC call and event to the console.                                                           |

```ts
// preload.ts — must be bundled (esbuild, webpack, etc.)
import "@loc/electron-window/preload";
```

```tsx
// renderer
import { useState } from "react";
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

| Prop                     | Type                          | Default |
| ------------------------ | ----------------------------- | ------- |
| `resizable`              | `boolean`                     | `true`  |
| `movable`                | `boolean`                     | `true`  |
| `minimizable`            | `boolean`                     | `true`  |
| `maximizable`            | `boolean`                     | `true`  |
| `focusable`              | `boolean`                     | `true`  |
| `alwaysOnTop`            | `boolean \| AlwaysOnTopLevel` | `false` |
| `skipTaskbar`            | `boolean`                     | `false` |
| `fullscreen`             | `boolean`                     | `false` |
| `fullscreenable`         | `boolean`                     | `true`  |
| `showInactive`           | `boolean`                     | `false` |
| `ignoreMouseEvents`      | `boolean`                     | `false` |
| `visibleOnAllWorkspaces` | `boolean`                     | `false` |

`AlwaysOnTopLevel`: `"normal" | "floating" | "torn-off-menu" | "modal-panel" | "main-menu" | "status" | "pop-up-menu" | "screen-saver"`. Higher levels float above lower ones. `true` behaves like `"floating"`.

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

| Prop                   | Platform | Description                                                                                             |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `trafficLightPosition` | macOS    | `{ x, y }` for close/minimize/maximize buttons                                                          |
| `titleBarOverlay`      | Windows  | `{ color, symbolColor, height }`                                                                        |
| `targetDisplay`        | all      | `"primary"`, `"cursor"`, or display index. Centers the window on that display when no explicit `x`/`y`. |

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
  const display = useWindowDisplay(); // DisplayInfo | null
  const state = useWindowState(); // WindowState | null
  const doc = useWindowDocument(); // child window's Document — for UI lib portal containers
}
```

`useCurrentWindow()` returns a `WindowHandle`. The method references (`focus`, `close`, etc.) are stable across renders — safe to pass as effect deps. The handle **object** itself changes when window state changes (to reflect `isFocused`, `bounds`, etc.), so don't use the whole handle as a dep.

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
  { minIdle: 1, maxIdle: 3, idleTimeout: 30000 }, // pool config
  { injectStyles: "auto" }, // optional: "auto" | false | (doc) => void
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

Shape props (`transparent`, `frame`, `titleBarStyle`, `vibrancy`) and `injectStyles` are fixed by the pool definition. Most other props work per-use: `defaultWidth`/`defaultHeight` size the window on each acquire, and behavior props (`alwaysOnTop`, `opacity`, etc.) update live while open. `targetDisplay`, `persistBounds`, and `recreateOnShapeChange` are not accepted on `<PooledWindow>` (TypeScript error) — pool windows are pre-created and reused, so these don't fit the model.

**[Full pooling guide →](https://loc.github.io/electron-window/guides/pooling/)** — pool lifetime, `destroyWindowPool`, HMR handling, and the close-button behavior difference vs `<Window>`.

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

- `webPreferences` cannot be set from the renderer — only via `setupWindowManager` in the main process. The library enforces `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true` (default) on all child windows regardless of consumer config.
- All renderer-supplied props are filtered through an allowlist before reaching `BrowserWindow`
- Child windows can only open `about:blank` — arbitrary URLs are rejected
- IPC main-frame-only enforcement in the generated IPC layer (iframes cannot call the API)
- **Per-WebContents ownership**: a renderer can only mutate (`UpdateWindow`/`DestroyWindow`/`WindowAction`) windows it registered. If you `setupForWindow` on multiple parent windows, each is isolated.
- Rate limits on window creation (`maxPendingWindows`, `maxWindows`, 10-second TTL on pending registrations)
- Window IDs are crypto-random (`crypto.randomUUID()`)

### Origin allowlist

Two ways to restrict which renderer origins can use the library:

**Runtime (main process only)** — works whether or not you bundle your main process:

```ts
setupWindowManager({
  allowedOrigins: ["app://main", "file://"],
});
```

**Build-time (main + preload)** — if you bundle both your main process and preload (most apps do), define a constant in your bundler config. This additionally gates the preload: on a wrong origin, `window.electron_window` is never exposed at all.

```js
// vite.config.ts / esbuild / webpack DefinePlugin — for BOTH main and preload builds
define: {
  __ELECTRON_WINDOW_ALLOWED_ORIGINS__: JSON.stringify(["app://main", "file://"]),
}
```

Both mechanisms validate the same thing (the main frame's origin, since iframes are already blocked). Use the build-time define for the extra preload-side gate; use the runtime config if you don't bundle your main process.

**[Full security guide →](https://loc.github.io/electron-window/guides/security/)**

## Entry Points

| Import                         | Use                                 |
| ------------------------------ | ----------------------------------- |
| `@loc/electron-window`         | Components, hooks (renderer)        |
| `@loc/electron-window/main`    | `setupWindowManager` (main process) |
| `@loc/electron-window/preload` | IPC bridge (preload script)         |
| `@loc/electron-window/testing` | Mocks for unit tests                |

## License

MIT
