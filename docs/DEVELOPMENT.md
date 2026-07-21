# Development

## Checkout

```sh
git clone --recursive REPOSITORY_URL
cd qalc-online
```

If the repository was cloned without submodules:

```sh
git submodule update --init --recursive
```

## Build

Activate Emscripten 6.0.3, then run:

```sh
scripts/build.sh
```

Individual stages can be run independently:

```sh
scripts/build-deps.sh
scripts/apply-patches.sh
scripts/gen-definitions.sh
scripts/build-lib.sh
scripts/build-app.sh
```

Generated files are written under `deps/`, `wasm-prefix/`, `build/`, and as
`web/qalc.mjs` / `web/qalc.wasm`. All are ignored by Git.

## Serve and test

```sh
scripts/serve.sh 8000
```

Do not open `web/index.html` directly with `file://`; browsers load WebAssembly
modules through HTTP. No custom response headers are necessary.

Manual regression cases:

```text
1+1
sqrt(2)
5 km + 3 mi to m
factor 6x^2+11x+3
2*ans
set precision 30
pi
```

Also verify:

1. Enter commits without blocking the page.
2. Live preview does not change `ans`.
3. Settings survive reload.
4. Clearing UI history does not clear settings.
5. LaTeX mode renders both preview and committed history.

## Working with the submodule patches

Normal builds leave generated/copied files and patch modifications in the
submodule working tree. To return it to the pinned upstream state after a build:

```sh
git -C libqalculate reset --hard
git -C libqalculate clean -fdx
```

Only run those commands when you are certain there are no intentional uncommitted
changes inside the submodule.

To edit an integration patch:

1. start from a clean submodule;
2. apply the current patches with `scripts/apply-patches.sh`;
3. edit the relevant upstream files;
4. regenerate the patch using `git -C libqalculate diff -- PATHS`;
5. restore the submodule and verify both `git apply --check` and a clean build.

The web driver itself belongs in `src/qalc_web.cc`, not permanently inside the
submodule.

## GitHub Pages workflow

The deployment workflow builds from source on `ubuntu-latest`, caches the
cross-compiled dependency prefix, and deploys the complete `web/` directory. The
generated module uses relative asset URLs, so it works on both user/organization
Pages and project Pages paths.

To test only the build portion of CI locally, use a clean clone with submodules,
activate the same Emscripten version, and run `scripts/build.sh`.
