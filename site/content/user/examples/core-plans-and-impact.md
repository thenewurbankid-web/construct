**Problem.** Anything that automates development (a script, a bot, an agent) needs the same two things a human does before it acts: a plan that says exactly what will run, and a measured answer to "what does this touch?". If each tool improvises its own, every run is different and none can be checked.

Plans and impact reports are plain JSON in, plain JSON out, exported as functions. No UI, no model, no network, and they never throw on bad input: they return an error object. The CLI and the Cockpit are thin wrappers over these same functions.

This page is the core API only. The same functions from a terminal are in the [CLI examples](@user-guide/examples/cli-impact-and-review/), and through a browser in the [Cockpit examples](@user-guide/examples/cockpit-plan-and-run/). The code is open source; see the [Building blocks](@developers/building-blocks/) inventory.

## Do this

### 1. A plan is a checked contract

```js
import { createPlan, validatePlan, planToCommand, planTouches } from './src/plan.mjs';

const plan = createPlan({ source: 'text', title: 'Add an invoice slice to billing' }, [
  { id: 's1', title: 'Create the billing feature', flow: 'create.feature',
    args: { name: 'billing' }, executor: 'deterministic',
    touches: { features: ['billing'], files: [{ path: 'features/billing/index.ts', change: 'create' }] } },
  { id: 's2', title: 'Scaffold the Invoice slice', flow: 'create.layer',
    args: { name: 'Invoice', feature: 'billing', layers: ['domain', 'hook', 'page', 'controller'] },
    executor: 'deterministic', dependsOn: ['s1'],
    touches: { features: ['billing'], files: [] } },
]);

validatePlan(plan);            // { valid: true, errors: [] }
planToCommand(plan.steps[1]);  // { argv: ['create', 'layer', 'Invoice', '--feature', 'billing', '--layers', 'domain,hook,page,controller'], ... }
planTouches(plan);             // { features: ['billing'], files: [{ path: 'features/billing/index.ts', changes: ['create'], steps: ['s1'] }] }
```

Every step names a real Construct flow and one of three executors: `repeatable`, `local-model` or `user`. A model can appear only on flows that genuinely have a model path. Real output when a step names a flow that does not exist:

```text
{"valid":false,"errors":[{"code":"STEP_FLOW_UNKNOWN","path":"steps[1].flow","message":"Unknown flow \"deploy.to.prod\". A plan step must name a real Construct flow: project.init, create.feature, create.layer, create.unit, create.page.from, create.workflow.from, create.controller.bind, create.service.openapi, refactor.move, refactor.rename, import.unit, import.plan, import.route, summarize.unit, summarize.list, summarize.usage, research.summarize, research.workflow, research.doctor, validate, sync, pipeline.run, manual.task."}]}
```

`planToCommand` turns a step into the exact `argv` the CLI would run, and `planTouches` is what the review checks later compare against.

### 2. Impact is a computation, not a guess

```js
import { analyzeImpact } from './src/engine/impact.mjs';

const report = analyzeImpact(root, { seeds: ['features/shared/components/CurrencyLabel.tsx'] });
report.ok;                                   // true
report.summary;                              // "Impact of component:features/shared/components/CurrencyLabel.tsx: 4 feature(s) (shared, billing, checkout, reporting), 6 file(s) ... every entry derived deterministically."
report.warnings.map((w) => w.code);          // ['CROSS-FEATURE', 'PUBLIC-API', 'SHARED-COMPONENT', 'SHARED-COMPONENT']
report.features.map((f) => f.name);          // ['shared', 'billing', 'checkout', 'reporting']
```

Seeds are unit references, git diffs or, as a clearly labelled guess, a plain-English description of the change. Every row in the report says whether it is `derived` (reached by graph computation from a seed you named) or `inferred` (every path starts at a guess), so a caller can trust the first kind and ask a human about the second. Files reached from both kinds count as derived. Traversal is bounded (depth 2 by default; 200 files) and nothing is silently dropped: files past the limit are counted, not hidden.

Companion entry points: `impactFromChangedFiles` (seeds from a diff), `proposeSeedsFromText` (text to candidate seeds, all `inferred`) and `impactFromTicketText`. A model can propose seeds by emitting the same seed objects with `method: "model"`; core itself never calls one, so the what it touches is still computed offline.

## You get

| You get | Evidence above |
|---|---|
| A plan checked before it runs | `validatePlan` names the bad step and lists the real flows |
| The exact command each step will run | `planToCommand` |
| Guesses labelled, computation trusted | `derived` and `inferred` on every row |
| Errors as data | `{ ok: false, error }`, never a throw |

Schemas: `schemas/plan.v1.json` and `schemas/impact-report.v1.json`. Design notes: `docs/impact-analysis.md`.

## Why it matters

A script or an agent gets a checked plan and a measured answer, not a guess, with the same functions the CLI and the Cockpit use.

Checked against commit `081150b` on 2026-09-20 (wording revised for plain language on the same day).
