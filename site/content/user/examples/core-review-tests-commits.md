**Problem.** Reviewing a change, keeping tests honest and writing a commit message are all judgement-shaped chores that get delegated to a model by default. Each run gives a different answer and costs tokens, and none of it can be checked.

Each is a small function that reads a project and returns JSON. The Cockpit and the CLI call these same functions; a script or an agent can call them directly.

This page is the core API only. The terminal versions are in the [CLI examples](@user-guide/examples/cli-impact-and-review/) and the screens are in the [Cockpit examples](@user-guide/examples/cockpit-review/).

## Do this

### 1. Review two refs

```js
import { prHealth } from './packages/engine/prHealth.mjs';

const report = prHealth(root, { base: 'main', head: 'feature/invoice-fetch' /*, expected: plan */ });
report.summary;
// "1 file changed across 1 feature (billing): 1 finding (0 mechanical, 1 for a conversation)."
report.indicators.map((i) => [i.id, i.status, i.measured]);
// [["blast-radius","not-measured",false], ["unexplained","clear",true],
//  ["rule-regressions","attention",true], ["public-surface","info",true], ["flow-diff","clear",true]]
```

Every indicator carries the sentence, its evidence, where the number comes from, and `deterministic: true`. Findings are `mechanical` (a Construct block resolves it, with the command) or `conversation` (a human decides); the engine classifies and never fixes. Bad input comes back as data, not an exception:

```text
prHealth(root, { base: 'main', head: '--upload-pack=x' })
{"schemaVersion":1,"ok":false,"error":{"code":"INVALID_ARGUMENT","message":"head \"--upload-pack=x\" is not a valid ref: refs cannot start with \"-\"."}}
```

It is read-only by construction: git is spawned with argument arrays (never a shell) against temporary detached checkouts that are removed afterwards. Contract: `schemas/pr-health.v1.json`.

### 2. Generate, clone and edit tests

```js
import { generateFeatureTests } from './packages/engine/testGenerator.mjs';
import { cloneGeneratedTest } from './packages/engine/testClone.mjs';
import { readStepDocument, previewStepEdit, applyStepEdit } from './packages/engine/testSteps.mjs';

generateFeatureTests(root, 'login', { dryRun: false });          // one locked spec per route
cloneGeneratedTest(root, { feature: 'login', source: 'login--happy-path.spec.ts', name: 'login-mine' });
const doc = readStepDocument(root, { feature: 'login', name: 'login-mine.spec.ts' });
const preview = previewStepEdit(root, { feature: 'login', name: 'login-mine.spec.ts', baseHash: doc.hash, steps });
applyStepEdit(root, { feature: 'login', name: 'login-mine.spec.ts', baseHash: doc.hash, resultSha: preview.resultSha, steps });
```

The safety contract is part of the API: generation writes only under a feature's `tests/generated/` folder and refuses symlinks; a clone never overwrites; a step edit is applied only if you hand back the hash of the file you read and the fingerprint of the diff you previewed, and a stale file is refused. Field values (events, states, URLs, text) are validated against what the flow really has before they become code.

### 3. Write a commit message, the same way every time

```js
import { buildCommitMessage, nextSerialFrom, newSessionId } from './packages/engine/commitMessage.mjs';

const built = buildCommitMessage(root, {
  changedFiles: ['features/billing/domain/billingRules.ts'],
  changes: { 'features/billing/domain/billingRules.ts': 'update' },
  sessionId, serial: nextSerialFrom(subjectsOnThisBranch, { sessionId }), prefix: 'CON',
});
built.message;   // subject and body, ready for `git commit -F -`
```

Impact counts come from the impact report and the prose from the unit summarizer. A test asserts that this module's import graph cannot reach the model provider code, so "no model" is enforced, not promised.

### 4. Where a bot's output lands

Two more building blocks sit behind the Cockpit's Plan screen and are equally callable: the bot runner (each plan runs in its own git worktree (its own copy of the repository), one commit per successful step, on branch `construct/bot/<process id>`, with a repeatable step run with no model reachable) and the approval gate, whose `review` reads each artifact's diff and every reason it cannot apply, and whose `decide` is the only call that writes into your tree, for named files only, quoting the diff fingerprint. Both return JSON and never throw on bad input.

## You get

| You get | Why |
|---|---|
| Review, tests and commit messages without a model | none of these modules can reach one |
| The same input gives the same output | assembled from the import graph, the rules and git |
| Safe by construction | validated refs, locked regions, hash-checked writes |
| A stable contract | JSON in and out, versioned schemas |

The full inventory is in [Building blocks](@developers/building-blocks/).

## Why it matters

Review, tests and commit messages come out identical every run, at no model cost.

Checked against commit `d23283f` on 2026-09-23.
