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
construct generate tests [--unit] <feature> [--dry-run] [--prune] [--dir <path>]
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

## Every path, no browser (`--unit`, #583, part of #574)

```
construct generate tests --unit <feature> [--dry-run] [--prune] [--dir <path>]
```

Writes one **locked** unit test per workflow machine, `features/<feature>/tests/generated/<machine>--every-path.test.ts`, next to the Playwright specs (same marker, same `frozen:`/`nonLayer:` regions, same overwrite and prune rules; `*.spec.ts` stays Playwright's, `*.test.ts` is node's, so neither runner nor the Cockpit's test listing picks up the other's files). Deterministic, no LLM; `--unit` and the plain command are independent and complement each other: the specs drive the UI through one scenario each, the unit test checks the whole state space in milliseconds.

The generated file imports the machine and, under `node:test`, walks it with [`@xstate/graph`](https://github.com/statelyai/xstate/tree/main/packages/xstate-graph) (MIT): `getShortestPaths` for every reachable state, `getAdjacencyMap` for every transition. It compares what it finds with a table baked in at generation time, read statically from the machine (`packages/engine/workflowExtractor.mjs`; nothing is executed by the generator):

| Constant | Meaning |
|---|---|
| `STATES` | every state the machine declares (`parent.child` for nested states); the walk may not reach a state outside it |
| `REACHABLE` | states every run reaches without a fixture (no guard, no service outcome, no timer to choose); each must be reached |
| `TRANSITIONS` | per resting state and user event, the states the flow may land on; one candidate is the ordinary case, several when the machine decides (a guarded group, a transient `always` state, a final child settling through its parent's `onDone`) |

A transition removed, retargeted or added since generation fails the test with a one-line reason (`failed --RETRY--> is gone (it landed on loading)`, `audit --OK--> lands on idle, expected done`, `the flow can no longer reach loading`). Once the change is intended, `construct generate tests --unit <feature>` refreshes the table. `after`, `invoke` and `onDone` steps are not in the user-event table, but the walk follows them, so a state only they reach is still visited and its own transitions checked. Machines that are not an exported `const`, or that use `parallel`/`history` states, are reported as skipped with the reason.

**Running it.** The machine files are `.tsx`, which node's own type stripping cannot load, so the project needs a TypeScript loader for node's test runner: `npx tsx --test features/<feature>/tests/generated/<machine>--every-path.test.ts` (the file's `run:` header line says exactly this). `construct init` scaffolds `@xstate/graph`, `tsx` and `@types/node` as devDependencies plus a `test:unit` script (`tsx --test "features/**/tests/generated/*.test.ts"`); on a project that lacks them the command prints the `npm install -D ...` line. Core: `generateUnitTests(root, feature, { dryRun, prune })`, `planUnitTests`, `pathModel` in `packages/engine/testUnitGenerator.mjs`.

## Safety

Only `features/<feature>/tests/generated/` is ever written; symlinked directories or files are refused; a file without the `@construct-generated` marker is never overwritten; `--prune` removes only marker-bearing orphans. Names are escaped in literals and comments, and file names are built from `[a-z0-9-]` only.

## Cloning a locked test (#300, #301)

The Cockpit's **Tests** screen (`/tests`, Explore) lists a feature's scenarios with their coverage, the locked generated tests and yours. Trying to edit a generated test opens a dialog that explains why and clones it. Core: `cloneGeneratedTest(root, { feature, source, name })` in `packages/engine/testClone.mjs` (JSON in, JSON out).

- The copy lands at `features/<feature>/tests/<name>.spec.ts` (never under `generated/`); `name` must match `^[a-z0-9][a-z0-9-]*$`; an existing file is never overwritten (`{ ok: false, code: 'exists', suggested }`).
- The clone is four header lines (`// @construct-clone v1 ...`, `// cloned from: <generated path> (scenario "<slug>")`, the copied `machine-hash` / `scenario-hash`, a note) then the source byte for byte, so its lineage survives for the stale-clone warning (#306).
- Server: `GET /api/tests/:feature`, `GET /api/tests/:feature/source`, `POST /api/tests/:feature/clone`, `POST /api/tests/:feature/generate`, all behind the session; the client sends only a feature name, a file name and a clone name.

## Editing a test as steps (#302)

In the Cockpit's **Tests** screen, select one of *your* tests (a clone or one you wrote) and press **Edit steps**. The test opens as a document of GIVEN / AND / WHEN / THEN / CHECK rows, each showing the selector it binds to (`[data-testid="request-refund"]`, `[data-flow-state="manualReview"]`, `page.goto`). A panel of ordinary form fields edits the selected row: a pick-list of the flow's real events, a pick-list of its real states, the page to open, the text to look for, how long to wait, a note. Add a flow event, a flow state or a check; remove a step (it stays struck through until saved); move a step up or down (buttons, so the keyboard works). **Review changes** shows the diff of exactly what will change; **Save these changes** writes exactly that. Nothing is written before that. Generated tests stay locked: clone first.

No second source of truth: the spec file *is* the document. `packages/engine/testSteps.mjs` parses the test body with `packages/ast` into steps and re-renders it through `packages/engine/testSpecRender.mjs`, the same renderer the generator uses.

- **Round-trip gate.** A file is offered for editing only if parse -> render gives the file back byte for byte. Anything else (a hand-written statement, single quotes, an extra comment, a changed helper, CRLF, no trailing newline) is shown **read-only with the reason** ("line 27: a statement the step editor does not know") and is never touched. The clone's lineage header (`@construct-clone`, machine-hash, scenario-hash) is preserved verbatim.
- **Safety.** Field values come from the browser and become code, so each is validated against an allowlist and only ever rendered through escaped literal slots: an event must be one of the machine's events (its `data-testid` is derived from the machine, never taken from the client), a state one of its leaf states, a URL a same-origin path (one leading `/`, no scheme, no `//`, no `..`), free text at most 200 characters without line breaks or control characters. The result is re-parsed and must contain exactly the validated steps, or nothing is written.
- **Write discipline.** The client sends a feature name, a file name (`^[a-z0-9][a-z0-9-]*\.spec\.ts$`, an existing non-symlink file directly under `features/<f>/tests/`, never `generated/`), the content hash it opened and the step fields. A write also needs the hash of the reviewed diff; a stale file is refused; the file is replaced atomically (`O_EXCL` temp file, then rename).
- **API** (behind the session; the two POSTs also refuse a foreign Origin): `GET /api/tests/:feature/steps?name=` -> `{ editable, hash, title, steps[], machine }` or `{ editable: false, reason }`; `POST /api/tests/:feature/steps/preview { name, baseHash, steps }` -> `{ changed, resultSha, diff }`; `POST /api/tests/:feature/steps { name, baseHash, resultSha, steps }` -> `{ hash }`. Core: `readStepDocument`, `previewStepEdit`, `applyStepEdit`, `parseSpec`, `renderDoc` in `packages/engine/testSteps.mjs`.
- **Step vocabulary** is what round-trips today: Go to (edit the URL), Flow event, Flow state, Check "text is visible". Type, Click and Wait are not offered yet (no template can round-trip them); free-form code editing is #303, authoring from scratch #304, recording #319.

## When the flow a clone came from changes (#306)

A clone records where it came from (`machine-hash`, `scenario-hash`, copied from the generated file). `packages/engine/testFreshness.mjs` compares those hashes with what the generator would write **today** (the same `planFeatureTests` plan; nothing is computed twice). No LLM, read-only: **a clone is never rewritten; QA decides.**

| State | Meaning | Flagged? |
|---|---|---|
| `current` | both hashes match | no |
| `machine-changed` | the machine changed elsewhere, this scenario's steps are identical | quiet note only |
| `scenario-changed` | the route this test walks changed | **stale**, with the step diff |
| `scenario-removed` | the scenario it came from no longer exists | **stale** |
| `unknown` | no usable lineage (hand-edited header) | no claim |

The diff compares flow steps (an event happening, the flow reaching a state), read by the step parser, and says in words which step is new, gone or changed ("A new step is in the flow (step 6): the flow moves to audit."). Checks, notes, the address and fixmes QA added are never reported. Limit: the clone is compared as it is now, so a flow step QA changed on purpose also shows as a difference. `outOfDate` on a coverage row is a different question (a **locked generated** file behind the machine; `construct generate tests` refreshes it).

- **API** (read-only, behind the session): `GET /api/tests/:feature` clones carry `freshness {state, stale, summary, changes}`, coverage rows `staleClones[]`, the listing `environment.browsers`; `GET /api/tests/:feature/compare?name=<clone>.spec.ts` -> `{ state, stale, summary, next, comparable, changes[{kind, at, text}], from, now }`. Core: `assessClone`, `diffFlow`, `compareClone`, `listFeatureTestsFresh`.
- **Cockpit**: a banner on the clone (with "It is still fine", which hides it for this visit only), an "Out of date" tag in the tree and coverage table, and the other states: empty (Generate N tests), no flow, browsers not installed (`npx playwright install chromium`), and the two failure kinds side by side. Running tests as processes (#305) and authoring from scratch (#304) are shown as not available yet.
