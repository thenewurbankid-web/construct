#!/usr/bin/env bash
# #637 -- proves @line/studio is standalone: packs it, installs the tarball into an EMPTY directory outside this repository,
# and runs it from there. One PASS/FAIL/SKIP line per check; exits non-zero on any FAIL. Nothing is published.
#
#   packages/tools/dev/verify-studio-package.sh
#
# Checks: pack, tarball contents, install (through heavy.sh), `studio --version`, `studio doctor`, the vendored media tools
# running from the installed copy (SRT built from a captions file, add-audio.sh executable, nothing written into the package),
# and, only when src/server.mjs is in the tarball, the server: /health, then the config route without and with the access token.
# `studio doctor` exits 1 on a machine without ffmpeg or a browser; that is the machine, not the package, so it is a NOTE.
#
# Server contract assumed (override with env when the server's differs): the token is read from STUDIO_ACCESS_TOKEN, sent as
# `Authorization: Bearer <token>`; STUDIO_HEALTH_ROUTE=/health, STUDIO_CONFIG_ROUTE=/api/config. Without the token the config
# route must answer 401 or 403; with it, 200. Ports come from 48200-48299.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HEAVY="$ROOT/packages/tools/dev/heavy.sh"
PKG="$ROOT/packages/studio"
HEALTH_ROUTE="${STUDIO_HEALTH_ROUTE:-/health}"
CONFIG_ROUTE="${STUDIO_CONFIG_ROUTE:-/api/config}"
TOKEN="verify-$$-$RANDOM"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/construct-studio-verify-$$-XXXX")"
SERVER_PID=""
FAILS=0

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null; sleep 0.3; kill -9 "$SERVER_PID" 2>/dev/null
  fi
  rm -rf "$TMP"
  rm -f "$PKG"/*.tgz
}
trap cleanup EXIT INT TERM

pass() { printf 'PASS  %s\n' "$1"; }
skip() { printf 'SKIP  %s\n' "$1"; }
note() { printf 'NOTE  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }
check() { local name="$1"; shift; if "$@" >"$TMP/last.log" 2>&1; then pass "$name"; else fail "$name ($(tail -n 2 "$TMP/last.log" | tr '\n' ' '))"; return 1; fi; }

finish() { [ "$FAILS" -eq 0 ] && { echo "studio package: all checks passed"; exit 0; }; echo "studio package: $FAILS check(s) failed"; exit 1; }

# 1. pack
mkdir -p "$TMP/pack" "$TMP/app"
check "pack (vendor packages/tools/media + npm pack)" node "$PKG/scripts/pack.mjs" --out "$TMP/pack" || finish
TARBALL="$(ls "$TMP/pack"/*.tgz 2>/dev/null | head -n 1)"
[ -n "$TARBALL" ] || { fail "pack produced no tarball"; finish; }

# 2. tarball contents
tar -tzf "$TARBALL" | sed 's#^package/##' | sort >"$TMP/files.txt"
contents_ok() {
  grep -qx 'bin/studio.mjs' "$TMP/files.txt" && grep -qx 'vendor/media/lib.mjs' "$TMP/files.txt" &&
    grep -qx 'vendor/media/add-audio.sh' "$TMP/files.txt" && grep -qx 'README.md' "$TMP/files.txt" &&
    ! grep -Eq 'node_modules|\.media-cache|^test/|^scripts/|__pycache__' "$TMP/files.txt"
}
check "tarball contents ($(wc -l <"$TMP/files.txt" | tr -d ' ') files, vendored media present, no node_modules or tests)" contents_ok

# 3. install into an empty directory (the only heavy step)
( cd "$TMP/app" && npm init -y >/dev/null 2>&1 )
install_ok() { ( cd "$TMP/app" && "$HEAVY" npm install "$TARBALL" --no-audit --no-fund --loglevel=error ); }
check "install tarball into an empty directory" install_ok || finish
INSTALLED="$TMP/app/node_modules/@line/studio"
[ -d "$INSTALLED" ] || { fail "installed package not found at node_modules/@line/studio"; finish; }
before="$(cd "$INSTALLED" && find . -type f | sort | md5sum)"

# 4. --version
version_ok() { [ "$( cd "$TMP/app" && npx --no-install studio --version )" = "$(node -p "require('$PKG/package.json').version")" ]; }
check "npx studio --version matches package.json" version_ok

# 5. doctor
( cd "$TMP/app" && npx --no-install studio doctor >"$TMP/doctor.txt" 2>&1 ); DOCTOR_RC=$?
if [ "$DOCTOR_RC" -le 1 ] && grep -q '^ok .*node:' "$TMP/doctor.txt" && grep -Eq '^(ready|[0-9]+ required item)' "$TMP/doctor.txt"; then
  pass "studio doctor runs from the install (exit $DOCTOR_RC)"
  [ "$DOCTOR_RC" -eq 0 ] || note "this machine lacks: $(grep '^[0-9]* required' "$TMP/doctor.txt" | sed 's/.*missing: //')"
else fail "studio doctor (exit $DOCTOR_RC): $(tail -n 2 "$TMP/doctor.txt" | tr '\n' ' ')"; fi

# 6. the vendored media tools run from the installed copy and write only under the workspace
mkdir -p "$TMP/ws/videos"
printf '[{"text":"Hello from the packed tools.","start":1},{"text":"A second line.","start":6}]\n' >"$TMP/ws/videos/demo.captions.json"
media_ok() {
  ( cd "$TMP/app" && STUDIO_ROOT="$TMP/ws" STUDIO_VIDEO_DIR="$TMP/ws/videos" node node_modules/@line/studio/vendor/media/script.mjs demo srt ) &&
    grep -q 'Hello from the packed tools' "$TMP/ws/videos/demo.en.srt" && [ -x "$INSTALLED/vendor/media/add-audio.sh" ]
}
check "vendored media tools run from the install (script.mjs demo srt, add-audio.sh executable)" media_ok
after="$(cd "$INSTALLED" && find . -type f | sort | md5sum)"
[ "$before" = "$after" ] && pass "nothing written into the installed package" || fail "the media tools wrote into the installed package"

# 7. the server, only when the tarball carries it
if ! grep -qx 'src/server.mjs' "$TMP/files.txt"; then
  skip "server checks: src/server.mjs is not in the tarball yet (agent B's src has not landed)"
  finish
fi
PORT=""
for p in $(seq 48200 48299); do
  if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then PORT="$p"; break; fi
done
[ -n "$PORT" ] || { fail "no free port in 48200-48299"; finish; }
( cd "$TMP/app" && STUDIO_ACCESS_TOKEN="$TOKEN" exec node node_modules/.bin/studio --port "$PORT" --host 127.0.0.1 --workspace "$TMP/ws" >"$TMP/server.log" 2>&1 ) & # exec: $! is the server itself, so cleanup kills it
SERVER_PID=$!
up=""
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$HEALTH_ROUTE" 2>/dev/null || true)"
  [ "$code" = "200" ] && { up=1; break; }
  kill -0 "$SERVER_PID" 2>/dev/null || break
  sleep 0.5
done
if [ -z "$up" ]; then fail "server did not answer $HEALTH_ROUTE on port $PORT ($(tail -n 2 "$TMP/server.log" | tr '\n' ' '))"; finish; fi
pass "server answers $HEALTH_ROUTE on port $PORT"
without="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$CONFIG_ROUTE")"
[ "$without" = "401" ] || [ "$without" = "403" ] && pass "$CONFIG_ROUTE without the access token is refused ($without)" || fail "$CONFIG_ROUTE without the token answered $without, expected 401 or 403"
with="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT$CONFIG_ROUTE")"
[ "$with" = "200" ] && pass "$CONFIG_ROUTE with the access token answers 200" || fail "$CONFIG_ROUTE with the token answered $with, expected 200"
finish
