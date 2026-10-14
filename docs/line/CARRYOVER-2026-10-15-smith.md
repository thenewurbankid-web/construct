# Carry-over 2026-10-15: Smith and the codemod move into construct

Branch: `line/import-smith-codemod` on `private` (construct-private only, never `origin`), cut from `private/work/2026-09-23` (c363018c). Worktree: `~/Repositories/construct/.claude/worktrees/line-import-smith`. Not merged anywhere yet.

## What is on this branch
- `packages/line-smith/`: smith-functional imported with history (`git subtree`, from `r9-every-sentences`). Smith's functional atoms and Atomic English (`smith/fluent`). Spec: `packages/line-smith/ENGLISH-RULES.md`, rules R1-R9.
- `packages/line-codemod/`: atomic-codemod-atoms imported with history (from `atoms-transform`). The codemod, the full JS reference corpus (`bench/atoms/js-reference/`: 2,378 entries, Node-checked) and two page generators.

## Owner decisions 2026-10-15 (all in ENGLISH-RULES.md)
- **Decision 2 revised:** apps keep their original typed code; the fluent layer is a generated read-only English view built from the JS reference (also the small model's English context). Running sentences stays an opt-in.
- **R9, callbacks:** owner's wording `every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(2)`; the first word decides the result (`checks()` yes/no, `every()` list, `the().first()` one item, `folds()` one value, `does()` nothing); index `every(x).at(i).in(xs)`; async one at a time, `all().at().once()` for parallel; imported placeholders with types carried along the chain; `this` rewritten when provable, else refused.
- **Molecules and organisms:** bodies longer than one atom become use-case molecules in the app, not Smith atoms. Only new Smith atoms need owner approval; a molecule passing the six-check gate needs none.
- **Level and placement:** static measures set the level; a small model answers belongs/separate/split (shadow until it beats static). Block purpose comes from the Trace path step, else derived from name + atom English.
- Built in line-smith by the R9 session (reported 702/702 before the shape commit; not re-run): every() table, nested every, chain types, at(i), does(), async.

## Published pages (owner's account)
- Smith Atoms: https://claude.ai/artifact/VyLUndJe64ZfZEojij9E7b
- JS Reference Atlas: https://claude.ai/artifact/WgS7uBhJUJVYBYvaYonPao
Not yet opened in a browser. Rebuild: `node bench/atoms/atoms-page/build.mjs`, `node bench/atoms/js-reference/site.mjs`.

## Next, in order
1. Freeze the old repos (`~/Repositories/smith-functional`, `~/Repositories/atomic-codemod-atoms`): no new commits there; all work in `packages/line-*`.
2. Fix hard-coded paths: `git grep -n "smith-functional\|atomic-codemod-atoms\|construct-worktrees" packages/line-*` (e.g. atoms-page/build.mjs defaults SMITH_DIR to the old repo; esbuild path points into another worktree).
3. Wire into construct: workspaces, package names, both test suites in `npm test` (one heavy job at a time).
4. Run both suites here and record exact counts.
5. Open risks to measure, not decide: does the English view beat raw code for the small model (the English-as-context probe); coverage of real app code; token cost; derived purpose being circular; no labelled set for placement.
6. Naming: `＠line/atoms` (state-machine atoms) and Smith's atoms share the word "atoms".
7. Never merge this into a branch that goes public without the owner's OK (open-core boundary).
