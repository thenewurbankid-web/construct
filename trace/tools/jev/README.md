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
