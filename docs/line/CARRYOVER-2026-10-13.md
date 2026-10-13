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

## In flight (branches to expect on private, base 3184fe0c)
| Work | Branch | Notes |
|---|---|---|
| A: seed + open-work suggestions derived from the spec; shop recipes become example data | `line/seed-spec-driven` | closed-set page shape from point text; persisted member state -> store; no acceptance files |
| B: `finish` refused while approved steps wait (f1 plan_run_next) | `line/finish-guard` | |
| C: builder context: num_ctx 32k, history compaction, per-file context pack, example fixes for common tsc errors | `line/builder-context` | stays out of seed/ |
| Probe: replay stuck turns 12 and 2 of lending-qwen-7b-r1 against Ollama in isolation, variants V0-V4 / C0-C2 | `exp/context-probe` | owner asked; results in bench/lending/CONTEXT-PROBE.md feed C's prompt shape |

## Next, in order
1. Read the probe result; if its winning shape differs from C's, adjust C before merge.
2. When A, B, C are on private: og merges into og/final-2026-10-12, ONE full suite via heavy.sh, ff work.
3. Rerun, one at a time: lending seed-only, lending Line `--seed-plan`, ecommerce seed-only (must stay 22/22).
   Report vs owner bar (one whole feature, e.g. BRW-1..5) and per-point open reasons.
4. Path-first proof step 4 (path-cli install -> qwen-agent `--arm path` -> path-cli report), through heavy.sh.

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
- Board fields for #926-#930 and the A/B/C issues (project-manager pass).
- #881 needs its measured jev-vs-static eval.
- openWork text check misses PROD-2/PROD-4 after seeding (may be covered by A).
- docs/MEDIA.md still uses Playwright recording — ask the owner before using it.
