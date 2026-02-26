# Pooled Window Example

This example demonstrates `PooledWindow` and `createWindowPool` for instant overlay display.

## Features Demonstrated

- Pre-warming hidden windows for zero-latency open
- Pool shape props (fixed at pool creation: `transparent`, `frame`)
- Per-use props (`alwaysOnTop`, `title`, event handlers)
- Pool sizing config (`minIdle`, `maxIdle`, `idleTimeout`)

## Files

- `App.tsx` - React application with pooled window usage
- `main.ts` / `preload.ts` - Shared with `examples/basic/`. Copy or symlink from there.

## Shared main/preload

This example doesn't include its own `main.ts` or `preload.ts` — it uses the same
Electron setup as `examples/basic/`. Copy those files or point your bundler at them.

## Code Overview

```tsx
// Define pool once at module level
const overlayPool = createWindowPool(
  { transparent: true, frame: false }, // shape: creation-only, shared by all pool windows
  { minIdle: 1, maxIdle: 3, idleTimeout: 5000 }, // pool sizing
);

// Use anywhere — acquire is instant when a warm window is available
<PooledWindow pool={overlayPool} open={show} alwaysOnTop>
  <Overlay />
</PooledWindow>;
```
