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

## Shapes (JSDoc in `packages/engine/line/importV2/contract.mjs`, the ONE place they live since the merge; a mock in `mock.mjs`)
- **`LogicUnit`:** `{ id, fingerprint, kind, file, fn, line, detail }`.
  - `kind` is one of: `branch | render-if | state | effect | derived | data | navigation | url-read | handler | toast | analytics | storage | io | export`.
  - `id` is `file#fn:kind:n` and is for display only.
  - `fingerprint` is a stable hash of the kind, the enclosing function name and the normalized AST text. Identifiers renamed by the import are mapped through the rename table. It never includes the file path, so it survives a move.
  - Optional `anchor` (added on `iv2-map`): the normalized AST text the fingerprint was hashed from, so `compareLogicMaps(before, after, {renames})` can re-hash through a rename table given after the map was built.
- **`LogicMap`:** `{ root, files, units, counts }`.
- **`MapDiff`:** `{ kept, moved: [{from, to}], missing: LogicUnit[], changed: [{before, after, sentence}], added }`. Each missing unit has one sentence.
- **`RouteClosure`:** `{ appRoot, routes: [{route, entry}], feature?, files, shared, external }`. `external` lists the boundaries the tracer stopped at.
  - Scope rule (iv2-scope): a traced file is in `files` (the feature) only when it is reachable from this route family and from NO root outside it. The roots outside are every other route's entry (Next app-router pages or the react-spa route table), Next app-router layouts, templates, loading/error/not-found states and route handlers outside the family, and the app's middleware/instrumentation; reachability is over `line/import.mjs` `importGraph`.
  - `shared`: files the family reaches that a root outside it reaches too. They stay where they are and are referenced, never imported, mapped, characterized or fitted. The agent view names them in one sentence: "N shared files stay where they are; other routes use them." They may become library candidates later, as a separate import.
  - `files` and `shared` never overlap; `external` (packages, excluded folders, unresolved imports) is unchanged.
  - A feature can span several routes with no common prefix: `readRouteFamily(appRoot, ['/', '/profile/:id'], {feature: 'contacts'})` reads each route's family as ONE closure, `feature` the person's name (default the first route's family name). A single route works as before. `agent.start(by, {route: [...], feature})`, `planImport(root, {route: [...], feature})` and `ImportLogic.route` (`string | string[]`, plus `feature`) take the same.
  - The loop scopes everything to `files`: the logic map maps them plus where moves land (`<folder>/library/` and `<folder>/features/<feature>/`), characterize and fit get the same list, and Import's plan (`only`) moves nothing else.
- **`CharTest`:** `{ file, runner: 'jest', kind: 'pure'|'render'|'interaction'|'machine', unitFingerprints, title }`.
- **`UnitCoverage`:** `{ covered, uncovered, waived: [{fingerprint, by: 'owner', why, at?}], byKind?, details? }`. `byKind`: `{kind: {covered, total}}`; `details`: each uncovered unit with its cause and one sentence (iv2-tests).
- **`FitProposal`:** `{ feature, blocks: [{ kind, name, units, from, sentence, area? }], unassigned: [{unit, sentence}] }`. `area` is `feature | library` (library when other routes use the code); `from` is `file#name` or `file`; a unit no rule claims is listed with one sentence for a person. `FitStep` (planFitSteps): `{ id, tool: line.import.extract*, args, sentence, blocks }`.
  - `kind` is one of: `page | component | workflow | fixture | usecase | service | domain`.
  - Fitting rules, in order:
    1. Data hooks and adapters → service.
    2. Pure transforms and sort/filter rules → domain.
    3. Orchestration of data, state and navigation for one user goal → usecase.
    4. Screen-flow, URL state and navigation between views → workflow.
    5. JSX with its render-ifs and handlers → component or page.
    6. Sample data → fixture.
- **`ImportLoopState`** (one checked step, fixed-size; reconciled to what the loop writes): `{ step, n, at, tool, mapBefore, mapAfter: {units, counts, hash}, diff: {kept, moved, added, changed, missingCount, missing}, tests: {passed, failed, total, state}, coverage: {covered, uncovered, waived, total}, behaviour, checks, status: 'ok'|'stopped', sentence, fixes }`. A `put-back` fix carries `step`, the extract tool of the unit's FitProposal block. The plan file keeps them in `ImportLogic` (`{route, closure, map, fit, tests, baselineTests, waivers, loop, last}`); the records go to `records/import-loop.jsonl`.

- **`AtomBreakdown`** (static breakdown, 2026-10-14; `importV2/breakdown.mjs`, kept in `<folder>/line/atoms.json`): `{ via: 'static'|'off', codemod, runtime, units: AtomUnitResult[], counts, sentence, reason? }`. `AtomUnitResult`: `{ file, name, block, status: 'converted'|'partial'|'unchanged'|'unchecked', check, atoms, rewrites, takenBack, code, body, importDecl, untranslated: [{form, text, line, reason?}], repair?, sentence }`. A rewrite counts only when the QuickJS check says `same` on at least one generated input. A function with untranslated parts is one refusal (rule `LINE-ATOMS`, option tool `line.import.atoms`) for construct.repair; `ImportLogic.atoms` keeps the counts and the sentence.

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
