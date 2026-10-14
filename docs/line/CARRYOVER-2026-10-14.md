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

## State after merge wave 2 (2026-10-14)
- work/2026-09-23 = og/final-2026-10-12 = 67dfe77b. Suite 7238 pass / 0 fail / 52 skip / 6 todo (Smith linked).
  Merged: smith-system1-data, smith-oss-coverage, lsp-into-line 0b421213 (LSP #943 + wiring #945 + isolation
  harness #941), english-loop-chain fbce3355, smith-eval-hardened e85b92a0. Closed #940, #941, #942, #943-#946.
- Smith pin a9191a5 (owner merged smith-hardening cbc2567 into ~/Desktop/atomic-codemod master). Untranslated-step
  marker counts as a gap; link checked once per process. Smith tracker closed.
- Fix later: `link.mjs --pin` covers only links.json (atomic-codemod.json edited by hand).
- Not yet merged: exp/small-model-isolation 7e3d7646+ (modelled-I/O harness fixes), exp/english-loop-chain
  62efd4c1+ (one-unit plan writer, k2b fix pending), exp/smith-eval-hardened 1e87be0b (facts compiler: matches
  hand-written facts on every probe case), Claude Code cd2 run (running).
- In flight: line/modelled-io (product audit fixes), exp/quickjs-sandbox, exp/lsp-speed (scoped + excalidraw +
  background index), line/trace-beam (beam + structure/types/behaviour prune), Smith plain-English style on
  smith-hardening (owner pushes), max-ai-ui admin-navigation chain report (read-only).
- Owner rule (memory feedback-modelled-model-io): no free-form model I/O anywhere.

## Results since wave 2 (ready for the next og wave)
- QuickJS sandbox (#947, exp/quickjs-sandbox 293061e4, quickjs-emscripten 0.32.0 MIT): same results as vm on 52
  cases, 1.3-3.7x faster warm, 13/13 escapes blocked. Execution beats Smith text match as the correctness judge:
  K2b 7b plans 20/20 (text 7), 1.5b wrong plans 16/16 caught, K5b swapped plan caught, K6 refs 12/12 (text 7), fills
  9/12 = task check (text 4), 0 correct fills rejected. Q-exec drops 45% early, -35% non-model time. Runs WITH tsc
  (3 wrong fills passed only on types). vm stays logicVerify default (Intl); QuickJS opt-in + Q-exec/Q-diff executor.
- Facts compiler (exp/smith-eval-hardened 1e87be0b, packages/engine/lsp/facts.mjs): deterministic Smith+index ->
  compact context matches hand-written facts on every probe case (7b 4/5, 5/5; 1.5b 5/5 case 2).
- Harness modelled-I/O fixes: exp/small-model-isolation 7e3d7646; exp/english-loop-chain 62efd4c1, 730b68b1.
- Validation design now: tsc (types) + QuickJS on spec examples (behaviour, Q-diff vs plan) + Smith (readable
  record, atomic gate). Context: Smith -> facts compiler, never raw.

## In flight at compaction
cd2 (Claude Code harness, worktree agent-a1face930fad09995, results bench/isolation/results/claude-drive/cd2);
line/modelled-io (product audit fixes); exp/lsp-speed (scoped, excalidraw, background index); line/trace-beam
(beam + structure/types/behaviour prune); Smith plain-English style on smith-hardening (~/Repositories/
atomic-codemod-hardening, owner pushes); max-ai-ui admin-navigation chain report (exp/smith-eval-hardened,
read-only on max-ai-ui); functional atom runtime + full-ES atoms generated from lib.d.ts (smith repo,
~/Repositories/smith-functional branch functional-atoms, owner pushes).
