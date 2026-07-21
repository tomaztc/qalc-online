#!/usr/bin/env bash
# One-shot build: dependencies -> patches -> definitions -> libqalculate -> app.
# Safe to re-run; each stage skips work that is already up to date.
set -euo pipefail
here="$(dirname "${BASH_SOURCE[0]}")"

bash "$here/build-deps.sh"
bash "$here/apply-patches.sh"
bash "$here/gen-definitions.sh"
bash "$here/build-lib.sh"
bash "$here/build-app.sh"

echo
echo "Build complete. Serve the app with:"
echo "  scripts/serve.sh        # then open http://localhost:8000"
