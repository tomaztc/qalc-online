# Agent notes

## Project

This is the qalc/libqalculate 5.12.0 engine compiled to WebAssembly, with a
static UI in `web/`.

## Layout

- `libqalculate/`: pristine upstream submodule pinned to v5.12.0.
- `patches/`: tracked WebAssembly adaptations to upstream files.
- `src/qalc_web.cc`: web driver copied into the submodule during builds.
- `scripts/build.sh`: canonical full build.
- `web/`: hand-written UI. `qalc.mjs` and `qalc.wasm` are generated and ignored.
- `tests/unit/`: fast Vitest/jsdom tests using a mocked WebAssembly boundary.
- `tests/e2e/`: Playwright tests.

## Important constraints

- Keep the submodule clean in commits. Never commit generated `definitions.c`, copied `qalc_web.cc`, or build output inside it.
- Build paths must come from `scripts/env.sh`.
- The engine is single-threaded. `QALC_FIBER_THREADS` uses cooperative Emscripten fibers so the site needs no SharedArrayBuffer or special HTTP headers.
- Committed expressions go through the real qalc REPL to preserve commands, `ans`, and configuration. Live preview must remain side-effect-free.
- Serialize calls into WebAssembly and preserve the async engine queue in `web/app.js`.
- Keep `web/qalc-loader.js` as the stable boundary around generated `qalc.mjs`; unit tests mock this tracked module and must not require generated build files.
- `/qalc` is session-only; UI history in localStorage is the sole persisted state and is replayed through the REPL on startup.

## Build and test

Install test dependencies and run the fast UI tests without an engine build:

```sh
npm ci
npm run test:unit
```

With Emscripten 6.0.3 active, build and run the real-engine browser tests:

```sh
git submodule update --init --recursive
scripts/build.sh
npx playwright install chromium
npm run test:e2e
```

Use `scripts/serve.sh` for additional manual browser testing. Confirm `git -C libqalculate status --short` is empty and that generated dependencies, objects, logs, and WebAssembly files remain untracked.
