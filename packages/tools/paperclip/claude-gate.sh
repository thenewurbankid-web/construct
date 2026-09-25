#!/usr/bin/env bash
# A machine-wide counting semaphore in front of `claude`, so that "every agent is active" cannot become "every agent runs at
# once": this host has 15 GB RAM and no swap, each Claude run is about 500 MB, and an out-of-memory kill ends every session.
# Paperclip runs this as the adapter `command` (company.json adapterDefaults.command); it waits for a free slot, then execs the
# real `claude` with the same arguments. The slot is an flock on a file descriptor the exec'd process inherits, so it is released
# when that process (and its children) exit, however they exit (a killed run frees its slot).
#
#   PAPERCLIP_MAX_CLAUDE          slots, default 3
#   PAPERCLIP_SLOT_DIR            where the slot files live, default /tmp/paperclip-slots
#   PAPERCLIP_GATE_WAIT_SEC       how long to wait for a slot, default 1800; then exit 75 (EX_TEMPFAIL) with a message
#   PAPERCLIP_MIN_AVAILABLE_KB    do not start below this MemAvailable, default 3145728 (3 GB)
#   PAPERCLIP_REAL_CLAUDE         the real command, default `claude`
#   PAPERCLIP_MEMINFO             the meminfo file to read, default /proc/meminfo (tests)
set -u
MAX="${PAPERCLIP_MAX_CLAUDE:-3}"
DIR="${PAPERCLIP_SLOT_DIR:-/tmp/paperclip-slots}"
WAIT="${PAPERCLIP_GATE_WAIT_SEC:-1800}"
MIN_KB="${PAPERCLIP_MIN_AVAILABLE_KB:-3145728}"
REAL="${PAPERCLIP_REAL_CLAUDE:-claude}"
MEMINFO="${PAPERCLIP_MEMINFO:-/proc/meminfo}"
mkdir -p "$DIR" 2>/dev/null || { echo "claude-gate: cannot create $DIR" >&2; exit 75; }
deadline=$(( $(date +%s) + WAIT ))
notified=0
while :; do
  avail=$(awk '/^MemAvailable:/ {print $2}' "$MEMINFO" 2>/dev/null)
  if [ "${avail:-0}" -ge "$MIN_KB" ]; then
    i=1
    while [ "$i" -le "$MAX" ]; do
      exec {fd}>>"$DIR/slot-$i" || { echo "claude-gate: cannot open a slot file in $DIR" >&2; exit 75; }
      if flock -n "$fd"; then
        exec "$REAL" "$@"
      fi
      exec {fd}>&-
      i=$((i + 1))
    done
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "claude-gate: no free slot (max $MAX) or too little free memory (need ${MIN_KB} kB, have ${avail:-0} kB) after ${WAIT}s; try again later" >&2
    exit 75
  fi
  if [ "$notified" -eq 0 ]; then echo "claude-gate: waiting for a free slot (max $MAX) or memory" >&2; notified=1; fi
  sleep 3
done
