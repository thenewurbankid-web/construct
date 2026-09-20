# Generated Playwright tests (#348, part of #284)

`construct generate tests <feature>` writes one **locked** Playwright spec per workflow scenario. Deterministic, no LLM.

## Setup

Declare the two regions in `architecture.yml` (the command refuses, and prints these lines, if they are missing):

```yaml
frozen:
  - features/*/tests/generated/**   # generated specs are read-only to everything but the generator
nonLayer:
  - features/*/tests/**             # tests sit inside the feature but outside the layer graph
```

```
construct generate tests <feature> [--dry-run] [--prune] [--dir <path>]
```

Output: `features/<feature>/tests/generated/<machine>--<slug>.spec.ts`. Clones and hand-written tests go one level up in `features/<feature>/tests/` (name them `*.spec.ts`), where nothing regenerates them.

## The attribute convention

| Attribute | Value |
|---|---|
| `data-testid` | kebab-case of the event: `REQUEST_REFUND` -> `request-refund`, `paymentFailed` -> `payment-failed`. An event name shared by two machines of one feature is scoped `<machine>-<event>` on both. Only user events bind; `after`/`always`/`invoke`/`onDone` are driven by the flow. |
| `data-flow` | the machine key (kebab of the machine id), on the element showing the machine's state |
| `data-flow-state` | the machine's leaf state path (`manualReview`, `parent.child`) |

`construct create page --from` adds `data-testid` to the first element carrying each `on<Event>` callback and, when the feature has a workflow, `data-flow` / `data-flow-state={flowState}` on the root (an optional `flowState` prop the controller forwards from a hook member of the same name).

## File names

`happy-path`, or `ends-<end-state>-via-<decision steps>` where a decision step leaves a state with more than one way out (`request-refund`, `when-is-suspicious`, `otherwise`, `service-failed`, `after-<ms>`). Names describe the branch, never a position, so adding a scenario does not rename the others.

## Failure semantics

A missing `data-testid` fails as a harness problem: the message names the convention and the exact `[data-testid="..."]` expected and says not to file a product bug. A present element in the wrong state is an ordinary assertion failure. Scenarios that need something the UI cannot choose (a guarded branch, a failing service, a delay over 10 s) are emitted as `test.fixme` naming the needed fixture; a feature no route reaches (or only a dynamic route) is emitted as `test.fixme` with a `TODO(construct)` start URL.

## Lineage

Each file's header records the `machine-hash` and `scenario-hash`, so a clone can later be flagged stale when its source scenario changes.

## Safety

Only `features/<feature>/tests/generated/` is ever written; symlinked directories or files are refused; a file without the `@construct-generated` marker is never overwritten; `--prune` removes only marker-bearing orphans. Names are escaped in literals and comments, and file names are built from `[a-z0-9-]` only.

## Cloning a locked test (#300, #301)

The Cockpit's **Tests** screen (`/tests`, Explore) lists a feature's scenarios with their coverage, the locked generated tests and yours. Trying to edit a generated test opens a dialog that explains why and clones it. Core: `cloneGeneratedTest(root, { feature, source, name })` in `src/engine/testClone.mjs` (JSON in, JSON out).

- The copy lands at `features/<feature>/tests/<name>.spec.ts` (never under `generated/`); `name` must match `^[a-z0-9][a-z0-9-]*$`; an existing file is never overwritten (`{ ok: false, code: 'exists', suggested }`).
- The clone is four header lines (`// @construct-clone v1 ...`, `// cloned from: <generated path> (scenario "<slug>")`, the copied `machine-hash` / `scenario-hash`, a note) then the source byte for byte, so its lineage survives for the stale-clone warning (#306).
- Server: `GET /api/tests/:feature`, `GET /api/tests/:feature/source`, `POST /api/tests/:feature/clone`, `POST /api/tests/:feature/generate`, all behind the session; the client sends only a feature name, a file name and a clone name.
