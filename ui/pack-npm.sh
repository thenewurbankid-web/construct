#!/usr/bin/env bash
# #485 -- assembles the @line/cockpit npm package into packages/cockpit/
# from ui/build.sh's compiled outputs plus a vendored, read-only copy of the
# repo's core (`packages/core/`, `packages/ast/`, `packages/engine/`,
# `packages/cli/` -- moved out of root `src/`/`bin/` by the packages/
# restructuring) -- see packages/cockpit-meta/README.md (and
# ui/server/scripts/build.mjs's header) for exactly why core still needs to
# ship alongside the compiled server: ui/server/dist/index.mjs still imports
# it by relative path ('../../../packages/core/...'), and packages/engine/
# botRunner.mjs resolves packages/cli/construct.mjs relative to itself at
# runtime, so the vendored copy MUST stay at that same depth
# (packages/cockpit/packages/{core,ast,engine,cli}/ siblings of
# packages/cockpit/ui/server/dist/) or those imports break. This is a copy,
# never a move -- the real packages/{core,ast,engine,cli}/ are untouched
# (#480's parallel core/CLI package split owns actually publishing them
# standalone).
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
mkdir -p "$PKG/packages"
cp -r packages/core "$PKG/packages/core"
cp -r packages/ast "$PKG/packages/ast"
cp -r packages/engine "$PKG/packages/engine"
cp -r packages/cli "$PKG/packages/cli"

cp "$META/package.json" "$PKG/package.json"
cp "$META/launch.mjs" "$PKG/launch.mjs"
cp "$META/README.md" "$PKG/README.md"
cp "$META/LICENSE" "$PKG/LICENSE"

echo "Packed -> $PKG"
