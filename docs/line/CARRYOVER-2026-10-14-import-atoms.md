# Carry-over 2026-10-14: Import v2 static breakdown into atoms

Branch `line/import-v2-static-breakdown` (from `line/ladder-model-gaps` 66ca1f42, i.e. private/work/2026-09-23 + the
LINE.md ladder commit). Not pushed, not merged. Owner decisions behind it: atomic-codemod HANDOFF.md "Decisions 2026-10-14".

## What is wired
- Import agent `classify` stage, after the fit: `breakdownStage` (packages/engine/line/importAgent.mjs) runs the loop op
  `breakdown` (importLoopDisk.mjs) over every top-level function the FitProposal put in a **domain** block (fit rule 2,
  pure functions). Values and types are skipped; arrows bound to a const are read as declarations (as the codemod corpus).
- One shared module: packages/engine/line/importV2/breakdown.mjs (createStaticBreakdown, breakDownImport, functionOf,
  refusalOf, breakdownCounts). Shapes `AtomBreakdown` / `AtomUnitResult` + asserts in importV2/contract.mjs (also in
  docs/line/import-v2/CONTRACT.md); mock converter `createMockStaticBreakdown` + `MOCK_ATOM_BREAKDOWN` in importV2/mock.mjs.
- Per function: atomic-codemod's checked converter (toAtoms, run old vs new in QuickJS on 25 generated inputs, take back
  rewrites that change behaviour, try each candidate where several atoms fit). A rewrite counts only when the check says
  `same` with at least one input compared; otherwise the original is kept (`unchecked`).
- Untranslated parts (no atom, ambiguous, taken back): one refusal per function (rule LINE-ATOMS, option
  `{tool: 'line.import.atoms', args: {file, name, body}}`) through the agent's existing `o.repair` (createRepairer ->
  repairLoop, step construct.repair). Construct's `check` for a repaired body: toAtoms finds nothing left to rewrite or
  leave, and QuickJS says same as the original. A repaired body replaces the kept one; any other outcome stays on the
  unit for a person. No second repair loop, no model step in this module.
