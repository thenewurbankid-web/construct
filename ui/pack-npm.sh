#!/usr/bin/env bash
# #485 -- assembles the @line/cockpit npm package into packages/cockpit/
# from ui/build.sh's compiled outputs plus a vendored, read-only copy of the
# repo's core (`src/`, `bin/`) -- see packages/cockpit-meta/README.md (and
# ui/server/scripts/build.mjs's header) for exactly why core still needs to
# ship alongside the compiled server: ui/server/dist/index.mjs still imports
# it by relative path ('../../../src/...'), so the vendored copy MUST stay
# at that same depth (packages/cockpit/{src,bin}/ siblings of
# packages/cockpit/ui/server/dist/) or those imports break. This is a copy,
# never a move -- the real src/ and bin/ are untouched (#480's parallel
# core/CLI package split owns actually relocating them).
#
# Run `ui/build.sh` first. Then: ui/pack-npm.sh && (cd packages/cockpit && npm pack --dry-run)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
META="ui/cockpit-npm-meta"
PKG="packages/cockpit"

[ -f ui/server/dist/index.mjs ] || { echo "Run ui/build.sh first (ui/server/dist/index.mjs missing)." >&2; exit 1; }
[ -f ui/client/.next/standalone/server.js ] || { echo "Run ui/build.sh first (ui/client/.next/standalone/server.js missing)." >&2; exit 1; }

rm -rf "$PKG"
mkdir -p "$PKG/ui/server/dist" "$PKG/ui/client/standalone"

cp -r ui/server/dist/. "$PKG/ui/server/dist/"
cp -r ui/client/.next/standalone/. "$PKG/ui/client/standalone/"
cp -r src "$PKG/src"
cp -r bin "$PKG/bin"

cp "$META/package.json" "$PKG/package.json"
cp "$META/launch.mjs" "$PKG/launch.mjs"
cp "$META/README.md" "$PKG/README.md"
cp "$META/LICENSE" "$PKG/LICENSE"

echo "Packed -> $PKG"
