#!/usr/bin/env bash
# Prepare a patched source tree under build/ without modifying the pristine
# libqalculate submodule. The staged tree is reused until the pinned revision or
# an integration patch changes.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

if [ ! -f "$QSUB/configure.ac" ]; then
  echo "ERROR: libqalculate submodule not found at $QSUB" >&2
  echo "Run: git submodule update --init --recursive" >&2
  exit 1
fi

source_signature="$({
  git -C "$QSUB" rev-parse HEAD
  for patch in "$QROOT"/patches/*.patch; do
    [ ! -e "$patch" ] || sha256sum "$patch" | cut -d' ' -f1
  done
} | sha256sum | cut -d' ' -f1)"
signature_file="$QBUILD/.source-signature"

if [ -f "$QSRCDIR/configure.ac" ] &&
   [ -f "$signature_file" ] &&
   [ "$(<"$signature_file")" = "$source_signature" ]; then
  echo "patched source already prepared"
  exit 0
fi

staging="$QBUILD/source.new"
rm -rf "$staging"
mkdir -p "$staging"
git -C "$QSUB" archive --format=tar HEAD | tar -xf - -C "$staging"

for patch in "$QROOT"/patches/*.patch; do
  [ -e "$patch" ] || continue
  echo "applying to staged source: $(basename "$patch")"
  (cd "$staging" && GIT_CEILING_DIRECTORIES="$QBUILD" git apply "$patch")
done

rm -rf "$QSRCDIR"
mv "$staging" "$QSRCDIR"
printf '%s\n' "$source_signature" > "$signature_file"
echo "patched source prepared in $QSRCDIR"
