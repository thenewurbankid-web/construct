#!/bin/bash
# watch-agents.sh — OG's stall watcher for dispatched worktree agents.
#
# Why this exists: on 2026-09-19 two agents went silent for 1h45m with ~1,200
# lines and 41 files uncommitted between them, one ended session away from
# being lost. Nobody noticed because the orchestrator was waiting for a
# completion notification instead of looking. Silence is not progress.
#
# Progress is measured by things a human could also check: new comments on the
# agents' issues, and new commits in their worktrees. When neither moves for
# STALL_MIN minutes the script exits and prints what it found, which re-invokes
# the orchestrator so it can intervene.
#
# Usage:  ISSUES="278 254" packages/tools/dev/watch-agents.sh     (run in background)
cd "$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)" || exit 1
ISSUES="${ISSUES:-}"          # space-separated issue numbers to watch
STALL_MIN=${STALL_MIN:-18}           # minutes with no signal before we call it stalled
POLL=180               # seconds between polls
MAX_LIFE=$((100*60))   # give up watching after 100 minutes
started=$(date +%s)

sig() {  # comment count + total commits across all agent worktrees
  local total=0 c
  for i in $ISSUES; do
    c=$(env -u GH_TOKEN -u GITHUB_TOKEN gh issue view "$i" --json comments --jq '.comments|length' 2>/dev/null || echo 0)
    total=$((total + c))
  done
  for w in .claude/worktrees/agent-*/; do
    [ -d "$w/.git" ] || [ -f "$w/.git" ] || continue
    c=$(git -C "$w" rev-list --count HEAD 2>/dev/null || echo 0)
    total=$((total + c))
  done
  echo "$total"
}

last=$(sig); last_change=$(date +%s)
while true; do
  sleep "$POLL"
  now=$(date +%s)
  cur=$(sig)
  if [ "$cur" != "$last" ]; then last="$cur"; last_change=$now; fi
  idle=$(( (now - last_change) / 60 ))
  if [ "$idle" -ge "$STALL_MIN" ]; then
    echo "STALL DETECTED: no new issue comments or worktree commits for ${idle} minutes."
    echo "Per-issue comment counts:"
    for i in $ISSUES; do
      printf '  #%s: %s\n' "$i" "$(env -u GH_TOKEN -u GITHUB_TOKEN gh issue view "$i" --json comments --jq '.comments|length' 2>/dev/null)"
    done
    echo "Uncommitted files per worktree:"
    for w in .claude/worktrees/agent-*/; do
      n=$(git -C "$w" status --porcelain 2>/dev/null | grep -v 'node_modules' | wc -l)
      [ "$n" -gt 0 ] && printf '  %s: %s files\n' "$(basename "$w")" "$n"
    done
    exit 0
  fi
  if [ $(( now - started )) -ge "$MAX_LIFE" ]; then
    echo "Watcher reached its 100-minute lifetime with progress still happening (idle ${idle}m). Not a stall."
    exit 0
  fi
done
