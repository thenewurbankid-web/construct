# open-jev as a line-matcher provider

[open-jev](https://github.com/kyegomez/open-jev) is an open PyTorch reconstruction of a "system one" decision model: state goes in, typed answers come out of a single forward pass (no text generation). Its `Choice` head can only return one of the options you declare, which matches the shape of line-matcher's questions.

**It ships with random weights.** It is an architecture, not a trained model, so its answers are noise until it is trained. With the fixed seed the answers are deterministic but meaningless, and its epistemic confidence is near zero. On line-matcher's 21 gold questions it scores about chance (33% against ~27% for random guessing).

```bash
# one-time (already done in this checkout): a venv, torch, and a clone of open-jev in tools/jev/
python3 -m venv tools/jev/.venv && tools/jev/.venv/bin/pip install torch
git clone --depth 1 https://github.com/kyegomez/open-jev tools/jev/open-jev

npm run jev                      # serves http://127.0.0.1:8765
node src/cli.mjs examples/roster --auto --ai --ai-task choose=jev:open-jev --out /tmp/out
npm run bench -- --models ollama:qwen2.5vl:latest,jev:open-jev --repeat 3 --detail
```

In the provider (`src/ai/provider.mjs`, `jev`), each question becomes two typed `Choice` questions over one shared state: which option, and which fact settles it. The model's epistemic confidence gates the answer: below `JEV_MIN_CONFIDENCE` (default 0.5) it answers "no fact settles it", so the question falls through to a person, which is what the model's design intends. `jev` serves the `choose` task only; `pick-fields` and `draft-body` need a text model.

Trained weights: `python tools/jev/serve.py --weights your.pt`.

## Context-line scorer for Line's bench builder (#881, shadow, OFF by default)

Line's bench builder shows a small model everything Line returned since its last action. A scorer ranks each context line 0-1 and the builder keeps the top lines under an adaptive cap (5, or 15 once the same refusal repeats). The static scorer (`packages/engine/line/contextScore.mjs`, re-exported here as `contextScore.mjs`; Line ranks every refusal's context lines with it, #886; rules: fix steps > paths/exports in a refusal > status > lists > fields, plus lexical overlap with the attempted step) is the default. jev is trained for the same job but stays off: an AI step ships only with a measured win over static code, and it has none yet (held-out pilot-qwen-7b-r2: static P@5 0.265 / R@5 0.824, jev 0.253 / 0.765).

```bash
node tools/jev/build-context-lines.mjs        # data/runs/<run>/{calls,turns}.jsonl -> data/context-lines.jsonl (+ label counts per run)
node --test tools/jev/contextScore.test.mjs
node tools/jev/eval-context.mjs --runs pilot-qwen-7b-r2                       # static
../packages/tools/dev/heavy.sh tools/jev/.venv/bin/python tools/jev/train_context.py --holdout pilot-qwen-7b-r2   # or --loro
node tools/jev/eval-context.mjs --runs pilot-qwen-7b-r2 --scores tools/jev/weights/scores-pilot-qwen-7b-r2.jsonl  # jev
```

- Labels are automatic: a line is USEFUL when the next action carried one of its key tokens (path, export, route, tool, fix ref, code) and was accepted; NOISE when the next action ignored it and was refused; otherwise unclear (kept in the file, not trained on). Exact repeats (refusal loops) collapse into one row with a `weight`.
- jev answers two typed `Choice` questions: `keep` (keep / drop; the line's score is P(keep)) and, per turn, `fact` ("which fact settles the next step?" over the turn's lines). Soft targets (0.9 / 0.1), open-jev's RLCD loss and serve.py's config, so `serve.py --weights weights/context-<run>.pt` loads them. Line text is normalised (paths and camelCase split into words) before the hash tokenizer sees it; a caller must do the same.
- Features use only what exists before the next action (the attempted step, its outcome, the model's output for it, the line); the next action is used only for the label.
- Weights (16 MB each) go to `weights/`, which is gitignored.
- Since #886, calls.jsonl keeps what the model was shown (`result.shown`, the fixes with why/effect/context) and every candidate context line with its static score (`result.context`), so fix steps and context lines are candidates from now on; runs before #886 keep only the summary fields.
