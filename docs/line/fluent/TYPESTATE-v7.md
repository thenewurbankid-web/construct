# Fluent English grammar and type-state: plan revision 7 (for approval)

Status: **plan, not built** (2026-10-15, branch `line/fluent/catchup`, from the cloud branch
`line/fluent/t1-4-library-run` at `47df541e`). Revision 6 (`docs/line/fluent/TYPESTATE.md` on
`line/fluent/typestate`, `1157bb7e`) was written against `cd151807`. The cloud session then landed 25 commits that
build part of it, in different shapes. This revision keeps what is built, lists only what remains, and orders it.

Revision 6 stays the reference for the design detail (worked examples, scoring weights, morphology table). This file
does not repeat it; where a section is unchanged it says "as rev 6 §N".

## Owner's design goals (this session)

1. One grammar over English parts of speech.
2. Two lexicons, JS and user domain, defined by **one `LexiconEntry` interface**.
3. Roles come from code structure plus supertypes, never from names.
4. A function is a verb when called and an agent noun when passed.
5. Pick the candidate that matches the original **at every node** on several inputs.
6. Closest library match only as a **tie-break**.
7. Ask the user only on close calls, in plain words.
8. Untranslatable code stays plain JS, with rename suggestions.
9. A generic prompt with no rule text.
10. The model returns only **decision and sentence**.
11. Sanitize, then structured feedback with retry.
12. English-first authoring: describe in English with an example per step, match the lexicon, else implement and
    verify, else suggest in English.

## A. What the cloud branch already built (do not rebuild)

| Built | Where | Goal |
|---|---|---|
| R10: every sentence ends `andThe().<name>()`, name derived by rules; `Returns<T, Name>` makes a wrong name a `tsc` error | `packages/line-smith/ENGLISH-RULES.md`, `scripts/lib-return.mjs`, `src/fluent/returns.ts`, `gate/grammar/grammar.mjs` | 1 |
| R11: the library is pure; impure / in-place / void members excluded; `does()` withdrawn; codemod keeps a mutating call as written (`untranslated`, `mutates`) | `ENGLISH-RULES.md`, `scripts/gen-atoms.mjs`, `packages/line-codemod/atoms-transform.js` | 8 |
| Sentence shapes: 55 shapes from catalog + R9 sentences, content verbs as a `VERB` slot, a new third-person verb passes as an alias; third level "class shapes" abstracts subjects and role words | `packages/line-fluent/gate/grammar/shapes.mjs` | 1 (partly) |
| Rules-built answers: js/params from the reference entry, the verb by POS tagging (compromise), the sentence as the shortest shape path carrying every argument; the model only picks or corrects | `pilot/build/build.mjs` | 10 (partly) |
| Lexicon **decoder**: a small code-to-English translation model (BPE, Dice phrase table, bigram LM, decoding constrained to shapes) + a meaning check refusing sentences that drop a meaningful word | `pilot/lexicon/lexicon.mjs`, `pilot/library/run.mjs` | 5 (a candidate source) |
| Clarify from code: guess inputs/outputs by running, compare a sentence with the code on every input (result and in-place change); only words are asked; options narrowed by asking where they disagree | `clarify/io.mjs`, `clarify/sentences.mjs` (`checkAgainstCode`), `clarify/narrow.mjs`, `clarify/clarify.mjs`, `clarify/cli.mjs` | 5, 7, 12 (partly) |
| Gap questions in plain words: the step by its example, options as plain sentences, replies read in the person's own words; the model self-asks by running experiments; the person only confirms (settles at 0.8) | `gaps/cli.mjs`, `gaps/fill.mjs` | 7 |
| toAtoms: an atom only on its own type (type read from the const declaration); a missing atom is a gap with its reference entry | `packages/line-codemod/atoms-transform.js` | 3 (partly), 8 |
| Approved-atom registry: new verb into `naming.json`, check sets, generated `src/fluent/approved.ts`; `gaps/cli choose` registers for real | `packages/line-smith/scripts/lib-approved.mjs`, `gen-atoms.mjs` | 2 (partly) |
| Library run: batched turns, kept-open model processes, user stage (inside model asks, Opus answers as the owner), worker-pool gate with a memory/time watchdog, resumable results, live page | `pilot/library/*`, `gate/isolated/*`, `pilot/runner/claude-model.mjs` | — |

**Library run status** (`pilot/library/runs/full-2026-10-15/results.jsonl`): stopped at 1,307 of 2,378 entries. 650
passed the gate: **84 real atoms** (42 existing, 42 new) and 566 not-expressible; 657 refused. Since `36c79b00`, a
not-expressible answer is not a library entry, so the 566 still need turn 2 and the user stage. A separate session is
re-running the library on qwen2.5-coder:7b from the same commit.

**Tests on `47df541e`** (run in this session): line-fluent 341/342, line-smith 691/691 + types clean, line-codemod
273/273. The one failure: `gate/isolated/isolated.test.mjs:12`, whose fixture sentence predates R10
(`list(xs).gives().item().at(index)` is refused for its missing return clause before the memory watchdog can fire).
The R10 commit message says 342/0; it is 341/1.

