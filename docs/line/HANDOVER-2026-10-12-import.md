# Handover: Line Import v2, opportunity run (2026-10-12)

**Start here.** Read the following first:
- `docs/line/import-v2/CONTRACT.md`
- `docs/line/review.md`, section "Import v2"
- `CLAUDE.md` and `LINE.md`

`work/2026-09-23` is at **5801a7de** (local, never pushed). It holds wave 4 (awaiting the owner's UAT; checklist in review.md under "Wave 4: ready for owner UAT"), the walk fix, the yaml-comment fix, the plan lock, System 1 accuracy and Import v2.

## The owner's goal
Import a feature from a target app by reading its routes and files. Build a logic map and characterization tests, fit the existing logic into Line's blocks (page, component, workflow, fixture, usecase, service, domain), and import step by step until no logic unit is missed and every test passes. The first real case is max-ai-ui `/opportunity`.

## What the end-to-end run showed
The run was on a clone. Driver: `~/Repositories/construct-old-copies/opp-e2e-2026-10-12/run.mjs` (plus log.jsonl); to reproduce it, copy the agent route test in `test/line-import-agent.test.mjs`.
- `start` took 29 min.
- Route family `/opportunity` gave 7 routes, but the closure was 187 files: 15,152 units, 1,603 blocks, 840 steps, and 250 units that no rule placed.
- 1,252 characterization tests were generated, and all passed before any move. Unit coverage was 1,748 of 15,152.
- Step 1 was fine. Step 2 (move `opportunityAdapter` into the library) kept every unit, but 102 of the 1,252 tests failed. The loop stopped correctly and offered recheck or undo.

## Fix 1: feature scope
`readRouteFamily` with `excludes: []` follows every import: the app shell, the store, the UI kit, and so on.
- The rule: a file belongs to the feature only if it is reachable from this route family and from no other route in the app.
- Files that other routes also use are "shared": list them in `RouteClosure.shared`, reference them, and do not import or fit them. They could become library candidates later, as a separate import.
- Use the reverse import graph (`line/import.mjs` `importGraph`) together with the full route table.
- Expected result: about 14–30 files for `/opportunity`. The earlier prototype traced 14 files with 637 units.

## Fix 2: a move breaks the generated tests' mocks
This is likely, not yet confirmed; inspect a failing test first, e.g. "#001 renders with 24 data hooks…". The generated tests in `__line_characterization__/` mock modules by path. After a move, the component imports from the new path, so the mock no longer applies.
- Either the move tools (`tsFileMove` and the `line.import.*` and extract tools) also rewrite `jest.mock(...)` and import paths inside the characterization folder,
- or the characterizer mocks in a form that follows moves.
- Add a test: move a mocked module and the characterization tests still pass.

## Fix 3: speed
Start should take minutes once the scope is right. Profile the characterize step, and cache the map and tests by file hash.

## Then
Re-run `/opportunity` end to end on a fresh clone until it reaches `done` with every check passing, or with only owner-waivable units left. After that, pre-walk the Cockpit UAT in review.md ("Import v2" → UAT) and hand the owner one UAT list.

## Owner rules (still in force)
- Ask the owner only before a public push.
- Every write goes through Construct's writer.
- Only a person approves writes.
- Take the recommended call and keep going.
- Pre-UAT on the owner's behalf; only the owner's UAT marks a step done.
- Heavy jobs go through `heavy.sh`. Don't combine `link-worktree-node-modules.sh` with `npm install` (it damaged the main checkout's node_modules once; it was repaired with `npm ci`).

## Decided, still to do later
- Layers wave: domain/usecases/services kinds formalized; Sheriff as the dependency-rule engine wrapped by Construct; publint, are-the-types-wrong and knip as findings.
- OSS wave: zod schemas, fast-check, AST instead of regex, dagre, Express 5, parseArgs, pluralize, stable JSON, eslint-plugin-playwright, a generated client contract.
- Nx affected and cache trial.
- Rename the Train `train_*` routes and tools to `training_*`.

