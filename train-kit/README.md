# train-kit

The training side of Construct's "train elsewhere" loop (#647). It runs on a **different machine** from the one you develop on, reads
a dataset bundle that `construct traces export --yes` wrote, and writes a model bundle that `construct model import` verifies. This
folder is **not part of any published package** and depends on nothing from Construct: copy it out on its own.

- Python 3 (standard library only: no numpy, no scikit-learn, no network access).
- `bash` (macOS 3.2 is fine), `nice`, optionally `timeout`/`gtimeout`.

## Use

```
./train.sh <dataset-bundle> <model-out>                       # train once
./train.sh --watch <inbox> <outbox> [--once] [--interval 30]  # loop: train every NEW dataset hash found in <inbox>
python3 -m unittest                                           # the kit's own test (determinism against the golden model)
```

`<dataset-bundle>` is a folder with `manifest.json` and `dataset.jsonl`. The kit checks `dataset.jsonl` against the hash in the
manifest before it trains, so a half-copied or altered folder is refused (exit 2) or, in the loop, skipped until it is complete.

**Output** (`<model-out>`, or `<outbox>/model-<hash12>/`, written to a temporary folder and renamed, so a reader never sees half a
bundle): `features.json` (weights, plain JSON), `eval-report.json` (accuracy per chooser against the rules baseline on the validation
and test splits, coverage, peak memory), `MODEL_CARD.md` (data hash, base model none, licence note, limits), `manifest.json`,
`checksums.txt`. Copy the folder back to the dev machine and run `construct model import <folder>`.

## What it trains

One multinomial logistic regression (softmax) per closed question, on the **train** split only, by seeded stochastic gradient
descent (`train.config.json`: seed, epochs, learning rate, L2, minimum score, minimum examples per question). The features
(`features.v1`) come from the question as it was offered: the enabled option ids, the quoted word and its ending, the words of the
rest of the question. `train_features.py` repeats `packages/core/decision-features.mjs` exactly, and the tests on both sides prove
they agree on the fixture. It abstains on a question it saw fewer than `min_train_per_route` times.

It is deterministic: the same dataset and config give the same `features.json` (weights rounded to 6 decimals; the golden test
compares within 1e-5 across platforms, because `exp` may differ in the last bit between C libraries).

## Prototypes (the local embedding classifier, #645)

`build_prototypes.py` (or `TRAIN_KIND=prototypes ./train.sh`) writes a `prototypes.json` bundle instead: for each closed question the
words people chose each option for on the TRAIN split (the most frequent `max_per_class`, default 30), after the curated
`--seed` words, with the same guards, the same eval report (against the rules baseline) and the same bundle layout. Nothing is
learned by gradient descent and the embedding (`embed.v1`, hashed character n-grams) is a fixed function that
`packages/core/decision-prototypes.mjs` computes identically, so no model file is needed. Standard library only. See
`docs/TRAIN-ELSEWHERE.md`, section 3b. Its test: `python3 -m unittest` runs `test_build_prototypes.py` too.

## Guards (environment variables)

