# Basic Example

This example demonstrates basic window management with `@loc/electron-window`.

## Features Demonstrated

- Opening and closing windows declaratively with `<Window open={...}>`
- User close handling with `onUserClose`
- Window props (title, dimensions, constraints)
- Bounds persistence with `persistBounds`
- Using hooks inside windows (`useCurrentWindow`, `useWindowBounds`, `useWindowFocused`)

## Files

- `main.ts` - Electron main process setup
- `preload.ts` - Preload script setup
- `App.tsx` - React application with window management

## Setup

1. Build the library: `yarn build`
2. Bundle the preload script with esbuild or similar
3. Run with Electron

## Code Overview

```tsx
// Simple declarative window
<Window
  open={showSettings}
  onUserClose={() => setShowSettings(false)}
  title="Settings"
  defaultWidth={600}
  defaultHeight={400}
  persistBounds="settings-window"
>
  <SettingsContent />
</Window>
```
