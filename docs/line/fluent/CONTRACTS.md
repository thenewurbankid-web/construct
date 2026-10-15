# Fluent build: contracts index

The contract text lives in `docs/line/FLUENT-PLAN-2026-10-15.md` ("Shared contracts"); the code below is the
enforced version. When they disagree, the code and its tests win, and the plan is updated.

| Contract | What | Plan section | Code |
|---|---|---|---|
| C1 | Reference entry (input) | C1 | `packages/line-codemod/bench/atoms/js-reference/reference.json`, `expected.json`, `map.json` |
| C2 | Fluent answer | C2 | `packages/line-fluent/contract/answer.schema.json`, `validate.mjs` |
| C3 | Gate result | C3 | `packages/line-fluent/gate/` (`assemble.mjs`, `grammar/`) |
| C4 | Comparison | C4 | `packages/line-fluent/compare/compare.mjs` |
| C5 | Next words | C5 | `packages/line-fluent/grammar/next-words.mjs` |

Per-leaf contracts (each wave 2 leaf: inputs, outputs, files, done) are in the board snapshot:
`board-data/tasks/<id>.json`, field `data.contract`, with `benefit`, `risks`, `thoughts`, `report`.

## Board data (db of the Fluent Build Board)

### tasks/<id>
```
title, parent (id | null), order, status: todo | running | review | done | blocked, progress 0-100,
quickWin, etaAt (ISO), linesAdded, linesRemoved, version (fluent-v0.x.y | null),
contract, benefit, risks: [{risk, mitigation}], thoughts, session, branch, note, report
```
Ids: `E<n>` epics, `T<e>.<n>` tasks, `T<e>.<n>.<m>` or `T<e>.<n><letter>` subtasks. Parents roll up progress
and line counts in the page.

### report (on a task, when done)
```
doneAt (ISO), summary, baseline (before), outcome (after),
metrics: [{name, before, after, unit?}], tests: {pass, fail, skipped},
collection: [{name, count, note?}]   what the task added to the library
artifacts: [{label, ref}]            commits, paths, https links
followups: [string]
```
Numbers are measured by the orchestrator (re-run tests, git diff --shortstat), never copied from an agent's claim.

### agents/<name>
`task, status: running | done | failed | idle, startedAt (ISO), note`

### release/current
`version, goal, items: [task ids], etaAt, startedAt`

## Operating rules (owner, 2026-10-15)
- One task at a time, with the full capacity of 14-18 agents on it, split into file-disjoint 15-20 min leaves.
- The task closest to done always has 4-5 agents.
- Every task and subtask files a report when done.
- Heavy jobs one at a time (`packages/tools/dev/heavy.sh`). Full suites may run in a cloud session once a cloud
  environment for construct-private exists.
- Push to `private` only. Nothing merges to a public branch without the owner.
