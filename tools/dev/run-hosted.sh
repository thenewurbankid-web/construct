#!/usr/bin/env bash
# Run the Cockpit reachable from any IP, with mandatory GitHub login (#278).
# Secrets come from the environment only; nothing is written to disk.
#   PUBLIC_HOST=203.0.113.10 CONSTRUCT_GITHUB_CLIENT_ID=... CONSTRUCT_GITHUB_CLIENT_SECRET=... \
#   CONSTRUCT_ALLOWED_LOGINS=you tools/dev/run-hosted.sh
# Ports: client 3000, server 4000. Set SCHEME=https if a TLS proxy fronts both.
set -euo pipefail
# Optional: CONSTRUCT_ENV_FILE=/path/outside/the/repo (chmod 600) holding the same
# variables as `KEY=value` lines, so no secret ever appears on a command line.
if [ -n "${CONSTRUCT_ENV_FILE:-}" ]; then set -a; . "$CONSTRUCT_ENV_FILE"; set +a; fi
: "${PUBLIC_HOST:?set PUBLIC_HOST (ip or domain)}"
: "${CONSTRUCT_GITHUB_CLIENT_ID:?set CONSTRUCT_GITHUB_CLIENT_ID}"
: "${CONSTRUCT_GITHUB_CLIENT_SECRET:?set CONSTRUCT_GITHUB_CLIENT_SECRET}"
: "${CONSTRUCT_ALLOWED_LOGINS:?set CONSTRUCT_ALLOWED_LOGINS (comma-separated GitHub logins)}"
SCHEME="${SCHEME:-http}"; WS=$([ "$SCHEME" = https ] && echo wss || echo ws)
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export CONSTRUCT_SESSION_SECRET="${CONSTRUCT_SESSION_SECRET:-$(openssl rand -hex 32)}"
export CONSTRUCT_OAUTH_CALLBACK_URL="${CONSTRUCT_OAUTH_CALLBACK_URL:-$SCHEME://$PUBLIC_HOST:4000/auth/callback}"
echo "Callback URL to register on the OAuth app: $CONSTRUCT_OAUTH_CALLBACK_URL"
(cd "$ROOT/ui/client" && NEXT_PUBLIC_API_BASE="$SCHEME://$PUBLIC_HOST:4000" NEXT_PUBLIC_WS_BASE="$WS://$PUBLIC_HOST:4000" npm run build)
(cd "$ROOT/ui/client" && npm start) &
trap 'kill 0' EXIT
cd "$ROOT/ui/server" && HOST=0.0.0.0 UI_CLIENT_ORIGIN="$SCHEME://$PUBLIC_HOST:3000" npm start
