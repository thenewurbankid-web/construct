# Carry-over 2026-10-13

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
- `private/work/2026-09-23` = **ce2c8795** (suite 7060/0 fail). Includes: loop breaker #912, r4 gaps #915-#918,
  turn I/O #913, spec->steps seed #914, point skeleton #920, seed atoms #919 (shop spec seed-only 22/22, likely
  tuned to that spec's wording, e.g. atomSteps.mjs:110), MC poller fix #922.
- `private/og/final-2026-10-12` = **359f6deb** = ce2c8795 + held-out lending bench #925 (`bench/lending/`,
  drivers take `--bench`). Worktree: `.claude/worktrees/og-final-1012`.
- Bench history: r4-s2 1/22 (first pass), r5 5/22 (seed only, model added 0: pasted our placeholder -> BAD_CODE,
  fixed by #920). Results in `bench/ecommerce/results/`, `RESULTS.md`.

## In flight (branches to expect on private)
| Work | Branch | Notes |
|---|---|---|
| fallow wrapper, ON by default in validate (FALLOW-*, warnings, `--no-fallow`) | `oss/fallow` @ 6ea01662 (DONE, #924) | fallow 3.33.1 MIT pinned devDependency; runs only when the root has package.json; +0.1 s; 8 enforcer tests now pass `--no-fallow` |
| per-function complexity via OSS only (ESLint core `complexity` in-process + fallow health for cognitive), FUNC-001 ON by default, logicMap signature | `ast/function-complexity` @ 588a088b (DONE, #923) | ESLint core `complexity` in-process (eslint + @typescript-eslint/parser moved to dependencies) + fallow cognitive via `validateArchitecture(root, { fallowHealth })` — WIRE the oss/fallow runner's health report into it at merge; budgets raised (domain 15, component 20) so generated code has 0 warnings; package.json/lock will conflict with oss/fallow |
| lending plain-arm starter | `bench/lending-plain` @ 2bb51072 (DONE) | from 359f6deb, refs #925; owner kept its one-line fixture-path edit to bench/lending/SPEC.md |
| path-first proof (CAT-2 + CART-1, 11 stubs, fill tool, `--arm path`) | `exp/path-first-proof` @ 07ddd3d2 (#921) | steps 1-3 done; step 4 (qwen fill run) waits |

## Next, in order
1. All three in-flight branches are DONE on private (oss/fallow 6ea01662, ast/function-complexity 588a088b, bench/lending-plain 2bb51072). og merges them into og/final-2026-10-12 (fallow + FUNC-001
   change validate defaults and golden fixtures), then ONE full suite via heavy.sh, then fast-forward work.
2. Lending bench on that tree, one at a time: seed-only acceptance, Line `--seed-plan`, Line `--seed-plan --seed 2`,
   plain twin (`--bench bench/lending`; reset BENCH_DIR per run). Report vs owner bar and per-point open reasons.
   This is the generality test for the seed.
3. Path-first proof step 4 (path-cli install -> qwen-agent `--arm path` -> path-cli report), through heavy.sh.

## Path-first decisions (owner, 2026-10-13)
In memory `project-path-first-plan`: Trace builds typed path per point (beam always forks, deterministic prune
first, model compares only if >1 survive; 3 tries then user); examples from spec+fixtures (acceptance held out);
AI fills any stub body, signatures locked, bottom-up; first failing example back; stub fail x3 -> re-plan, none
left -> NEEDS_YOU; oracle = stub check + tsc + examples + AST dry run (logicVerify) + DOM snapshot diff (expected
change must appear); render examples for UI, contract mock for services; models switchable per role; Cockpit
Layers view shows the path.

## Open items
- fallow follow-ups (#924 report): a fresh scaffold shows ~20 FALLOW warnings (unused files for unrouted layers, feature index.ts barrels, types.ts, .dependency-cruiser.cjs; CRAP on generated proof tests) → Construct-aware default fallow config, HIGH (dogfood); Cockpit engine-mode validate (ui/server/src/validateApi.mjs handleValidate) doesn't run fallow; IMPORT-001 may report the wrong line (line 1 vs 2 in Score.ts); OWNER DECIDED: make fallow a regular dependency (next wave, with the Construct-aware config) so installed users get it; fallow needs Node >=22, repo says >=20.
- Board fields for #912-#925 (project-manager pass).
- #881 needs its measured jev-vs-static eval.
- openWork text check misses PROD-2/PROD-4 after seeding (Quantity label in library component; link case).
- docs/MEDIA.md still uses Playwright recording — ask the owner before using it.
- `.claude/launch.json` (Mission Control) in the carryover worktree points at the MC-fix worktree; repoint to
  og-final-1012 now that #922 is merged.
