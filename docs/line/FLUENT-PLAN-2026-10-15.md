# Fluent English plan, 2026-10-15

Live status: the "Fluent Build Board" artifact (link in the carry-over). This file is the source of truth for scope and
contracts; the board only tracks status. Integration branch: `line/import-smith-codemod` on `private` only.

## Vision
Every function in a Line app has a generated, read-only English view written in Smith's Atomic English (R1-R9). The app
keeps its typed code (ENGLISH-RULES decision 2, revised). The English view is what people read in Cockpit and what the
small local model reads and writes. Claude writes the base fluent library once, from the full JS reference, under
static gates. The small model learns that library by building the same answers and being compared, by checks, with
Claude's. People reach it through an LSP, generators, the CLI and MCP, with no prompt files. Static first: a model step
ships on only after a measured win over static (`ladder.measured`).

## How we work
- **Quick wins:** each task leaf is a 15-20 minute build with a predefined contract (inputs, outputs, files, done).
  One session per leaf, own worktree, branch `line/fluent/<task-id>` cut from the integration branch, pushed to
  `private`.
- **Versions:** a wave is merged into the integration branch after verification, then tagged
  `fluent-v0.<wave>.<n>` on `private`. The board records the version each task shipped in.
- **Heavy jobs:** one at a time through `packages/tools/dev/heavy.sh`. Sessions run single test files directly; the
  full suite runs once per wave on the combined tree.
- **Files:** parallel sessions never touch the same files. New tooling goes into `packages/line-fluent/<area>/`, one
  folder per task.
- **Model calls:** fixed input, constrained output, one unit per request, a deterministic check after.

## Shared contracts (predefined; every task codes against these)

### C1. Reference entry (input; exists)
`packages/line-codemod/bench/atoms/js-reference/reference.json` `entries[]`:
`{id, section, layer: 'es'|'web'|'syntax', kind, params: [{name, type, optional, rest}], lib, key}`.
Node's answers: `expected.json`; one runnable function per entry: `map.json` -> `input/ref-*.mjs`.

### C2. Fluent answer (output of Claude and of the student)
```json
{
  "entry": "Array.prototype.flatMap",
  "decision": "new-atom | existing | molecule | not-expressible",
  "atom": "flatMapped",
  "existing": null,
  "kind": "question | copy | in-place | value | effect",
  "sentence": "every(x).in(xs).is().mapped().to(f).and().flattened()",
  "js": "xs.flatMap(f)",
  "params": [["xs", "list"], ["f", "fn"]],
  "parts": ["mapEach", "flattened"],
  "reason": null
}
```
Rules: `existing` is a catalog atom id when `decision` is `existing`; `parts` lists catalog atoms when `decision` is
`molecule`; `reason` is one plain sentence when `decision` is `not-expressible`; `sentence` and `js` are null then.
Field order and names are fixed; unknown fields are refused.

### C3. Gate result (output of the gate runner)
```json
{ "entry": "...", "pass": false,
  "checks": { "schema": "pass", "grammar": "fail", "equivalence": "skip", "types": "skip" },
  "refusal": "The word `flattened` is not in the grammar's verb list; add it to naming.json grammar.verbs or use `flattens()`.",
  "fixes": [{ "kind": "replace-word", "from": "flattened", "to": "flattens" }] }
```
`refusal` is the plain-English sentence fed back to the model once; `fixes` are typed and closed.

### C4. Comparison (output of the comparator)
`{ "entry", "verdict": "same | equivalent | wrong", "reason", "gold": C2, "student": C2, "studentGate": C3 }`.
`same`: same decision, atom (or existing id) and sentence after whitespace normalising. `equivalent`: different, but
the student's gate passes and its JS behaves the same as gold's. `wrong`: anything else.

### C5. Next words (LSP completions)
`nextWords(prefix: string) -> { legal: string[], complete: boolean }`, from `naming.json` `grammar` only (closed enum,
no model). Every catalog `fluent` sentence must be accepted word by word.

## Tasks

Status and ETA live on the board. Leaves marked QW are 15-20 minute quick wins.

### E0 Foundation: Smith and the codemod live in construct
- **T0.1 Paths resolve in-repo** (QW, this session)
  - S1 atoms-page/build.mjs: SMITH_DIR defaults to `packages/line-smith`, esbuild from the repo's node_modules.
  - S2 js-reference/list.mjs: TS 7 lib dir resolved from line-smith's own install.
  - S3 bench/atoms/runtime.js: snapshot from the construct repo at `packages/line-smith` (git archive `<sha>:packages/line-smith`).
  - S4 bench/corpus.js: default corpus root is this checkout.
  - Contract: `git grep "smith-functional\|atomic-codemod\|construct-worktrees" packages/line-smith packages/line-codemod`
    shows only docs, history notes and recorded results.
  - Benefit: anyone with a construct checkout runs everything. Risk: snapshotting from this repo changes cache keys
    (mitigation: new key = construct sha + subdir; old `.runtime` is git-ignored).
