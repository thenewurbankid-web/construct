# Construct dataset bundle

Made by Construct fixture with `construct traces export`. Dataset hash (sha256 of dataset.jsonl): `55d26b82295fb64512b37b217a2d0f620e48e2e2f025a0067c20b2e315cb5bd6`.

120 decision records (96 train, 11 validation, 13 test) from 2026-09-01T09:00:00.000Z to 2026-09-01T10:59:00.000Z, 0 dropped on re-validation.

## What it is

Each line of `dataset.jsonl` is one closed choice a person (or a model) made in a Construct chain: `{ "split", "trace" }`, where the trace is a
`decision-trace.v1` record (`schema.json`): the question as it was offered with its option ids, the option chosen, who chose, what a rules
provider suggested, and what happened afterwards. `manifest.json` has the counts, the sha256 of every file and the split rule
(80/10/10 by a hash of the record id, so a record never changes side).

## Privacy

Every record was checked again before it was written: a record holding an absolute path, a `~/`, `./` or `../` path or a secret-shaped
string was dropped, not repaired. The project is named only by a hash. No source file, no path and no credential is in this bundle. It still
describes what the project's people asked for, so treat it like the project: move it only over a channel you trust, encrypted (see
train-kit/README.md, "Transport").

## How to train

Copy this folder to the training machine and run the kit there (it needs Python 3 and nothing else):

    train-kit/train.sh <this folder> <output folder>

It writes a model bundle (`features.json`, `eval-report.json`, `MODEL_CARD.md`, `checksums.txt`, `manifest.json`). Copy that folder back and run
`construct model import <folder>` in the project. The import verifies it against the dataset hash above, replays the held-out test records
against the rules baseline and registers the model DISABLED. See docs/TRAIN-ELSEWHERE.md.
