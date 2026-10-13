# Carry-over 2026-10-14 (small-model isolation, Smith hardening, harness drivers)

Read first. Check agent work by branch state with git (`git ls-remote private`), not transcripts. Push to `private`
only. Never use the model "fable". Heavy jobs one at a time through `packages/tools/dev/heavy.sh` from a checkout of
work/2026-09-23 or later (older copies fail on macOS without flock). Previous carry-over: CARRYOVER-2026-10-13.md.

## Live pages
- Results board (isolation runs, kill tests, harness): https://claude.ai/artifact/5zY3SuhugJQXRDUxhQVvkJ
  (Dashboard; data = uploaded results.json/kills.json; rebuild script in the old session scratchpad, re-create from
  the branch result files: bench/isolation/results/r{1,2,3}.jsonl, bench/isolation/chain/quick/results/k*.json)
- Smith hardening tracker: https://claude.ai/artifact/XdDLmASwjAmFcsdMx3EjSV (db: items/*, summary/metrics; write admin)

## State
- work/2026-09-23 = og/final-2026-10-12 = 6a474b17 (merge wave of 10 branches, suite 7152/0/52 on d7d1e14e).
- Bench reruns stopped after lending r2 seed-only 0/24 (bench/rerun-2026-10-13 7685e605, not merged). Diagnosis: app
  builds and acceptance runs; lending has no behaviour recipes (12 checks need picks store/flow, 5 wording, 4 paging).

## Owner decisions (2026-10-13 late; full text in memory project-english-loop-chain, project-focus-first-acceptance)
- Small models don't build alone; a driver (human or a coding HARNESS like Claude Code/OpenCode via MCP) drives,
  qwen2.5-coder:1.5b fills. Validate in isolation first, then Line. Target: plug whole harnesses, not just models.
- English-native system: Smith translates code<->English; models reason only in Line rules; templates are dumb
  (bind view-model fields), built by Morpheus blocks, checked by DOM render; logic goes through Smith.
- Every generated function gated atomic + Smith-readable (atomicGate). Light "Line LSP" over three layers (Smith
  English, Line rules, generated TS), incrementally indexed. Goal: a native Line model (LoRA 1.5b) trained on gated
  (Smith, Line steps, code) triples + translated permissive OSS.
- Plan after evidence: "Both, measured" — blocks are the default reasoning; keep a 1.5b-reasoning setup each run so
  it can win a role back.

## Evidence
| Run | Result |
|---|---|
| isolation r1 (#941) | 1.5b alone 1/12; 7b driver->1.5b 7/12; +repair 8/12; 7b alone 8/12 |
| isolation r2 | H blocks-only (no driver model) 8/12 = E best-of-5 8/12; F 6, G FIM 2, I qwen3:4b tools 2 (20 min), F-sr 0 |
| isolation r3 (importFixer = TS LanguageService fixMissingImport + moduleScope) | D 8->10, H 8->9, E 8->9, C 8; tsc failures -> 0; left: t07, t10, t12 (logic) |
| kill tests (#942) | K1 pass (Smith separates 8/8 mutants), K4 pass (embedding top-1 88%), K2 kill (1.5b writes JS not Smith 0/20), K3 kill (1.5b 3/8 vs deterministic decide() 8/8), K5 kill (0/5) |
| K1/K5 on hardened Smith (700638e1) | K1 still 8/8, no ties; K5 0/5: ternary vs if/return read differently + plan in JS |
| Smith OSS probe (#944, 4b6d032b) | pinned Smith: 57.5% of 539 fns (3 MIT repos), logic-only 75.4%, ~250 clean pairs |

## Smith hardening (owner repo, local branch — not pushed)
- ~/Repositories/atomic-codemod-hardening, branch smith-hardening 72e4c09 (11 commits S1-S10). Verified by Claude:
  114/114 tests (106 example, 5 property, 3 golden); coverage 380/380 functions clean (logic 207, JSX 173), 0 gaps;
  4 bugs fixed; server.js LLM extraction opt-in (deterministic by default); memoized toEnglish.
- Clones: ~/Repositories/atomic-codemod (pin 885b32e; package-lock.json modified by the deps install only),
  ~/Repositories/smith (pin f70eecf). Export ATOMIC_CODEMOD_SOURCE_DIR / SMITH_SOURCE_DIR. Agents cannot read ~/Desktop.
- Open: (1) owner reviews + `git -C ~/Repositories/atomic-codemod-hardening push origin smith-hardening`, merges in
  ~/Desktop/atomic-codemod; (2) tracker item q2: equivalent forms read the same (run the deterministic atomic rewrite
  before translating); (3) og: bump pin (`node packages/line-links/link.mjs --pin`), count "does not translate cleanly"
  in the placeholder metric, check the link once per process (packages/summarize/links.mjs:56), ONE full suite.
  Tracker closes when all green.

## In flight
| Work | Ref | State |
|---|---|---|
| Claude Code harness run cd1 (CD note, CD-raw, CW x 4 tasks, 12 headless sessions) | exp/small-model-isolation fbf583db; worktree agent-a1face930fad09995; results bench/isolation/results/claude-drive/cd1* | running at hand-over; `node bench/isolation/drive.mjs summary --run cd1`; put on the board |
| Line LSP (#943): TS layer done; Smith + rules layers, dynamic index, atomicGate, triples.jsonl logging, L-* setups | exp/line-lsp 4d247b54 | agent running |
| OpenCode harness | harness-drive.sh --harness opencode --model ollama/qwen3:4b | later, after isolation runs (free tier refuses headless) |

## Next, in order
1. Read cd1 results; board update. 2. Smith: owner push -> q2 -> og pin bump + suite -> close tracker.
3. LSP report -> decide what moves into Line/MCP. 4. Human/Claude driver with blocks on t07/t10/t12 (logic gaps).
5. Issues #940-#944 open; close only when verified (rule 2: no comment needed).

## Late additions (after hand-over)
- Claude Code harness cd1 finished (NOT committed: worktree agent-a1face930fad09995,
  bench/isolation/results/claude-drive/cd1/). CD-raw 4/4 (incl. t12, which every 7b arm failed), CD note-mode 3/4
  (t06 fragment), CW 4/4. ~$0.16-0.29 per task; ~110k cached Claude Code overhead per session dominates, so no Claude
  token saving on tasks this small. Commit it and put it on the board.
- Line LSP (#943) done: exp/line-lsp afe4e30e, packages/engine/lsp/{host,index,smith,rules,gate,server}.mjs, results
  bench/isolation/results/lsp-r1.md. Wins: L-rules (nextSteps 8/8 vs 1.5b 3/8), L-enum (6/9 vs free text 0/9),
  L-gather-det (-68% context tokens, no model), smithDiagnostics exact (12/12; embed fallback worse, 8/12). L-fix clears
  tsc but pass unchanged. L-brief, model-driven gatherer lose. Agent recommends moving nextSteps, completionsAt+enum,
  definition/quickInfo gatherer, smithDiagnostics (exact), fixes into Line/MCP.
- OWNER DECIDED (2026-10-14): keep the gate strict — pages read data through a view-model/service function, never a fixture directly; update the isolation tasks/reference solutions and blocks accordingly, then rerun L-gate. Original issue: atomicGate's "connections only through functions" rejects bench pages that read the books
  fixture directly (even the reference solutions): change the gate's page rule or the tasks? L-gate 2/12 vs H 8/12
  until settled. atomic-codemod plug() can transform but its atom calls aren't imported (L-norm 0 compile).
- Smith: owner pushed smith-hardening to ~/Desktop/atomic-codemod (new branch); merge into its main still open.
