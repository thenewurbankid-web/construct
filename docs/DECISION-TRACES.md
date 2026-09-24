# Decision traces (`decision-trace.v1`, #643, part of epic #616)

Every choice made in a chain (a person answering an open question of a requirement card, the `q-shape` offer, a placement
question, an answer compiled by `compileChain`) is recorded as ONE clean classification example: the closed question as it was
offered, the option chosen, who chose, what a provider suggested and what happened afterwards. Nothing is trained here. The
records and a yardstick exist from the first chain, so a faster decision model (or one trained on another machine, #647) can
later be scored on real choices before it is trusted with anything (`docs/BLOCK-CONTRACT.md`, "AI-ready by design").

Modules (`packages/core/`, all deterministic, none touches the network):

| module | job |
| --- | --- |
| `decision-trace.mjs` | the record: `buildTrace`, `validateTrace`, `traceId`, `serializeTrace`, outcome records. Pure, no filesystem, no clock. |
| `redaction.mjs` | the path and secret patterns, shared with `chooserSummary` (which hides paths) so a trace refuses what a summary hides |
| `decision-trace-store.mjs` | the append-only JSONL store in the state directory: `recordDecisions`, `recordOutcome(s)`, `recordChoices`, `readTraces` |
| `decision-trace-adapters.mjs` | `choicesFromChain`, `choiceFromCardQuestion`, `choicesFromPlacement`: what the chain blocks return, as records |
| `decision-trace-replay.mjs` | `traceStats`, `replayTraces` and the text renderers |

## The record

One JSON object per line, keys sorted, no whitespace:

| field | meaning |
| --- | --- |
| `version` | `decision-trace.v1` |
| `id` | `dt-` and 24 hex characters: a hash of `chooser`, `summary`, `chosen`, `by` and the provider name. Never random, never the time, so the same decision is the same record. What a provider suggested is not part of it. |
| `at` | ISO time, **supplied by the caller**; the pure functions never read a clock |
| `chooser` | `{ id, question }`. Card questions: `requirement.card.noun` / `.verb`. Placement: `requirement.placement.ambiguity` / `.check` / `.server-check` / `.shape`. A chain: the chooser's own id. |
| `summary` | the fixed-size, path-free object that was **offered** (`chooserSummary`, or a card or placement question), with `chosen: null`. Replaying it through a provider is "what would it say with the same input". At most 16 KiB. |
| `options` | the 2-5 option ids of the summary, in order |
| `chosen` | one of `options`, or `exit` (a chooser's manual exit) |
| `by` | `person`, `llm` or `decision-model` |
| `provider` | `{ name, version }` of the decision provider that suggested or chose (`rules` is `{ rules, 1 }`) |
| `suggestion` | `{ option, reason, score? }`: what that provider suggested, when asked |
| `outcome` | `{ planValidated?, testsPassed?, reverted?, accepted? }`, all booleans. `accepted` means the suggestion was taken (`true`) or overridden (`false`); it is recorded with the decision whenever a suggestion exists. |

An **outcome record** is a separate line, `{ version, kind: 'outcome', of: <decision id>, at, outcome }`. History is never
rewritten: `readTraces` folds the outcome records over the decisions (later wins per label), and `recordOutcome(root, id,
outcome)` skips a label already recorded with the same value. `planValidated` is recorded by the Requirement API when the plan
built from a person's answers passes `validatePlan` (`false` when it does not). `testsPassed` and `reverted` have no cheap hook
today: a plan carries no link back to the decisions that produced it, so the process that runs it cannot name them. That is the
documented seam: whoever carries the decision ids to the run calls `recordOutcome(root, id, { testsPassed: true })`.

Because the id is a hash of the identifying fields, a stateless caller that replays every answer on every request (the
Requirement API does) records each choice once: a second record with the same id is skipped as a duplicate.

<!-- trace-example:code -->
```js
import { buildTrace, buildOutcomeRecord } from '@line/construct-core/decision-trace';

const summary = {
  id: 'o1',
  question: 'What does "invoice" mean here?',
  options: [
    { id: 'entity', label: 'A data object', enabled: true, why: 'Something the app stores and shows.' },
    { id: 'ui-part', label: 'A part of the screen', enabled: true, why: 'A button, a list, a form.' },
    { id: 'ignore', label: 'Ignore this word', enabled: true, why: 'It changes nothing to build.' },
  ],
  chosen: null,
};
const at = '2026-09-24T10:00:00.000Z';
const { trace } = buildTrace({ summary, chosen: 'entity', by: 'person', provider: { name: 'rules', version: '1' }, suggestion: { option: 'entity', reason: 'first available step' }, outcome: { accepted: true } }, { at });
const { record } = buildOutcomeRecord({ of: trace.id, outcome: { planValidated: true } }, { at: '2026-09-24T10:00:02.000Z' });
export const result = { trace, outcome: record };
```

<!-- trace-example:result -->
```json
{
  "trace": {
    "version": "decision-trace.v1",
    "at": "2026-09-24T10:00:00.000Z",
    "chooser": { "id": "o1", "question": "What does \"invoice\" mean here?" },
    "summary": {
      "id": "o1",
      "question": "What does \"invoice\" mean here?",
      "options": [
        { "id": "entity", "label": "A data object", "enabled": true, "why": "Something the app stores and shows." },
        { "id": "ui-part", "label": "A part of the screen", "enabled": true, "why": "A button, a list, a form." },
        { "id": "ignore", "label": "Ignore this word", "enabled": true, "why": "It changes nothing to build." }
      ],
      "chosen": null
    },
    "options": ["entity", "ui-part", "ignore"],
    "chosen": "entity",
    "by": "person",
    "provider": { "name": "rules", "version": "1" },
    "suggestion": { "option": "entity", "reason": "first available step" },
    "outcome": { "accepted": true },
    "id": "dt-8b2cd80c7460594d1b4f5e11"
  },
  "outcome": {
    "version": "decision-trace.v1",
    "kind": "outcome",
    "of": "dt-8b2cd80c7460594d1b4f5e11",
    "at": "2026-09-24T10:00:02.000Z",
    "outcome": { "planValidated": true }
  }
}
```

(The file holds each record as one line with sorted keys; the example is pretty-printed. The `chooser` of a real card question is
`requirement.card.noun`, not `o1`, which is the summary's own instance id.)

## Privacy and where the file is

- **Local.** `<state dir>/traces/<project key>/decisions.jsonl` (older rotated files `decisions.1.jsonl` ...), where the state
  directory is `CONSTRUCT_STATE_DIR`, else `$XDG_STATE_HOME/construct`, else `~/.local/state/construct`, and the project key is
  `<basename>-<12 hex of the root's hash>`: the same place and convention as process records (`resolveStateDir`, `projectKey`).
  It is never inside your source tree, so it is not in `git status`, not walked by the enforcers and not copied into a shadow
  tree. The directory is created private (`0700`, files `0600`).
- **Nothing leaves the machine.** No module of the trace format imports a network API (a test walks their import graph and
  fails on `http`, `net`, `fetch` and the like). Export is an explicit action that shows what will be included: that is #647,
  not built here.
- **No path, no secret.** A record is REFUSED (never repaired) when any string in it, a key included, holds an absolute path, a
  `~/`, a `./` or `../`, or a secret-shaped token (provider tokens, private key headers, JWTs, bearer credentials, `password=`
  assignments, any 40+ character run of letters and digits). It is the same path pattern `chooserSummary` uses to hide paths,
  from one shared module. The Requirement API hides paths in a card question the way a chooser summary does before recording.
- **The switch.** `traces: on|off` at the top level of `architecture.yml`. Default `on`, because a trace is local, path-free and
  never exported by itself; a project that does not want even that sets `traces: off`, and nothing is written or asked (the
  rules provider is not even called). A config that cannot be read counts as `off`. Switching off keeps what was recorded until
  you delete the directory; `construct traces` still reads it.
- **Bounded and failure-safe.** The active file rotates at 2 MiB and keeps 5 files (10 MiB per project at most, the oldest is
  dropped). Every write path returns `{ ok: false, error }` instead of throwing, so a full disk, a read-only or missing state
  directory or a bad config never breaks the chain that called it. A torn last line (a killed process) is skipped by readers and
  repaired by the next append.

## The commands

```
construct traces list [--chooser <id>] [--limit <n>] [--json]
construct traces stats [--chooser <id>] [--json]
construct traces replay --provider <name> [--chooser <id>] [--min-traces <n>] [--baseline <name>] [--plugin <file.mjs>] [--json]
```

All three are read-only, deterministic, need no model and no network. `--dir <path>` targets a project as everywhere else.

- `list` prints the decisions: time, chooser, chosen, who, the suggestion and whether it was taken, the outcome.
- `stats` counts per chooser (and who chose), the acceptance rate of suggestions overall and per provider (`rules@1`, ...), and
  how many decisions carry each outcome label.
- `replay` sends each recorded summary through the named provider (`rules`, `off`, or a plugin) and reports, per chooser and
  overall, next to the same numbers for the baseline (`rules` unless `--baseline` says otherwise):
  - **agreement**: how often the provider's pick equals what the person chose, over person-made traces (an abstention counts as
    a miss); **when answered** leaves the abstentions out;
  - **outcome agreement**: the same over decisions whose outcome vouches for them (a positive label, `planValidated`,
    `testsPassed` or `accepted`, and no negative one: `reverted`, a failed plan or test);
  - **coverage**: how often the provider answered instead of abstaining;
  - **verdict**: `beats`, `ties` or `loses` against the baseline on hits against person choices, and **promotable** only when it
    beats AND there are at least `--min-traces` (default 30) person-made traces. A provider is promoted only when it wins.

A provider that throws, hangs or returns something that is not an enabled option of the summary abstains, exactly as in a live
chain (`suggest()` of `decision-provider.mjs`). A plugin is a provider registered by name; on the command line,
`--plugin <file.mjs>` imports a file that calls `registerDecisionProvider` itself or default-exports `{ name, suggest }`. That
file is code you named yourself and runs locally with your permissions; Construct does not fetch or install one.

## What is not here

Export bundles, dataset splits, training, the embedding classifier plugin and importing a trained model are #647 and #645. The
Cockpit does not show traces yet. Outcomes `testsPassed` and `reverted` have a function to record them (`recordOutcome`) but no
caller: see the seam above.
