#!/usr/bin/env bash
# Serve the built web app locally. No special headers are required (the build
# uses no SharedArrayBuffer), so any static file server works.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
PORT="${1:-8000}"
cd "$QWEB"
echo "Serving $QWEB at http://localhost:$PORT  (Ctrl-C to stop)"
exec python3 -m http.server "$PORT"