## B. Revision 6, section by section

| Rev 6 section | State on `47df541e` | Evidence | What remains |
|---|---|---|---|
| 0 Sources of truth | partial | `naming.json` + `catalog.json` + `approved.json` are the sources; shapes, the decoder and builder derive from them | `grammar.json`, `morphology.json`, `lexicon/core.json`, project `domain.json` |
| 1 Grammar over parts of speech | partial | `shapes.mjs` (55 shapes, `VERB` slot, class shapes); `grammar/next-words.mjs` trie | promote class shapes to positions over word classes; R10 clause and R11 (no `Effect`, no `does()`) folded in |
| 2 Lexicon (data) | missing | `pilot/lexicon/lexicon.mjs` is a decoder, not lexicon entries | one `LexiconEntry` interface for both lexicons |
| 3 Morphology | partial | `lib-return.mjs` `participleOf`, `shapes.mjs` `looksLikeVerb`, `build.mjs` `wordsOf`/`verbOf` (compromise), `naming.json` participles | one module: -s, -ed, -ing, **-er/-or agent nouns**, plural, camelCase split |
| 4 Type-state over positions | partial | hand-written `src/fluent/index.ts` + `returns.ts` (R10 typed), `every.ts`, generated `approved.ts` | generated per-position interfaces with typed role interfaces |
| 4b Runtime factory | partial (core) | `approved.ts` speaks approved sentences | domain runtime from `binds` |
| 5 Roles from code | partial | toAtoms reads types from declarations; `clarify/io.mjs` guesses kinds from usage and confirms by running | roles from the TS checker, two-word verb rule, kind from code for domain functions |
| 5b Supertypes, callables | missing | — | fundamental type, supertype chain, verb when called / agent noun when passed |
| 5c Several roles: match, ask | partial | asking on close calls exists in `gaps/cli.mjs` and `clarify/narrow.mjs` | role candidates per node; **order changes**: behaviour first, library score only as tie-break (goal 6) |
| 5a Untranslated + renames | partial | codemod `untranslated` with reason `mutates`; gaps listed | reason classes (operator, plumbing, naming, several), rename suggestions as plan steps |
| 6 Rules table | partial | R10/R11 added and enforced; R1 verb check in shapes | rows for new positions once the grammar exists |
| 7 Select or write | partial | `build.mjs` computes js/params; `--build` lets the model pick | **drop "select"** (goal 10): the answer is `{decision, sentence}` (+ `existing`/`parts`/`reason`); contract still requires 10 fields |
| 8 Sanitize | partial | `claude-model.mjs` re-reads fenced/spaced JSON | a sanitizer module: case, inflect by position, synonyms, slips; changes recorded |
| 9 Feedback + retry | partial | gate `fixes` (`replace-word`, `add-return`); turn 2 re-sends the refusal text; user stage | structured feedback (position, legal next words, fix) as data; gap records |
| 10 Generic prompt | missing | `pilot/request/request.mjs` still has `RULES` R1-R10 and the shapes list; `clarify/sentences.mjs` `DRAFT_SYSTEM` too | prompt text built from grammar + lexicon data only |
| 11 Steps 1-16 | see C | | |
| 12 Open questions | some answered | Q4 (mutation proof) is moot for the library under R11; Q5 (new core verbs): the owner confirms through `gaps/cli`; Q7 (retries): turn 2 + user stage | the rest stay open (D) |

## C. Remaining work, in order

One commit per step, each with its own test file run directly (no full suite, no benchmark, no model call), pushed
to `private` only. Paths are under `packages/line-fluent/` unless noted.

