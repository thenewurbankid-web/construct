#!/usr/bin/env bash
# Run ONE memory-heavy command at a time, machine-wide (full test suites,
# Playwright, next dev, npm ci). Waits for the lock and for enough free RAM,
# lowers priority, caps Node's heap, and prunes stale Construct temp dirs after.
#
#   tools/dev/heavy.sh npm test
#   tools/dev/heavy.sh npx playwright test --workers=1 pages-editor
#   tools/dev/heavy.sh --prune-only        # only the temp-dir sweep, no lock, no command
#
# Env: CONSTRUCT_HEAVY_LOCK (lock file, default /tmp/construct-heavy.lock),
#      CONSTRUCT_MIN_FREE_MB (default 3000), CONSTRUCT_HEAVY_HEAP_MB (default 2048),
#      CONSTRUCT_HEAVY_LOCK_WAIT_SEC (default 3600: give up on the lock after this),
#      CONSTRUCT_HEAVY_RAM_WAIT_SEC (default 1800: give up waiting for RAM after this),
#      CONSTRUCT_HEAVY_POLL_SEC (default 15: pause between RAM checks),
#      CONSTRUCT_HEAVY_TMP (default $TMPDIR or /tmp: where construct-* dirs are pruned).
#
# Exit status: the command's own; 75 (EX_TEMPFAIL) when the lock or the RAM never
# came within the wait; 2 on usage.
#
# Waits are bounded (#414). A holder that is *dead* never blocks anyone: the kernel
# releases flock with the process. A holder that is *hung* used to block every heavy
# job on the box silently; now every waiter gives up with a message naming the
# holder (pid, start time, command, from <lock>.holder). The RAM wait releases the
# lock between checks so a waiter never holds the lock while it is not running
# anything.
#
# Pruning is by owner liveness, never by age alone (#414). Every temp family
# Construct creates carries the creating pid in its name
# (construct-<family>-<pid>-<random>: tests, prhealth, testrun, txn, step,
# e2e-state, test-state) or in a `.owner` file at its top level. A directory is
# removed only when that pid provably no longer exists. A directory with no
# discoverable owner is kept unless nobody holds anything under it (lsof) AND it
# is older than a day. It used to be `find -mmin +30`, which deleted the live
# state of any run longer than 30 minutes (a full e2e run is).
set -u
LOCK="${CONSTRUCT_HEAVY_LOCK:-/tmp/construct-heavy.lock}"
MIN_MB="${CONSTRUCT_MIN_FREE_MB:-3000}"
HEAP_MB="${CONSTRUCT_HEAVY_HEAP_MB:-2048}"
LOCK_WAIT_SEC="${CONSTRUCT_HEAVY_LOCK_WAIT_SEC:-3600}"
RAM_WAIT_SEC="${CONSTRUCT_HEAVY_RAM_WAIT_SEC:-1800}"
POLL_SEC="${CONSTRUCT_HEAVY_POLL_SEC:-15}"
TMP="${CONSTRUCT_HEAVY_TMP:-${TMPDIR:-/tmp}}"
HOLDER="$LOCK.holder"
EX_TEMPFAIL=75

say() { echo "heavy.sh: $*" >&2; }

# ---- liveness ---------------------------------------------------------------------------------

# 0 when the pid provably no longer exists. Anything uncertain (not a number, another user's
# process, no way to tell) counts as alive: the worst case is a stale dir surviving one more run,
# never a live run losing its directory.
pid_gone() {
  case "${1:-}" in '' | *[!0-9]*) return 1 ;; esac
  [ "$1" -gt 0 ] 2>/dev/null || return 1
  if [ -d /proc/self ]; then
    [ ! -d "/proc/$1" ]
  else
    ! ps -p "$1" >/dev/null 2>&1
  fi
}

# Print the owning pid of a construct-* directory, or nothing when there is none to find.
owner_pid() {
  local dir="$1" name pid=''
  if [ -f "$dir/.owner" ]; then
    pid=$(head -c 32 "$dir/.owner" 2>/dev/null | tr -cd '0-9')
  fi
  if [ -z "$pid" ]; then
    name=$(basename "$dir")
    pid=$(printf '%s\n' "$name" | sed -n -E 's/^construct-.+-([0-9]+)-[A-Za-z0-9_]+$/\1/p')
  fi
  printf '%s' "$pid"
}

# 0 when some process holds a file or a working directory under $1 (requires lsof; without it,
# nothing can be proven and the answer is "in use").
in_use() {
  command -v lsof >/dev/null 2>&1 || return 0
  [ -n "$(lsof -t +D "$1" 2>/dev/null | head -n 1)" ]
}

prune_stale() {
  local dir pid
  for dir in "$TMP"/construct-*; do
    [ -d "$dir" ] || continue
    [ -L "$dir" ] && continue
    [ -O "$dir" ] || continue
    pid=$(owner_pid "$dir")
    if [ -n "$pid" ]; then
      if pid_gone "$pid"; then
        rm -rf "$dir" 2>/dev/null && say "pruned $dir (owner pid $pid is gone)"
      fi
      continue
    fi
    # No owner to ask: liveness by open files plus a long age, never age alone.
    if ! in_use "$dir" && [ -n "$(find "$dir" -maxdepth 0 -mmin +1440 2>/dev/null)" ]; then
      rm -rf "$dir" 2>/dev/null && say "pruned $dir (no owner recorded, nothing open under it, older than a day)"
    fi
  done
}

# ---- entry ------------------------------------------------------------------------------------

if [ "$#" -eq 0 ] || [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  echo "usage: heavy.sh <command...> | heavy.sh --prune-only" >&2
  exit 2
fi
if [ "$1" = "--prune-only" ]; then
  prune_stale
  exit 0
fi

free_mb() {
  if [ -r /proc/meminfo ]; then awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo; else echo ''; fi
}

exec 9>>"$LOCK"
started=$(date +%s)
ram_deadline=$((started + RAM_WAIT_SEC))
while :; do
  remaining=$((LOCK_WAIT_SEC - ($(date +%s) - started)))
  [ "$remaining" -gt 0 ] || remaining=0
  if ! flock -w "$remaining" 9; then
    holder=$(cat "$HOLDER" 2>/dev/null || echo "unknown (no $HOLDER)")
    say "could not get the heavy-job lock $LOCK within ${LOCK_WAIT_SEC}s. Held by: $holder."
    say "a dead holder releases the lock by itself, so that process is alive and stuck: look at it before killing it, or raise CONSTRUCT_HEAVY_LOCK_WAIT_SEC."
    exit "$EX_TEMPFAIL"
  fi
  free=$(free_mb)
  if [ -z "$free" ]; then
    say "no /proc/meminfo here; running without the free-RAM check."
    break
  fi
  if [ "$free" -ge "$MIN_MB" ]; then break; fi
  if [ "$(date +%s)" -ge "$ram_deadline" ]; then
    flock -u 9
    say "gave up waiting for >= ${MIN_MB} MB free RAM after ${RAM_WAIT_SEC}s (have ${free} MB). Lock released; nothing was run."
    exit "$EX_TEMPFAIL"
  fi
  say "waiting for >= ${MIN_MB} MB free RAM (have ${free} MB)..."
  flock -u 9 # never hold the lock while running nothing
  sleep "$POLL_SEC"
done

printf 'pid %s since %s: %s\n' "$$" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >"$HOLDER" 2>/dev/null
trap 'rm -f "$HOLDER" 2>/dev/null' EXIT

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=${HEAP_MB}}"
nice -n 10 "$@"
status=$?
prune_stale
exit $status
