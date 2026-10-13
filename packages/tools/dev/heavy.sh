#!/usr/bin/env bash
# Run ONE memory-heavy command at a time, machine-wide (full test suites,
# Playwright, next dev, npm ci). Waits for the lock and for enough free RAM,
# lowers priority, caps Node's heap, and prunes stale Construct temp dirs after.
#
#   packages/tools/dev/heavy.sh npm test
#   packages/tools/dev/heavy.sh npx playwright test --workers=1 pages-editor
#   packages/tools/dev/heavy.sh --prune-only        # only the temp-dir sweep, no lock, no command
#
#   packages/tools/dev/heavy.sh --lock-path         # print the lock file this machine uses
#
# Env: CONSTRUCT_HEAVY_LOCK (lock file, default /tmp/construct-heavy.lock; $TMPDIR/construct-heavy.lock
#      where /tmp is not a writable folder, e.g. Termux),
#      CONSTRUCT_MIN_FREE_MB (default 3000), CONSTRUCT_HEAVY_HEAP_MB (default 2048),
#      CONSTRUCT_HEAVY_LOCK_WAIT_SEC (default 3600: give up on the lock after this),
#      CONSTRUCT_HEAVY_RAM_WAIT_SEC (default 1800: give up waiting for RAM after this),
#      CONSTRUCT_HEAVY_POLL_SEC (default 15: pause between RAM checks),
#      CONSTRUCT_HEAVY_TMP (default $TMPDIR or /tmp: where construct-* dirs are pruned),
#      CONSTRUCT_HEAVY_MEMINFO / CONSTRUCT_HEAVY_VMSTAT (test overrides for the free-RAM probe),
#      CONSTRUCT_HEAVY_HELD (set by heavy.sh itself for its command: a nested heavy.sh runs directly, #939).
#
# Exit status: the command's own; 75 (EX_TEMPFAIL) when the lock or the RAM never
# came within the wait; 2 on usage or when the lock's folder does not exist.
#
# Waits are bounded (#414). A holder that is *dead* never blocks anyone: the kernel
# releases flock with the process. A holder that is *hung* used to block every heavy
# job on the box silently; now every waiter gives up with a message naming the
# holder (pid, start time, command, from <lock>.holder). The RAM wait releases the
# lock between checks so a waiter never holds the lock while it is not running
# anything.
#
# macOS has no `flock` binary at all (#686). Where it is missing, the same lock/wait/
# release contract is implemented with an atomic `mkdir` (a lock *file*'s create-if-
# absent has a TOCTOU race that `mkdir` does not) holding a pid file, with the same
# dead-pid-never-blocks-anyone liveness test used below for stale Construct temp dirs.
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
# The default lock lives in /tmp wherever /tmp is a writable directory (Linux, macOS): one path every session on the
# machine shares, even sessions that each have their own $TMPDIR (macOS sets a per-user one; sandboxes set their own),
# so it is not moved there. Where /tmp is not usable (Termux on Android) it falls back to $TMPDIR (#855).
# CONSTRUCT_HEAVY_SHARED_TMP stands in for /tmp in tests.
default_lock() {
  local shared="${CONSTRUCT_HEAVY_SHARED_TMP:-/tmp}"
  if [ -d "$shared" ] && [ -w "$shared" ]; then printf '%s/construct-heavy.lock' "${shared%/}"; else printf '%s/construct-heavy.lock' "${TMPDIR:-/tmp}" | sed 's#//*#/#g'; fi
}
LOCK="${CONSTRUCT_HEAVY_LOCK:-$(default_lock)}"
MIN_MB="${CONSTRUCT_MIN_FREE_MB:-3000}"
HEAP_MB="${CONSTRUCT_HEAVY_HEAP_MB:-2048}"
LOCK_WAIT_SEC="${CONSTRUCT_HEAVY_LOCK_WAIT_SEC:-3600}"
RAM_WAIT_SEC="${CONSTRUCT_HEAVY_RAM_WAIT_SEC:-1800}"
POLL_SEC="${CONSTRUCT_HEAVY_POLL_SEC:-15}"
TMP="${CONSTRUCT_HEAVY_TMP:-${TMPDIR:-/tmp}}"
HOLDER="$LOCK.holder"
EX_TEMPFAIL=75

HAVE_FLOCK=1
command -v flock >/dev/null 2>&1 || HAVE_FLOCK=0
LOCKDIR="$LOCK.d" # the mkdir-based lock, used only when flock is unavailable (e.g. macOS)

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

