#!/usr/bin/env bash
# Run ONE memory-heavy command at a time, machine-wide (full test suites,
# Playwright, next dev, npm ci). Waits for the lock and for enough free RAM,
# lowers priority, caps Node's heap, and prunes stale test temp dirs after.
#
#   tools/dev/heavy.sh npm test
#   tools/dev/heavy.sh npx playwright test --workers=1 pages-editor
#
# Env: CONSTRUCT_HEAVY_LOCK (lock file), CONSTRUCT_MIN_FREE_MB (default 3000),
#      CONSTRUCT_HEAVY_HEAP_MB (default 2048).
set -u
LOCK="${CONSTRUCT_HEAVY_LOCK:-/tmp/construct-heavy.lock}"
MIN_MB="${CONSTRUCT_MIN_FREE_MB:-3000}"
HEAP_MB="${CONSTRUCT_HEAVY_HEAP_MB:-2048}"
[ "$#" -gt 0 ] || { echo "usage: heavy.sh <command...>" >&2; exit 2; }

exec 9>"$LOCK"
flock 9   # released automatically when this script exits

while [ "$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)" -lt "$MIN_MB" ]; do
  echo "heavy.sh: waiting for >= ${MIN_MB} MB free RAM..." >&2
  sleep 15
done

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=${HEAP_MB}}"
nice -n 10 "$@"
status=$?
find /tmp -maxdepth 1 -type d -name 'construct-*' -user "$(id -un)" -mmin +30 -exec rm -rf {} + 2>/dev/null
exit $status
