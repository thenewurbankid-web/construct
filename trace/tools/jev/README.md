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

## Tokenizer (`jev_tokenizer.py`, shared by every jev script)

open-jev's own tokenizer is a stand-in (whitespace split + CRC32 hash into 4096 buckets). `jev_tokenizer.py` replaces it for serve.py, train_context.py and any new trainer (train_intent.py, ...): a code-aware pre-split (paths and dotted names, camelCase / acronyms, snake_case, digits, each punctuation mark; lower-cased) feeding a 4096-token BPE (HuggingFace `tokenizers`, Apache-2.0, offline) trained on this repo's tracked code and docs plus the bench logs in `data/runs/` (the held-out run `pilot-qwen-7b-r2` excluded). The vocabulary is `tokenizer.json`, committed, so ids are stable; rebuild it only on purpose.

```bash
tools/jev/.venv/bin/python -m pip install tokenizers                     # one-time, next to torch
tools/jev/.venv/bin/python tools/jev/jev_tokenizer.py "scoreContext in src/ai/provider.mjs"   # words, pieces, ids
tools/jev/.venv/bin/python tools/jev/jev_tokenizer.py --train            # rebuild tokenizer.json (new version)
```

In a script (`tools/jev` on `sys.path`): `from jev_tokenizer import new_model, save_weights, load_weights, get_tokenizer, version, CONFIG`. `new_model()` is a Jev with the shared config and this tokenizer; `save_weights(model, path, **meta)` stores the tokenizer version beside the weights; `load_weights(model, path)` refuses weights saved under another tokenizer version, or bare state_dicts from the old hash tokenizer, with a message naming both, since their token ids mean other words. `/health` reports the version.

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
- jev answers two typed `Choice` questions: `keep` (keep / drop; the line's score is P(keep)) and, per turn, `fact` ("which fact settles the next step?" over the turn's lines). Soft targets (0.9 / 0.1), open-jev's RLCD loss and serve.py's config, so `serve.py --weights weights/context-<run>.pt` loads them. The tokenizer splits paths and camelCase itself, so callers send line text as is (a caller that still normalises, like `hints.mjs` `norm`, only loses the punctuation tokens).
- Features use only what exists before the next action (the attempted step, its outcome, the model's output for it, the line); the next action is used only for the label.
- Weights (16 MB each) go to `weights/`, which is gitignored.
- Since #886, calls.jsonl keeps what the model was shown (`result.shown`, the fixes with why/effect/context) and every candidate context line with its static score (`result.context`), so fix steps and context lines are candidates from now on; runs before #886 keep only the summary fields.

## Testing and training the plan algorithm (#891, #892; jev intent in shadow, OFF by default)

Line's drafter reads every request into closed labels: an **intent** id from the catalog (`verb.object`,
packages/engine/line/drafter/contract.mjs buildIntentCatalog), its **object**, the target **slot** and the **layers**
it touches. The static rules (drafter/classify.mjs) decide. jev answers the same closed questions beside them
(drafter/classifyJev.mjs, through the `jev` provider), is logged, and is never used until it beats static on the eval.

### The loop (run from the repo root)

```bash
(cd trace && npm run jev)                                             # 0. once: jev on :8765 (random weights until trained)
node trace/tools/jev/ask.mjs "add a Button to the orders page"        # 1. ask: the plan as a Trace path, static vs jev
node trace/tools/jev/intent-label.mjs from-last --intent add.component --slot page:OrdersPage --layers ui   # 2. label it (or --yes)
node trace/tools/jev/eval-intent.mjs --seed 0                         # 3. eval: static vs jev -> reports/intent-eval.md
node trace/tools/jev/build-intent-data.mjs --seed 0 && packages/tools/dev/heavy.sh trace/tools/jev/.venv/bin/python trace/tools/jev/train_intent.py   # 4. train
(cd trace && tools/jev/.venv/bin/python tools/jev/serve.py --weights tools/jev/weights/intent.pt) # then
node trace/tools/jev/eval-intent.mjs --seed 0                         # 5. eval with the trained weights
```

Mission Control (`npm run mc`) shows the latest ask's path and the latest eval table in its **Plan / jev** panel.
`--no-jev` runs ask or eval static-only; `--jev-url` points at another jev. Keep the same `--seed` for build-intent-data
and eval-intent: it fixes which rows are held out.