- **T0.2 Workspace wiring** (QW)
  - S1 names `@line/smith`, `@line/codemod`, `private: true`; nested lockfiles removed.
  - S2 root install through heavy.sh; TypeScript 7 stays nested under line-smith.
  - S3 `npm test`: line-smith runs as its own suite (tsc, tests, type fixtures), not globbed; codemod tests globbed.
  - Risk: TS 5 vs 7 and Babel 7 vs 8 hoisting clashes (mitigation: nested installs, check with `npm ls`).
- **T0.3 Baseline counts** (QW): each package suite alone, then the full suite once; exact counts in the carry-over.
- **T0.4 Unpushed work** (owner): wave 3 (og/final 8d9a23e2), import-v2 (11 commits + BUNDLE-READ section),
  ladder-model-gaps. Push to `private` on the owner's yes.

### E1 Fluent library, written by Claude
- **T1.1 Contract C2 + validator** (QW) `packages/line-fluent/contract/`
  - S1 `answer.schema.json` (C2); S2 `validate.mjs` (no deps) returning C3-shaped `checks.schema`; S3 tests: 6 good, 10 bad answers.
- **T1.2 Gate runner** (QW) `packages/line-fluent/gate/`
  - S1 grammar check through `packages/line-smith/scripts/lib-sentence.mjs` + naming.json;
  - S2 equivalence: run `js` and the atom on fast-check inputs (line-smith gens) and on the entry's expected.json case;
  - S3 C3 output with one refusal sentence and typed fixes; tests on 5 catalog atoms (pass) and 5 broken answers.
- **T1.3 Pilot: Array section** (2-3 QWs): Claude, one entry per request, C2 out, C3 gate, one retry with the refusal.
  Measure: pass rate, retries, tokens and minutes per entry, decisions by kind. Go/no-go for the rest.
- **T1.4 Remaining sections** (batched QWs, by section), owner approves new atoms in batches.

### E2 Static translator: JS to the English view
- **T2.1** toAtoms writes the fluent form (ENGLISH-RULES build step 5).
- **T2.2** `construct english <file>` (QW): prints the read-only English view through the in-repo to-english step.
- **T2.3** Coverage report: converts / refused / untranslated, on the reference and on real code.
- **T2.4** `line.import.writeAtoms` writes sentences (step 6); re-import and measure the corpus (step 7).

### E3 Student: the small model learns by comparison
- **T3.1 Comparator C4** (QW) `packages/line-fluent/compare/`: pure module, fixtures for each verdict.
- **T3.2** Student runner: qwen2.5-coder 1.5b through the prefilled one-unit call, C2 out, on the pilot section.
- **T3.3** Training records (gold, corrected misses, codemod pairs) and a held-out split by section.
- **T3.4** English-as-context probe: must show the English view helps before any training spend.
- **T3.5** LoRA round 1; held-out score must rise, else stop and ask.

### E4 LSP on the fluent layer
- **T4.1 nextWords C5** (QW) `packages/line-fluent/grammar/`.
- **T4.2** Hover: English view of a JS function (needs wave 3's live index #950 on the base).
- **T4.3** Diagnostics: C3 refusals as LSP diagnostics with code actions from `fixes`.
- **T4.4** Go to definition: sentence -> atom -> JS twin in the reference.

### E5 Generators and tooling
- **T5.1** Atom generator: one new JS API entry -> C2 via the stage 1 pipeline -> catalog after approval.
- **T5.2** MCP tools `line_english`, `line_atoms`.
- **T5.3** Cockpit English panel (view beside code, detail collapsed).
- **T5.4** Pages rebuild from the catalog after every batch (Smith Atoms, JS Reference Atlas).

## Risks across the plan
| Risk | Mitigation |
|---|---|
| The English view does not help the small model | T3.4 probe gates all training spend; the view still serves people |
| Claude's cost over 2,378 entries | Pilot one section, measure per-entry cost, go/no-go; reuse existing atoms first |
| Grammar too narrow (trailing optional args, R8 names) | `not-expressible` is a first-class answer; gaps go to the owner as a batch |
| Student overfits to Claude's style | Held-out sections; `equivalent` counts as right when gates pass |
| Parallel sessions collide | One folder per task, contracts fixed up front, merge only after verification |
| Heavy jobs pile up | heavy.sh queue; single files while iterating; one full suite per wave |
| Open-core leak | Everything stays on `private`; nothing merges to a public branch without the owner |
