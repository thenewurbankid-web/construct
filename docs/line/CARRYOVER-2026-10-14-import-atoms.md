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
  `logicView` exposes it. App files are NOT rewritten.
- Fallback: either link down -> `via: 'off'`, one sentence, the import carries on (tested). Cockpit's browser mock has
  no breakdown op (breakdown.mjs needs Node), so the stage is skipped there.

## Pins
- packages/line-links/atomic-codemod-atoms.json: ~/Repositories/atomic-codemod-atoms (env ATOMS_CODEMOD_SOURCE_DIR),
  branch atoms-transform, 7d1e228d. Links atoms-transform.js and bench/atoms/{checked,runtime,equivalence,checker-types}.js.
  The codemod is unchanged.
- packages/line-links/smith-functional.json: ~/Repositories/smith-functional (env SMITH_FUNCTIONAL_SOURCE_DIR), branch
  functional-atoms, 939c25ce (337 atoms). Snapshotted by the codemod's runtime.js (`git archive` of the pinned commit
  into the codemod's git-ignored bench/atoms/.runtime/), never imported in Node.
- Both tables are listed by `node packages/line-links/link.mjs`; `--pin` still covers links.json only (bump by hand).

## Tests
- test/line-import-v2-breakdown.test.mjs: 15 (13 with the mock; 2 against the real links, skipped with the link's sentence
  when a source is missing). Real run on the fixture app (src/calc/rules.ts): `total` -> `plus(a, b)`, `isBig` ->
  `greaterThan(n, 100)`, both check `same`; `label`'s template literal reaches construct.repair (no model: outcome
  no-model); the real check accepts `join(plus(n, m), ' items')` and refuses a body that behaves differently.
- Touched packages: line-import*, line-links*, import-repair, summarize: 154/154. eslint clean on touched files; tsc
  clean on touched files. Full suite (heavy.sh npm test): 7311 tests, 7250 pass, 0 fail, 55 skipped, 6 todo.

## Open questions
1. Writing the atom bodies into the app: the app needs the atom runtime as a dependency (importDecl says `from 'smith'`).
   Until decided, the breakdown is import state only (input for naming, atomicGate, dedup, library).
2. `line.import.atoms` is a refusal-shape tool name, not a registered plan tool (no plan step writes it yet).
3. Every refusal goes to the repair loop (capped at LOOP_LIMITS.fixes = 12 per import); with Ollama up that is up to 4
   model calls each. construct.repair's profile was measured on Train Line refusals, not atom gaps.
4. Owner, 2026-10-14 (asked in this session): no AST desugar pass for template literals or optional calls; gaps go to
   repair and later the model, with the syntax tree as reference (above). Not measured: whether the tree helps the 1.5B.
5. Checker parameter types only reach function declarations whose text is found verbatim (not const arrows, and TS
   includes `export` in the declaration start, so exported declarations get none); annotated types still apply.
6. Construct issue for this work not filed (brief said do not push; filing is an outward action for the parent session).
