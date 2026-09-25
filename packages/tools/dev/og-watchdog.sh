#!/usr/bin/env bash
# Keeps one Claude Code session alive on this machine.
# If no interactive Claude Code session is running in this repo, start OG in a detached tmux session with
# Remote Control enabled, so work continues and the owner can reach it from claude.ai/code or the phone.
#
# Usage: packages/tools/dev/og-watchdog.sh <command>
#   check      one pass (what cron runs): start OG only when no session is alive, paused is off and the throttle allows
#   start      start OG now (ignores "a session exists", still honours pause and throttle unless OG_FORCE=1)
#   status     what it sees: sessions, tmux, pause, throttle, last log lines
#   pause      stop auto-starting (touch the PAUSE file); use it before you open your own session for a while
#   resume     remove the PAUSE file
#   install    copy this script to ~/.og-watchdog and add the cron entry (every 3 minutes), idempotent; rerun after editing
#   uninstall  remove the cron entry
#   attach     attach to the OG tmux session (Ctrl-b d to leave it running)
#
# Guardrails: one start per throttle window (backoff 5 -> 10 -> 20 -> 40 -> 60 min when a started session dies within
# 15 minutes, e.g. a usage limit), a lock so runs never overlap, a PAUSE file, and --permission-mode auto (the same
# classifier as an interactive session; never bypassPermissions). Files live in ~/.og-watchdog (override OG_STATE_DIR).
set -u

export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:/bin"
REPO="${OG_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
STATE="${OG_STATE_DIR:-$HOME/.og-watchdog}"
TMUX_NAME="${OG_TMUX:-og}"
CLAUDE_BIN="${CLAUDE_BIN:-$(command -v claude || echo "$HOME/.local/bin/claude")}"
PROMPT_FILE="${OG_PROMPT_FILE:-$STATE/prompt.txt}"
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
LOG="$STATE/watchdog.log"
mkdir -p "$STATE"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >>"$LOG"; [ -t 1 ] && printf '%s\n' "$*"; return 0; }