**ask.mjs** runs the real drafter (`draft`: normalize, classify, enumerate, verify, rank) and prints:
the labels (static | jev with confidence | FORK), the recommended route with its plan steps, and the **Trace path**
of the target page: `page part -> dynamic? -> api | computed -> controller -> hook -> provider -> service -> contract`.
Each node shows its decision (per layer stub first: `existing stub (complete it) | existing fn (map/reuse) | create`),
the matched id in `[...]`, the static pick, jev's pick + confidence and FORK. A decision with no static logic yet reads
`undecided` (hook, provider, service today). `--json` emits the same structure (nodes use Trace's tree fields
`title, sub, state, layer, kind` plus `decision`, trace/tools/jev/tracePath.mjs). Every ask appends
`{request, labels, path, shadow, ...}` to `data/ask-log.jsonl` (gitignored).

**intent-label.mjs**: `add "<request>"` / `from-last` print static's guess and the request's slots, then save with
`--yes` (accept the guess) or with the labels you correct (`--intent`, `--slot kind:name|none`, `--layers a,b`,
`--uncertain "why"`); on a terminal with no flags it asks each label (Enter keeps static's guess). `edit <id>`,
`rm <id>`, `list [--intent x]` (count per intent, and intents with a template but no gold row).

### Report columns (eval-intent)

| column | meaning |
|---|---|
| intent / object / slot (exact) | share of gold rows where the predictor's value equals the gold value |
| layers (exact set) | the predicted layer set equals the gold set (static over-includes by design, so this is low) |
| layers (micro F1) | F1 over all (row, layer) pairs: the fair layer score for a recall-tuned predictor |
| static n / jev n | rows each predictor answered (jev 0 when it is not running) |
| all / held-out | every gold row / the rows the seeded split keeps out of training (judge jev on held-out) |
| Forks | rows where jev differs from static on a label or is under the gate (`JEV_MIN_CONFIDENCE`, 0.5) |
| a fork held the gold value | of the forked labels, how often gold was static's or jev's value (beam-rescue proxy) |
| beam rescues | forked labels where static was wrong and jev right (what a beam opening both would win) |
| Top confusions | most frequent `gold -> predicted` pairs per predictor (layers listed apart) |

### Gold labels (`data/intent-gold.jsonl`)

`{id, project, request, gold: {intent, object, slot, layers}, source: "hand"|"requester", uncertain?, from?}`.
`slot` is `"<slot kind>:<name>"` in the project's words (`page:OrdersPage`, `feature:orders`, `null` for none);
`layers` are the layers the change writes into. The gold block is never shown to the drafter, jev or a grader.
The starter set is 80 rows: 47 from the drafter corpus (`from: "drafter corpus <id>"`) and 33 by hand, covering every
intent that has a template (31) plus remove, rename, test and service; 11 are marked `uncertain`. A Requester (#894)
writes the same shape with `source: "requester"`.

### Fork records (for the beam, #893)

Each shadow record (`<project>/line/drafter/jev-shadow.jsonl`, written when the project's shadow switch is on) and
each ask carries `forks: [{label, static, jev, confidence, reason: "disagree"|"low-confidence"|"both"}]`; path
decisions carry `{decision: "path.<node>", node, static, jev, confidence, fork}`. A beam opens one run per distinct
value of a forked label and lets Construct's verification pick. The shadow log is slot form (`page:P1`, the
normalized request), like the drafter's other records.

### Switches

- **Shadow** (log only): the project's `line/ai-profiles.json` `{"v":1,"steps":{"construct.intent":{"shadow":true}}}`
  or `LINE_JEV_SHADOW=1`. Then `draft()` asks jev in the background (4 s timeout) and logs; nothing else changes.
  `"gate": 0.6` there overrides the fork gate. Off by default: no network call, nothing written.
- **Use jev's labels**: step `construct.intent` in packages/core/ai-profiles.json ships `on: false, measured: null`.
  Once eval-intent shows jev beating static on held-out rows, set `ladder.options.on: true` and write the measurement
  in `ladder.measured` (date, gold size, held-out static vs jev per label); a project can then switch it per project
  (`steps["construct.intent"].on`). Both are required (stepOnFor). Today only async callers use jev's labels
  (`pickLabels` in drafter/shadow.mjs, used by ask.mjs); `draft()` is synchronous, so wiring the switch into Cockpit's
  drafting call is the step after the win.

### Where the plan path's other closed choices are decided (#895)

| choice | static decision today | jev shadow |
|---|---|---|
| intent / object / slot / layers | drafter/classify.mjs `classify` | drafter/index.mjs `draft` -> `runIntentShadow` (shadow.mjs), and ask.mjs |
| dynamic? (part has data or an action) | pageBinding.mjs `readPageBinding` (PartData.kind, interactions) | tracePath.mjs `shadowPath` (ask.mjs only) |
| api vs computed | bound endpoint / interaction resolution / recommended typed fix (pageBinding.mjs `fixesFor`) | tracePath.mjs `shadowPath` |
| which home for an unresolved action | typed fixes, rank 1 recommended (pageBinding.mjs `fixesFor`) | tracePath.mjs `shadowPath` (`path.home`) |
| controller: stub / fn / create | interaction handler none / stub / function (Trace interactions.mjs `handlerStub`) | tracePath.mjs `shadowPath` |
| contract: map / create | the endpoint is in the page's API contract | tracePath.mjs `shadowPath` |
| hook, provider, service: stub / fn / create | none anywhere (shown `undecided`) | jev asked, logged against `undecided` |
| which candidate field (Trace matcher) | trace/src/match.mjs `cheapest` + ask.mjs `orderByNameEvidence` | no shadow hook added: jev can already answer it as the `choose` task (`--ai-task choose=jev:open-jev`, trace/src/ask.mjs `resolveQuestions` -> `ai(q)`), but nothing logs it beside static yet |

## NLP arms: candidate readings for the beam (#903, part of #900; static default, every other arm in shadow, OFF)

The beam opens one run per plausible **reading** of a request: a closed tuple `{intent, object, target, layers}` plus
confidence (`Reading`, trace/src/beam/contract.mjs; a list of them is the top-k form of `classify()`).
trace/src/beam/arms.mjs `readCandidates(ctx)` asks every arm for a small, recall-first set (k = 4):

| arm | what it reads | step (packages/core/ai-profiles.json) |
|---|---|---|
| static | drafter `classify()` -> `toReadings` (its intent + alternatives) | always on (the default) |
| lr / nb | scikit-learn logistic regression / naive Bayes over the normalized request (slot tokens + slot shapes, never names); a pairwise ranker picks the target slot | `construct.intent-lr` / `-nb` |
| spacy | en_core_web_sm dependency parse; an EntityRuler built from the domain map (`buildDomainMap`) merges each project name into one token first; the root verb, then its object, then the rest are fed to `classify()`; a `to / on / in / into / for` object picks the target | `construct.intent-spacy` |
| jev | open-jev's full distribution per closed question (`/choose` probabilities), its epistemic confidence as the gate | `construct.intent` |
| nli | zero-shot entailment, one hypothesis per closed option (verb, object, slot, layers multi-label), MoritzLaurer/xtremedistil-l6-h256-zeroshot-v1.1-all-33 (MIT, 13M params, 25 MB) | `construct.intent-nli` |

Every Python arm runs in the jev sidecar (`serve.py`): the same `POST /choose`, with `"arm": "lr"|"nb"|"spacy"|"nli"`
(arms.py; no `arm` = open-jev). `GET /health` lists which arms have their model. Dependencies:
`requirements-arms.txt` (permissive licenses, pinned), `python -m spacy download en_core_web_sm`, `fetch_arms_models.py`.

- **Default unchanged**: the readings the beam opens are static's plus those of arms whose step is ON (profile on AND a
  measured win, `stepOnFor`). Every arm step ships `on: false, measured: null`.
- **Forks, never guesses**: a label where the arms' best readings disagree, or an arm under the gate (0.5; jev: its
  epistemic confidence), is a fork `{label, values: {arm: value}, reason, low}`. `forks` covers the active arms,
  `shadowForks` every arm that answered.