# ---- locking -----------------------------------------------------------------------------------

# Portable stand-in for `flock -w SECONDS 9` where flock does not exist: an atomic mkdir as the
# mutex, a pid file inside it, and cleanup of a stale holder whose pid is provably gone (same test
# as pid_gone/prune_stale above). Returns 0 once the directory is ours, 1 if SECONDS elapses first.
mkdir_lock_wait() {
  local wait_sec="$1" start holder_pid
  start=$(date +%s)
  while :; do
    if mkdir "$LOCKDIR" 2>/dev/null; then
      echo "$$" >"$LOCKDIR/pid" 2>/dev/null
      return 0
    fi
    holder_pid=$(tr -cd '0-9' <"$LOCKDIR/pid" 2>/dev/null)
    if [ -n "$holder_pid" ] && pid_gone "$holder_pid"; then
      rm -rf "$LOCKDIR" 2>/dev/null # dead holder: never blocks anyone
      continue
    fi
    [ "$(($(date +%s) - start))" -lt "$wait_sec" ] || return 1
    sleep 0.2
  done
}

# lk_wait SECONDS / lk_unlock: the one contract both lock implementations share. On the flock path
# these are exactly `flock -w SECONDS 9` / `flock -u 9`; that path is otherwise untouched.
lk_wait() {
  if [ "$HAVE_FLOCK" = 1 ]; then flock -w "$1" 9; else mkdir_lock_wait "$1"; fi
}

lk_unlock() {
  if [ "$HAVE_FLOCK" = 1 ]; then flock -u 9; else rm -rf "$LOCKDIR" 2>/dev/null; fi
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
if [ "$1" = "--lock-path" ]; then # where the lock is (status.sh asks, so the two never disagree)
  printf '%s\n' "$LOCK"
  exit 0
fi
# A lock whose folder does not exist can never be taken: the flock path would fail to open it on every pass and the
# mkdir path would wait out the whole CONSTRUCT_HEAVY_LOCK_WAIT_SEC. Say so at once instead (#855).
if [ ! -d "$(dirname "$LOCK")" ]; then
  say "the lock's folder $(dirname "$LOCK") does not exist (lock $LOCK). Create it, or set CONSTRUCT_HEAVY_LOCK or TMPDIR to a writable folder."
  exit 2
fi

# Available RAM in MB, or nothing when this machine offers no way to tell (#854).
#   Linux/Android: MemAvailable from /proc/meminfo.
#   macOS (no /proc): (free + inactive + speculative) pages from `vm_stat`, times the page size
#   its header states ("(page size of 16384 bytes)"). Inactive and speculative pages are what
#   macOS reclaims on demand, the closest counterpart of Linux's MemAvailable.
# Overridable for tests: CONSTRUCT_HEAVY_MEMINFO (a file read instead of /proc/meminfo) and
# CONSTRUCT_HEAVY_VMSTAT (a command run instead of `vm_stat`).
MEMINFO="${CONSTRUCT_HEAVY_MEMINFO:-/proc/meminfo}"
VMSTAT="${CONSTRUCT_HEAVY_VMSTAT:-vm_stat}"
free_mb() {
  if [ -r "$MEMINFO" ]; then
    awk '/^MemAvailable:/{print int($2/1024); exit}' "$MEMINFO"
    return
  fi
  if command -v "$VMSTAT" >/dev/null 2>&1; then
    "$VMSTAT" 2>/dev/null | awk '
      /page size of/ { for (i = 1; i <= NF; i++) if ($i == "of") ps = $(i + 1) + 0 }
      /^Pages (free|inactive|speculative):/ { v = $NF; gsub(/[^0-9]/, "", v); pages += v; seen++ }
      END { if (ps > 0 && seen > 0) printf "%d\n", pages * ps / 1048576 }'
    return
  fi
  echo ''
}

# ---- re-entrancy (#939) ------------------------------------------------------------------------
# A heavy command may itself call heavy.sh (`heavy.sh npm run install:all` runs install-all.sh, which runs
# `heavy.sh npm ci`). The inner call used to wait for the lock its own ancestor holds: a self-deadlock that
# blocked every heavy job on the machine for CONSTRUCT_HEAVY_LOCK_WAIT_SEC. The outer heavy.sh exports
# CONSTRUCT_HEAVY_HELD="<its pid>:<lock path>" to its command; an inner heavy.sh runs its command directly
# (no lock, no RAM wait, no prune: the outer one already did all three) only when every part checks out:
#   - the marker names this same lock path,
#   - that pid is an ancestor of this process (a forged or inherited-elsewhere marker is not),
#   - and the lock is still held by that pid right now (mkdir lock: its pid file; flock: the holder file).
# Anything else -- stale, foreign, malformed -- falls through to the normal lock wait.

# 0 when $1 is this process or one of its ancestors.
is_ancestor() {
  local want="$1" p="$$" i=0
  while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null && [ "$i" -lt 64 ]; do
    [ "$p" = "$want" ] && return 0
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -cd '0-9')
    i=$((i + 1))
  done
  return 1
}

