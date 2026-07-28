# Qalc Online

[![Build test and deploy](https://github.com/tomaztc/qalc-online/actions/workflows/pages.yml/badge.svg)](https://github.com/tomaztc/qalc-online/actions/workflows/pages.yml)

Try Qalc Online: [https://tomaztc.github.io/qalc-online/](https://tomaztc.github.io/qalc-online/)

An unofficial, static browser build of [Qalculate!](https://qalculate.github.io/)'s `qalc` CLI using WebAssembly. It uses the libqalculate 5.12.0 engine, with support for units, conversions, variables, functions, symbolic algebra, arbitrary precision, uncertainty propagation, interval arithmetic, linear algebra, calculus, complex numbers, dates, currencies, number bases, statistics, and more, with many built-in functions, units and constants. The app supports live previews as you type, persistently stored calculation history, and all `qalc` methods except for plotting.

## Build

1. Clone with submodules:

```sh
git clone --recursive https://github.com/tomaztc/qalc-online.git
cd qalc-online
```

2. Install and activate Emscripten 6.0.3:

```sh
git clone https://github.com/emscripten-core/emsdk.git
./emsdk/emsdk install 6.0.3
./emsdk/emsdk activate 6.0.3
source ./emsdk/emsdk_env.sh
```

3. Build and serve:

```sh
scripts/build.sh
scripts/serve.sh
```

## Layout

| Path | Purpose |
| --- | --- |
| `libqalculate/` | Upstream submodule pinned to v5.12.0 |
| `patches/` | Upstream adaptations for WebAssembly |
| `src/qalc_web.cc` | WebAssembly driver for JS |
| `scripts/` | Dependency/library/app builds |
| `web/` | Static web app; a dedicated Web Worker owns the stateful engine |
