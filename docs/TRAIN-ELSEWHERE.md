# Train elsewhere: the decision model is trained on another machine and comes back as verified data (#647, part of epic #616)

The dev machine only RECORDS decisions (`docs/DECISION-TRACES.md`) and RUNS a finished model (`docs/DECISION-PROVIDERS.md`). It never
trains one. Training happens on a different machine, on a dataset you export on request, and the result comes back as a folder of
plain data that Construct verifies, replays against the rules baseline and registers **disabled**. Enabling it is your explicit act.

```
 dev machine (Construct)                         training machine (the MacBook, or any Linux/macOS box with python3)
 -----------------------                         -----------------------------------------------------------------
 1  construct traces export --out D             (preview: what would be included; nothing is written)
 2  construct traces export --out D --yes       writes the dataset bundle D and records it in the export ledger
 3  copy D over YOUR private transport  ------>  inbox/<name>/            (encrypted in transit, docs below)
 4                                               train-kit/train.sh --watch inbox outbox     (or train.sh D M, once)
 5  copy M back                         <------  outbox/model-<hash12>/    (features.json, eval-report.json, ...)
 6  construct model import M                    verify + replay the held-out records vs the rules baseline (stores nothing)
 7  construct model import M --yes              register it DISABLED
 8  construct model enable <name>  + a project plugin file + `decision:` in architecture.yml       (you, explicitly)
```

Nothing here trains. A test (`test/no-training-guard.test.mjs`) asserts that `packages/core`, `cli`, `engine` and `mcp` import no
training or model-runtime dependency, start no trainer and carry no `train` verb; the kit is the folder `train-kit/`, outside every
package, with its own README and no dependency on Construct.

## 1. Export a dataset bundle

```
construct traces export --out <dir> [--since <date>] [--chooser <id>] [--yes] [--json] [--dir <project>]
```

**Without `--yes` it is a preview and writes nothing** (no folder, no ledger). It prints exactly what a bundle would hold:

```
PREVIEW: nothing is written. This is what a dataset bundle would hold (add --yes to write it to /srv/handoff/bundle).

Records: 120 (train 96, validation 11, test 13); dropped on re-validation: 0
Per chooser:
  requirement.card.noun                     90  (train 73, validation 9, test 8)
  requirement.placement.shape               30  (train 23, validation 2, test 5)
Fields of every record: version, id, at, chooser, summary, options, chosen, by, provider, suggestion, outcome (plus split)
Date range: 2026-09-01T09:00:00.000Z to 2026-09-01T10:59:00.000Z
Projects (key hashed): f64327503b69da5c (120 records)
No path and no secret is in it: every record was checked again and a failing one is dropped, never repaired.
Dataset hash: 55d26b82295fb64512b37b217a2d0f620e48e2e2f025a0067c20b2e315cb5bd6
```

With `--yes` it writes four files into `<dir>` (mode 0600; `<dir>` must be new or empty, or hold an earlier bundle; it may not be
inside the project, a symbolic link, or hold other files):

| file | what |
| --- | --- |
| `dataset.jsonl` | one `{ "split", "trace" }` per line, keys sorted, sorted by time then id. The trace is a `decision-trace.v1` record read from the store and **validated again** (`validateTrace`, which includes the path and secret check): a record that fails is **dropped and counted**, never repaired. |
| `schema.json` | the `decision-trace.v1` record, a dataset line and the two manifests, as JSON Schema |
| `manifest.json` | counts (records, per split, dropped and why, per chooser), `sha256` and size of every other file, the **dataset hash** (sha256 of `dataset.jsonl`), the Construct version, `decision-trace.v1`, the providers and versions seen, the chooser ids, the date range, the projects by **hashed** key (no name, no path) and the split rule. The creation time is supplied by the caller. |
| `README.md` | what it is, the privacy statement, how to train |

- **The split** is `sha256("split.v1:" + record id)`, the first 8 hex digits as a number, mod 100: below 80 `train`, below 90
  `validation`, else `test`. A pure function of the id, so a record never changes side, whatever else is exported later. The test
  side is HELD OUT: nothing trains on it and `model import` replays it.
- **Opt-out.** A project with `traces: off` in `architecture.yml` contributes nothing (`DATASET_EMPTY`), even if traces were
  recorded before the switch.
- **Deterministic.** The same traces, filters and clock give the same bytes (a test compares two exports and a regenerated fixture).
- **Filters.** `--since 2026-09-01` (or an ISO time) and `--chooser <id>`.
- **The export ledger.** `--yes` records the export in `<state dir>/exports/<project key>/ledger.jsonl`: the dataset hash, the time,
  the counts and the ids of the held-out test records. It is how a model coming back proves it was trained on a dataset THIS
  project exported (a model for any other dataset is refused) and which records to replay.
