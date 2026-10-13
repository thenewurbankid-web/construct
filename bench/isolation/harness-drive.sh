#!/usr/bin/env bash
# harness-drive.sh (#941): plugs a whole coding harness in as the driver, through MCP only (drive-mcp.mjs).
# For each task x arm it runs one fresh headless session whose ONLY tools are two isolation MCP tools:
#   CD      harness drives qwen2.5-coder:1.5b: task_show + task_try   (its brief is a note on briefBuilder's brief; never sees the file)
#   CD-raw  same tools, task_try raw: true                         (its brief is the whole 1.5b prompt)
#   CW  harness writes the code itself:    task_show_code + task_check (no model)
# No shell, no file read/write tools. Run from the repo root, NOT under heavy.sh: each task_try takes the heavy
# slot itself (it may wait for another Ollama job; that is expected).
#
#   bench/isolation/harness-drive.sh --harness claude   --run cd1 [--tasks t03-...,t06-...] [--arms CD,CD-raw,CW]
#   bench/isolation/harness-drive.sh --harness opencode --run cd1 [--model ollama/qwen3:4b]
#   node bench/isolation/drive.mjs summary --run cd1
#
# Results: bench/isolation/results/claude-drive/<run>.jsonl (every try/check) and
#          bench/isolation/results/claude-drive/<run>/<harness>-<arm>-<task>.json (one per session).
# Env: CLAUDE_MODEL (claude --model; default: claude's own), OPENCODE_MODEL (same as --model),
#      MCP_TOOL_TIMEOUT (ms, default 3900000: task_try can wait for the heavy slot).
set -euo pipefail

HARNESS=claude RUN= MODEL=${OPENCODE_MODEL:-} ARMS=CD,CD-raw,CW
TASKS=t03-book-availability,t05-book-add-to-picks,t06-picks-store,t07-picks-page-list,t09-browse-heading-availability,t10-browse-paging,t11-browse-sort-title,t12-browse-genre-filter
while [ $# -gt 0 ]; do
  case "$1" in
    --harness) HARNESS=$2; shift 2 ;;
    --run) RUN=$2; shift 2 ;;
    --tasks) TASKS=$2; shift 2 ;;
    --arms) ARMS=$2; shift 2 ;;
    --model) MODEL=$2; shift 2 ;;
    *) echo "usage: $0 --harness claude|opencode --run <id> [--tasks a,b] [--arms CD,CD-raw,CW] [--model m]" >&2; exit 2 ;;
  esac
done
[[ "$RUN" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "--run <id> is required" >&2; exit 2; }
[ -f bench/isolation/drive-mcp.mjs ] || { echo "run from the repo root" >&2; exit 2; }
case "${CLAUDE_MODEL:-}${MODEL}" in *fable*) echo "model fable is not allowed" >&2; exit 2 ;; esac

ROOT=$(pwd)
OUT="$ROOT/bench/isolation/results/claude-drive/$RUN"
mkdir -p "$OUT"
SERVER="$ROOT/bench/isolation/drive-mcp.mjs"
export MCP_TOOL_TIMEOUT=${MCP_TOOL_TIMEOUT:-3900000}