- Owner, 2026-10-14: the AST as a reference for reasoning. From the first refused repair of a function on, the check's
  refusal sentence ends with the syntax tree of the parts with no atom (`syntaxTreeOf`, e.g. `${n + m} items` is
  TemplateExpression("", span(BinaryExpression(n + m), " items"))); repairLoop shows each earlier refusal to the next
  attempt. After one failure, not two (owner's choice): repairLoop stops when an attempt fixes no more parts than the last,
  so a tree after two failures would rarely reach a third attempt. Shared repairPrompt unchanged.
- Result: `<folder>/line/atoms.json` (through the writer, like fit.json) and `ImportLogic.atoms` (counts + sentence);
  `logicView` exposes it. The breakdown itself rewrites no app file; the plan step below does, one function at a time.
- Fallback: either link down -> `via: 'off'`, one sentence, the import carries on (tested). Cockpit's browser mock has
  no breakdown op (breakdown.mjs needs Node), so the stage is skipped there.

## Writing into the app (owner, 2026-10-14, option C "through @line/atoms")
- **@line/atoms re-exports the pinned Smith atoms.** packages/line-atoms/functional/ is a generated snapshot of
  smith-functional `src/atoms/**/*.ts` at 939c25ce (the same pin as smith-functional.json), each file headed
  `@line-atoms functional 939c25c ... do not edit`, listed in functional/PIN.json. Regenerate after a pin bump with
  `node packages/line-atoms/runtime.mjs --write`; a test compares the snapshot with the pinned commit (skips when the
  source folder is missing). Package exports `@line/atoms/functional` (the TS atoms) and `@line/atoms/runtime` (Node:
  `functionalFiles()`, `FUNCTIONAL_PIN`). Not hand-written copies, and LINE-ATOM does not read the atoms kind.
- **The breakdown imports from @line/atoms**: `importDecl` is `import { … } from '@line/atoms';` (the codemod's own
  `'smith'` specifier is rewritten, names and aliases kept); the contract refuses any other source. checkPair reads only
  the names, so the QuickJS check is unchanged.
- **How it reaches an app (owner's choice: copy + path alias).** Today apps get atoms only as copies (line.useAtom, #919:
  `<library>/atoms/<id>.ts`, relative import; @line/atoms is private, never published). So the new plan step copies the
  functional atoms into `<library>/atoms/line/` of the import folder and gives the folder's `tsconfig.json` the alias
  `paths['@line/atoms'] = ['./<library>/atoms/line/index.ts']` (relative to `baseUrl` when set; created when the folder
  has no tsconfig). The import text stays `from '@line/atoms'`, so moving to a published package later is a tsconfig change.
- **The plan step `line.import.writeAtoms` `{folder, file, name}`** (importV2/writeAtoms.mjs; registered in planTools,
  toolRegistry, the contract tool list and the drafter grammar; an import step, planned inside the folder). It writes one
  `converted` unit's body over the function (its `export` kept), merges the import, copies the atoms and sets the alias,
  through the checked writer (validate). Refuses: NO_BREAKDOWN, UNKNOWN_FILE/ITEM, NOT_CONVERTED (partial/unchanged),
  STALE (the function changed since the breakdown), NAME_TAKEN (an atom name already used in the file), BAD_CONFIG.
- **Behaviour test (owner's choice: QuickJS re-check, not jest).** `createStaticBreakdown().behaves(fn, written)`:
  the function as written against the original, the breakdown's check with the same seed. Run twice: on the planned file
  before anything is written (different -> BEHAVIOUR refusal; tester down -> NOT_CHECKED), and on the file as written,
  as the step's `tests` check `behaviour` (planTools legacyCheck runs `staged.behaviour` via `ops.runBehaviour`). Only
  when every check passes does `line/atoms.json` get `unit.written = {file, sentence}`. A run outside the plan tools
  (no tester: repair scratch runs, train/drafter verify) is refused, never ungated.

## Pins
- packages/line-links/atomic-codemod-atoms.json: ~/Repositories/atomic-codemod-atoms (env ATOMS_CODEMOD_SOURCE_DIR),
  branch atoms-transform, 7d1e228d. Links atoms-transform.js and bench/atoms/{checked,runtime,equivalence,checker-types}.js.
  The codemod is unchanged.
- packages/line-links/smith-functional.json: ~/Repositories/smith-functional (env SMITH_FUNCTIONAL_SOURCE_DIR), branch
  functional-atoms, 939c25ce (337 atoms). Snapshotted by the codemod's runtime.js (`git archive` of the pinned commit
  into the codemod's git-ignored bench/atoms/.runtime/), never imported in Node.
- Both tables are listed by `node packages/line-links/link.mjs`; `--pin` still covers links.json only (bump by hand).

## Tests
- test/line-import-v2-write-atoms.test.mjs: 14 (snapshot vs pin, LINE-ATOM on the copy, importDecl contract, the
  import/alias helpers, plan, refusals, the gate, the step through lineTools with the unit marked written, a failing
  behaviour test that needs you and is not marked, the refused ungated run, and one real-link run: `isBig` written as
  `greaterThan(n, 100)` and QuickJS says the file behaves the same). test/line-plan.test.mjs registry list +1 tool.
- Option C full suite (heavy.sh npm test): 7325 tests, 7264 pass, 0 fail, 55 skipped, 6 todo (a first run had the
  studio-export volume-knob browser test fail under load; it passes alone and on the re-run). eslint and tsc clean on
  touched files; packages/line-atoms/contract.d.ts regenerated for the two new exports.
- test/line-import-v2-breakdown.test.mjs: 15 (13 with the mock; 2 against the real links, skipped with the link's sentence
  when a source is missing). Real run on the fixture app (src/calc/rules.ts): `total` -> `plus(a, b)`, `isBig` ->
  `greaterThan(n, 100)`, both check `same`; `label`'s template literal reaches construct.repair (no model: outcome
  no-model); the real check accepts `join(plus(n, m), ' items')` and refuses a body that behaves differently.
- Touched packages: line-import*, line-links*, import-repair, summarize: 154/154. eslint clean on touched files; tsc
  clean on touched files. Full suite (heavy.sh npm test): 7311 tests, 7250 pass, 0 fail, 55 skipped, 6 todo.

## Open questions
1. Decided (option C, above). Left open: the import agent's plan stage does not add `line.import.writeAtoms` steps for
   converted units yet (the step exists and is tested; adding it per unit is a plan-stage change). The alias is written
   only into the import folder's own tsconfig.json (a step cannot write outside its folder); comments in an existing
   tsconfig are not kept (rewritten as JSON); jest/vite configs get no `@line/atoms` mapping (the behaviour test is
   QuickJS, so the app's own test runner is not involved). The copy is the whole runtime (35 files, ~200 KB of TS);
   unused atoms drop out only when the app's bundler tree-shakes.
2. `line.import.atoms` stays the refusal-shape name for the repair loop; the writing step is `line.import.writeAtoms`.
3. Every refusal goes to the repair loop (capped at LOOP_LIMITS.fixes = 12 per import); with Ollama up that is up to 4
   model calls each. construct.repair's profile was measured on Train Line refusals, not atom gaps.
4. Owner, 2026-10-14 (asked in this session): no AST desugar pass for template literals or optional calls; gaps go to
   repair and later the model, with the syntax tree as reference (above). Not measured: whether the tree helps the 1.5B.
5. Checker parameter types only reach function declarations whose text is found verbatim (not const arrows, and TS
   includes `export` in the declaration start, so exported declarations get none); annotated types still apply.
6. Construct issue for this work not filed (brief said do not push; filing is an outward action for the parent session).
