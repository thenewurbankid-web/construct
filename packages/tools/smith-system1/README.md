# Smith System 1: training data generator (#940)

Smith System 1 is a planned learned English<->JS translator (a CodeT5+ 220M fine-tune). It covers the code where
Smith's deterministic translation (System 2) returns nothing useful, such as React pages. It ships only if it
measurably beats Smith. See `docs/line/CARRYOVER-2026-10-13.md`, "Decisions".

This folder only generates the data. It does no training and calls no model.

```sh
node packages/tools/smith-system1/generate.mjs [--out DIR] [--no-smith] [--quiet]
node --test packages/tools/smith-system1/test/generate.test.mjs
```

The generator writes `train.jsonl`, `val.jsonl`, `test.jsonl`, `eval.jsonl` and `stats.json` to `--out`. The default
is `/tmp/construct-smith-system1`, outside the repo. `heavy.sh` prunes stale `/tmp/construct-*` folders. Two runs
produce byte-identical output.

## Pair format

Each line is one pair: `{id, source, direction, code, english, meta}`.

- `id` is a hash of the source, direction, normalized code and normalized English.
- `code` is JS: TypeScript types are removed and JSX is kept.
- `direction` is `js->en` or `en->js`, depending on which side was written first.
- `meta.split` is `train`, `val`, `test` or `eval`.

| source | what | direction |
| --- | --- | --- |
| `atoms` | Each atom's `english` plus its entry function (`packages/line-atoms`). | en->js |
| `typed-contracts` | Each `define<Layer>()` unit in `packages/core/typed-contracts/examples`. The English is generated from the factory call and the unit's leading comment. The deliberately non-compiling `*invalid*` files are skipped. | js->en |
| `probe` | The PCK-1 step text paired with the code of each sample that passed tsc and was useful (read-only from `bench/lending/results/context-probe-r1.json`). | en->js |
| `smith` | Smith's translation of each top-level function in the fixture and example roots (`SMITH_ROOTS` in `sources.mjs`), produced by `packages/summarize/links.mjs` `summarizeCode`. | js->en |
| `ledger` | The **eval set only**, in three slices (`meta.slice`, below). The generator throws if `CONTEXT-PROBE.md` stops showing L+tools and CL winning at 4/5 or better. | js->en |

Rules:

- **Empty Smith outputs are skipped and counted** in `smithEmpty`. There are three kinds:
  - `failed`: Smith is not linked, or it cannot read the code.
  - `blank`: fewer than 3 words remain once the placeholders are removed.
  - `placeholder`: after the title sentence, there is at least one `(...)` for every two meaningful words.
- **Dedupe** keeps one pair per normalized code (comments and whitespace removed). Sources win in this order: atoms,
  typed-contracts, probe, smith.
- **Splits** come from a hash of the normalized code: 80% train, 10% val, 10% test. The same code always lands in the
  same split, and adding pairs never moves an existing one.
- **Eval-leak guard.** A candidate is held out (counted in `leakHeldOut`) if it matches the eval set in any of these
  ways:
  - its code equals an eval code, or one of the files or functions that eval code was assembled from;
  - its English equals an eval fact;
  - its function name equals an eval function name. This catches, for example, the ecommerce starter's own
    `ListPage`.

  The tests assert that no train, val or test pair leaks.

## Eval set: 28 pairs

All eval pairs are JS -> English and have source `ledger`. None of them, and none of their function names, reach
train, val or test; the tests check this.

| slice | pairs | code | English |
| --- | --- | --- | --- |
| `ledger-probe` | 4 | The code a ledger fact cites: ListPage; the three library pages together; the PicksPage skeleton; BookPage. It comes from the lending starter or the probe's own prompts. | The fact, from the probe's winning L+tools and CL contexts. |
| `ledger-written` | 9 | For the 9 facts that cite no existing code (such as the empty RequestPage): target code written by hand from `bench/lending/SPEC.md`, the starter and its fixtures, kept in `eval-facts.json`. `acceptance/` was not read. | The fact, word for word. The generator throws if the file holds a fact the probe does not have. |
| `pages` | 15 | Pages and components that Smith left empty, kept in `eval-pages.json` with their code. They are picked deterministically by `pickPages` in `sources.mjs`: a capitalized name, JSX, at most 2,000 characters, one per folder per round, in sha256 order. | Written by hand in the style of the ledger facts. |

The tests check that every code in `eval-pages.json` still equals its source function. The 0.5 placeholder cutoff is
unchanged.

## One run (2026-10-13, atomic-codemod linked at 885b32e)

| source | candidates | eval-leak held out | duplicates | kept |
| --- | --- | --- | --- | --- |
| atoms | 14 | 0 | 0 | 14 |
| typed-contracts | 27 | 0 | 1 | 26 |
| probe | 10 | 0 | 8 | 2 |
| smith | 233 | 29 | 53 | 151 |

Smith saw 377 functions in 339 files:

- 233 translations were non-empty.
- 144 were empty: 144 `placeholder`, 0 `blank`, 0 `failed`.

After the leak guard, the kept pairs split into 155 train, 21 val and 17 test, for 193 in total. The eval set holds
28 more.
