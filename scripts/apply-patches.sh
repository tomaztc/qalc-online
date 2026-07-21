#!/usr/bin/env bash
# Apply the qalc-online patches to the pristine libqalculate submodule and copy
# in the web driver. Idempotent: skips patches that are already applied.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

if [ ! -f "$QSUB/configure.ac" ]; then
  echo "ERROR: libqalculate submodule not found at $QSUB" >&2
  echo "Run: git submodule update --init --recursive" >&2
  exit 1
fi

cd "$QSUB"
for patch in "$QROOT"/patches/*.patch; do
  [ -e "$patch" ] || continue
  if git apply --reverse --check "$patch" >/dev/null 2>&1; then
    echo "already applied: $(basename "$patch")"
  else
    echo "applying: $(basename "$patch")"
    git apply "$patch"
  fi
done

# The web driver lives in the main repo; copy it alongside qalc.cc so the build
# picks it up with the same include paths.
cp "$QROOT/src/qalc_web.cc" "$QSUB/src/qalc_web.cc"
echo "patches applied; qalc_web.cc installed"
