#!/usr/bin/env bash
# Generate libqalculate/definitions.c by embedding the XML definition data files
# as C string literals. This mirrors the recipe in libqalculate's own
# libqalculate/Makefile.am (the COMPILED_DEFINITIONS path), so no runtime
# filesystem access is needed for units/functions/currencies/etc.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

DATA="$QSUB/data"
OUT="$QSUB/libqalculate/definitions.c"

# Map each data file to the C symbol declared in libqalculate/definitions.h.
# (basename with '.' and '-' replaced by '_', matching the upstream Makefile.)
files=(
  currencies.xml.in datasets.xml.in elements.xml.in eurofxref-daily.xml
  functions.xml.in planets.xml.in prefixes.xml.in units.xml.in
  variables.xml.in rates.json
)

: > "$OUT"
for f in "${files[@]}"; do
  src="$DATA/$f"
  [ -f "$src" ] || { echo "ERROR: missing data file $src" >&2; exit 1; }
  # Symbol name matches libqalculate/definitions.h, which expects the *.xml name
  # (upstream compiles the .xml files produced from .xml.in). Strip the trailing
  # ".in" before turning '.'/'-' into '_', so elements.xml.in -> elements_xml.
  base="${f%.in}"
  sym="$(printf '%s' "$base" | sed 's/[.-]/_/g')"
  printf 'const char * %s = ' "$sym" >> "$OUT"
  # Escape backslashes and quotes, strip leading whitespace, wrap each line.
  sed -e 's/^[ \t]*//' -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/^/"/' -e 's/$/\\n"/' "$src" >> "$OUT"
  printf ';\n\n' >> "$OUT"
done
# definitions.h also declares this (GResource path, unused here).
printf 'const char * definitions_gresource_xml = "";\n' >> "$OUT"

echo "generated $OUT ($(wc -l < "$OUT") lines)"