- **No path, no secret, and what is still in it.** The trace format already refuses them and the export checks again. It still
  says what the project's people asked for (the questions as offered, the words in them). Treat a bundle like the project.

## 2. Train (on the other machine)

`train-kit/` is copied out (`scp -r train-kit you@mac:line-train/`); it needs `python3` and nothing else (standard library only, no
numpy, no scikit-learn, no network). One entry point:

```
train-kit/train.sh <dataset-bundle> <model-out>                 # once
train-kit/train.sh --watch <inbox> <outbox> [--once] [--interval 30]   # a loop: train each NEW dataset hash
```

It reads the bundle (verifying it against the manifest hash first), trains one softmax (multinomial logistic) regression per
closed question on the TRAIN split with fixed seeds, evaluates on validation and test against the rules baseline, and writes the
model bundle. Features (`features.v1`, mirrored in `packages/core/decision-features.mjs`): the enabled option ids, the number of
enabled options, the quoted word of the question and its ending and length (a plural is usually data), and the words of the rest of
the question. The kit's guards (memory below 8 GB free, a hard time limit, `nice 19`, an optional AC-power check, a heartbeat file)
and the launchd service for the MacBook are in `train-kit/README.md`.

The model bundle (`<outbox>/model-<hash12>/`):

| file | what |
| --- | --- |
| `features.json` | the weights as plain JSON (`construct.features-model.v1`): per question ("route") the classes, a bias and a weight vector per feature |
| `eval-report.json` | accuracy per chooser against the rules baseline on validation and test, coverage, the peak memory of the run |
| `MODEL_CARD.md` | what it is, the dataset hash, base model (none), licence note, limits |
| `manifest.json` | `construct.model-bundle.v1`: name, version, kind, the dataset hash, the schema versions, `sha256` of the files |
| `checksums.txt` | `sha256sum` format, every other file |

## 3. Import the model back and verify it

```
construct model import <dir> [--yes] [--min-traces <n>] [--json] [--dir <project>]
construct model list | remove <name> | enable <name> | disable <name>
```

`import` verifies first, and **refuses anything that is not plain data**. Nothing in the folder is executed, imported, unpickled or
unzipped; files are opened without following links, sized before they are read, read once, and the same bytes that were verified
are the ones stored.

| refused | code |
| --- | --- |
| a file name outside `manifest.json checksums.txt eval-report.json MODEL_CARD.md features.json prototypes.json model.onnx` (a script, `.py`, `.pkl`, a module, a hidden file) | `MODEL_FILE_NOT_ALLOWED` |
| a symbolic link (a file or the folder), | `MODEL_SYMLINK` |
| a sub-folder | `MODEL_FILE_NOT_ALLOWED` |
| a file over its cap (`features.json` 8 MiB, `model.onnx` 128 MiB, 200 MiB in all) | `MODEL_TOO_LARGE` |
| a file that starts like a script, an ELF/Mach-O/Windows executable, a zip/gzip or a pickle | `MODEL_EXECUTABLE` |
| a text file that holds binary data | `MODEL_NOT_TEXT` |
| a required file missing, or the declared model kind's file | `MODEL_MISSING_FILE` |
| `checksums.txt` malformed, not covering every file, or a checksum that does not match | `MODEL_CHECKSUM_INVALID`, `MODEL_CHECKSUM_MISSING`, `MODEL_CHECKSUM_MISMATCH` |
| a name with a path in `checksums.txt` or the manifest (`../x`, `/etc/x`) | `MODEL_PATH_TRAVERSAL` |
| a manifest that disagrees with the files, or is not valid (provider-safe `name`, `version`, `kind`, ...) | `MODEL_MANIFEST_MISMATCH`, `MODEL_MANIFEST_INVALID` |
| another bundle, trace or dataset schema version | `MODEL_SCHEMA_MISMATCH` |
| a dataset hash this project never exported (not in the ledger) | `MODEL_DATASET_UNKNOWN` |
| a `features.json` that is not valid data (bad weights, poisoned keys, too big) | `MODEL_FEATURES_INVALID` |
| an `eval-report.json` that is not JSON or names another dataset | `MODEL_REPORT_INVALID` |

Every refusal is `{ ok: false, code, message }` (exit code 1; `--json` prints it as `{ ok: false, error }`), a one-line message
with no path in it, never a stack trace. Usage errors are exit code 2.

