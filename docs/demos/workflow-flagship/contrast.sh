#!/bin/bash
# Honest contrast: the same refund flow, produced 5 times by (a) a prompt-only
# `claude -p` call and (b) Construct's deterministic `create workflow`.
# Measures wall time, a SHA-256 of each output, the size of the diff between
# runs, and what the workflow narrator makes of each output.
#
#   bash docs/demos/workflow-flagship/contrast.sh [runs]     (default 5)
#
# Needs the `claude` CLI on PATH. Nothing here is mocked; the numbers printed
# are whatever this machine measured.
RUNS=${1:-5}
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
CLI="node $REPO/packages/cli/construct.mjs"
OUT="${CONTRAST_OUT:-$(mktemp -d)}"
mkdir -p "$OUT/llm" "$OUT/construct"

read -r -d '' BRIEF <<'EOF'
Write a single TypeScript file that defines an XState v5 state machine (using `setup({...}).createMachine({...})` from 'xstate') for a refund request flow. Output ONLY the file contents, no explanation, no markdown fences.
The flow:
- Starts in "requested". Event SUBMIT moves to "reviewing".
- In "reviewing": event APPROVE goes to "paying" if the guard isWithinLimit holds, otherwise to "escalated". Event REJECT goes to "rejected".
- In "escalated": APPROVE goes to "paying", REJECT goes to "rejected".
- In "paying": PAYMENT_SUCCEEDED goes to "refunded". PAYMENT_FAILED goes back to "paying" if the guard hasRetriesLeft holds, otherwise to "rejected".
- "refunded" and "rejected" are final states.
- Context has amount (number, default 0) and attempts (number, default 0).
EOF

ms() { echo $(( ($(date +%s%N) - $1) / 1000000 )); }

echo "== (a) prompt-only claude, $RUNS runs =="
for i in $(seq 1 "$RUNS"); do
  t=$(date +%s%N)
  claude -p --output-format text --permission-prompts none "$BRIEF" > "$OUT/llm/run$i.tsx" 2> "$OUT/llm/run$i.err"
  echo "run $i: $(ms $t) ms, $(wc -l < "$OUT/llm/run$i.tsx") lines, sha256 $(sha256sum "$OUT/llm/run$i.tsx" | cut -c1-12)"
done
echo "distinct outputs: $(sha256sum "$OUT"/llm/run*.tsx | cut -d' ' -f1 | sort -u | wc -l) of $RUNS"
for i in $(seq 2 "$RUNS"); do
  d=$(diff "$OUT/llm/run1.tsx" "$OUT/llm/run$i.tsx" | grep -cE '^[<>]')
  echo "diff run1 vs run$i: $d changed line(s)"
done

echo; echo "== (b) Construct create workflow from the JSON descriptor, $RUNS runs =="
for i in $(seq 1 "$RUNS"); do
  P="$OUT/construct/p$i"; rm -rf "$P"
  $CLI init "$P" > /dev/null
  t=$(date +%s%N)
  line=$($CLI create workflow refund --feature refunds --from "$HERE/refund.json" --dir "$P" | head -1)
  echo "run $i: $(ms $t) ms wall (incl. node start-up); ${line}; sha256 $(sha256sum "$P/features/refunds/workflows/RefundWorkflow.tsx" | cut -c1-12)"
done
echo "distinct outputs: $(sha256sum "$OUT"/construct/p*/features/refunds/workflows/RefundWorkflow.tsx | cut -d' ' -f1 | sort -u | wc -l) of $RUNS"

echo; echo "== what the narrator says about each claude output =="
for i in $(seq 1 "$RUNS"); do
  P="$OUT/llm/proj$i"; rm -rf "$P"; $CLI init "$P" > /dev/null
  mkdir -p "$P/features/refunds/workflows"
  # strip stray markdown fences if the model added them despite the instruction
  sed '/^```/d' "$OUT/llm/run$i.tsx" > "$P/features/refunds/workflows/RefundWorkflow.tsx"
  echo "-- claude run $i:"
  $CLI research workflow refunds --format json --dir "$P" 2>&1 | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const m=JSON.parse(s).files[0].machines[0];console.log("   states:",m.states.length,"| scenarios:",m.scenarios.length,"| health findings:",m.findings.length, m.error?"| error: "+m.error:"")}catch(e){console.log("   narrator could not read it:",s.split("\n")[0].slice(0,120))}})'
done
echo "outputs kept in $OUT"