# Interactive Claude Code sessions in this repo (or one of its worktrees): the native binary, not a one-shot
# `--print` run and not an admin subcommand. Prints one pid per line.
sessions() {
  local p args a cwd skip
  for p in $(pgrep -x claude 2>/dev/null); do
    [ -r "/proc/$p/cmdline" ] || continue
    mapfile -d '' args <"/proc/$p/cmdline" || continue
    [ "$(basename "${args[0]:-}")" = claude ] || continue
    case "${args[1]:-}" in remote-control|agents|attach|logs|rm|stop|respawn|doctor|auth|mcp|plugin|plugins|install|project|import|gateway|auto-mode|update) continue ;; esac
    skip=0
    for a in "${args[@]:1}"; do [ "$a" = -p ] || [ "$a" = --print ] && skip=1; done
    [ "$skip" = 1 ] && continue
    cwd="$(readlink "/proc/$p/cwd" 2>/dev/null)" || continue
    case "$cwd" in "$REPO" | "$REPO"/*) echo "$p" ;; esac
  done
}

default_prompt() {
  cat <<'EOF'
You are OG, the orchestrator for this repo. This session was started automatically by og-watchdog because no Claude Code session was running on this machine. Start work now.
1. Read your memory index and the latest handoff note, then run packages/tools/dev/status.sh.
2. Check .claude/worktrees for agent work that needs rescuing (commits ahead, dirty trees) and read Trinity's needs list so you do not repeat a question the owner already answered.
3. Continue the backlog under the standing rules in CLAUDE.md: issue discipline, verify agents actively, commit and push every shippable piece, never idle while backlog exists.
4. Ask the owner only for a genuine decision, and put it in Trinity's needs list rather than waiting on a reply. If you hit a rate limit, stop and wait for the window; do not loop.
EOF
}

throttle_ok() {
  local last=0 streak=0 now gap
  [ -r "$STATE/throttle" ] && read -r last streak <"$STATE/throttle"
  now="$(date +%s)"
  case "$streak" in '' | *[!0-9]*) streak=0 ;; esac
  gap=120
  [ "$streak" -gt 0 ] && gap=$((300 * (1 << (streak - 1)))) && [ "$gap" -gt 3600 ] && gap=3600
  if [ $((now - last)) -lt "$gap" ]; then
    log "throttled: last start $((now - last))s ago, need ${gap}s (streak $streak)"
    return 1
  fi
  return 0
}

record_start() {
  local last=0 streak=0 now
  [ -r "$STATE/throttle" ] && read -r last streak <"$STATE/throttle"
  now="$(date +%s)"
  case "$streak" in '' | *[!0-9]*) streak=0 ;; esac
  # a session that died within 15 minutes of its start counts as a failed start and lengthens the backoff
  if [ $((now - last)) -lt 900 ] && [ "$last" -gt 0 ]; then streak=$((streak + 1)); else streak=0; fi
  echo "$now $streak" >"$STATE/throttle"
}

start_og() {
  command -v tmux >/dev/null || { log "tmux not installed"; return 1; }
  [ -x "$CLAUDE_BIN" ] || { log "claude not found at $CLAUDE_BIN"; return 1; }
  [ -r "$PROMPT_FILE" ] || default_prompt >"$PROMPT_FILE"
  if tmux has-session -t "$TMUX_NAME" 2>/dev/null; then
    log "tmux session $TMUX_NAME exists but no Claude process is in it: replacing it"
    tmux kill-session -t "$TMUX_NAME" 2>/dev/null
  fi
  record_start
  local name="og-$(hostname -s)"
  if [ "${1:-}" = "--dry-run" ]; then
    echo "would run in tmux '$TMUX_NAME' (cwd $REPO): $CLAUDE_BIN --agent og --permission-mode auto --remote-control=$name -n og \"\$(cat $PROMPT_FILE)\""
    return 0
  fi
  # env -u: the session must not inherit tokens from a cron or login environment; it authenticates with its own login
  tmux new-session -d -s "$TMUX_NAME" -c "$REPO" \
    "exec env -u GH_TOKEN -u GITHUB_TOKEN '$CLAUDE_BIN' --agent og --permission-mode auto --remote-control='$name' -n og \"\$(cat '$PROMPT_FILE')\"" \
    && log "started OG in tmux '$TMUX_NAME' (remote control name $name)" \
    || log "tmux failed to start the session"
}

cmd_check() {
  exec 9>"$STATE/lock"
  flock -n 9 || { log "another run holds the lock"; return 0; }
  local pids
  pids="$(sessions | tr '\n' ' ')"
  if [ -n "${pids// /}" ]; then
    # quiet on the happy path: log only when the picture changes
    [ "$(cat "$STATE/last-seen" 2>/dev/null)" = "alive $pids" ] || log "session alive (pids $pids)"
    echo "alive $pids" >"$STATE/last-seen"
    return 0
  fi
  echo "none" >"$STATE/last-seen"
  if [ -e "$STATE/PAUSE" ]; then log "no session, but paused (rm $STATE/PAUSE or run: $SELF resume)"; return 0; fi
  log "no Claude Code session in $REPO"
  throttle_ok || return 0
  start_og
}

cmd_start() {
  exec 9>"$STATE/lock"
  flock -n 9 || { log "another run holds the lock"; return 0; }
  if [ "${OG_FORCE:-0}" != 1 ]; then
    [ -e "$STATE/PAUSE" ] && { log "paused"; return 0; }
    throttle_ok || return 0
  fi
  start_og "${1:-}"
}

cmd_status() {
  echo "repo:      $REPO"
  echo "sessions:  $(sessions | tr '\n' ' ')"
  echo "tmux:      $(tmux has-session -t "$TMUX_NAME" 2>/dev/null && echo "session '$TMUX_NAME' exists" || echo "no session '$TMUX_NAME'")"
  echo "paused:    $([ -e "$STATE/PAUSE" ] && echo yes || echo no)"
  echo "throttle:  $(cat "$STATE/throttle" 2>/dev/null || echo 'never started')  (epoch streak)"
  echo "cron:      $(crontab -l 2>/dev/null | grep -F "og-watchdog.sh check" | head -1 || true)"
  echo "-- last log lines"
  tail -n 6 "$LOG" 2>/dev/null
}

# cron runs a private copy under $STATE, so switching branches in the repo can never remove the watchdog
INSTALLED="$STATE/og-watchdog.sh"
MARK="# og-watchdog"
CRON_LINE="*/3 * * * * OG_REPO='$REPO' '$INSTALLED' check >>'$STATE/cron.log' 2>&1 $MARK"
case "${1:-}" in
  check) cmd_check ;;
  start) shift; cmd_start "${1:-}" ;;
  status) cmd_status ;;
  pause) touch "$STATE/PAUSE"; log "paused: no session will be started until resume" ;;
  resume) rm -f "$STATE/PAUSE"; log "resumed" ;;
  install)
    [ "$SELF" = "$INSTALLED" ] || cp "$SELF" "$INSTALLED"; chmod +x "$INSTALLED"
    # drops any older entry of this script (marked or not) before adding the current one
    { crontab -l 2>/dev/null | grep -vF "$MARK" | grep -vF "og-watchdog.sh check"; echo "$CRON_LINE"; } | crontab - && log "cron installed: $CRON_LINE" ;;
  uninstall)
    crontab -l 2>/dev/null | grep -vF "$MARK" | grep -vF "og-watchdog.sh check" | crontab - && log "cron entry removed" ;;
  attach) exec tmux attach -t "$TMUX_NAME" ;;
  *) sed -n '2,20p' "$SELF" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