## Line knowledge graph (owner, 2026-10-12): no code embeddings
- **G1 `line-graph`:** contract and mock in `packages/engine/line/graph/`. Nodes: item, unit, route, endpoint, field, table, specPoint, finding, planStep. Edge layers:
  - structure: unifies moduleEdges, baseLinks, classify and importGraph.
  - static: CALLS, RENDERS, USES_HOOK and HANDLES_EVENT, via the TS checker.
  - domain: a stub for now.
  - process.
  - runtime: reserved.
  - Stored in `line/graph/`, cached by file hash and built incrementally.
- **G2 `line-graph-runtime`:** a `module.registerHooks` / jest recorder of caller→callee with shapes only (no values), plus fetches and state writes. Its records become CALLED_AT_RUNTIME edges, and units no test reached are flagged. Integration points cover the Import v2 coverage report and Fix 2's mocks.
- **Toward UAT 2:**
  - G3: domain layer, from OpenAPI via `packages/core/shape-source.mjs`, the cf1 spec, and the DB schema if present.
  - G4: context picker and symbol index on the graph, plus a Graph Details view in Cockpit.
- **Rule:** write tests and expected outputs first. If tests fail, stop and report them to the owner.

## Next UI milestone (owner, 2026-10-12): two modes on every screen
Every Cockpit screen gets two modes, switched by one global toggle in the shell and remembered per user:
- **Chat mode:** a full-screen chat in the style of cd1's Features, offering that screen's own options. Picking an item opens it with the chat as a side panel.
- **Under the hood:** the regular screen, with the chat as a collapsible helper.

Screens: Open a project, Components, Pages, Features, Workflows, Import / Import agent, Plan, Settings and Train.

Reuse:
- `ChatEntry` and `lineChat.ts` (cd1);
- `StreamedText` (flowtoken);
- Trace and Auto (ct1/cg1);
- `LINE_CONTROLS`.

Start once the open-project-simple branch has committed its ChatEntry and StreamedText changes; it edits the same files. Each screen gets a Playwright check in both modes.
- **Breadcrumb in chat mode (owner):** chat mode always shows a breadcrumb of where you are in the UI, for example "Features › orders › OrdersPage › title". Clicking any crumb switches to Under the hood at exactly that place: the same screen, with that item selected. As the chat moves around (opens a feature, a page, a part), the breadcrumb follows. Test: in chat, open orders → OrdersPage, click the "orders" crumb, and Under the hood shows Features with orders open.

## "What Line knows" page (owner, 2026-10-12): see and change the graph and memory, in plain words
This extends G4. One Cockpit page with three tabs, every view in plain English and the technical detail under Details:
- **Map:** the knowledge graph as a readable picture, using dagre (already in Cockpit).
  - Start from something the person knows: a feature, a page or a component. Show its neighbours as sentences ("OrdersPage is based on ListPage", "InvoicesPage uses OrderButton from feature orders, which a feature may not do").
  - Filter by layer: structure, calls, domain, runtime, process.
  - "Who uses this?" and "What breaks if I change it?" come from `whoCalls` / `impactOf`.
- **Memory:** per AI step, what Line remembered (im3/j5): "You picked 'via the library' 3 times for 'use X in Y'".
  - Edit, forget (one entry or the whole step), export/import.
  - An embeddings on/off switch, off by default; embeddings cover slotted decision text only, never code.
  - Person-only, and logged.
- **Change:** an edit that touches the project goes through the plan. Examples: re-basing an item, moving a component to the library, removing a cross-feature use. Each becomes a plan step with typed fixes, approved by a person. Memory edits are Line state: they apply at once and are logged.

Reuse ChatEntry, StreamedText, Trace/Auto and LINE_CONTROLS, and the two modes (chat / under the hood). Start after G2 and im3+j5 merge. Tests first, plus a UAT walk on contact-manager-ui.
- **A fourth tab, "How smart is it" (owner):** the page also shows the person how accurate their framework is, on their own project, in plain numbers with trends:
  - **Logic coverage:** % of logic units with a test; % reached at runtime (G2).
  - **Graph health:** cross-feature uses, items with no base, unresolved imports, and duplicates.
  - **AI accuracy per step:** proposals accepted as-is / edited / refused, static vs AI share (cs2), drafter preferred-route accuracy on the person's own picks, and misses absent vs picked (im1).
  - **Fixes:** % of Construct refusals fixed by a typed fix with no person edit, and the repair success rate (im2).
  - **Memory effect:** accuracy with memory vs without (im3/j5).

  Each number links to the items behind it (one click goes to Map or to the plan), and each has a one-line "how to improve it". Data comes only from local records; nothing leaves the machine.

