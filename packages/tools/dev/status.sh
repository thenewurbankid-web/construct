#!/usr/bin/env bash
# One-shot status: open PRs, agent worktrees (commits ahead + last activity), heavy-job lock, memory, hosted health.
# Usage: packages/tools/dev/status.sh
R="$(cd "$(dirname "$0")/../../.." && pwd)"
echo "== $(date -u +%H:%M) UTC =="
echo "-- open PRs"; env -u GH_TOKEN -u GITHUB_TOKEN gh pr list --state open --json number,title --jq '.[]|"#\(.number) \(.title)"' 2>/dev/null || echo "(gh unavailable)"
BASE="${CONSTRUCT_BASE_BRANCH:-origin/work/2026-09-23}"   # main is frozen; see docs/DELEGATION.md
echo "-- agent worktrees (commits ahead of $BASE, last commit)"
for d in "$R"/.claude/worktrees/agent-*; do [ -d "$d" ] || continue
  n=$(git -C "$d" rev-list --count "$BASE"..HEAD 2>/dev/null || echo ?)
  [ "$n" = "0" ] && continue
  printf '%s  %s ahead, last %s\n' "$(basename "$d" | cut -c7-14)" "$n" "$(git -C "$d" log -1 --format=%cr 2>/dev/null)"
done
LOCK="$(bash "$R/packages/tools/dev/heavy.sh" --lock-path)"   # same path heavy.sh takes: /tmp, or $TMPDIR where /tmp is unusable (Termux)
echo "-- heavy queue"
if command -v flock >/dev/null 2>&1; then
  if flock -n "$LOCK" -c true 2>/dev/null; then echo "free"; else echo "HELD by: $(pgrep -fa 'heavy.sh' | grep -v pgrep | head -1 | cut -c1-110)"; fi
else # #854: no flock (macOS) -- heavy.sh holds an mkdir lock at $LOCK.d with the holder's pid inside
  P=$(tr -cd '0-9' <"$LOCK.d/pid" 2>/dev/null)
  if [ ! -d "$LOCK.d" ]; then echo "free"
  elif [ -n "$P" ] && ! kill -0 "$P" 2>/dev/null; then echo "free (stale lock from dead pid $P)"
  else echo "HELD by pid ${P:-?}: $(ps -o command= -p "${P:-0}" 2>/dev/null | cut -c1-100)"; fi
fi
echo "-- machine"; free -g | awk 'NR==2{print "mem avail " $7 "G"}'; uptime | sed 's/.*load/load/'
echo "-- hosted"; curl -s -m 5 -o /dev/null -w "https %{http_code}\n" https://2-28-127-143.sslip.io/
