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

## Wave 2 leaves (2026-10-15)

One leaf = one agent, own worktree, branch `line/fluent/<leaf>` cut from `line/import-smith-codemod` (wave 1 at
f3b27614 plus this section), pushed to `private` only. Each leaf owns only the files listed; nothing else changes
(no root `package.json`, no lockfile, no shared README). Tests are `*.test.mjs` next to the module, run directly with
`node --test <file>`; eslint clean on the touched files. Done = tests pass, eslint clean, one commit (or a few
shippable ones) pushed, report with the commit sha, test count and `git diff --shortstat` vs the integration branch.
Check results (all gate parts) share one shape: `{ check: 'pass'|'fail'|'skip', errors: string[], fixes: Fix[] }`;
each error is one plain-English sentence naming the word or field and the fix. `Fix` is closed:
`{kind:'replace-word', from, to}`, `{kind:'remove-word', word}`, `{kind:'use-existing', atom}`,
`{kind:'set-field', field, value}`.

| Leaf | Folder / files | Contract | Done |
|---|---|---|---|
| t1-2a-grammar | `packages/line-fluent/gate/grammar/` | `checkGrammar(answer) -> CheckResult`. Parse `answer.sentence` with `packages/line-smith/scripts/lib-sentence.mjs` `parse`; walk words with wave 1's `grammar/next-words.mjs` (`nextWords`), so the gate and the LSP agree. `skip` when `sentence` is null. Unknown word -> `replace-word` to the closest legal word (edit distance over `nextWords(prefix).legal`), else `remove-word`. Incomplete sentence is a fail naming the legal next words. | Every catalog `fluent` passes; 8+ broken sentences fail with the expected sentence and fix. |
| t1-2b-equivalence | `packages/line-fluent/gate/equivalence/` | `checkEquivalence(answer, {entry, runs = 50, seed}) -> CheckResult`. Runs `answer.js` (params bound by `answer.params`) against the entry's reference function (`map.json` -> `input/ref-*.mjs`) on the entry's `expected.json` case and on generated inputs (line-smith's gens / `typeGens` from naming.json, or `bench/atoms/equivalence.js` sandbox if it fits). `skip` for `not-expressible` and `molecule`. A mismatch names the input and both outputs. Deterministic for a fixed seed. | 5 catalog atoms pass; 5 wrong `js` answers fail with the differing input. |
| t1-2c-assemble | `packages/line-fluent/gate/assemble.mjs` (+ test) | `runGate(answer, {grammar, equivalence, types}) -> C3`. `schema` from wave 1's `contract/validate.mjs`; other checks are injected functions (default: each returns `skip`), so this leaf never imports its sibling folders. If schema fails, the rest are `skip`. `pass` = no check is `fail`. `refusal` = first error of the first failed check in order schema, grammar, equivalence, types, else null; `fixes` = all fixes in that order, deduplicated. Output keys exactly C3's. | Fixtures for all-pass, each single fail, schema-fail short circuit, dedupe. |
| t1-3a-request | `packages/line-fluent/pilot/request/` | `buildRequest(entry, {candidates = [], refusal = null}) -> {system, user, prefill}`. One C1 entry per request; fixed text; lists the C2 fields in order, the closed enums, up to 5 candidate catalog atoms (`{atom, fluent, js}`), the R1-R9 summary lines from ENGLISH-RULES.md, and, on retry, the refusal sentence. `prefill` is `{"entry": "<id>", "decision": "`. No model call. | Snapshot tests for a first try and a retry; size cap (chars) asserted. |
| t1-3b-runner | `packages/line-fluent/pilot/runner/` | `runPilot(entries, {model, gate, build, maxRetries = 1, log}) -> {results, summary}`; `model(request) -> {text, tokensIn, tokensOut}` injected; `mock-model.mjs` answers from a fixtures map. Parse `prefill + text` as JSON; a parse error is a schema fail. Retry once with `gate.refusal`. `results[]`: `{entry, answer, gate, tries, tokensIn, tokensOut, ms}`; `summary`: pass rate, retries, tokens and ms per entry, decisions by kind. Optional JSONL log path. | Mock run over 4 fixture entries: first-try pass, retry pass, retry fail, unparsable. |
| t1-3c-entries | `packages/line-fluent/pilot/entries/` | `arrayEntries()` -> C1 entries whose `section` is `Array` (exact count recorded), each with `candidates`: catalog atoms whose `js` uses the same member (e.g. `.flatMap(`), via `existingAtoms(entry)`. `node pilot/entries/array.mjs` prints count, with-candidate count, and the first 10. | Counts asserted; 3 known matches (e.g. `Array.prototype.includes`) found. |
| t2-2-english-cli | `packages/line-fluent/cli/english.mjs`, `construct.commands` in `packages/line-fluent/package.json` (only this leaf edits it) | `construct english <file>`: read-only English view of each top-level function through `packages/line-codemod/to-english.js` `toEnglish`; prints `name: sentence` lines; `--json` prints `[{name, line, english}]`. Registers through the plugin-command registry (docs/CLI-COMMAND-REGISTRY.md); unreadable file or parse error is one sentence and exit 1. | Test on a 3-function fixture (text and `--json`), error case; `node packages/cli/construct.mjs english <fixture>` works. |
| t2-3a-coverage | `packages/line-fluent/coverage/` | `coverage({sections})` over C1: for each entry, the reference function source -> `toAtoms` (line-codemod `atoms-transform.js`, catalog from `atoms-catalog.js`) -> `converts` (atom calls, no leftover JS), `refused` (toAtoms throws or refuses), `untranslated` (JS left). Output `{total, converts, refused, untranslated, bySection}`; CLI prints a table and writes `coverage/latest.json`. | Counts on the full reference recorded in the report; test on 5 entries with known outcomes. |
| t2-1-spike | `packages/line-codemod/fluent-form.js` (+ test), new module only | `toFluent(atomCall, catalog) -> string|null`: an atom call `name(a, b)` -> the catalog `fluent` sentence with its params replaced by the call's arguments; null when the atom has no `fluent`. `fluentFor(code, opts)` = `toAtoms` then `toFluent` per call. Spike: report how many of 20 sample reference entries come out as a full sentence and why the rest do not. | 10 catalog atoms round-trip; findings in the report. |
| t3-2a-student | `packages/line-fluent/student/` | `studentRequest(request, {model = 'qwen2.5-coder:1.5b', schema}) -> Ollama /api/generate body` (raw prompt, prefill appended, `temperature: 0`, `num_predict` cap, `format` = C2 JSON schema); `parseStudent(prefill, responseText) -> {answer}|{error}`; `callStudent(body, {fetch})` with injected fetch. No network in tests. | Body snapshot; parse of good, truncated and extra-field outputs. |
| t3-3a-records | `packages/line-fluent/records/` | `record({entry, section, source: 'gold'|'corrected'|'codemod', gold, student, verdict})` -> one closed-shape object; `appendRecords(path, records)` JSONL; `splitBySection(entries, {heldOut = 0.2, seed})` -> `{train, heldOut}` by whole section, deterministic (hash of seed + section), no section in both. | Same seed same split; sizes near the fraction; shape refused on unknown fields. |
| t4-3a-diagnostics | `packages/line-fluent/lsp/diagnostics/` | `toDiagnostics(c3, {sentenceRange})` -> LSP `Diagnostic[]` (one per failed check, `source: 'line-fluent'`, `code: <check>`, message = its error); `codeActions(c3, {uri, text, sentenceRange})` -> `CodeAction[]` with `WorkspaceEdit`s for `replace-word` / `remove-word` (word located by `lib-sentence` `parse` offsets). Pure, no LSP library. | Diagnostics and edits for 4 C3 fixtures; applying an edit yields the fixed sentence. |
| t4-4a-definition | `packages/line-fluent/lsp/definition/` | `buildIndex()` from `catalog.json` + C1: `{bySentenceWords, byAtom}` where each atom maps to `{atom, fluent, module, reference: [entry ids]}` (reference match by the catalog `js` member vs entry `key`). `definitionAt(sentence, offset) -> {atom, reference}|null` by the longest catalog sentence matching the words around the offset. | Index counts recorded; 5 lookups including one with no match. |
| t5-4a-pages | `packages/line-codemod/bench/atoms/rebuild-pages.mjs` (+ test) | One command: builds Smith if `dist/` is stale (`npm run build` in line-smith), runs `atoms-page/build.mjs` and `js-reference/site.mjs`, then checks both `index.html` files exist and embed counts equal to the catalog and the reference. `--check` verifies without writing. Prints the two output paths to publish. | Test runs `--check` on the current tree; counts in the report. |
| t0-5-probe-port | `packages/line-codemod/` (the probe's files only) | Port atoms-probe 274083e, 54efe04, 9dc24ab from `~/Repositories/atomic-codemod-probe` into the prefix (`git subtree pull --prefix packages/line-codemod ... atoms-probe`, else cherry-pick with `-X subtree=packages/line-codemod`). Probe dependencies (QuickJS) are reported, not installed into the root lockfile, unless already present. | Codemod suite 231 + the probe's tests green; conflicts stop the leaf and are reported. |
| t0-6-links-inrepo | `packages/line-links/smith.json`, `atomic-codemod.json`, `link.mjs` (only the default/pin logic) | `default` points at `packages/line-smith` / `packages/line-codemod` (repo-relative); env vars still override; the commit pin is skipped for an in-repo source (it moves with the repo). If `@smith/core` (Chain, Organism, Comparable from the old `smith` repo) is not in line-smith, stop and report: that is a different repo, not a path change. | line-links and `packages/summarize` link tests green. |

Merge order: leaves merge as they verify; `gate/index.mjs` (wiring t1-2a/b into t1-2c's `runGate`) is added by the
orchestrator after the three gate leaves land. T5.2a (MCP `line_english`) starts only after the wave merges, since it
touches the shared tool registry in `packages/mcp/src/blocks.mjs`.

Wave 1 suite (2026-10-15, heavy.sh on f3b27614): 7636 tests, 7572 pass, 3 fail, 55 skipped, plus Smith 757/757. Fails:
`packages/line-smith/contract.d.ts` missing (line-module contracts test); `@line/smith` `./catalog.json` export targets
`dist/atoms/catalog.json`, absent before Smith's own build runs; studio-export `editor-browser.test.mjs` volume knobs
(timing). fluent-v0.1.0 is not tagged until the owner decides.
