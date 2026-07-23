# Qalc Online

An unofficial, static browser build of [Qalculate!](https://qalculate.github.io/) and its `qalc` CLI using WebAssembly. It uses the libqalculate 5.12.0 engine, including units, variables, functions, uncertainty calculation, symbolic algebra, physical constants, calculus, matrices, dates, statistics, number bases, and conversions.

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

|     |     |
| --- | --- |
| `libqalculate/` | Upstream submodule pinned to v5.12.0 |
| `patches/` | Upstream adaptations for WebAssembly |
| `src/qalc_web.cc` | WebAssembly driver for JS |
| `scripts/` | Dependency/library/app builds |
| `web/` | Static web app |