## Roadmap (owner, 2026-10-12, full version)
The full roadmap is in `docs/line/ROADMAP-2026-10-12.md`, replacing the earlier partial pastes. It covers items 1–18, the benchmark arms, envelope reconciliation, the north star and the licence.
- **Next sprint:** 1, 2, 7, 8, 9, 10. Items 1 and 2 (core) are already pulled into the enterprise MVP.
- **Later:** 3–6 and 11–18.
- **Model roles:** 16 (Pick / Propose / Author tiers), 17 (model switching per step, with presets), 18 (internal model plus external agent as complementary reasoners).
- **Licence:** everything is open source for now. The "Cockpit proprietary" note is on hold. max-ai-ui-derived content stays out of the public repo.

## Line logic verification (owner, 2026-10-12)
**Goal:** near-100% proof that import and extraction keep all logic. The proof is light, fast, framework-agnostic and logic-first. The UI is regenerated from primitives, so DOM output is not part of the proof.

### 0. Read first; reuse, don't duplicate
- **From Morpheus** (`~/Repositories/vision-architect-pipeline`):
  - **Reuse** from `src/morpheus/import/scan*.ts`: the TS-checker item scan, transitive effects → IMPURE_LOGIC, the renders/uses/navigates edges, and `diffScans`. Feed the transitive effect analysis into the logic map and G1; there is no second graph.
  - **Reuse** from `src/morpheus/behavior/`: the happy-dom child-process probe (reuse its sandbox design for isolated execution), the typed listener fingerprint (cross-check it against logic-map fingerprints) and `compareBehavior`.
  - **Do NOT reuse** the HTML-input probe path.
- **From Construct, reuse:**
  - the logic map (fingerprints);
  - the characterization generator (mined literals, recording fakes);
  - `semanticDiff` / `semanticDiffSplit`;
  - `check-change` (path-mapped);
  - `pureExportEquivalence` (fast-check);
  - the G2 runtime recorder and the G1 impact graph;
  - `tsFileMove` and `extractExpression`;
  - the Cockpit devServer slot and `heavy.sh`.

### A. Correct-by-construction transforms
- Line changes existing code only through a closed set of semantics-preserving transforms (TS language service / ts-morph):
  - move and rename;
  - extract function or expression;
  - wrap in an adapter;
  - re-point imports and mocks.
- Each transform is validated Alive2-style: a canonical before/after compare must match exactly, and a mismatch stops at the exact location.
- Code that people or models change outside these transforms is labelled "tested", never "proven".

### B. Pure/impure split (from Morpheus's effect analysis)
- Each unit is marked pure or impure, with its transitive effect chain: fetch, storage, navigation, store, timers.
- Pure units go to the strong proofs (C3). Impure units go to isolated execution with recording fakes (D).
- The split also drives fit: pure → domain, data effects → service, orchestration → usecase.

### C. Layered equivalence per logic unit
Run the layers cheapest first and stop at the first decisive one:
1. **Canonical-form match.** One pinned minifier (esbuild/terser/SWC) with conservative settings: keep function boundaries, mangle locals only, no cross-function inlining, no reordering of side effects. Builds on the logic-map fingerprint.
2. **Path-mapped** `semanticDiff` / `semanticDiffSplit`.
3. **Pure units:** Z3 proofs for small logic (conditions, validators, guards) and fast-check property equivalence for other pure functions.
4. **Isolated execution (D):** same inputs before and after must give the same outputs and effects.
5. **G2 runtime traces** for whatever is left.

The outcome for each unit is one of:
- **proven unchanged;**
- **changed**, with the exact location (AST path, file:line, failing input);
- **unverified**, never assumed fine.

**Round-trip check for extraction:** re-inline the atoms and canonical-compare with the original. Units in no atom or block are reported as "not extracted".

