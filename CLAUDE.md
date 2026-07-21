# Project guidance

This repository builds the real qalc/libqalculate engine as a static WebAssembly
application. Preserve that architecture: do not replace the engine with a
JavaScript calculator or duplicate qalc parsing in the UI.

## Important paths

- `libqalculate/` is a pristine upstream Git submodule pinned to v5.12.0.
- `patches/` contains all tracked modifications to upstream files.
- `src/qalc_web.cc` is owned by this repository and copied into the submodule only
  while building.
- `web/` contains hand-written UI assets. `web/qalc.mjs` and `web/qalc.wasm` are
  generated and ignored.
- `scripts/build.sh` is the canonical full build entry point.

## Build sequence

1. `scripts/build-deps.sh` cross-compiles GMP, MPFR, and libxml2.
2. `scripts/apply-patches.sh` applies the WebAssembly patches idempotently and
   copies the web driver into the submodule.
3. `scripts/gen-definitions.sh` embeds libqalculate's XML/JSON data.
4. `scripts/build-lib.sh` builds `build/libqalculate.a`.
5. `scripts/build-app.sh` creates `web/qalc.mjs` and `web/qalc.wasm`.

Build scripts must stay location-independent. Derive paths from `scripts/env.sh`;
never add a home directory, username, IDE path, or local SDK path.

## WebAssembly integration constraints

- The browser build does not use pthreads. `QALC_FIBER_THREADS` replaces the
  producer/consumer `Thread` implementation with cooperative Emscripten fibers.
  This avoids SharedArrayBuffer and COOP/COEP requirements.
- qalc's actual REPL is compiled with `QALC_WEB`. Expressions committed with
  Enter use that REPL so `ans`, commands, and settings retain qalc semantics.
- Live preview uses a separate side-effect-free calculation path and must not
  modify `ans`, history, definitions, or settings.
- Engine calls are serialized and Asyncify-aware. Do not make overlapping calls
  into the module or remove the async queue in `web/app.js`.
- Settings are written by qalc under `/qalc`, mounted as IDBFS, and flushed by the
  front end. History clearing must not remove or reset qalc configuration.
- qalc emits siunitx-oriented LaTeX. `web/app.js` normalizes the small unsupported
  subset before passing it to bundled KaTeX.

## Change checklist

- Keep the submodule clean in commits. Generated `definitions.c`, copied
  `qalc_web.cc`, and build directories must remain untracked.
- If an upstream file changes, regenerate the relevant patch from a pristine
  v5.12.0 checkout and verify `scripts/apply-patches.sh` remains idempotent.
- Run `scripts/build.sh` after C++ or build-script changes.
- Serve `web/` over HTTP and test at minimum: normal evaluation, `ans`, a unit
  conversion, a `set` command across reload, clearing history without losing
  settings, and LaTeX preview/history rendering.
- Do not commit local dependency trees, Emscripten SDKs, object files, logs, or
  generated WebAssembly output.

## Licensing

All additions are GPL-2.0 to match libqalculate. Preserve upstream copyright and
license headers in patched files.
