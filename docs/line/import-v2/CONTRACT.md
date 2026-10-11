# Line Import v2: fit existing logic into Line's blocks, backed by tests

Owner (2026-10-11): "read features from target app from route/files, then we build a logic map and test cases, then we import till all logic not missed and test passed"; "it should fit existing logic into our blocks backed by tests". Moving files is not importing.

**Reuse first.** A survey (2026-10-11) found that most of the pieces already exist in Construct but are not wired into Line. Each piece below names the module to reuse. New code is only the glue.

**First real case:** the `opportunity` feature of max-ai-ui.
- The `/opportunity` route traces to 13 files and about 4.8k lines (`opportunity-route-files.txt`).
- The prototype logic map (`logicmap.mjs`, `opportunity-logicmap.prototype.jsonl`) has 637 units.
- The existing jest tests cover about 2% of the route's branches.
- Line's folder Import, run on a copy, showed:
  - it is seeded by a folder, not a route;
  - it split the feature into 5;
  - it missed a name clash at plan time (Detail.tsx and Detail-v2.tsx both export `Detail`);
  - a refused `applyImport` left 2 modified files plus `library/`, `features/` and `architecture.yml` on disk.

Agents ALWAYS work on their own clone of max-ai-ui under their scratch dir: `git clone --local ~/Repositories/max-ai-ui <scratch>/maxcopy && ln -s ~/Repositories/max-ai-ui/node_modules <scratch>/maxcopy/node_modules`. Never touch the original.

## Pipeline and what to reuse
1. **Read:** `readRouteFamily(appRoot, route)` → `RouteClosure`.
   - Reuse `packages/core/route-resolver.mjs` `resolveRoute:398` and `traceRouteFiles:205`. Pass `excludes: []`, because `DEFAULT_TRACE_EXCLUDES` is hard-coded to one app; make the excludes configurable.
   - Reuse `packages/engine/units/route-adapters.mjs` `readRouteTable` for the route list.
   - Export Line's private `importGraph` (`line/import.mjs:96`) for reverse users.
   - A route family is the route plus its sub-routes (`/opportunity/*`), and it becomes ONE feature.
2. **Logic map:** `buildLogicMap(appRoot, files)` → `LogicMap`.
   - New glue: `packages/engine/line/logicMap.mjs`.
   - Detectors to reuse: `core/mechanical-plan.mjs` `readSignals`; `packages/ast` `jsxComplexity.collectInlineJsxLogic`, `stateShape`, `staleness`, `domainPurity`, `jsxTree`; `engine/workflowExtractor.mjs`; Trace `trace/src/pagemap/states.mjs` and `interactions.mjs`; `describeComponent` and `pageComponents`.
   - The prototype `logicmap.mjs` shows the unit kinds. Replace its ad-hoc walker with these detectors where they cover a kind.
   - Store the map at `<folder>/line/logic-map.json` through Construct's writer.