Then it **replays the held-out test records** of the export the model came from, through the model and through the rules
baseline, with the same yardstick as `construct traces replay` (agreement, when answered, coverage, verdict `beats`, `ties` or
`loses`; promotable only on at least 30 person-made traces). Without `--yes` that is all, and nothing is stored. With `--yes`
the verified files are stored under `<state dir>/models/<project key>/<name>/` and the model is registered **DISABLED**.
`architecture.yml` is never edited by import.

Model kinds: this version can LOAD only `features.json` (weights in JSON, scored in pure JavaScript, deterministic). A
`model.onnx` or `prototypes.json` bundle is verified and stored, but NOT loaded, not replayed and cannot be enabled; the report
says so (the embedding classifier is #645).

## 4. Enable it (your explicit act)

A registered model is inert. To use it in a project:

1. `construct model enable features-lr` (flips one flag in the state directory; `disable` flips it back; `remove` deletes it).
2. Put the model's plugin file in the project, for example `tools/decision-model.mjs`:

   ```js
   import { registeredModelProvider } from '@line/construct-core/decision-model-registry';
   export default registeredModelProvider('features-lr', { root: new URL('..', import.meta.url) });
   ```

3. Name it in `architecture.yml` (docs/DECISION-PROVIDERS.md):

   ```yaml
   decision:
     provider: features-lr
     plugin: tools/decision-model.mjs
   ```

   The Cockpit server imports a project plugin only when started with `CONSTRUCT_DECISION_PLUGINS=on`.

The provider asks the registry on every suggestion, so `disable`, `remove` and a re-import take effect without a restart; a model
that is disabled, missing or whose stored file no longer matches its hash makes the suggestion fail and the **rules provider
answers in its place** with a path-free log line. Every suggestion it makes is recorded as a decision trace with its name and
version, so the next replay scores it on what people really chose.

## Transport (your choice; the kit and Construct open no connection)

The training machine PULLS: nothing connects into it and it listens on no port. Any of these works, because the kit only reads
`<inbox>` and writes `<outbox>`:

- **A private folder over Tailscale** (WireGuard, free): the dev machine copies `D` into a shared folder, the Mac's inbox is that
  folder (or `rsync`/`scp` in a cron on the Mac, pulling). The results are pulled back the same way.
- **A private GitHub release asset** (a private repo you own): upload `D` as an archive, the Mac downloads it on a schedule.
- **`scp`/`rsync`** by hand.

**Encrypt it**, in transit and at rest, because traces come from real projects. With [age](https://github.com/FiloSottile/age)
(BSD-3-Clause):

```
# dev machine: encrypt the bundle to the Mac's PUBLIC key
tar -C D -cf - . | age -r age1...publickey... > dataset.tar.age
# Mac: decrypt into the inbox (the private key never leaves the Mac)
mkdir -p inbox/from-dev && age -d -i ~/.age/key.txt dataset.tar.age | tar -x -C inbox/from-dev
```

The kit does not decrypt for you (a documented TODO); it trains only on a folder that verifies against its manifest, so a
half-copied or altered folder is skipped, not trained. Delete the dataset from the Mac when the model is back.

## The training MacBook (16-inch MacBook Pro, Apple M5 Pro, 24 GB, macOS 26)

The default mode is tiny (well under a gigabyte, seconds to minutes) and pure Python, so it works as it is: no PyTorch, no MPS,
no MLX. Check first that the machine's policy allows project data, a 24/7 background job and a private network tool on it (a
managed work laptop may not). To run the loop as a service, use `train-kit/com.line.train.plist` (RunAtLoad, KeepAlive, `Nice`,
`caffeinate`, log files, no secrets); the steps are in the comment at its top and in `train-kit/README.md`. The kit refuses to
start a job with less than 8 GB free (`vm_stat`), waits and tries again.

## What is not here (left out on purpose, in order)

- **Embedding prototypes plus a classification head** (the default mode of the issue, the classifier plugin of #645) and an **ONNX
  loader**: `model.onnx` and `prototypes.json` are verified and stored, never loaded.
- **LoRA of a small open model through MLX**, and Apple Silicon GPU/MPS training: documented as TODO in `train-kit/README.md`.
- **Installing the launchd service**: the template is provided, nothing installs it.
- **Decrypting an `age` bundle inside the kit**, and any transport code.
- **Editing `architecture.yml` or writing the plugin file for you**: enabling is the owner's act; a per-diff approval flow for it
  is a later slice.
- **Automatic retraining, promotion on `promotable`, a Cockpit screen for models.**
- The features only see the question as offered (the four fields a provider is handed). Card and placement summaries carry no
  richer structured fields today; when they do, `features.v2` adds them (a model with another feature version is refused).
