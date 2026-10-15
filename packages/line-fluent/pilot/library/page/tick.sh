#!/bin/bash
# Page sync for a running library run: every 30s, when there are new results, writes a fresh outbox (sync.mjs) and
# prints one TICK line; prints RUN ENDED when the run process is gone. A Claude Code session watches it (Monitor)
# and pushes the outbox to the Library Run page with ArtifactData. Usage: tick.sh <runDir> <outboxDir> "<scope>" [models json]
HERE="$(cd "$(dirname "$0")" && pwd)"
R="$1"; O="$2"; SCOPE="$3"; MODELS="$4"
last=0
while true; do
  sleep 30
  n=$(wc -l < "$R/results.jsonl" 2>/dev/null || echo 0)
  if ! pgrep -f "out $R" >/dev/null; then
    st=done; grep -q "Stopped on repeated model errors" "$R/run.log" && st=stopped
    echo "RUN ENDED ($st) $(node "$HERE/sync.mjs" "$R" "$O" $st "$SCOPE" "" "" "$MODELS" 2>&1 | tail -1) | $(tail -1 "$R/run.log")"
    exit 0
  fi
  if [ "$n" != "$last" ]; then
    last=$n
    echo "TICK $(node "$HERE/sync.mjs" "$R" "$O" running "$SCOPE" "" "" "$MODELS" 2>&1 | tail -1)"
  fi
done
