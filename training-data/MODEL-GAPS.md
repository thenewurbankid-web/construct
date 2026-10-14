# Plan: a small model fills the gaps, not more rules

Status: plan only, nothing built. Written 2026-10-14.

## Why

Every failure so far was fixed with another guard in the transform or the catalog:
`sortedBy` only for an inline function whose length is not 1 (`compareOnly`), `replaceFirst`
only for text or a RegExp literal without g (`nonGlobalOnly`), kinds for `+` and `slice`,
mutating methods only on fresh receivers. Each guard is right, but they keep adding up and
each one covers a single case. From here on, a case the rules do not cover goes to a small
model, and the check decides whether its answer stays.

## What stays deterministic

- **The catalog** (Smith, `catalog.json`): what each atom is and the JS it replaces.
- **The transform's core** (`atoms-transform.js`, rules 1 to 10): forms matched to atoms,
  if/else to `when`, switch to `match`, try to `attempt`. Cheap, exact, and already tested.
- **The checks**: original vs converted on generated inputs (`equivalence.js`), and each
  atom form run on its own (`diagnose.js` `alone`). These are what make a model's answer safe
  to keep. A model never decides whether its own output is right.

## Freeze

No new special-case guards in `atoms-transform.js` or `atoms-catalog.js`. A new failure is
written down as a case for the model instead. The existing guards stay until step 4 below
shows they can go.

## Where the model fills in

| gap | today | with the model |
|---|---|---|
| ambiguous places no input settles | 11 of 76 left as they were (27 before the checker's types) | the model picks the atom from the code around it; the check confirms |
| syntax with no rule (`untranslated`) | 18 corpus functions dropped (25 before); template literals (97 places) and optional calls have no atoms | the model writes the atom version of that part, or says there is none |
| English for a program | one fixed `toEnglish` sentence | paraphrase and intent passes (`DESIGN.md`, step 4) |

The contract is the same for each gap: the model proposes, the checks run, and a proposal
that fails is dropped and the original is kept. A record made with the model's help says so
(for example `filledBy: "model"`), so it can be counted and sampled apart.

## Open questions

1. **Which model.** It could be the English-to-atoms LoRA itself (it writes atom programs
   already, so writing them from JS is close to the same task), or a separate small local model
   used only for gap filling. Reusing the LoRA has a catch: it would be trained on records that
   the model helped make.
2. **Pick or write.** For ambiguous places it only picks from listed alternatives (easy to
   check). For untranslated syntax it writes new code (harder, and the place can be one the
   inputs never reach).
3. **Context size.** The model can get just the place, the function, or the function plus its
   file's types.

## Steps

1. Record every gap with its context: the unresolved ambiguous places and the untranslated
   parts from the dataset and checked runs, as a JSONL of cases. No model yet.
2. Try one small local model on the ambiguous places only (picking, the easy case) and report
   how many pass the check.
3. Then the untranslated parts.
4. For each existing guard, turn it off, let the check and the model handle that case, and
   remove the guard if the results are no worse.

## Result: picking atoms (2026-10-14)

`node bench/atoms/model-eval.js --model <m>`: 98 cases with known answers, taken from the
places the check settled (49 where an atom is right, and the same 49 with that atom removed,
so "neither" is right). Each is asked in both option orders and counts only when both agree:
the check settles ties in catalog order, so the right atom is listed first in 47 of 49, and
the 1.5B took the first option in 93 of 98 answers.

| model / arm | right picks (of 49) | right "neither" (of 49) | wrong atom (of 98) |
|---|---|---|---|
| qwen2.5-coder 1.5B, free | 16 | 0 | 52 |
| 1.5B, constrained | 6 | 2 | 53 |
| 1.5B, checker types | 21 | 5 | 58 |
| qwen2.5-coder 7B, free | 23 | 38 | 18 |
| 7B, constrained | 27 | 42 | 10 |
| 7B, checker types | 31 | 37 | 20 |

Rerun after the checker's types settled 16 more places (65 picks, 130 cases; the committed
`bench/results/model-eval-*.json` are this run): 1.5B wrong atom 74 / 70 / 76, 7B 20 / 11 / 22
(free / constrained / checker). Same picture.

The 1.5B cannot refuse: given one wrong option it takes it. The 7B is wrong about one time
in ten. At places no input reaches, the check cannot catch either, so picking stays out of the
model's job. Done next: the checker's types fed to input generation reached 16 of the 27 places, and
try-each settled them by running. Of the 11 left, 2 receive two kinds of value (no single
atom is right) and 9 are still not reached.

## Result: filling untranslated parts (2026-10-14)

`node bench/atoms/model-fill.js --model <m>`: the 18 corpus functions the dataset drops as
`untranslated`. The model rewrites the whole function; it is kept only when it parses (same
kind, same parameters), calls only atoms or the original's names, leaves fewer gaps, behaves
the same as the original with the checker's types, and every atom call it wrote runs with a
real value of the atom's kind (counted apart: `plus as plus__new`, `checkPair({ countLocals })`).
Tests: `atoms-model-fill.test.js` (canned answers, no Ollama).

| model | accepted | rejected at: parses | names | fewer gaps | same | reached |
|---|---|---|---|---|---|---|
| qwen2.5-coder 1.5B | 1 of 18 | 0 | 1 | 16 | 0 | 0 |
| qwen2.5-coder 7B | 3 of 18 | 1 | 0 | 6 | 4 | 4 |

The 1.5B hands the code back almost unchanged (16 of 18). The 7B writes real rewrites; the
checks turned down 8 of them (4 behave differently, 4 put atoms where no input goes) and kept
3 (`send` in async-status, `applyView` with sortedBy for a mutating sort, `toXStateConfig`
with each). Nothing is added to the dataset yet.

## Result: filling, after the four new atoms (2026-10-14, runtime 939c25c)

typeOf, isFunction, isObjectType and hasProperty closed every `typeof` and `in` gap with no
model: 18 untranslated functions became 13. The harness then got a shortlist by the
catalog's own form shapes, a NO ATOM answer (counted as declined, the function stays as it
was), every gap labelled by kind, the prompt in `bench/atoms/model-fill-prompt.txt`
(editable, `--prompt` for another), rest parameters shown as `...items`, and a report per run
(`bench/results/model-fill-<model>.md`, every case not accepted with prompt and answer).

| model | accepted | declined | rejected |
|---|---|---|---|
| 1.5B | 0 of 13 | 10 | 3 |
| 7B | 2 of 13 | 1 | 10 (6 behave differently, 4 put atoms where no input goes) |

Why: every gap left has an atom of its shape, but almost none can simply take its place.
7 functions are mutations (`.push`, `.sort`, `delete`, `Object.assign`, `.test`): the atom
returns a copy, so the data flow has to change (`issues = pushedList(issues, x)`). 6 are the
ambiguous places, and the 4 no input reaches cannot pass "reached". 2 are control flow. The 7B
got both reachable ambiguous ones. A static rebinding rule (local, fresh, unshared values) or
a repair loop with the check's evidence as feedback (construct.repair exists) are the two
candidates; the owner's direction is the model.