| # | Step | Files | Check | Builds on (do not redo) |
|---|---|---|---|---|
| 0 | Fix the R10 fixture in the isolated-gate test | `gate/isolated/isolated.test.mjs` | line-fluent 342/342 | — |
| 1 | **`LexiconEntry`**: one interface for JS and domain entries (lemma, pos, forms, kind, subject, typed frame, R10 return name, binds, certainty, evidence, source, match) | `lexicon/entry.ts` + `lexicon/entry.schema.json`, test | core and a domain fixture entry both validate; no field is per-lexicon | `approved.json` fields, `lib-return.mjs` |
| 2 | **Morphology** in one module, absorbing the scattered pieces; adds agent nouns and plurals | `grammar/morphology.mjs` + `morphology.json`, test | every catalog verb round-trips -s/-ed/-ing/-er; `participleOf`, `looksLikeVerb`, `wordsOf` call it | `lib-return.mjs`, `shapes.mjs`, `build.mjs` (compromise) |
| 3 | **Core lexicon**, generated | `lexicon/build.mjs`, `lexicon/core.json` (`--check`), test | every catalog and approved atom has one entry with binds, frame, types and return name | `gen-atoms.mjs`, `catalog.json`, `approved.json` |
| 4 | **Grammar over parts of speech**: class shapes become positions over word classes; one parser; shapes and next-words read it; catalog sentences become fixtures | `grammar/grammar.json`, `grammar/parse.mjs`; `gate/grammar/shapes.mjs` and `grammar/next-words.mjs` keep their APIs | every catalog + R9 sentence parses to its atom; the LSP and shapes tests unchanged | `shapes.mjs` class shapes |
| 5 | **Roles from code**: checker types, supertype chain, callables (verb called, agent noun passed), two-word verb rule; usage guesses only as `certainty: inferred` | `grammar/roles.mjs`, `grammar/types.mjs` (via `packages/engine/lsp/host.mjs`), test on a `LoanApplication extends Application` / `Approver` fixture | rev 6 §5 and §5b tables reproduced; no role read from a name | toAtoms declaration types, `clarify/io.mjs` |
| 6 | **Per-node selection**: candidates per node (roles, decoder, rules builder), each run against the original **at every node** on several inputs; keep those equal everywhere; library closeness only breaks ties; a close call goes to the existing plain-word question flow | `grammar/select.mjs`, `grammar/match.mjs` (tie-break score), test | rev 6 §5c examples, re-ordered: behaviour decides, the score only orders equals | `checkAgainstCode`, `gate/isolated` pool, `lexicon.mjs` `decode`, `build.mjs`, `gaps/cli.mjs` questions |
| 7 | **Short answer**: `{decision, sentence}` plus `existing`/`parts`/`reason`; everything else derived | `contract/derive.mjs`, `contract/validate.mjs`, `contract/answer.schema.json`, `gate/assemble.mjs`, test | the old 10-field shape still validates; derive matches `build.mjs` on the Array pilot | `build.mjs` |
| 8 | **Sanitizer** | `pilot/sanitize/sanitize.mjs`, test | each change recorded; idempotent | `claude-model.mjs` fence handling moves here |
| 9 | **Structured feedback + retry + gap records** | `pilot/feedback/feedback.mjs`, `pilot/library/run.mjs` turn 2, `records/records.mjs`, test | rev 6 §9 flatMap example as data | gate `fixes`, turn 2, user stage |
| 10 | **Generic prompt**: no rule text in source | `pilot/request/request.mjs`, `clarify/sentences.mjs` `DRAFT_SYSTEM`, `gaps/*` prompts, test that greps the sources | every request under 4,000 chars for the student | `SHAPE_LINES` become generated examples |
| 11 | **Domain lexicon from code**, same `LexiconEntry`; approval is for words only | `lexicon/domain.mjs`, `cli/english.mjs` (`lexicon propose|approve`), test on a fixture TS project | rev 6 §5 worked examples | steps 1, 5, 6 |
| 12 | **Untranslated classes + rename suggestions** as reviewable plan steps | `grammar/untranslated.mjs`, `lexicon/abbreviations.json`, `packages/engine/line/planService.mjs` `renameSymbol` (reuses `booleanNames.mjs` `renameEdits`) | `calcTtlAmt` -> a pending step, nothing renamed without approval | codemod `untranslated` + `mutates` |
| 13 | **English-first authoring**: describe in English with an example per step -> match each step in the lexicon (step 6) -> else implement and verify against the examples -> else suggest in English | `clarify/author.mjs` + `clarify/cli.mjs author`, test | a 3-step description with examples yields 3 sentences, one implemented and verified | `clarify.mjs` `propose/choose/create`, `narrow.mjs`, `gaps/fill.mjs` |
| 14 | **Generated type-state + runtime factory** from the lexicon; the hand-written core runtime stays until the generated one equals it | `typestate/generate.mjs`, `typestate/runtime.mjs`, fixtures, test | `tsc` valid/invalid fixtures; sentence = plain call under fast-check | `returns.ts`, `every.ts`, `approved.ts` |
| 15 | LSP and student on the same data | `lsp/hover/hover.mjs`, `student/student.mjs` | their own tests | — |

Steps 0-10 come before resuming the full library run; 11-15 do not block it.

## D. Conflicts to decide (surfaced, not resolved)

1. **R11 vs revision 6's kinds.** Rev 6 has `in-place` and `effect` kinds, an `Effect` production, `does()` binders
   and domain examples with effects (`applyFee`, `sendNotice`, the `Approver` example
   `does().every(approver)...`). R11 says the library is pure and withdraws `does()`. Proposal: R11 binds the
   **library** (JS lexicon); a **domain** function with effects keeps a sentence in app code only, or stays plain JS.
   Which?
2. **Where the grammar comes from.** Rev 6: a hand-kept `grammar.json` over parts of speech, catalog sentences as
   fixtures. Cloud: shapes **derived** from catalog sentences. Proposal (step 4): derive positions from the class-shape
   level once, then keep `grammar.json` as the source and the shapes as a check.
3. **Library match: winner or tie-break.** Rev 6 §5c lets the library score pick the role; goal 6 makes it a
   tie-break after behaviour. This plan follows goal 6.
4. **"Lexicon" names two things.** `pilot/lexicon/lexicon.mjs` is a statistical decoder; rev 6's lexicon is entry
   data. Proposal: rename the decoder `pilot/decoder/` when step 3 lands.
5. **Resume the full library run now or after steps 7-10?** Resuming now spends turns on the old 10-field contract
   and rule-text prompt; after, the results use the final contract.

Rev 6 open questions 1-3, 6, 8-21 stay open as written there.
