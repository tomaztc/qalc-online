# Agent notes

## Project

This is the qalc/libqalculate 5.12.0 engine compiled to WebAssembly, with a
static UI in `web/`. A dedicated module Web Worker owns the stateful engine so
calculations do not block the browser's main thread.

## Layout

- `libqalculate/`: pristine upstream submodule pinned to v5.12.0.
- `patches/`: tracked WebAssembly adaptations to upstream files.
- `src/qalc_web.cc`: web driver copied into the submodule during builds.
- `scripts/build.sh`: canonical full build.
- `web/app.js`: main-thread UI and history/session orchestration.
- `web/qalc-client.js`: main-thread RPC proxy and async engine queue.
- `web/qalc-worker.js`: module worker entry point and RPC dispatcher.
- `web/qalc-engine.js`: worker-owned Wasm, REPL, filesystem, and exchange-rate logic.
- `web/qalc-input.js`: input restrictions shared by the UI proxy and worker.
- `web/qalc-loader.js`: stable boundary around generated Emscripten output.
- `web/qalc.mjs` and `web/qalc.wasm`: generated and ignored.
- `tests/`: Playwright tests against the real WebAssembly engine.

## Important constraints

- Keep the submodule clean in commits. Never commit generated `definitions.c`, copied `qalc_web.cc`, or build output inside it.
- Build paths must come from `scripts/env.sh`.
- The engine is single-threaded and must remain owned by one dedicated Web Worker. `QALC_FIBER_THREADS` uses cooperative Emscripten fibers within that worker, so the site needs no SharedArrayBuffer or special HTTP headers.
- Committed expressions go through the real qalc REPL to preserve commands, `ans`, and configuration. Live preview must remain side-effect-free.
- Never instantiate or call the Wasm engine on the main thread. UI code talks to it through `web/qalc-client.js`.
- Serialize calls into WebAssembly. Preserve the async proxy queue in `web/qalc-client.js` and the definitive worker-side queue in `web/qalc-engine.js`.
- Preserve preview revision checks so stale queued previews are dropped before dispatch and stale worker responses are ignored.
- Clearing the session terminates the old worker, including any active calculation, then creates a fresh worker.
- Keep `web/qalc-loader.js` as the stable boundary around generated `qalc.mjs`.
- `/qalc` is session-only; UI history in localStorage is the sole persisted state and is replayed through the REPL on startup.

## Build and test

With Emscripten 6.0.3 active, build and run the browser tests:

```sh
npm ci
git submodule update --init --recursive
scripts/build.sh
npx playwright install chromium
npm test
```
