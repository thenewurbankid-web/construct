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
| ambiguous places no input settles | 27 of 76 left as they were | the model picks the atom from the code around it; the check confirms |
| syntax with no rule (`untranslated`) | 25 corpus functions dropped; template literals (97 places) and optional calls have no atoms | the model writes the atom version of that part, or says there is none |
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