| variable | default | what |
| --- | --- | --- |
| `TRAIN_MIN_FREE_GB` | `8` | do not start below this much free memory (`MemAvailable` on Linux, `vm_stat` free+inactive+speculative on macOS; unreadable counts as too little). One-shot: exit 75. The loop waits and tries again. `0` turns it off (tests). |
| `TRAIN_TIME_LIMIT` | `1800` | hard limit in seconds; the trainer stops itself (exit 124) and `timeout` is a second net when present |
| `TRAIN_NICE` | `19` | the job runs at the lowest priority |
| `TRAIN_REQUIRE_AC` | `0` | `1` (macOS): do not start on battery power |
| `TRAIN_INTERVAL` | `30` | seconds between polls of the loop |
| `TRAIN_CONFIG` | `train.config.json` | the training config (`prototypes.config.json` for `TRAIN_KIND=prototypes`) |
| `TRAIN_KIND` | `features` | `features`: the logistic regression (`train_features.py`); `prototypes`: the prototype set of the local embedding classifier (`build_prototypes.py`, #645; no training run, see "Prototypes" below) |
| `TRAIN_SEED` | none | a curated prototype file merged first (`TRAIN_KIND=prototypes` only) |
| `TRAIN_CREATED_AT` | now | fix the manifest time for a reproducible bundle |
| `TRAIN_PYTHON` | `python3` | the interpreter |

The loop writes `<outbox>/heartbeat.json` (`{ time, state: idle|training|waiting|stopped, dataset, lastTrained, pid }`) so you can see
when it last ran and what it is doing. A dataset that failed (not for memory) is marked `.failed-<hash12>` in the outbox and skipped
until you delete the marker. A hash already trained is never trained again.

## The MacBook as a service (launchd)

`com.line.train.plist` is a template (RunAtLoad, KeepAlive, `Nice 19`, background process type, log files, `caffeinate -i`, no
secrets, no ports). Nothing installs it for you:

```
mkdir -p ~/line-train/inbox ~/line-train/outbox ~/line-train/logs
cp -R train-kit ~/line-train/                         # and edit /Users/YOU in the plist
cp ~/line-train/train-kit/com.line.train.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.line.train.plist
launchctl kickstart -k gui/$(id -u)/com.line.train    # start now
launchctl bootout gui/$(id -u)/com.line.train         # stop and unload
```

Before you put project data on a laptop: check that its policy allows project data, a 24/7 background job and a private network
tool (a managed work machine may not).

## Transport and encryption

The machine PULLS: nothing connects into it and the kit opens no connection. Get bundles into `inbox/<name>/` and take
`outbox/model-<hash12>/` back by any private channel you trust: a private folder over Tailscale (WireGuard), a private GitHub
release asset, `scp`/`rsync`. Traces come from real projects, so encrypt them in transit and at rest, for example with
[age](https://github.com/FiloSottile/age):

```
tar -C bundle -cf - . | age -r <the Mac's public key> > dataset.tar.age             # on the dev machine
mkdir -p inbox/from-dev && age -d -i ~/.age/key.txt dataset.tar.age | tar -x -C inbox/from-dev   # on the Mac
```

Decrypting inside the kit is a TODO. Delete the dataset when the model is back.

## Apple Silicon: documented TODO, not implemented

The default mode above is CPU, pure Python and needs no GPU. Left for later slices, in order:

1. **A neural embedding plus a small classification head** (a 22M-parameter encoder, well under 4 GB on the M5 Pro). The
   prototype classifier of #645 ships without one (`build_prototypes.py`, character n-grams, standard library only). This would
   need `torch` with the MPS backend, or MLX, in a pinned environment file, and would write `prototypes.json` with another
   `embedder.version` and a `model.onnx`; `construct model import` verifies and stores an `.onnx` but has no loader for it.
2. **LoRA fine-tune of a 3B-or-smaller permissively licensed model through MLX** (4-bit), with the memory guard keeping 8 GB free
   (about 16 GB usable of 24 GB), lowering the batch size before failing, and recording peak memory in `eval-report.json`.
3. A Linux GPU mode for anything larger. No CUDA is assumed anywhere.

## Files

`train.sh` (entry point, guards, loop), `train_features.py` (the trainer, standard library), `train.config.json`,
`build_prototypes.py` and `prototypes.config.json` (the prototype builder, #645) with `test_build_prototypes.py`, `fixtures/golden-prototypes/` (its golden bundle),
`com.line.train.plist`, `test_train_features.py` (the kit's own test), `fixtures/dataset/` (a synthetic 120-record dataset bundle
made by Construct's own exporter), `fixtures/golden/` (the model bundle a first run produced; the golden `features.json` is what
the test compares with).