# 0 when the lock at $LOCK is currently held by pid $1.
lock_held_by() {
  local holder_pid
  if [ "$HAVE_FLOCK" = 1 ]; then
    holder_pid=$(sed -n -E '1s/^pid ([0-9]+) .*/\1/p' "$HOLDER" 2>/dev/null)
    [ "$holder_pid" = "$1" ] || return 1
    # The holder file is written only after flock succeeds; confirm the lock really is taken now.
    ! flock -n "$LOCK" true 2>/dev/null
  else
    holder_pid=$(tr -cd '0-9' <"$LOCKDIR/pid" 2>/dev/null)
    [ "$holder_pid" = "$1" ]
  fi
}

if [ -n "${CONSTRUCT_HEAVY_HELD:-}" ]; then
  held_pid="${CONSTRUCT_HEAVY_HELD%%:*}"
  held_lock="${CONSTRUCT_HEAVY_HELD#*:}"
  case "$held_pid" in '' | *[!0-9]*) held_pid='' ;; esac
  if [ -n "$held_pid" ] && [ "$held_lock" = "$LOCK" ] && ! pid_gone "$held_pid" \
    && is_ancestor "$held_pid" && lock_held_by "$held_pid"; then
    say "nested under heavy.sh pid $held_pid, which already holds $LOCK: running directly."
    exec "$@"
  fi
  say "ignoring CONSTRUCT_HEAVY_HELD=$CONSTRUCT_HEAVY_HELD (not a live ancestor holding $LOCK); taking the lock normally."
  unset CONSTRUCT_HEAVY_HELD
fi

[ "$HAVE_FLOCK" = 1 ] && exec 9>>"$LOCK"
started=$(date +%s)
ram_deadline=$((started + RAM_WAIT_SEC))
while :; do
  remaining=$((LOCK_WAIT_SEC - ($(date +%s) - started)))
  [ "$remaining" -gt 0 ] || remaining=0
  if ! lk_wait "$remaining"; then
    holder=$(cat "$HOLDER" 2>/dev/null || echo "unknown (no $HOLDER)")
    say "could not get the heavy-job lock $LOCK within ${LOCK_WAIT_SEC}s. Held by: $holder."
    say "a dead holder releases the lock by itself, so that process is alive and stuck: look at it before killing it, or raise CONSTRUCT_HEAVY_LOCK_WAIT_SEC."
    exit "$EX_TEMPFAIL"
  fi
  free=$(free_mb)
  if [ -z "$free" ]; then
    say "no /proc/meminfo or vm_stat here; running without the free-RAM check."
    break
  fi
  if [ "$free" -ge "$MIN_MB" ]; then break; fi
  if [ "$(date +%s)" -ge "$ram_deadline" ]; then
    lk_unlock
    say "gave up waiting for >= ${MIN_MB} MB free RAM after ${RAM_WAIT_SEC}s (have ${free} MB). Lock released; nothing was run."
    exit "$EX_TEMPFAIL"
  fi
  say "waiting for >= ${MIN_MB} MB free RAM (have ${free} MB)..."
  lk_unlock # never hold the lock while running nothing
  sleep "$POLL_SEC"
done

printf 'pid %s since %s: %s\n' "$$" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >"$HOLDER" 2>/dev/null
trap 'rm -f "$HOLDER" 2>/dev/null; [ "$HAVE_FLOCK" = 1 ] || rm -rf "$LOCKDIR" 2>/dev/null' EXIT

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=${HEAP_MB}}"
export CONSTRUCT_HEAVY_HELD="$$:$LOCK" # lets a heavy.sh inside this command run without re-taking the lock
nice -n 10 "$@"
status=$?
prune_stale
exit $status
