#!/usr/bin/env bash
# Make a fresh run folder for one builder: a copy of the arm's starter (with its node_modules hard-linked or copied, so
# no install is needed) and an empty log folder.
#
#   bench/ecommerce/driver/new-run.sh <builder-id> line|plain [runs-dir]
#
# Prints the project folder. The builder then works ONLY in that folder, through plan-cli.mjs (line) or plain-cli.mjs
# (plain), with BENCH_PROJECT, BENCH_LOG and BENCH_BUILDER set as printed.
set -euo pipefail
builder="${1:?builder id}"; arm="${2:?line|plain}"
here="$(cd "$(dirname "$0")/.." && pwd)"
runs="${3:-$here/runs}"
case "$arm" in line) starter="$here/starter";; plain) starter="$here/starter-plain";; *) echo "arm must be line or plain" >&2; exit 2;; esac
dir="$runs/$builder"
if [ -e "$dir" ]; then echo "$dir already exists; move it away first" >&2; exit 1; fi
mkdir -p "$dir/logs"
rsync -a --exclude .next --exclude node_modules "$starter/" "$dir/project/"
if [ -d "$starter/node_modules" ]; then cp -Rc "$starter/node_modules" "$dir/project/node_modules" 2>/dev/null || cp -R "$starter/node_modules" "$dir/project/node_modules"; fi
( cd "$dir/project" && git init -q && git add -A && git -c user.name=bench -c user.email=bench@localhost commit -qm "starter" )
echo "export BENCH_PROJECT=$dir/project BENCH_LOG=$dir/logs/calls.jsonl BENCH_BUILDER=$builder"
