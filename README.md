# qalc online

A static, one-page browser build of [Qalculate!](https://qalculate.github.io/) and
its `qalc` command-line interface. The calculator engine runs locally as
WebAssembly; calculations and settings do not require a server.

## Features

- The real libqalculate 5.12.0 engine, including units, variables, functions,
  symbolic algebra, calculus, matrices, dates, number bases, and conversions.
- qalc-compatible expressions, commands, and configuration.
- Live, side-effect-free previews while typing.
- Persistent qalc settings through IndexedDB.
- Persistent expression history.
- Plain static files: no backend, SharedArrayBuffer, or special HTTP headers.

The web-specific integration is intentionally small. The upstream source is kept
as a pinned Git submodule, and the required WebAssembly adaptations are stored as
patches in [`patches/`](patches/).

## Try it locally

Clone with submodules:

```sh
git clone --recursive https://github.com/YOUR_ACCOUNT/qalc-online.git
cd qalc-online
```

Install and activate Emscripten. The tested version is 6.0.3:

```sh
git clone https://github.com/emscripten-core/emsdk.git
./emsdk/emsdk install 6.0.3
./emsdk/emsdk activate 6.0.3
source ./emsdk/emsdk_env.sh
```

Build and serve:

```sh
scripts/build.sh
scripts/serve.sh
```

Then open <http://localhost:8000>.

The first build downloads and cross-compiles GMP, MPFR, and libxml2. Subsequent
builds reuse `deps/`, `wasm-prefix/`, and `build/`.

### Build prerequisites

- A Unix-like environment (Linux is used in CI)
- Emscripten 6.0.3 (`emcc`, `em++`, `emar`)
- Bash, curl, tar, make, and standard autotools build utilities
- Python 3 only for the optional local static server

All scripts derive paths from the repository root; no user-specific paths or
shell startup configuration are required. Dependency versions and build
parallelism can be overridden with environment variables documented in
[`scripts/env.sh`](scripts/env.sh).

## Tests

Install the JavaScript test dependencies and run the fast UI suite:

```sh
npm ci
npm test
```

The unit tests use a controlled WebAssembly boundary and do not require a qalc
build. They cover boot and failure handling, serialized engine access, preview
isolation, output parsing/rendering, history replay, and persistence behavior.

After `scripts/build.sh`, run the browser tests against the real qalc engine:

```sh
npx playwright install chromium
npm run test:e2e
```

The browser suite checks evaluation, `ans`, unit conversion, qalc settings
across reload, and clearing UI history without losing those settings. Both
suites run in the deployment workflow before the Pages artifact is uploaded.

## GitHub Pages

The workflow in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):

1. checks out this repository and its submodule;
2. installs Emscripten with `emscripten-core/setup-emsdk`;
3. builds the C/C++ dependencies, libqalculate, and the web module;
4. uploads `web/` and deploys it through GitHub Pages.

After pushing the repository, choose **GitHub Actions** as the Pages source in
the repository settings. Pushes to `main` deploy automatically; the workflow can
also be run manually. Nothing in this repository publishes until it is pushed to
GitHub and the workflow is enabled there.

## Source layout

| Path | Purpose |
| --- | --- |
| `libqalculate/` | Upstream submodule pinned to tag v5.12.0 |
| `patches/` | Minimal upstream adaptations for cooperative WebAssembly fibers and the web REPL |
| `src/qalc_web.cc` | JavaScript-facing WebAssembly driver |
| `scripts/` | Reproducible dependency, library, and application builds |
| `web/` | Static UI and generated `qalc.mjs` / `qalc.wasm` output |
| `AGENTS.md` | Concise implementation and maintenance notes |

## Updating libqalculate

The tested submodule commit is `d01cfdae6f965bf9264af3b52db8f5b0345fe1da`
(tag `v5.12.0`). To update it:

1. move the submodule to the desired upstream commit;
2. check both patches with `git -C libqalculate apply --check`;
3. refresh patches if upstream changed the affected files;
4. update `QALC_VERSION` in `scripts/env.sh`;
5. perform a clean build and browser regression test.

Do not commit patched or generated files inside the submodule. The build applies
the patches and generates `definitions.c` automatically.

## Known platform differences

The mathematical and command parser is qalc itself, but browser constraints mean
some operating-system integrations are unavailable. In particular, launching
external plotting programs and libcurl-based live exchange-rate downloads are
not part of this static build. The definition and exchange-rate data shipped by
libqalculate is embedded in the WebAssembly module.

## License

This project is licensed under the GNU General Public License, version 2, matching
libqalculate. See [LICENSE](LICENSE). Qalculate! and libqalculate are developed by
their respective upstream contributors; this project is not an official
Qalculate! distribution.
