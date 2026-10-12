#!/usr/bin/env bash
# Serve Cockpit for the claude-ui builder: ui/server on 4396 and ui/client (next dev) on 3396, with a fresh copy of the
# Line starter open as the project (the server's harness seam CONSTRUCT_E2E_PROJECT_DIR, loopback only, never in
# production). The browser builder then ticks Auto and "Let Auto approve in this session" itself (ct1; that setting
# lives in the page, off by default, and ends when the tab closes): BUILDER-PROMPT-UI.md tells it to.
#
#   bench/ecommerce/driver/serve-cockpit.sh [builder-id=claude-ui] [client-port=3396] [server-port=4396]
#
# Needs ui/server and ui/client node_modules (install each once with packages/tools/dev/heavy.sh npm ci). Runs in the
# foreground through heavy.sh (next dev is a heavy job); Ctrl-C stops both servers. Afterwards collect metrics with
#   node bench/ecommerce/metrics.mjs collect --builder <id> --arm ui --run bench/ecommerce/runs/<id> --usage <usage.json>
# (wall time and actions from the browser agent's log: {"wallMs": n, "turns": <actions>, "input_tokens": ...}).
set -euo pipefail
builder="${1:-claude-ui}"; cport="${2:-3396}"; sport="${3:-4396}"
here="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$here/../.." && pwd)"
run="$here/runs/$builder"
if [ ! -d "$run/project" ]; then bash "$here/driver/new-run.sh" "$builder" line >/dev/null; fi
state="$run/cockpit-state"; mkdir -p "$state"
for d in ui/server ui/client; do
  [ -d "$repo/$d/node_modules" ] || { echo "Install $d first: (cd $repo/$d && $repo/packages/tools/dev/heavy.sh npm ci)" >&2; exit 1; }
done
echo "Cockpit for $builder: http://localhost:$cport (server :$sport), project $run/project"
echo "{\"builder\":\"$builder\",\"startedAt\":\"$(date -u +%FT%TZ)\",\"url\":\"http://localhost:$cport\"}" >> "$run/logs/ui-session.jsonl"
cleanup() { kill "${spid:-}" "${cpid:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
(
  cd "$repo/ui/server"
  PORT="$sport" UI_CLIENT_ORIGIN="http://localhost:$cport" CONSTRUCT_STATE_DIR="$state" \
  CONSTRUCT_WORKSPACE_ROOT="$run" CONSTRUCT_E2E_PROJECT_DIR="$run/project" exec node src/index.mjs
) > "$run/logs/cockpit-server.log" 2>&1 &
spid=$!
cd "$repo/ui/client"
NEXT_PUBLIC_API_BASE="http://localhost:$sport" NEXT_PUBLIC_WS_BASE="ws://localhost:$sport" \
  "$repo/packages/tools/dev/heavy.sh" npx next dev -p "$cport" &
cpid=$!
wait "$cpid"
