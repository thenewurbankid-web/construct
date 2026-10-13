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
| `ledger` | The **eval set only**. It holds the hand-written ledger facts from the probe's winning contexts (L+tools and CL). The generator throws if `CONTEXT-PROBE.md` stops showing them winning at 4/5 or better. Each fact is paired with the code its citation names. | js->en |

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

## One run (2026-10-13, atomic-codemod linked at 885b32e)

| source | candidates | eval-leak held out | duplicates | kept |
| --- | --- | --- | --- | --- |
| atoms | 14 | 0 | 0 | 14 |
| typed-contracts | 27 | 0 | 1 | 26 |
| probe | 10 | 0 | 8 | 2 |
| smith | 233 | 13 | 56 | 164 |

Smith saw 377 functions in 339 files:

- 233 translations were non-empty.
- 144 were empty: 144 `placeholder`, 0 `blank`, 0 `failed`.

The kept pairs split into 166 train, 22 val and 18 test, for 206 in total.

The eval set has 4 pairs: ListPage; the three library pages together; the PicksPage skeleton; and BookPage. Of the 13
ledger facts, 9 cite no code that exists, such as the empty RequestPage. Those 9 are counted, not paired, but their
English still feeds the leak guard.
