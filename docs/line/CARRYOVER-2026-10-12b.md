# Carry-over 2026-10-12 (evening)

Base: `private/work/2026-09-23` (local `work/2026-09-23` ref is stale at cc45f012; always fetch private). Push to `private` only, never `origin`. Never model "fable". Android/Termux paused.

## Heavy queue (owner decision)
Bench runs first (one at a time through heavy.sh): pilot-qwen-7b-r3 (Line arm), pilot-qwen-7b-plain-r3 (twin), pilot-qwen-7b-r3-s2 (seed 2). When all three finish, send "bench done" to the waiting agents below; after that up to 2 heavy jobs at once (heavy.sh is one slot today — needs a small change or two queues).
Then report r2 vs r3 vs twin vs seed 2 against the owner bar (>=3 landed steps, model gaps not the majority).

## Branches waiting for "bench done" (all unmerged; merge via og after full suite on the combined tree)
| Work | Branch | Head | Waits on |
|---|---|---|---|
| jev intent shadow, ask CLI, label CLI, Plan/jev MC panel (#892, epic #891) | worktree-agent-a83ab6193103a5684 | e81b9970 | train_intent, trained eval, full suite |
| planner eval: Requester/Grader/rubric, Trace /beam page (#896, #897) | worktree-agent-a892f45e8efd3eff6 | cee444b9 | Playwright beam-eval, full suite (agent C builds on it) |
| jev tokenizer (#881) | worktree-agent-ad6f690f1c4746f2a | e64bba72 | retrain on RAW text (owner), eval vs static 0.765/0.265/0.824 |
| jev data runs | jev-data-runs | 3277d308 | acceptance for data-qwen3-4b-r1 (stopped at turn 43, 12/12 landed) |
| mvp-flow real run | worktree-agent-a399fcbcf27b1b09b | (none) | fresh replay from step 1 (step-14 clone not found) |
| MC Context / jev view (#899) | worktree-agent-a4df8b232cf11ea50 | 2017c836 | og gate+merge in flight |
Also in flight earlier: #882 flakes, #883 safe coverage, #887 gap, lv8 L2 dev-server.

## Beam epic ("Plan = fit the request into the Trace map, by parallel runs")
Owner decisions: beam forks the Trace pipeline (makePlan per candidate; not runPipeline); owner's 4-line rubric (fits 0-3, layer/stub-first 0-3, asked-when-needed 0-2, clarity 0-2); ONE real Opus eval run (~20 requirements, ~$1-2) after A+B land and bench done; hints (slice 0) already merged in 12da0053.
- A: trace/src/beam/ planner; contract on local branch `beam-contract` (`trace/src/beam/contract.mjs`, epic number in `trace/src/beam/EPIC`).
- B: NLP arms (static default; sklearn, spaCy, jev, zero-shot in shadow, off) on top of #892.
- C: eval harness + Mission Control "Beam eval" panel on top of #896.

## Follow-ups to file/launch
- Drop the old `norm` in packages/engine/line/hints.mjs:551 so the jev shadow sends raw text (owner: raw text).
- Board: 17 older orphans flagged, 127 unclassified issues (#637-#852), stale In progress #180 #182 #299 #701, no epic for "[Logic verification]" issues.
- heavy.sh: allow 2 slots after bench.

Mission Control: `npm run mc` (127.0.0.1:4777).
