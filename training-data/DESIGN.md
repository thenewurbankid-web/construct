# Training data for the English → atoms LoRA

Status: design, 2026-10-14. Nothing here is built yet except the pieces named under
"What already exists". `pairs.jsonl` in this folder is unrelated (shape-similarity pairs
for an embedding model).

## What the model learns

Input: an English description of one function, plus its signature.
Output: the function body written only with Smith atoms (`when`, `equals`, `mapEach` …)
and the syntax the transform keeps (`return`, `const`, arrows, `await`).

The output is never raw JavaScript operators or built-in calls. Lowering atoms to
JavaScript is the runtime's job and is exact, so the model only has to get the atom
program right.

## One record

```json
{
  "id": "sha1 of english + program",
  "english": "next using state: return if state equals 'cart' then 'paying', otherwise 'done'.",
  "signature": "function next(state: CheckoutState): CheckoutState",
  "program": "return when(equals(state, 'cart'), () => 'paying', () => 'done');",
  "atoms": ["equals", "when"],
  "source": "corpus | synthetic | per-atom",
  "englishKind": "mechanical | paraphrase | intent",
  "check": { "status": "same", "runs": 40, "exercised": 31 },
  "runtime": "414cdbd"
}
```

`check` is the result of `bench/atoms/equivalence.js`. `runtime` is the Smith commit the
program was checked against, so records can be re-checked or dropped when atoms change.

## Where the programs come from

Every program must have passed the equivalence check against real JavaScript. That is
the one rule: no program enters the set on a model's say-so.

| Source | How | Yield today | Target |
|---|---|---|---|
| Corpus | Real TypeScript functions through `bench/atoms/checked.js` | 141 functions with a conversion, from one repository | 20–50k functions from open-source TypeScript |
| Synthetic | Sample typed compositions of atoms from the catalog, lower to JavaScript, check both ways | 0 (generator not written) | 20k, weighted toward atoms the corpus rarely uses |
| Per-atom | One or more records per catalog entry from its `reads` line and `js` form | 333 atoms available | about 1,000 (3 per atom) |

Corpus rules:

- Keep a function only when the check says `same` and at least half the runs were
  exercised (the original returned rather than threw). A function that throws on every
  input is weak evidence.
- Keep partial conversions out of the first version: a record's program must have no
  `untranslated` entries other than syntax the atoms do not cover by design
  (template literals, loops with `break`). Today that removes most of the corpus, which
  is the main reason more source code is needed.
- No JSX functions until there is an atom story for JSX.

Synthetic programs exist to cover the catalog evenly. Corpus code uses about 80 of the
333 atoms; a model trained only on it will not know the rest exist.

## Where the English comes from

Three kinds, mixed in every batch:

1. **Mechanical** — `toEnglish(originalJs)`. Deterministic and already works on plain
   JavaScript (it reads atom calls badly, so it is run on the original, not the
   program). Cheap, exact, but one fixed phrasing per program.
2. **Paraphrase** — a large model rewrites the mechanical sentence in 3–5 other
   wordings without changing meaning. Checked by round trip: a second pass must map the
   paraphrase back to the same mechanical sentence's program, or the paraphrase is
   dropped.
3. **Intent** — a large model writes what a person would actually ask for, given the
   function name, signature and mechanical sentence ("work out which checkout step comes
   next"). This is the kind real users type and the kind the LoRA most needs. It cannot
   be checked mechanically, so a sample of 200 is read by a person before the batch is
   accepted, and the batch is dropped if more than 5% are wrong.

Suggested mix: 20% mechanical, 40% paraphrase, 40% intent.

## Splits

Split by **source repository and by function**, never by record. All phrasings of one
function go to the same side, or the test set only measures memory of the program.

- train 90%, validation 5%, test 5%
- a separate held-out test set of functions from repositories that contributed nothing
  to training
- a held-out atom set: 20 atoms that appear in training only through their per-atom
  records, to measure whether the model can use an atom it has barely seen

## How the trained model is scored

Not by text match. For each test record, generate a program, then:

1. Does it parse and use only catalog atoms? (constrained decoding should make this 100%)
2. Does it pass the equivalence check against the reference JavaScript?

Report pass rate at 1 sample and at 5 samples. The 5-sample number matters because the
checked converter can already "try several and keep the one that works": the same loop
applies to model output whenever a reference or tests exist.

## What already exists

- `atoms-transform.js` — JavaScript → atoms, deterministic.
- `bench/atoms/equivalence.js` — runs both versions in QuickJS and compares them.
- `bench/atoms/checked.js` — converts, takes back rewrites that change behaviour, and
  resolves ambiguous places by trying each atom.
- `to-english.js` — mechanical English for plain JavaScript.
- `bench/results/atoms-checked.json` — 207 corpus functions, 141 with a conversion.

## What has to be built, in order

1. A dataset builder: corpus → checked program → mechanical English → one JSONL file.
   Small; everything it calls exists.
2. A way to pull in more TypeScript (the corpus loader reads one hard-coded repository).
3. The synthetic program generator.
4. The paraphrase and intent passes, with the round-trip check and the sampling review.
5. The scorer.

## Open questions

- **Granularity.** One function per record, or also single statements and expressions?
  Smaller units give far more records and suit a small model; whole functions match how
  it will be used.
- **Free names.** Real functions call things defined elsewhere. Does the input list the
  helpers available, or does the model only write self-contained functions at first?
- **Base model and context size.** These set how long a signature plus description can
  be and whether the atom list can be in the prompt.
- **Template literals.** 97 places in the corpus have no atom. Either the atoms grow a
  `text` template form or the model is allowed to emit template literals.
