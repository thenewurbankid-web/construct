#!/usr/bin/env bash
# Give a git worktree the main checkout's installed dependencies without a fresh `npm ci`, while keeping
# this repo's own workspace packages (@line/*) pointing at the WORKTREE's code.
#
#   packages/tools/dev/link-worktree-node-modules.sh            # run from the worktree root
#   packages/tools/dev/link-worktree-node-modules.sh <main-checkout>
#
# Why not `ln -s <main>/node_modules node_modules`: main's node_modules/@line/construct-core is the relative
# link ../../packages/core, and Node resolves it through the realpath, i.e. to MAIN's packages/core. Every
# test that imports @line/* then runs main's (stale) code, not the worktree's: tests fail for no reason
# in the worktree, or pass against code that is not the one under test.
#
# What it does (idempotent; touches only node_modules entries, which git ignores):
#   1. node_modules/ is a real folder; every entry of <main>/node_modules except @line is a symlink to main's.
#   2. node_modules/@line/<name> -> ../../packages/<dir> for each workspace package (read from package.json names).
#   3. each nested node_modules main has (ui/server, ui/client, trace, studio-export, ...) is symlinked in
#      where the worktree has the same folder and no node_modules of its own.
set -euo pipefail

root=$(pwd -P)
main=${1:-}
if [ -z "$main" ]; then
  common=$(git rev-parse --path-format=absolute --git-common-dir)
  main=$(dirname "$common")
fi
main=$(cd "$main" && pwd -P)
if [ "$main" = "$root" ]; then
  echo "link-worktree-node-modules: this is the main checkout itself; run it from a worktree." >&2
  exit 2
fi
if [ ! -d "$main/node_modules" ]; then
  echo "link-worktree-node-modules: $main has no node_modules; run npm ci there first." >&2
  exit 2
fi

# 1. A real node_modules folder (replace an old whole-folder symlink).
if [ -L node_modules ]; then rm node_modules; fi
mkdir -p node_modules
for entry in "$main"/node_modules/* "$main"/node_modules/.[!.]*; do
  [ -e "$entry" ] || [ -L "$entry" ] || continue
  name=$(basename "$entry")
  [ "$name" = "@line" ] && continue
  [ -e "node_modules/$name" ] || [ -L "node_modules/$name" ] || ln -s "$entry" "node_modules/$name"
done

# 2. @line/* -> this worktree's packages.
mkdir -p node_modules/@line
for pkg in packages/*/package.json; do
  name=$(node -e 'const p=require(process.argv[1]); if (typeof p.name === "string") process.stdout.write(p.name)' "$root/$pkg")
  case "$name" in
    @line/*)
      dir=$(dirname "$pkg")
      ln -sfn "../../$dir" "node_modules/$name"
      ;;
  esac
done

# 3. Nested node_modules folders main has, linked where the worktree has the same folder.
while IFS= read -r nested; do
  rel=${nested#"$main"/}
  dir=$(dirname "$rel")
  if [ -d "$dir" ] && [ ! -e "$dir/node_modules" ] && [ ! -L "$dir/node_modules" ]; then
    ln -s "$nested" "$dir/node_modules"
    echo "linked $dir/node_modules"
  fi
done < <(find "$main" -mindepth 2 -maxdepth 4 -name node_modules -not -path '*/node_modules/*' -not -path '*/.claude/*' -not -path '*/.git/*' 2>/dev/null)

echo "link-worktree-node-modules: node_modules linked from $main; @line/* point at $root/packages."
