#!/usr/bin/env bash
# Install every folder the test suite needs, in one step (#853): `npm ci` in each folder listed by
# `node packages/tools/dev/run-tests.mjs --install-dirs` (the same list `npm test` checks before it runs),
# each one serialized through heavy.sh so it waits for the machine-wide heavy-job lock and free RAM.
#
#   npm run install:all
#   packages/tools/dev/install-all.sh [--dry-run]     # --dry-run prints what it would run, runs nothing
#
# Skips a folder with no package.json, and a folder whose node_modules is a symlink (a git worktree linked to the
# main checkout's install by link-worktree-node-modules.sh): `npm ci` there would replace the shared install.
# Safe to run under heavy.sh itself (`heavy.sh npm run install:all`): each inner heavy.sh sees it is nested and runs
# `npm ci` directly instead of waiting for the lock its ancestor holds (#939).
# Stops at the first folder whose install fails, with its exit status.
set -u
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../../.." && pwd -P)
dry=0
case "${1:-}" in
  --dry-run) dry=1 ;;
  '') ;;
  *) echo "usage: install-all.sh [--dry-run]" >&2; exit 2 ;;
esac

dirs=$(node "$here/run-tests.mjs" --install-dirs) || { echo "install-all: could not read the folder list from run-tests.mjs" >&2; exit 1; }
for d in $dirs; do
  dir="$root/$d"
  if [ ! -f "$dir/package.json" ]; then
    echo "install-all: skip $d (no package.json)"
    continue
  fi
  if [ -L "$dir/node_modules" ]; then
    echo "install-all: skip $d (node_modules is a symlink to a shared install)"
    continue
  fi
  echo "install-all: $d: npm ci"
  [ "$dry" = 1 ] && continue
  (cd "$dir" && "$here/heavy.sh" npm ci) || { status=$?; echo "install-all: npm ci failed in $d (exit $status)" >&2; exit "$status"; }
done
