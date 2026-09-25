#!/usr/bin/env bash
# Keeps one Claude Code session alive and working on this machine.
#  - No interactive Claude Code session in this repo: start OG in a detached tmux session with Remote Control enabled, named construct-og (only a session
#    whose name starts with `construct` counts as OG; one started by hand under another name does not stop a start).
#  - A session that has been idle too long (no transcript activity, subagent logs included): write a handoff summary,
#    close it and start a fresh OG that reads the summary, so a finished or stalled session never ends the work.
#
# Usage: packages/tools/dev/og-watchdog.sh <command>
#   check      one pass (what cron runs)
#   start      start OG now (honours pause and throttle unless OG_FORCE=1; --dry-run prints the command)
#   recycle    recycle now: handoff, close every session, start OG (OG_FORCE=1 skips the idle test)
#   (check also keeps a `claude rc` Remote Control server running in tmux session og-rc; OG_RC=0 turns that off)
#   status     sessions, idle time, tmux, pause, throttle, recycles, last log lines
#   pause      stop all automatic starts and closes (touch the PAUSE file); use it before you work in the tree yourself
#   resume     remove the PAUSE file
#   install    copy this script to ~/.og-watchdog and add the cron entries (every 3 minutes and at boot); rerun after editing
#   uninstall  remove the cron entry
#   attach     attach to the OG tmux session (Ctrl-b d leaves it running)
#
# Idle thresholds (minutes without transcript writes; a process younger than the threshold is never idle):
#   OG_IDLE_OG_MIN=30 for the watchdog's own OG session (it should always be working), OG_IDLE_MIN=120 for any other session.
# Guardrails: a lock, a PAUSE file, at most OG_MAX_RECYCLES (12) recycles per rolling 24 h, a start backoff (5 -> 60 min) when a
# started session dies within 15 minutes (usage limit, crash), and --permission-mode auto (never bypassPermissions).
# Files live in ~/.og-watchdog (override OG_STATE_DIR); handoff summaries are kept in ~/.og-watchdog/handoffs.
set -u

export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:/bin"
REPO="${OG_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
STATE="${OG_STATE_DIR:-$HOME/.og-watchdog}"
TMUX_NAME="${OG_TMUX:-og}"
RC_TMUX="${OG_RC_TMUX:-$TMUX_NAME-rc}"
NAME_PREFIX="${OG_NAME_PREFIX:-construct}"
SESSION_NAME="${OG_SESSION_NAME:-$NAME_PREFIX-og}"   # sessions this watchdog starts are named with it; a session without it does not count as OG
RC_SPAWN="${OG_RC_SPAWN:-worktree}"
CLAUDE_BIN="${CLAUDE_BIN:-$(command -v claude || echo "$HOME/.local/bin/claude")}"
PROMPT_FILE="${OG_PROMPT_FILE:-$STATE/prompt.txt}"
PROJECTS_DIR="${OG_PROJECTS_DIR:-$HOME/.claude/projects}"
IDLE_MIN="${OG_IDLE_MIN:-120}"
IDLE_OG_MIN="${OG_IDLE_OG_MIN:-30}"
SUMMARY_WAIT_MIN="${OG_SUMMARY_WAIT_MIN:-15}"
MAX_RECYCLES="${OG_MAX_RECYCLES:-12}"
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
SLUG="$(printf '%s' "$REPO" | sed 's/[^A-Za-z0-9]/-/g')"
LOG="$STATE/watchdog.log"
mkdir -p "$STATE"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >>"$LOG"; [ -t 1 ] && printf '%s\n' "$*"; return 0; }

