#!/usr/bin/env bash
# train.sh -- the one entry point of the training kit (#647). Runs on the TRAINING machine, never on the dev machine.
#
#   train.sh <dataset-bundle> <model-out>            train once from one dataset bundle, write a model bundle
#   train.sh --watch <inbox> <outbox> [--once] [--interval <seconds>]
#                                                    poll <inbox> for dataset bundles (each a folder with manifest.json) whose dataset
#                                                    hash has not been trained yet; train each, write the model bundle to
#                                                    <outbox>/model-<hash12>/, keep <outbox>/heartbeat.json fresh; --once: one pass, exit
#
# The kit only READS a folder someone put in the inbox and WRITES a folder to the outbox; nothing connects into this machine and the
# kit opens no connection. How bundles get here and back is your transport (train-kit/README.md, "Transport").
#
# Guards (all overridable by environment, none by default off):
#   memory   refuse to start below TRAIN_MIN_FREE_GB free memory (default 8; MemAvailable on Linux, vm_stat on macOS); the watch loop
#            waits and tries again; exit code 75 in one-shot mode. TRAIN_MIN_FREE_GB=0 turns it off (tests, tiny fixtures).
#   time     TRAIN_TIME_LIMIT seconds hard limit (default 1800): the trainer stops itself, and `timeout` (when present) is a second net.
#   priority TRAIN_NICE (default 19): the job runs at the lowest priority so the owner's own work is not slowed.
#   power    TRAIN_REQUIRE_AC=1 (macOS): do not start on battery power (the launchd template sets it).
#
# POSIX-leaning bash (macOS ships 3.2): no associative arrays, no ${var,,}. Needs python3 (standard library only).
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
PY=${TRAIN_PYTHON:-python3}
MIN_FREE_GB=${TRAIN_MIN_FREE_GB:-8}
TIME_LIMIT=${TRAIN_TIME_LIMIT:-1800}
NICE=${TRAIN_NICE:-19}
REQUIRE_AC=${TRAIN_REQUIRE_AC:-0}
CONFIG=${TRAIN_CONFIG:-$HERE/train.config.json}
INTERVAL=${TRAIN_INTERVAL:-30}
LAST_TRAINED=""

usage() {
  sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
  exit 64
}

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# Free memory in MiB (0 when it cannot be read: unreadable counts as "not enough").
free_mb() {
  if [ -r /proc/meminfo ]; then
    awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo
  elif command -v vm_stat >/dev/null 2>&1; then
    vm_stat | awk '
      /page size of/ { ps = $8 }
      /^Pages free/ { f = $3 }
      /^Pages inactive/ { i = $3 }
      /^Pages speculative/ { s = $3 }
      END { gsub(/\./, "", f); gsub(/\./, "", i); gsub(/\./, "", s); if (ps == "" || ps == 0) print 0; else print int((f + i + s) * ps / 1048576) }'
  else
    echo 0
  fi
}

memory_ok() {
  need=$((MIN_FREE_GB * 1024))
  have=$(free_mb)
  [ -n "$have" ] || have=0
  if [ "$have" -lt "$need" ]; then
    log "memory guard: ${have} MiB free, ${need} MiB required (TRAIN_MIN_FREE_GB=${MIN_FREE_GB}); not starting"
    return 1
  fi
  return 0
}

power_ok() {
  [ "$REQUIRE_AC" = "1" ] || return 0
  command -v pmset >/dev/null 2>&1 || return 0
  if pmset -g batt | grep -q "AC Power"; then return 0; fi
  log "power guard: on battery (TRAIN_REQUIRE_AC=1); not starting"
  return 1
}

# Train one bundle: <dataset dir> <final out dir>. Writes to a temporary folder next to it and renames, so a reader never sees half a bundle.
train_one() {
  dataset=$1
  out=$2
  if [ -e "$out" ] && [ -n "$(ls -A "$out" 2>/dev/null)" ]; then
    log "refusing: $out already exists and is not empty"
    return 2
  fi
  memory_ok || return 75
  power_ok || return 75
  tmp="${out}.tmp.$$"
  rm -rf "$tmp"
  guard=""
  if command -v timeout >/dev/null 2>&1; then guard="timeout -k 10 $((TIME_LIMIT + 30))"; elif command -v gtimeout >/dev/null 2>&1; then guard="gtimeout -k 10 $((TIME_LIMIT + 30))"; fi
  log "training from $dataset (nice $NICE, limit ${TIME_LIMIT}s)"
  rc=0
  # shellcheck disable=SC2086
  nice -n "$NICE" $guard "$PY" "$HERE/train_features.py" --dataset "$dataset" --out "$tmp" --config "$CONFIG" --time-limit "$TIME_LIMIT" || rc=$?
  if [ "$rc" -ne 0 ]; then
    rm -rf "$tmp"
    log "training failed with exit code $rc"
    return "$rc"
  fi
  mkdir -p "$(dirname "$out")"
  rm -rf "$out"
  mv "$tmp" "$out"
  log "model bundle written to $out"
  return 0
}

heartbeat() {
  # heartbeat <state> [dataset hash]; atomic write of <outbox>/heartbeat.json
  [ -n "${OUTBOX:-}" ] || return 0
  tmp="$OUTBOX/.heartbeat.$$"
  printf '{"time":"%s","state":"%s","dataset":"%s","lastTrained":"%s","pid":%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "${2:-}" "$LAST_TRAINED" "$$" > "$tmp"
  mv "$tmp" "$OUTBOX/heartbeat.json"
}

watch_loop() {
  INBOX=$1
  OUTBOX=$2
  once=$3
  mkdir -p "$OUTBOX"
  trap 'heartbeat stopped; exit 0' TERM INT
  log "watching $INBOX, writing to $OUTBOX (poll ${INTERVAL}s)"
  while :; do
    heartbeat idle
    for d in "$INBOX"/*/; do
      d=${d%/}
      [ -f "$d/manifest.json" ] || continue
      hash=$("$PY" "$HERE/train_features.py" --print-dataset-hash "$d" 2>/dev/null) || continue   # not (yet) a complete, valid bundle
      short=$(printf '%s' "$hash" | cut -c1-12)
      target="$OUTBOX/model-$short"
      [ -d "$target" ] && continue
      [ -f "$OUTBOX/.failed-$short" ] && continue
      heartbeat training "$hash"
      rc=0
      train_one "$d" "$target" || rc=$?
      if [ "$rc" -eq 0 ]; then
        LAST_TRAINED=$hash
      elif [ "$rc" -eq 75 ]; then
        heartbeat waiting "$hash"
      else
        : > "$OUTBOX/.failed-$short"
        log "dataset $short failed (exit $rc); remove $OUTBOX/.failed-$short to retry"
      fi
    done
    [ "$once" = "1" ] && break
    heartbeat idle
    sleep "$INTERVAL"
  done
  heartbeat idle
}

case "${1:-}" in
  -h|--help|"") usage ;;
  --watch)
    shift
    [ $# -ge 2 ] || usage
    inbox=$1
    outbox=$2
    shift 2
    once=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --once) once=1 ;;
        --interval) shift; INTERVAL=${1:?--interval needs seconds} ;;
        *) usage ;;
      esac
      shift
    done
    watch_loop "$inbox" "$outbox" "$once"
    ;;
  *)
    [ $# -eq 2 ] || usage
    train_one "$1" "$2"
    ;;
esac
