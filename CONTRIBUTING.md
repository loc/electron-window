# Contributing

## Setup

```bash
yarn install
yarn generate:ipc   # required before typecheck/test — see below
```

## Two things that will trip you up

**`src/generated-ipc/` is gitignored.** Typecheck and tests import from it. `yarn build` regenerates it automatically (via `prebuild`), but `yarn typecheck` and `yarn test` don't. Run `yarn generate:ipc` after cloning or pulling schema changes.

**`@marshallofsound/ipc` is pinned to `~2.6`.** `scripts/patch-ipc-validators.mjs` mutates the generated IPC code (replaces `return true` with `return __originHook(...)` in the validators). It string-matches the output shape. A major bump in the IPC library will likely break the patch — the build script asserts the replacement happened, so you'll get a hard error rather than a silent no-op.

## Commands

```bash
yarn test           # unit + integration (vitest)
yarn test:e2e       # Playwright (builds library + test app first)
yarn typecheck      # tsc --noEmit
yarn lint           # oxlint
yarn format         # oxfmt (writes in place)
```

## Commits

This repo uses conventional commits for semantic-release:

- `fix:` → patch
- `feat:` → minor
- `feat!:` or `BREAKING CHANGE:` in body → major
- `chore:`, `docs:`, `test:`, `ci:`, `build:`, `style:` → no release
