# Carry-over 2026-10-13 (updated after the fallow wave and lending r1)

Read this first. Check agent work by **branch state with git** (`git ls-remote private`), not transcripts — the
agents below report into the previous session. Push to `private` only. Never model "fable".

## Owner rules (standing)
- Development in parallel always; full suites, training, benchmarks strictly **one at a time** through
  `packages/tools/dev/heavy.sh` (single slot, never 2). Benchmarks only at the end, on the final merged tree.
- **No Playwright** in local dev or for UI features (CLAUDE.md rule 10). Only for crawling default atoms and the
  bench acceptance step. UI checks: unit tests, DOM render checks, AST dry runs.
- Main session answers and delegates (og for merges/suite/bench); verify agent claims against git diff before
  telling the owner, and say what was verified.
- og merges only with `git -C <og-final-1012 worktree> merge --no-ff <ref>` (owner permission rule; no pipe after).

## State
- `private/work/2026-09-23` = `private/og/final-2026-10-12` = **d7d1e14e** (merge wave 2026-10-13, then this doc commit on
  top; suite on d7d1e14e: 7210 tests, 7152 pass / 0 fail / 52 skip / 6 todo, via heavy.sh). Merged onto 3184fe0c:
  carry-over docs b816a985, heavy.sh re-entrant #939, finish guard #931 (B), feature modules #935 (E1), coder read
  tools #937 (E2), seed from the spec #933 (A), builder context #932 (C), research loop #936 (E3), tool harness #938,
  context probe write-up. #931-#933, #935-#939 closed.
  Reconciled in follow-up commits: coder `importableFor` reads other features' index via `moduleScope` (bb626736);
  seed reads module-scoped fixtures, `.value`/index-aware cart import (6e011838); ledger turn ends on the last refusal
  + fact "No feature has usecases, services or domains yet" (7d9d845b); research imports block uses `importableFor`,
  its `importableFiles` copy dropped (b38297a0); one ledger per `--research` run via `bridgeLedger` (384112c5);
  new engine files in subfolders, line-modules 32372/32768 bytes (dd1918e4: `line/harness/toolHarness.mjs`,
  `line/context/{contextPack,exampleFix,contextScore}.mjs`); knows map flags only a direct import of another
  feature's file (d7d1e14e). In the harness merge (4464dffe): a native call of a run's tool that the per-turn read
  selection left out is served and logged as a miss (`read-misses.jsonl`); only an unknown tool gets the nudge.
- Lending bench r1 (qwen2.5-coder:7b, `bench/lending/RESULTS.md`): **0/24 on every arm** (seed-only, `--seed-plan`,
  `--seed 2`; plain twin failed to build, 58 tsc errors). Owner bar not met: the seed does not generalise.
- Ecommerce history: r4-s2 1/22, r5 5/22, seed-only 22/22 (tuned to that spec). `bench/ecommerce/results/`.

## Diagnosis of lending r1 (verified from run logs)
- Seed is shop recipes (atomSteps.mjs: ~39 ecommerce refs, CART-1/CHK-5 hard-coded, cart wording at :172): browse
  `/` and loans get no page, browse list suggested on DetailPage, request on ListPage, picks told to load all
  books.json, "cart" text leaks into lending output.
- Wrong builder context (owner: "show more context to the coder model, they are good at these things"):
  prompt_eval_count 3.6k -> 16.2k against num_ctx 16384 by turn 14 (silent truncation); ~40% of turn 12 is one
  failed setCode repeated 3x; the model never saw PicksPage's code or ListPage props; TYPE_ERROR refusals give an
  instruction, not an example fix.
- `finish` accepted while 5 approved steps waited (`--seed 2` run).

## In flight / ready
Nothing in flight: the 2026-10-13 wave (A, B, C, E1, E2, E3, harness, #939, probe write-up) is merged (see State).

## Next, in order
1. Done 2026-10-13: merge wave onto og/final (d7d1e14e), suite green, work fast-forwarded, issues closed.
2. Bench rerun, one at a time: lending seed-only, lending `--seed-plan`, ecommerce seed-only (must stay 22/22).
3. CSP discipline (explicit step input/output, one ledger owner, trace wrapper = session log, model-call timeouts).
4. shortestPlan block (AND-OR graph, Knuth generalized Dijkstra, greedy Steiner merge, typed edges; tool picking first).
5. Smith System 1 (below), LoRA 1.5b coder, attention pruning via MLX; path-first step 4.

## Decisions (owner, 2026-10-13, full text in memory project-english-as-context)
- Probe result: fresh small context wins (L+tools 7b 4/5 at 1.5k tokens vs 0/5 at 14.9k); code->English via Smith and
  atom-sentence thinking 0/5 (Smith to-english near-empty on React pages).
- Tool harness: native Ollama tools only, no custom call parsing; layered turn ships only on a measured win.
- CSP: no runtime, discipline only. shortestPlan: deterministic only, no learned ranker.
- Line transformer: LoRA qwen2.5-coder:1.5b via MLX-LM -> GGUF -> Ollama; after merge + bench rerun.
- Attention: coder's own attention (MLX) as a context-pruning signal for ledger facts, not path detection.
- LoRA targets now include native `tool_calls` for qwen2.5-coder (it writes calls as text today).
- **Smith System 1** (new): a learned English<->JS translator, CodeT5+ 220M fine-tuned, the fast intuitive
  counterpart to Smith's deterministic translation (System 2). Smith stays the checker/fallback; System 1 covers
  where Smith returns nothing (React pages). Data: Smith's own non-empty translations, atom registry `english` +
  code, typed-contract examples, probe samples. Eval: JS->English vs the hand-written ledger facts that won the probe;
  then re-run probe V5/V8 with System 1 English. Ships only on a measured win. Data generator is dev work (now);
  training is a heavy job after merge + bench rerun.

## Path-first decisions (owner, 2026-10-13)
In memory `project-path-first-plan`: Trace builds typed path per point (beam always forks, deterministic prune
first, model compares only if >1 survive; 3 tries then user); examples from spec+fixtures (acceptance held out);
AI fills any stub body, signatures locked, bottom-up; first failing example back; stub fail x3 -> re-plan, none
left -> NEEDS_YOU; oracle = stub check + tsc + examples + AST dry run (logicVerify) + DOM snapshot diff (expected
change must appear); render examples for UI, contract mock for services; models switchable per role; Cockpit
Layers view shows the path.

## Open items
- fallow: Cockpit engine-mode validate (ui/server/src/validateApi.mjs handleValidate) doesn't run fallow; IMPORT-001
  may report the wrong line (line 1 vs 2 in Score.ts); a dead file inside a layer folder is not flagged (owner
  accepted for now, #926). Node 20 left only in trace/ (Termux, paused) and historical design docs.
- Epic #884 is closed with #921/#925 open under it (owner: leave as is).
- Board fields for #926-#939 (project-manager pass).
- #881 needs its measured jev-vs-static eval.
- openWork text check misses PROD-2/PROD-4 after seeding (may be covered by A).
- docs/MEDIA.md still uses Playwright recording — ask the owner before using it.
