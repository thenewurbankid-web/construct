# English-loop chain: quick kill-tests, run 1 (2026-10-13, #942)

Run command (Smith linked from the clones):

```sh
ATOMIC_CODEMOD_SOURCE_DIR=~/Repositories/atomic-codemod SMITH_SOURCE_DIR=~/Repositories/smith \
  packages/tools/dev/heavy.sh node bench/isolation/chain/quick/run.mjs k3 k4 k1 k2 k5
node --test bench/isolation/chain/quick/test/quick.test.mjs   # deterministic parts, no model
```

Models: qwen2.5-coder:1.5b (Ollama `format`, closed JSON schema) and nomic-embed-text. Each test ran once, with a small N.

| test | result | bar | verdict | evidence |
| --- | --- | --- | --- | --- |
| K3: Trace step choice (8 decisions) | 38% right (3/8). Step 38%, target 75%. A deterministic `decide()` gets 8/8. | >= 60% | kill | `results/k3.json:6` |
| K4: sentence to atom (8) | top-1 88%, top-3 100%. 0 exact hits. | top-1 >= 50% | pass | `results/k4.json:7` |
| K1: Smith as checker (4 tasks x 2 mutants) | 4/4 reference solutions match their plan exactly, and 8/8 mutants score lower. | no mutant ties the reference | pass | `results/k1.json:9` |
| K2: the 1.5b writes the plan (4 x 5, T 0.7) | 0% match, 0/20 full matches | >= 50% | kill | `results/k2.json:6` |
| K5: availability end to end (5 runs) | 0/5 pass. 3/5 passed tsc and 2/5 passed the unit check, but Smith read every passing body as "It returns (...)". | > 0/5 | kill | `results/k5.json:5` |

Findings:

- **K3.** The model follows rules 1 and 2: it completes an open stub or reuses a finished function. It answers `reuse` for every case in rules 3 to 5: add_to_scope, create and create_module (`results/k3.json:177`, `:214`, `:253`). This decision is a fixed rule order over facts that moduleScope and stubProblems already compute, so it should be deterministic code, not a model role.
- **K4.** Embeddings work for the gap-to-atom step. The one miss was filter-sort ranked below date-range. The scores do not separate right from wrong: the lowest right top-1 score is 0.68 and the highest wrong one is 0.68. So top-3 plus a check is the safe use; a single cosine threshold is not.
- **K1.** Smith works as a checker on code written in its templates. A cosine fallback is unsafe for checking, though: a mutant's step scores up to 0.996 cosine against the plan line it breaks.
- **K2 and K5.** The 1.5b writes plan lines in JS rather than in Smith's templates: ternaries, `listPicks(picks)`, `a.title.localeCompare` (`results/k2.json:47`). The coder then writes `available ? ... : ...`. Smith cannot render a ternary and returns `(...)` (`results/k5.json:29`). The plan language and the code the model writes do not meet.
