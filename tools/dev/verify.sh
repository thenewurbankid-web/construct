#!/usr/bin/env bash
# Independent verification of a branch on merged-with-main state, ONE compact summary at the end.
# Usage: tools/dev/verify.sh <branch> [--browser]    (run from the main checkout; needs a clean tree)
# Runs: merge (no commit) -> root/server/client tests, tsc, lint -> optional browser configs. Prints only PASS/FAIL lines.
set -uo pipefail
BR="${1:?branch}"; BROWSER="${2:-}"; R="$(cd "$(dirname "$0")/../.." && pwd)"; H="$R/tools/dev/heavy.sh"
OUT="$(mktemp /tmp/verify-XXXX.log)"; cd "$R"
git fetch -q origin "$BR" 2>/dev/null; git merge --no-ff --no-edit "origin/$BR" >>"$OUT" 2>&1 || { echo "MERGE CONFLICT — see $OUT"; git merge --abort; exit 1; }
res() { printf '%-22s %s\n' "$1" "$2"; }
t() { local n="$1"; shift; local o; o=$("$@" 2>&1 | grep -E "^# (pass|fail)" | tr '\n' ' '); res "$n" "${o:-no result}"; }
t root      "$H" npm test
t server    bash -c "cd ui/server && $H npm test"
t client    bash -c "cd ui/client && $H npm test"
res tsc     "$(cd ui/client && npx tsc --noEmit >/dev/null 2>&1 && echo PASS || echo FAIL)"
res lint    "$(npm run lint >/dev/null 2>&1 && echo PASS || echo FAIL)"
if [ "$BROWSER" = "--browser" ]; then
  export WATCHPACK_POLLING=true CHOKIDAR_USEPOLLING=1 E2E_CLIENT_PORT="${E2E_CLIENT_PORT:-3641}" E2E_SERVER_PORT="${E2E_SERVER_PORT:-4641}"
  for c in auth workspace processes processes-approval review-processes; do
    res "e2e $c" "$(cd ui/e2e && "$H" npx playwright test -c playwright.$c.config.js --workers=1 2>&1 | grep -E "passed|failed" | tail -1)"
  done
  res "e2e default" "$(cd ui/e2e && "$H" npx playwright test --workers=1 2>&1 | grep -E "passed|failed" | tr '\n' ' ')"
fi
echo "(merged locally, not pushed; details: $OUT)"