prompt() { # arm task
  if [ "$1" = CD-raw ]; then
    cat <<EOF
You are the lead on task $2 and a small coder model writes the code. You have only two tools.
1. Call task_show with task "$2" to see the spec and the function(s) to write.
2. Describe intent; never write the implementation; the 1.5b writes the code. The brief you write is the WHOLE prompt the coder sees: it gets nothing else. So include the function's exact name, its exact signature, the types it uses, what it must do, and the spec's exact wording for every string to show; at most a 3-line shape example from a different domain. A brief with a function body or more than 3 lines of code is rejected. The coder's reply starts with the signature already written, so it writes only the body. Call task_try with task "$2", that brief and raw: true.
3. If the task has several functions, write one brief per function, in the order task_show gives, and call task_try with fn set to that function. A brief must not name the other functions. OK means that function is done: go on to the next one.
4. If it says FAIL, rewrite that brief to fix the reported error and call task_try again with raw: true.
Never try to read source files. Stop at PASS, or after 3 FAIL results in total, and end with one line: PASS or FAIL.
EOF
  elif [ "$1" = CD ]; then
    cat <<EOF
You are the lead on task $2 and a small coder model writes the code. You have only two tools.
1. Call task_show with task "$2" to see the spec and the function(s) to write.
2. Describe intent; never write the implementation; the 1.5b writes the code. The harness already gives the coder the signature, the types, the spec and a worked example; your brief is a short note on top: what the function must do and the spec's exact strings, in a few lines. A brief with a function body or more than 3 lines of code is rejected. Call task_try with task "$2" and that brief.
3. If the task has several functions, write one note per function, in the order task_show gives, and call task_try with fn set to that function. A note must not name the other functions. OK means that function is done: go on to the next one.
4. If it says FAIL, rewrite that note to fix the reported error and call task_try again.
Never try to read source files. Stop at PASS, or after 3 FAIL results in total, and end with one line: PASS or FAIL.
EOF
  else
    cat <<EOF
You write the code for task $2 yourself. You have only two tools.
1. Call task_show_code with task "$2" to see the spec and the starting file.
2. Write the complete new file and call task_check with task "$2" and the file as content.
3. If it says FAIL, fix the file and call task_check again. At most 2 retries.
Stop at PASS or after 3 task_check calls, and end with one line: PASS or FAIL.
EOF
  fi
}
tools_for() { [ "$1" = CW ] && echo "task_show_code task_check" || echo "task_show task_try"; }

IFS=, read -r -a TASK_LIST <<<"$TASKS"
IFS=, read -r -a ARM_LIST <<<"$ARMS"
for task in "${TASK_LIST[@]}"; do
  for arm in "${ARM_LIST[@]}"; do
    read -r t1 t2 <<<"$(tools_for "$arm")"
    dest="$OUT/$HARNESS-$arm-$task.json"
    echo "$HARNESS $arm $task -> ${dest#$ROOT/}" >&2
    case "$HARNESS" in
      claude)
        mcp=$(printf '{"mcpServers":{"isolation":{"command":"%s","args":["%s"],"env":{"DRIVE_RUN":"%s","DRIVE_HARNESS":"claude"}}}}' "$(command -v node)" "$SERVER" "$RUN")
        claude -p "$(prompt "$arm" "$task")" --output-format json --max-turns 12 \
          ${CLAUDE_MODEL:+--model "$CLAUDE_MODEL"} \
          --mcp-config "$mcp" --strict-mcp-config \
          --allowedTools "mcp__isolation__$t1,mcp__isolation__$t2" \
          --disallowedTools "Bash,Read,Write,Edit,MultiEdit,NotebookEdit,Glob,Grep,LS,WebFetch,WebSearch,Task,Agent,TodoWrite" \
          >"$dest" || echo "  claude exited $? (result kept)" >&2
        ;;
      opencode)
        # A throwaway project dir with its own opencode.json: the user's global config is never touched.
        dir="$OUT/opencode-$arm-$task.project"
        rm -rf "$dir"; mkdir -p "$dir"
        cat >"$dir/opencode.json" <<EOF
{
  "mcp": { "servers": { "isolation": { "type": "local", "command": ["$(command -v node)", "$SERVER"],
    "environment": { "DRIVE_RUN": "$RUN", "DRIVE_HARNESS": "opencode" } } } },
  "permissions": [
    { "action": "*", "resource": "*", "effect": "deny" },
    { "action": "isolation_$t1", "resource": "*", "effect": "allow" },
    { "action": "isolation_$t2", "resource": "*", "effect": "allow" }
  ]
}
EOF
        start=$(node -e 'console.log(Date.now())')
        (cd "$dir" && opencode run --standalone --format json ${MODEL:+--model "$MODEL"} "$(prompt "$arm" "$task")") \
          >"$OUT/opencode-$arm-$task.events.jsonl" 2>"$OUT/opencode-$arm-$task.stderr" || echo "  opencode exited $? (events kept)" >&2
        node "$ROOT/bench/isolation/drive.mjs" opencode-normalize "$OUT/opencode-$arm-$task.events.jsonl" "$dest" "$start" "${MODEL:-configured default}"
        ;;
      *) echo "unknown harness $HARNESS (claude|opencode)" >&2; exit 2 ;;
    esac
  done
done
node bench/isolation/drive.mjs summary --run "$RUN"