- **Shadow log**: a project's `line/ai-profiles.json` `{"v":1,"steps":{"construct.intent-lr":{"shadow":true}}}` (per arm)
  or `LINE_ARMS_SHADOW=1` (all) / `=lr,nli`: `draft()` reads the request with those arms in the background and appends
  `{v, at, decision: "readings", request, static, arms: {arm: {readings, confidence}|null}, forks, gate, used}` to
  `<state>/drafter/arms-shadow.jsonl` (slot form; the nli arm sees the names, the log never does). Off: no import, no call.

```bash
node trace/tools/jev/build-arms-data.mjs --seed 0                                         # gold -> data/arms-train.jsonl
packages/tools/dev/heavy.sh trace/tools/jev/.venv/bin/python trace/tools/jev/train_arms.py # train split only -> weights/arms-sklearn.joblib
(cd trace && tools/jev/.venv/bin/python tools/jev/serve.py)                              # jev + the arms on :8765
node trace/tools/jev/eval-intent.mjs --seed 0                                             # + "Beam arms" tables (--arms static,lr,... | --no-arms)
trace/tools/jev/.venv/bin/python -m pytest trace/tools/jev/test_arms.py; node --test trace/src/beam/arms.test.mjs
```

eval-intent's **Beam arms** tables: per arm, the labels of its best reading (as above) and **gold among candidates**:
the share of rows where one of its readings has the gold intent, the gold intent and slot, and the full gold tuple
(layers as a superset); `union (all arms)` is the same over every arm's readings (what a beam opening all of them could
reach). An arm earns its switch only by beating static on held-out rows.