3. **Characterization tests** (written in the target app's own runner: jest + React Testing Library in max-ai-ui):
   - Pure exports: `packages/ast/pureExportEquivalence.mjs` (fast-check, old vs new).
   - xstate: `engine/testUnitGenerator.mjs`.
   - Locked rendering: `engine/testSpecRender.mjs` plus `GENERATED_MARKER`.
   - Test strength: `core/mutation-check.mjs`.
   - New: a render/interaction characterizer for React pages and components (mocked data hooks, one test per branch/handler group).
   - New: coverage → unit mapping (jest `--coverage` JSON or V8/c8) → `UnitCoverage`.
4. **Fit:** `fitLogic(map, closure)` → `FitProposal`. Every unit goes to exactly one block.
   - Reuse `line/import.mjs` `scanImport`/`planImport` (library vs feature).
   - Reuse `core/extractExpression.mjs` (JSX branches).
   - Reuse `engine/pageTransformer.mjs` and `engine/controllerBinder.mjs` (presentation/logic split).
   - Reuse `engine/workflowGenerator.mjs` and `research/specToCode.mjs` (implicit state → xstate workflow).
   - Reuse typed-contracts `defineService`/`defineDomain`.
   - New: Line kinds `usecase`, `service`, `domain` (the minimal ones now; the layers wave formalizes them and adds Sheriff), plus `line.import.extract*` plan tools that run through `applyChange`.
5. **Loop:** reuse `line/importAgent.mjs` (machine, `MAX_ROUNDS`, stop when a round doesn't improve), plan records, and `conditions.mjs`/`expr.mjs`.
   - New stages `map` and `characterize` come before `execute`.
   - `verifyImport` gains these checks:
     - the characterization tests pass;
     - the logic-map diff has 0 missing;
     - every unit has a block and a test (or an owner waiver);
     - a path-mapped `check-change` + `semanticDiff` (old path → new path, specifiers normalized).

## Shapes (JSDoc in `packages/engine/line/importV2/contract.mjs`, with a mock in `mock.mjs`)
- **`LogicUnit`:** `{ id, fingerprint, kind, file, fn, line, detail }`.
  - `kind` is one of: `branch | render-if | state | effect | derived | data | navigation | url-read | handler | toast | analytics | storage | io | export`.
  - `id` is `file#fn:kind:n` and is for display only.
  - `fingerprint` is a stable hash of the kind, the enclosing function name and the normalized AST text. Identifiers renamed by the import are mapped through the rename table. It never includes the file path, so it survives a move.
- **`LogicMap`:** `{ root, files, units, counts }`.
- **`MapDiff`:** `{ kept, moved: [{from, to}], missing: LogicUnit[], changed: [{before, after, sentence}], added }`. Each missing unit has one sentence.
- **`RouteClosure`:** `{ appRoot, routes: [{route, entry}], files, external }`. `external` lists the boundaries the tracer stopped at.
- **`CharTest`:** `{ file, runner: 'jest', kind: 'pure'|'render'|'interaction'|'machine', unitFingerprints, title }`.
- **`UnitCoverage`:** `{ covered, uncovered, waived: [{fingerprint, by: 'owner', why}] }`.
- **`FitProposal`:** `{ feature, blocks: [{ kind, name, units, from, sentence }], unassigned }`.
  - `kind` is one of: `page | component | workflow | fixture | usecase | service | domain`.
  - Fitting rules, in order:
    1. Data hooks and adapters → service.
    2. Pure transforms and sort/filter rules → domain.
    3. Orchestration of data, state and navigation for one user goal → usecase.
    4. Screen-flow, URL state and navigation between views → workflow.
    5. JSX with its render-ifs and handlers → component or page.
    6. Sample data → fixture.
- **`ImportLoopState`:** `{ step, mapBefore, mapAfter, diff, tests: {passed, failed}, coverage, status: 'ok'|'stopped', sentence }`.

## Invariants
- Every write goes through Construct's writer. `applyImport` is all-or-nothing: a refused run leaves the target byte-identical.
- No unit is lost. `missing` must be empty, or each missing unit has an owner waiver.
- Characterization tests are generated BEFORE the first move and must pass before and after every step.
- Refusals and questions are one sentence plus typed fixes; technical detail goes under Details.

## Branches (all from `work/2026-09-23`)
- `iv2-bugs`: atomic `applyImport`; name clashes caught at plan time.
- `iv2-map`: `contract.mjs` + mock + `logicMap.mjs` + `compareLogicMaps`. This branch owns the contract file; the others mirror its shapes from this doc and reconcile at merge.
- `iv2-tests`: characterizer + coverage → unit mapping, proven on the opportunity copy.
- `iv2-fit`: route-seeded import, `fitLogic`, the usecase/service/domain kinds, and the `line.import.extract*` tools.
- `iv2-loop`: importAgent stages, `verifyImport` checks, path-mapped check-change.
