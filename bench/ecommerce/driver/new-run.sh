#!/usr/bin/env bash
# Make a fresh run folder for one builder: a copy of the arm's starter (with its node_modules hard-linked or copied, so
# no install is needed) and an empty log folder.
#
#   bench/ecommerce/driver/new-run.sh [--bench <bench-dir>] <builder-id> line|plain [runs-dir]
#
# --bench (or BENCH_DIR) picks the bench (default bench/ecommerce; e.g. bench/lending, the held-out spec): its
# starter/ (line) or starter-plain/ (plain) is copied, and runs go to <bench-dir>/runs by default.
# Prints the project folder. The builder then works ONLY in that folder, through plan-cli.mjs (line) or plain-cli.mjs
# (plain), with BENCH_PROJECT, BENCH_LOG, BENCH_BUILDER and BENCH_DIR set as printed.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
bench="${BENCH_DIR:-$here}"
if [ "${1:-}" = "--bench" ]; then bench="${2:?bench dir}"; shift 2; fi
bench="$(cd "$bench" && pwd)"
builder="${1:?builder id}"; arm="${2:?line|plain}"
runs="${3:-$bench/runs}"
case "$arm" in line) starter="$bench/starter";; plain) starter="$bench/starter-plain";; *) echo "arm must be line or plain" >&2; exit 2;; esac
if [ ! -d "$starter" ]; then echo "$bench has no $(basename "$starter")/ for the $arm arm" >&2; exit 2; fi
dir="$runs/$builder"
if [ -e "$dir" ]; then echo "$dir already exists; move it away first" >&2; exit 1; fi
mkdir -p "$dir/logs"
rsync -a --exclude .next --exclude node_modules "$starter/" "$dir/project/"
if [ -d "$starter/node_modules" ]; then cp -Rc "$starter/node_modules" "$dir/project/node_modules" 2>/dev/null || cp -R "$starter/node_modules" "$dir/project/node_modules"; fi
( cd "$dir/project" && git init -q && git add -A && git -c user.name=bench -c user.email=bench@localhost commit -qm "starter" )
echo "export BENCH_PROJECT=$dir/project BENCH_LOG=$dir/logs/calls.jsonl BENCH_BUILDER=$builder BENCH_DIR=$bench"
