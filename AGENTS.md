# Agent notes

## Project

This is the real qalc/libqalculate 5.12.0 engine compiled to WebAssembly, with a
static UI in `web/`. Do not replace qalc parsing or evaluation with JavaScript.

## Layout

- `libqalculate/`: pristine upstream submodule pinned to v5.12.0.
- `patches/`: tracked WebAssembly adaptations to upstream files.
- `src/qalc_web.cc`: web driver copied into the submodule during builds.
- `scripts/build.sh`: canonical full build.
- `web/`: hand-written UI. `qalc.mjs` and `qalc.wasm` are generated and ignored.

## Important constraints

- Keep the submodule clean in commits. Never commit generated `definitions.c`,
  copied `qalc_web.cc`, or build output inside it.
- Build paths must come from `scripts/env.sh`; never hardcode a username, home
  directory, SDK location, or machine-specific setting.
- The engine is single-threaded. `QALC_FIBER_THREADS` uses cooperative Emscripten
  fibers so the site needs no SharedArrayBuffer or special HTTP headers.
- Committed expressions go through the real qalc REPL to preserve commands,
  `ans`, and configuration. Live preview must remain side-effect-free.
- Serialize calls into WebAssembly and preserve the async engine queue in
  `web/app.js`.
- qalc settings live in IDBFS under `/qalc`; UI history lives in localStorage.
  Clearing history must not clear settings.

## Build and test

With Emscripten 6.0.3 active:

```sh
git submodule update --init --recursive
scripts/build.sh
scripts/serve.sh
```

After engine or UI changes, check normal evaluation, `ans`, a unit conversion,
`set precision 30` across reload, and clearing history without losing settings.

Before committing, confirm `git -C libqalculate status --short` is empty and that
generated dependencies, objects, logs, and WebAssembly files remain untracked.

All project additions are GPL-2.0.
