# Library Run page tooling

The live page for a full library run: https://claude.ai/artifact/WRDACxYbY5ggnkt2Fb5P2W (owner-private).

- `library-run.html`: the page (published with the Artifact tool; `db` capability, collections `run` and `events`).
- `sync.mjs <runDir> <outbox> <status> "<scope>"`: turns `<runDir>/results.jsonl` into page documents in `<outbox>`
  (`run-current.json` -> `run/current`, `events-eNNNN.json` -> `events/eNNNN`, 40 log rows each). Which blocks were
  already pushed is kept in `<outbox>.state.json`; after pushing, set it to `{"pushedBlocks": <full>}` from
  `<outbox>.pending.json`.
- `tick.sh <runDir> <outbox> "<scope>"`: prints a TICK line every 30 s while new results land, RUN ENDED at the end.

## Resume the 2026-10-15 run (R10, R11, rules build + Haiku picks)

`../runs/full-2026-10-15/results.jsonl` holds the 1,307 results recorded before the run moved machines; the run
resumes from it (entries already done are skipped). Needs the `claude` CLI signed in to the plan.

```sh
mkdir -p /tmp/lib-full && cp packages/line-fluent/pilot/library/runs/full-2026-10-15/results.jsonl /tmp/lib-full/
nohup node packages/line-fluent/pilot/library/run.mjs --jobs 12 --batch 20 --build --outside none --user opus \
  --out /tmp/lib-full > /tmp/lib-full/run.log 2>&1 &
packages/line-fluent/pilot/library/page/tick.sh /tmp/lib-full /tmp/lib-outbox "Full JS reference: 2,378 entries"
```

The page's `run/current` was at version 46 and `events` held e0000-e0031 when the run moved; the next sync writes
e0032 onwards (set `/tmp/lib-outbox.state.json` to `{"pushedBlocks": 32}` before the first sync).