### D. Logic-first isolated execution (no browser, no server, no render)
- **Loading:** modules load through the target app's own bundler and tsconfig, in Node: the Vite module runner, or the esbuild/jest-style transform that characterize already uses.
- **Sandbox:** a locked-down child process (the Morpheus design), with no real network, timers or global leaks.
- **Fakes:** each unit's imports are swapped for recording fakes at load time.
- **How each unit runs:**
  - pure functions are called directly;
  - handlers get fake events;
  - hooks run in a headless hook runner (a no-op React renderer);
  - every dependency is a recording fake: router, fetch/axios, store/dispatch, storage, toast, analytics, and timers (fake clock, seeded random, fixed locale).
- **Recorded per unit:**
  - inputs, outputs and thrown errors;
  - state transitions and effects (shapes only, no values);
  - sentinel data flow (unique fixture markers found in outputs, effects and requests);
  - V8 branch coverage.
- **Fake DOM only where code touches document, window, refs or storage:** a minimal recording stub first, with happy-dom as the fallback.

### E. Layout as input
Layout-dependent units are simulated, not skipped:
- **Typed fakes** are generated from `lib.dom.d.ts`: DOMRect; offset, scroll and client sizes; innerWidth; IntersectionObserverEntry; ResizeObserverEntry; MediaQueryList; and scroll, resize, pointer and visibility events.
- **Values** come from the characterizer's mined comparison literals: the boundary ±1, 0, negative and large.
- **Observer callbacks and events** fire with those values under the fake clock.

This proves the logic given the layout values. Pixels and real geometry are checked only at L3.

### F. Escalation (the default stays light)
- **L0:** static checks plus the canonical compare. Always runs; milliseconds.
- **L1:** isolated execution in Node, for touched units only.
- **L2:** the target's own dev server over HTTP, for server-rendered routes:
  - sentinels in the HTML;
  - server fetches pointed at a local fixture server through the env base URL;
  - `NODE_V8_COVERAGE`.

  The app's code and `.env` are never edited; a generated `.env.line` provides stubs.
- **L3:** one shared headless browser, used only for screenshots, visual diffs, or apps that fail in Node.

### G. Speed
- Only touched units re-run (from the G1 impact graph), cached by file hash.
- One Node worker pool. The dev server and the browser start only when escalated, and close afterwards.
- **Targets:**
  - per unit: milliseconds;
  - per import step: a few seconds;
  - an opportunity-size feature (25 files): under 60 s cold, under 10 s warm.

### H. Atom discovery (same machinery)
- Normalise units (C1), find near-duplicates with clone detection (jscpd, MIT), and match them against existing atoms and primitives.
- Propose extraction as plan steps (T1 atom / T2 resource), proven by C.

### I. Where results show
- **Each import step in Cockpit:** "N proven, M tested, K unverified", plus the exact divergence when a unit changes.
- **"How smart is it":** the proven/tested/unverified share per feature.
- **Refusals** name the exact changed expression.

### Build order (contract first: shapes, expected outputs and tests before code)
1. **Contract:** `UnitVerdict {unit, purity, effectChain, status: proven|tested|unverified|changed|not-extracted, layer, location?, input?, sentence}`; the recording-fake interfaces; the layout-fake generator interface.
2. **Pure/impure split,** from Morpheus's effect analysis, into the logic map and G1.
3. **C1 canonicaliser** plus the round-trip extraction check.
4. **Isolated execution runner** in the child-process sandbox, with recording fakes and sentinels (D).
5. **Layout fakes** from `lib.dom.d.ts` (E).
6. **Z3 / fast-check** for pure units (C3).
7. **Wiring** into the Import v2 loop and `verifyImport`, and the Cockpit step view.
8. **L2 dev-server level,** with the L3 browser as opt-in.

**Proof run:** on clones only of max-ai-ui `/opportunity` and contact-manager-ui. It must show:
- the share of units proven / tested / unverified;
- no false "behaves differently" stops on moves and splits;
- every planted change (flipped condition, dropped effect, changed layout threshold) caught with its exact location;
- G's time targets met.

Fixtures and expectations derived from those apps stay out of git.
