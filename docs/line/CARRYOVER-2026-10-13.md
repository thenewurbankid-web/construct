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
- `private/work/2026-09-23` = `private/og/final-2026-10-12` = **3184fe0c** (suite 7059 pass / 0 fail / 52 skip on 3f7f99b3).
  Merged since ce2c8795: fallow ON by default #924, FUNC-001 complexity #923 (fallow health wired into cognitive),
  lending plain starter + held-out lending bench #925, path-first proof #921 (types/JSDoc fixed for ratchets),
  Construct-aware fallow config #926, store generator handlers #927, IMPORT-001/fallow dedupe #928 (CLI + engine),
  affected-tests pre-merge subset #929 (`node packages/tools/dev/affected-tests.mjs <base> --run`; og still runs
  the one full suite), fallow as a regular dependency + Node >=22 #930. #923, #924, #926-#930 closed.
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

## In flight / ready (updated 2026-10-13 late; base 3184fe0c / 5201dcb6)
All verified against git unless marked. og merges each with `git -C <og-final-1012 worktree> merge --no-ff <ref>`.
| Work | Ref | State |
|---|---|---|
| A: seed + open work from the spec (#933) | `private/line/seed-spec-driven` 517879fa | ready |
| B: finish guard (#931) | `private/line/finish-guard` a8cd0a77 | ready |
| C: builder context, scratchpad, session log (#932) | `private/line/builder-context` 4fe78129 | ready |
| E1: feature modules, cross-feature imports via index.ts (#935) | `private/line/feature-modules` 2480d666 | ready |
| E2: coder read tools via MCP, per turn | `private/line/coder-read-tools` 2a9492df | agent was still running; verify report vs git |
| E3: research sub-agents + central ledger (#936) | `private/line/research-loop` 13177551 | ready |
| Harness: native-only tool harness, layered turn (#938) | LOCAL `line/tool-harness` ba641d58 (not pushed) | 2 commits; worktree agent-aecc12095cb64adc0 has UNCOMMITTED model-profiles.json, tool-harness-probe.mjs, results/tool-harness-r1.json, tool-harness-replay.json; a probe rerun (adds qwen3:4b) held the heavy slot at 07:55 — check it finished, commit results + measured table, push |
| heavy.sh re-entrant (#939) | `private/dev/heavy-reentrant` 039709a7 | ready |
| Context probe write-up | `private/exp/context-probe` 572588b5 | ready (bench/lending/CONTEXT-PROBE.md) |

Merge reconciliation for og:
- C <-> E3 ledger bridge in bench/ecommerce/driver/ledger.mjs.
- E1 exports `importableFiles` from typeGate.mjs; drop E3's copy.
- A's seed must call `arrayFixtures(root, layout, feature)` (specSteps.mjs:139, atomSteps.mjs:67,101,193) and unwrap `.value`
  (E1 fixture format `{ "$lineBase": "fixtures/<name>", "value": [...] }`).
- line-modules spec topic is at 32765/32768 bytes: new files in packages/engine/line go in subfolders.
- C's turn builder: last refusal is the FINAL message; add fact "No feature has usecases, services or domains yet".
- ui/client/.../MapSentences.ts still flags cross-feature imports.

## Next, in order
1. Verify E2 and the harness (commit/push its probe results first). Then og merges A, B, C, E1, E2, E3, harness, #939,
   probe write-up, private/work into og/final-2026-10-12; ONE full suite via heavy.sh; ff work; close #931-#933,
   #935, #936, #938, #939.
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
