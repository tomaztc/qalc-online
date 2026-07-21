# Architecture

## Overview

The application consists of a small browser UI around the actual qalc CLI and
libqalculate. Emscripten compiles the C/C++ stack to one WebAssembly module and an
ES module loader. The remaining files are static HTML, CSS, JavaScript, KaTeX,
and fonts.

```text
web/app.js
    │ committed lines / side-effect-free previews
    ▼
src/qalc_web.cc
    │ drives the qalc REPL on a cooperative fiber
    ▼
patched src/qalc.cc
    │
    ▼
libqalculate + GMP + MPFR + libxml2
```

## Why the real REPL is retained

qalc includes much more than expression evaluation. It owns command dispatch,
the `ans` chain, modes, settings, local definitions, output variants, and qalc.cfg
semantics. Compiling `qalc.cc` preserves those behaviours and avoids maintaining
a second parser in JavaScript.

The `QALC_WEB` patch renames `main` to `qalc_main`, replaces terminal line input
with a web callback, disables interactive yes/no prompts, exposes persistence and
preview helpers, and keeps the rest of the command loop intact.

## Cooperative threads

Upstream libqalculate uses pthread-backed worker objects. Browser pthreads require
SharedArrayBuffer and cross-origin isolation headers, which are undesirable for a
zero-configuration static site.

Under `QALC_FIBER_THREADS`, the patched `Thread` class uses Emscripten fibers and
a byte queue. A write switches into the worker fiber; an empty read yields to the
caller. This matches the existing producer/consumer use of these workers without
requiring true parallelism. Consequently, the app works on ordinary static hosts,
including GitHub Pages, without COOP/COEP headers.

Emscripten Asyncify supports the fiber stack switches. Calls from the front end
are serialized because WebAssembly execution and qalc state are single-threaded.

## Definitions and runtime filesystem

Units, functions, variables, currencies, datasets, planets, elements, and bundled
exchange rates are compiled into `definitions.c` as string literals. This mirrors
libqalculate's `COMPILED_DEFINITIONS` build mode and avoids fetching definition
files at runtime.

The only persistent runtime filesystem is `/qalc`. The browser mounts it with
IDBFS and sets `QALCULATE_USER_DIR` through a C entry point before starting qalc.
qalc therefore reads and writes its normal configuration and local-definition
files. JavaScript requests an IndexedDB flush after committed commands.

Expression history shown by the UI is stored separately in localStorage. Clearing
that history deliberately does not touch IDBFS or qalc.cfg.

## Preview and commit paths

The UI has two evaluation paths:

- **Preview** calls `Calculator::calculateAndPrint` with the current qalc options.
  It is side-effect-free and does not update `ans`, history, or configuration.
- **Commit** feeds a line into the real qalc REPL. It updates state exactly as the
  CLI would, captures terminal and LaTeX output, then persists qalc configuration.

KaTeX is vendored locally. qalc's LaTeX printer uses a few siunitx commands that
KaTeX does not implement; the UI normalizes those commands before rendering.

## Dependency choices

- GMP 6.3.0
- MPFR 4.2.2
- libxml2 2.12.10
- libqalculate 5.12.0
- Emscripten 6.0.3

libcurl, ICU, readline, NLS, and native threading are intentionally omitted from
the WebAssembly build. KaTeX is included as static runtime assets.
