#!/usr/bin/env bash
# One-shot status: open PRs, agent worktrees (commits ahead + last activity), heavy-job lock, memory, hosted health.
# Usage: packages/tools/dev/status.sh
R="$(cd "$(dirname "$0")/../../.." && pwd)"
echo "== $(date -u +%H:%M) UTC =="
echo "-- open PRs"; env -u GH_TOKEN -u GITHUB_TOKEN gh pr list --state open --json number,title --jq '.[]|"#\(.number) \(.title)"' 2>/dev/null || echo "(gh unavailable)"
echo "-- agent worktrees (commits ahead of origin/main, last commit)"
for d in "$R"/.claude/worktrees/agent-*; do [ -d "$d" ] || continue
  n=$(git -C "$d" rev-list --count origin/main..HEAD 2>/dev/null || echo ?)
  [ "$n" = "0" ] && continue
  printf '%s  %s ahead, last %s\n' "$(basename "$d" | cut -c7-14)" "$n" "$(git -C "$d" log -1 --format=%cr 2>/dev/null)"
done
echo "-- heavy queue"; if flock -n /tmp/construct-heavy.lock -c true 2>/dev/null; then echo "free"; else echo "HELD by: $(pgrep -fa 'heavy.sh' | grep -v pgrep | head -1 | cut -c1-110)"; fi
echo "-- machine"; free -g | awk 'NR==2{print "mem avail " $7 "G"}'; uptime | sed 's/.*load/load/'
echo "-- hosted"; curl -s -m 5 -o /dev/null -w "https %{http_code}\n" https://2-28-127-143.sslip.io/