# ---------------------------------------------------------------- what is running
# Interactive Claude Code sessions in this repo (or one of its worktrees): the claude executable, not a one-shot `--print`
# run, not an admin subcommand, not a helper that borrows the binary (ugrep, bfs). One pid per line.
sessions() {
  local d p args a cwd skip
  for d in /proc/[0-9]*; do
    p="${d#/proc/}"
    [ -r "$d/cmdline" ] || continue
    mapfile -d '' args <"$d/cmdline" 2>/dev/null || continue
    [ "$(basename "${args[0]:-}")" = claude ] || continue
    case "${args[1]:-}" in remote-control|rc|agents|attach|logs|rm|stop|respawn|doctor|auth|mcp|plugin|plugins|install|project|import|gateway|auto-mode|update) continue ;; esac
    skip=0
    for a in "${args[@]:1}"; do if [ "$a" = -p ] || [ "$a" = --print ]; then skip=1; fi; done
    [ "$skip" = 1 ] && continue
    cwd="$(readlink "$d/cwd" 2>/dev/null)" || continue
    case "$cwd" in "$REPO" | "$REPO"/*) echo "$p" ;; esac
  done
}

# The name a claude process was started with (-n / --name), empty if none.
proc_name() {
  local a prev="" args
  mapfile -d '' args <"/proc/$1/cmdline" 2>/dev/null || return 0
  for a in "${args[@]:1}"; do
    case "$prev" in -n|--name) printf '%s' "$a"; return 0 ;; esac
    case "$a" in --name=*) printf '%s' "${a#--name=}"; return 0 ;; esac
    prev="$a"
  done
}
# Sessions (pids, one per line) whose name starts with the prefix. The legacy names `og` / `og-*` (what earlier versions of this
# script passed to -n) count too, so deploying this version does not start a second OG beside a running one.
named_pids() {
  local p; for p in $(sessions); do case "$(proc_name "$p")" in "$NAME_PREFIX"*|og|og-*) echo "$p" ;; esac; done
}
# Epoch seconds of the newest write to a main transcript whose latest name (custom-title, follows /rename) starts with the
# prefix; 0 if none. Catches a named session whose process cwd is outside the repo.
named_activity() {
  local f t best=0 m
  while IFS= read -r f; do
    t="$(grep -o '"customTitle":"[^"]*"' "$f" 2>/dev/null | tail -1)"
    case "$t" in '"customTitle":"'"$NAME_PREFIX"*|'"customTitle":"og"'|'"customTitle":"og-'*) m="$(stat -c %Y "$f")"; [ "$m" -gt "$best" ] && best="$m" ;; esac
  done < <(find "$PROJECTS_DIR" -mindepth 2 -maxdepth 2 -path "$PROJECTS_DIR/$SLUG*" -name '*.jsonl' -mmin -10 2>/dev/null)
  echo "$best"
}

og_pid() { tmux list-panes -t "=$TMUX_NAME:" -F '#{pane_pid}' 2>/dev/null | head -1; }

# Epoch seconds of the newest transcript write for this repo (main sessions and subagents, worktrees included); 0 if none.
last_activity() {
  find "$PROJECTS_DIR" -mindepth 2 -path "$PROJECTS_DIR/$SLUG*" -name '*.jsonl' -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1 | grep . || echo 0
}
youngest_age_min() { # minutes since the most recently started session process began
  local p e best=999999
  for p in "$@"; do e="$(ps -o etimes= -p "$p" 2>/dev/null | tr -d ' ')"; [ -n "$e" ] && [ "$e" -lt "$best" ] && best="$e"; done
  echo $((best / 60))
}

# ---------------------------------------------------------------- handoff summary (no model: git, worktrees, status, last message)
write_handoff() {
  local out newest
  mkdir -p "$STATE/handoffs"
  out="$STATE/handoffs/handoff-$(date -u +%Y%m%dT%H%M%SZ).md"
  newest="$(find "$PROJECTS_DIR" -mindepth 2 -path "$PROJECTS_DIR/$SLUG*" -name '*.jsonl' -not -path '*/subagents/*' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)"
  {
    echo "# Handoff snapshot $(date -u +%FT%TZ)"
    echo "Written by og-watchdog when the previous session went idle. Git, worktrees and status below are read mechanically; only the last section is the previous session's own words."
    echo; echo "## Repo"
    git -C "$REPO" status -sb 2>/dev/null | head -15
    echo; echo "## Commits in the last 12 hours"
    git -C "$REPO" log --since='12 hours ago' --format='%h %ar %s' 2>/dev/null | head -25
    echo; echo "## Agent worktrees with commits ahead of origin/work/2026-09-23 (rescue or verify these first)"
    for d in "$REPO"/.claude/worktrees/agent-*; do
      [ -d "$d" ] || continue
      n="$(git -C "$d" rev-list --count origin/work/2026-09-23..HEAD 2>/dev/null || echo ?)"
      [ "$n" = 0 ] || printf '%s  %s ahead, last commit %s, %s changed files\n' "$(basename "$d" | cut -c7-14)" "$n" "$(git -C "$d" log -1 --format=%cr 2>/dev/null)" "$(git -C "$d" status --short 2>/dev/null | wc -l)"
    done | head -20
    if [ -x "$REPO/packages/tools/dev/status.sh" ]; then echo; echo "## status.sh"; timeout 40 "$REPO/packages/tools/dev/status.sh" 2>&1 | head -40; fi
    echo; echo "## The previous session's last message (${newest:-none found})"
    if [ -n "$newest" ]; then
      python3 - "$newest" <<'PY'
import json, os, sys
p = sys.argv[1]
size = os.path.getsize(p)
with open(p, 'rb') as f:
    f.seek(max(0, size - 4_000_000))
    lines = f.read().decode('utf-8', 'replace').splitlines()
for line in reversed(lines):
    try:
        e = json.loads(line)
    except Exception:
        continue
    if e.get('type') != 'assistant':
        continue
    parts = [c.get('text', '') for c in (e.get('message', {}).get('content') or []) if isinstance(c, dict) and c.get('type') == 'text']
    text = '\n'.join(t for t in parts if t.strip())
    if text:
        print(text[:4000])
        break
PY
    fi
  } >"$out" 2>&1
  ls -1t "$STATE"/handoffs/handoff-*.md 2>/dev/null | tail -n +21 | xargs -r rm -f
  echo "$out"
}

# ---------------------------------------------------------------- start
default_prompt() {
  cat <<'EOF'
You are OG, the orchestrator for this repo. This session was started automatically by og-watchdog because no Claude Code session was running (or the previous one had gone idle). Start work now.
1. Read your memory index and the latest handoff note, then run packages/tools/dev/status.sh.
2. Check .claude/worktrees for agent work that needs rescuing (commits ahead, dirty trees) and read Trinity's needs list so you do not repeat a question the owner already answered.
3. Continue the backlog under the standing rules in CLAUDE.md: issue discipline, verify agents actively, commit and push every shippable piece, never idle while backlog exists.
4. Ask the owner only for a genuine decision, and put it in Trinity's needs list rather than waiting on a reply. If you hit a rate limit, stop and wait for the window; do not loop.
5. Before you finish or go idle, update your memory handoff note (shipped, in flight, next steps, open questions) and push any unpushed work.
EOF
}

throttle_ok() {
  local last=0 streak=0 now gap
  [ -r "$STATE/throttle" ] && read -r last streak <"$STATE/throttle"
  now="$(date +%s)"
  case "$streak" in '' | *[!0-9]*) streak=0 ;; esac
  gap=120
  if [ "$streak" -gt 0 ]; then gap=$((300 * (1 << (streak - 1)))); [ "$gap" -gt 3600 ] && gap=3600; fi
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
  local handoff="${1:-}" dry="${2:-}" run="$STATE/prompt.run.txt" name
  command -v tmux >/dev/null || { log "tmux not installed"; return 1; }
  [ -x "$CLAUDE_BIN" ] || { log "claude not found at $CLAUDE_BIN"; return 1; }
  [ -r "$PROMPT_FILE" ] || default_prompt >"$PROMPT_FILE"
  [ -n "$handoff" ] || handoff="$(ls -1t "$STATE"/handoffs/handoff-*.md 2>/dev/null | head -1)"
  { cat "$PROMPT_FILE"; [ -n "$handoff" ] && printf '\nThe previous session left a handoff snapshot: %s . Read it first; it lists worktrees to rescue and the previous session'\''s last message.\n' "$handoff"; } >"$run"
  if tmux has-session -t "=$TMUX_NAME" 2>/dev/null; then
    log "tmux session $TMUX_NAME exists but no Claude process is in it: replacing it"
    tmux kill-session -t "=$TMUX_NAME" 2>/dev/null
  fi
  name="$SESSION_NAME-$(hostname -s)"
  if [ "$dry" = "--dry-run" ]; then
    echo "would run in tmux '$TMUX_NAME' (cwd $REPO): $CLAUDE_BIN --agent og --permission-mode auto --remote-control=$name -n $SESSION_NAME \"\$(cat $run)\""
    return 0
  fi
  record_start
  # env -u: the session must not inherit tokens from a cron or login environment; it authenticates with its own login.
  # 9>&-: the tmux server must not inherit the lock file descriptor, or every later pass would see the lock held forever.
  tmux new-session -d -s "$TMUX_NAME" -c "$REPO" \
    "exec env -u GH_TOKEN -u GITHUB_TOKEN '$CLAUDE_BIN' --agent og --permission-mode auto --remote-control='$name' -n '$SESSION_NAME' \"\$(cat '$run')\"" 9>&- \
    && log "started OG in tmux '$TMUX_NAME' (remote control name $name${handoff:+, handoff $(basename "$handoff")})" \
    || log "tmux failed to start the session"
}

# ---------------------------------------------------------------- claude rc: a Remote Control server for this repo
# One `claude rc` in its own detached tmux session, so claude.ai/code and the phone app can start sessions here. Spawned sessions
# get their own worktree (OG_RC_SPAWN=same-dir to share the tree) and --permission-mode auto, never bypassPermissions.
# The tmux session exists exactly as long as the process runs, so a missing session means start it.
ensure_rc() {
  [ "${OG_RC:-1}" = 0 ] && return 0
  [ -e "$STATE/PAUSE" ] && return 0
  tmux has-session -t "=$RC_TMUX" 2>/dev/null && return 0
  command -v tmux >/dev/null && [ -x "$CLAUDE_BIN" ] || return 0
  tmux new-session -d -s "$RC_TMUX" -c "$REPO" \
    "exec env -u GH_TOKEN -u GITHUB_TOKEN '$CLAUDE_BIN' rc --name '$NAME_PREFIX-rc-$(hostname -s)' --spawn '$RC_SPAWN' --permission-mode auto" 9>&- \
    && log "started claude rc in tmux '$RC_TMUX' (spawn $RC_SPAWN)" \
    || log "tmux failed to start claude rc"
}

# ---------------------------------------------------------------- recycle: summarize, close, start fresh
recycles_in_24h() { local now cutoff; now="$(date +%s)"; cutoff=$((now - 86400)); awk -v c="$cutoff" '$1>=c' "$STATE/recycles" 2>/dev/null | wc -l; }

close_sessions() {
  local p left
  tmux kill-session -t "=$TMUX_NAME" 2>/dev/null
  for p in $(sessions); do kill -TERM "$p" 2>/dev/null; done
  for _ in 1 2 3 4 5 6; do left="$(sessions | tr '\n' ' ')"; [ -z "${left// /}" ] && return 0; sleep 2; done
  for p in $(sessions); do kill -KILL "$p" 2>/dev/null; done
  sleep 1
}

finish_recycle() { # handoff path
  close_sessions
  rm -f "$STATE/recycle"
  echo "$(date +%s)" >>"$STATE/recycles"
  start_og "$1"
}

# phases: (none) -> idle detected -> [OG session: ask it for a handoff note] "summarizing" -> close all -> start OG
recycle_step() {
  local force="${1:-0}" pids ogp thr act now idle_min young phase ts token handoff pane
  now="$(date +%s)"
  phase=none
  [ -r "$STATE/recycle" ] && read -r phase ts token handoff <"$STATE/recycle"
  if [ "$phase" = summarizing ]; then
    # OG's reply is a line holding only the token (optionally after the bullet); the request line holds much more text
    pane="$(tmux capture-pane -t "=$TMUX_NAME:" -p -J -S -400 2>/dev/null | grep -cE "^[[:space:]]*(●|⏺)?[[:space:]]*$token[[:space:]]*$")"
    if [ "${pane:-0}" -ge 1 ] || [ $((now - ts)) -ge $((SUMMARY_WAIT_MIN * 60)) ] || ! tmux has-session -t "=$TMUX_NAME" 2>/dev/null; then
      log "OG handoff note $([ "${pane:-0}" -ge 1 ] && echo written || echo 'not confirmed in time'); closing sessions and starting a fresh OG"
      finish_recycle "$handoff"
    else
      log "waiting for OG to write its handoff note ($(( (now - ts) / 60 ))/${SUMMARY_WAIT_MIN} min)"
    fi
    return 0
  fi
  pids="$(sessions | tr '\n' ' ')"; ogp="$(og_pid)"
  thr="$IDLE_MIN"; case " $pids " in *" $ogp "*) [ -n "$ogp" ] && thr="$IDLE_OG_MIN" ;; esac
  act="$(last_activity)"; idle_min=$(((now - act) / 60)); young="$(youngest_age_min $pids)"
  if [ "$force" != 1 ]; then
    [ "$idle_min" -ge "$thr" ] && [ "$young" -ge "$thr" ] || return 0
    [ -e "$STATE/PAUSE" ] && { log "idle ${idle_min} min but paused"; return 0; }
    if [ "$(recycles_in_24h)" -ge "$MAX_RECYCLES" ]; then log "idle ${idle_min} min but $MAX_RECYCLES recycles already in 24 h: not recycling"; return 0; fi
  fi
  log "idle ${idle_min} min (threshold ${thr}, youngest session ${young} min): recycling"
  handoff="$(write_handoff)"; log "handoff snapshot $(basename "$handoff")"
  case " $pids " in
    *" $ogp "*) [ -n "$ogp" ] && {
      token="HANDOFF-$now"
      tmux send-keys -t "=$TMUX_NAME:" "This session has been idle. Write your handoff note now: update your memory handoff (what shipped, what is in flight, next steps, open questions) and push any unpushed work. Then reply with exactly this token and nothing else: $token" Enter
      echo "summarizing $now $token $handoff" >"$STATE/recycle"
      log "asked OG for its handoff note (token $token)"
      return 0; } ;;
  esac
  finish_recycle "$handoff"
}

# ---------------------------------------------------------------- commands
cmd_check() {
  exec 9>"$STATE/lock"
  flock -n 9 || { log "another run holds the lock"; return 0; }
  ensure_rc
  local pids
  pids="$(sessions | tr '\n' ' ')"
  if [ -n "${pids// /}" ]; then
    [ "$(cat "$STATE/last-seen" 2>/dev/null)" = "alive $pids" ] || log "session alive (pids $pids)"
    echo "alive $pids" >"$STATE/last-seen"
    recycle_step 0          # idle handling covers every session in the repo, named or not
    [ -e "$STATE/recycle" ] && return 0     # a recycle is mid-way (waiting for a handoff note): leave it alone
  fi
  # Only a session named "$NAME_PREFIX*" counts as the running OG; one that is not (started by hand, say) does not stop a start.
  if [ -n "$(named_pids | tr -d '\n ')" ]; then return 0; fi
  # A named session whose process cwd is outside the repo (started from ~, say) is invisible to sessions(), but its transcript
  # and its subagents' transcripts are still being written: that is a live session, not an absent one.
  local act now; act="$(named_activity)"; now="$(date +%s)"
  if [ "$act" -gt 0 ] && [ $((now - act)) -lt "${OG_LIVE_SEC:-300}" ]; then
    log "no $NAME_PREFIX* session found by cwd, but its transcript changed $((now - act)) s ago: treating it as alive"
    return 0
  fi
  echo "none" >"$STATE/last-seen"; rm -f "$STATE/recycle"
  if [ -e "$STATE/PAUSE" ]; then log "no $NAME_PREFIX* session, but paused (run: $SELF resume)"; return 0; fi
  log "no session named $NAME_PREFIX* in $REPO${pids:+ (unnamed sessions running: $pids)}"
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
  start_og "" "${1:-}"
}

cmd_recycle() {
  exec 9>"$STATE/lock"
  flock -n 9 || { log "another run holds the lock"; return 0; }
  if [ -z "$(sessions | tr -d '\n ')" ]; then log "no session to recycle; starting OG"; start_og; return 0; fi
  recycle_step "${OG_FORCE:-0}"
}

cmd_status() {
  local pids act now
  pids="$(sessions | tr '\n' ' ')"; act="$(last_activity)"; now="$(date +%s)"
  echo "repo:      $REPO"
  echo "sessions:  ${pids:-none}  (named $NAME_PREFIX*: $(named_pids | tr '\n' ' ')${pids:+)}"
  echo "activity:  $([ "$act" -gt 0 ] && echo "last transcript write $(((now - act) / 60)) min ago (idle at ${IDLE_OG_MIN} min for OG, ${IDLE_MIN} min otherwise)" || echo "no transcripts found")"
  echo "tmux:      $(tmux has-session -t "=$TMUX_NAME" 2>/dev/null && echo "session '$TMUX_NAME' exists" || echo "no session '$TMUX_NAME'")"
  echo "rc:        $(tmux has-session -t "=$RC_TMUX" 2>/dev/null && echo "session '$RC_TMUX' running (claude rc, spawn $RC_SPAWN)" || echo "not running")"
  echo "paused:    $([ -e "$STATE/PAUSE" ] && echo yes || echo no)"
  echo "recycle:   $(cat "$STATE/recycle" 2>/dev/null || echo idle), $(recycles_in_24h)/${MAX_RECYCLES} in the last 24 h"
  echo "throttle:  $(cat "$STATE/throttle" 2>/dev/null || echo 'never started')  (epoch streak)"
  echo "handoff:   $(ls -1t "$STATE"/handoffs/handoff-*.md 2>/dev/null | head -1 || true)"
  echo "cron:      $(crontab -l 2>/dev/null | grep -F "og-watchdog.sh" | head -1 | cut -c1-130 || true)"
  echo "-- last log lines"
  tail -n 6 "$LOG" 2>/dev/null
}

# cron runs a private copy under $STATE, so switching branches in the repo can never remove the watchdog
INSTALLED="$STATE/og-watchdog.sh"
MARK="# og-watchdog"
CRON_LINE="*/3 * * * * OG_REPO='$REPO' '$INSTALLED' check >>'$STATE/cron.log' 2>&1 $MARK"
BOOT_LINE="@reboot sleep 30; OG_REPO='$REPO' '$INSTALLED' check >>'$STATE/cron.log' 2>&1 $MARK"
case "${1:-}" in
  check) cmd_check ;;
  start) shift; cmd_start "${1:-}" ;;
  recycle) cmd_recycle ;;
  status) cmd_status ;;
  pause) touch "$STATE/PAUSE"; log "paused: nothing will be started or closed until resume" ;;
  resume) rm -f "$STATE/PAUSE"; log "resumed" ;;
  install)
    [ "$SELF" = "$INSTALLED" ] || cp "$SELF" "$INSTALLED"; chmod +x "$INSTALLED"
    { crontab -l 2>/dev/null | grep -vF "$MARK" | grep -vF "og-watchdog.sh check"; echo "$CRON_LINE"; echo "$BOOT_LINE"; } | crontab - && log "cron installed: $CRON_LINE (and @reboot)" ;;
  uninstall)
    crontab -l 2>/dev/null | grep -vF "$MARK" | grep -vF "og-watchdog.sh check" | crontab - && log "cron entry removed" ;;
  attach) exec tmux attach -t "=$TMUX_NAME" ;;
  *) sed -n '2,26p' "$SELF" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
