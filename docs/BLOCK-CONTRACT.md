# The block contract and the audit of today's flows (#543, part of #542)

Every block a user or a bot can invoke has one shape, `packages/core/block-contract.mjs`:

```
{ id, writes, declaredScope(args, ctx), actions(state, ctx), run(scope, args, ctx) }
```

- `declaredScope` returns `{ features, files }`, which is exactly a plan step's `touches`, so it drops into a step
  unchanged (`validateScope` reuses `validatePlan`'s own `touches` rules). Read-only blocks (`writes: false`) declare
  the empty scope. `null` means "a writing block whose files cannot be derived from its arguments"; the plan step
  must declare them and the approval gate refuses anything outside them. Nothing is guessed.
- `actions(state)` is DERIVED by `deriveActions(rules, state)` from a rule table and the state. Each action is
  `{ id, kind, label, enabled, why?, requires?, blockId?, gates? }`. An action that a rule forbids here is offered
  disabled with the rule's `why`, or not offered.
- `run(scope, args, ctx)` returns `{ changedFiles }`; `runBlock` checks the shape, sorts and de-duplicates, and refuses a
  read-only block that reports a changed file.
- `kind` is `mechanical` (a deterministic block runs), `ai` (a model fills something in, output lands as a reviewable
  diff) or `free` (an explicit, labelled exit to open-ended work).

`packages/core/block-flows.mjs` derives a block from every `PLAN_FLOWS` entry (`flowBlock`, `flowBlocks`) and from the
process state machine (`processLifecycleBlock`). `PLAN_FLOWS`, `validatePlan` and `planToCommand` are unchanged: the
registry stays the single definition of a flow, the block is a view of it.

## Decision: how `free` actions are gated

A `free` action is never a way around a guardrail. It passes through exactly the four guardrails that `ai` actions
pass through, named `GUARDRAILS` in the contract: **containment** (paths stay inside the project root), **approval**
(per-diff approval, `approvalGate`), **session gate** (only reachable through the Cockpit server's session check) and
**checks** (deterministic validation of the staged result before it lands: `lintBuffer` for a buffer, `validate` on the
staged tree in a shadow root, and the transition invariant "actual changed files are a subset of `declaredScope`,
otherwise flagged at approval").

How that is enforced, not just written down:

1. `validateAction` rejects any `ai` or `free` action that does not list every guardrail in `gates`, and
   `deriveActions` stamps them, so a block cannot offer an ungated exit (tested per guardrail).
2. A free action's editable surface is bounded by the block's `declaredScope`. `edit-code` on a writing flow whose scope
   is unknown (`null`) is offered disabled: "its files are not known until the plan step declares what it touches".
3. A free action produces a proposal (a buffer, a diff, a note), never a direct write to the project tree.

What is not built yet (later slices of #542): the transition invariant and `lintBuffer` themselves. The contract fixes
the requirement and the vocabulary they will plug into; today `approvalGate` already enforces scope, approval and
containment for bot output.

## Audit: `PLAN_FLOWS` (`packages/core/plan.mjs`)

Scope column, from `flowScopeKind`: **empty** = read-only, fits as-is; **derived** = `plan-touches.mjs` computes the
files from the arguments (fits as-is); **declared** = a writing flow whose files only the plan step's `touches` can
name (needs a scope declaration, and is the list to derive next: each becomes `derived` when its output is pinned by a
test). Actions: `run` (mechanical) where the flow allows the `deterministic` executor, `fill-with-ai` (ai) where it has
a `local-model` path, `view-code` (mechanical) and `edit-code` (free) on writing flows with a CLI command, `do-by-hand`
(free) where the `user` executor is allowed.

| Flow | Scope | Actions offered | Note |
| --- | --- | --- | --- |
| `project.init` | declared | run, view-code, edit-code, do-by-hand | files are architecture.yml, rules, an entry point; framework-dependent |
| `create.feature` | derived | run, view-code, edit-code, do-by-hand | |
| `create.layer` | derived | run, fill-with-ai, view-code, edit-code, do-by-hand | |
| `create.unit` | derived | run, fill-with-ai, view-code, edit-code, do-by-hand | |
| `create.page.from` | declared | run, view-code, edit-code, do-by-hand | one page file plus its Props; derivable next |
| `create.workflow.from` | declared | run, view-code, edit-code, do-by-hand | machine file (+ state union with `--state-union`) |
| `create.controller.bind` | declared | run, view-code, edit-code, do-by-hand | modifies an existing page; kind `modify` |
| `create.service.openapi` | declared | run, view-code, edit-code, do-by-hand | service file plus the shared transport client |
| `refactor.move` | declared | run, view-code, edit-code, do-by-hand | touches every importer, so the set depends on the import graph (`impact`) |
| `refactor.rename` | declared | run, view-code, edit-code, do-by-hand | same |
| `import.unit` | declared | run, fill-with-ai, view-code, edit-code, do-by-hand | |
| `import.plan` | declared | run, fill-with-ai, view-code, edit-code, do-by-hand | union of its units' files |
| `import.route` | declared | view-code, edit-code, do-by-hand | interactive wizard, user only: no `run` |
| `summarize.unit` | empty | run | |
| `summarize.list` | empty | run | |
| `summarize.usage` | empty | run | |
| `research.summarize` | empty | run | |
| `research.workflow` | empty | run | |
| `research.doctor` | empty | run | |
| `validate` | empty | run | |
| `review.analyze` | empty | run | reads two commits through temporary checkouts |
| `test.run` | empty | run | writes nothing in the project |
| `sync` | declared | run, view-code, edit-code | derived rule config and each feature's barrel; the set is computable from architecture.yml |
| `pipeline.run` | declared | run, view-code, edit-code | steps carry no scope today (see below) |
| `manual.task` | declared | do-by-hand | no CLI behind it; the only flow that is free by definition |

`test/block-flows.test.mjs` reads this table: every flow id must appear, and its Scope cell must equal
`flowScopeKind`, so the table cannot drift from the registry.

## Audit: everything else the issue named

| Surface | Fits as-is? | How it is modelled |
| --- | --- | --- |
| `allowedEvents` (`packages/engine/processMachine.mjs:233`) | Yes | `processLifecycleBlock`: read-only, empty scope; its actions are the person-facing events (`START`, `PAUSE`, `RESUME`, `RETRY`, `CANCEL`) that `allowedEvents(state)` accepts, all mechanical. The engine's own events (`STEP_COMPLETED`, `YIELDED`, ...) are not offered to a person. |
| Block palette (`packages/engine/palette.mjs`) | Yes, as data | `buildPalette` is already a rule-derived read model (from the real `canImport` graph). It is the menu source for a page block: each entry is a candidate `mechanical` action whose `blockId` is the wrap/insert block; entries that do not fit are the disabled-with-`why` case (`wrapFit`'s `not-a-fit` reason). Nothing new to compute; wiring it to `deriveActions` is #407's job. |
| Pages editor Wrap with / Auto-extract (`buildWrapSuggestions`, `extractExpression.mjs`, `construct refactor extract-expression`) | Needs a scope declaration and a flow | Mechanical, single-file edits: scope is the page file plus the new `expressions/` (and companion component) file. `extract-expression` is not in `PLAN_FLOWS` today, so it has no block; adding it as a `declared` flow (range and name args) is the follow-up. |
| Pipeline steps (`packages/engine/pipeline.mjs`, envelope `steps: [{layer, name}]`) | Needs a scope declaration | `pipeline.run` is one `declared` block; its steps declare no scope. Each step's file is `layerTargetFile(root, layer, name, feature)`, so the scope is derivable from the envelope (`feature` + `steps`) exactly as `expectedFiles` does for `create.layer`; run is already all-or-nothing in a shadow root. |
| CLI commands with no flow | Needs a flow | `refactor extract-expression`, `research impact`, `research spec` (`--generate` writes), `template` are CLI commands with no `PLAN_FLOWS` entry, so no block. `research impact` and `research spec` (without `--generate`) would be `empty`. |
| Research mode (free text to a plan) | Free-form | The text is input, not a write: empty project scope. Its output is a plan, checked by `validatePlan` (every step must name a real flow) and then run block by block. The free-text field is a `free` action on the plan block and is gated by the same four guardrails; any file it eventually causes is written by a flow block under that block's own scope. |
| Notes (`ui/server/src/notesApi.mjs`) | Free-form | Text a person owns, stored in the Cockpit's notes store outside the project tree: empty project scope, `writes: false` for the contract. Gated by the session gate, the project-open gate and server-side path derivation (containment: the client never names a path). It becomes project change only through Run, which hands a plan to the flow blocks. |
| Code drill-down ("View/edit code") | Free-form | The `view-code` (mechanical) and `edit-code` (free) actions every writing block offers. Edit is bounded by the opening block's `declaredScope`, produces a diff and passes all four guardrails (decision above). This is the escape hatch, not a primary surface. |

## Findings

- Of 25 flows, 12 fit as-is (9 read-only with an empty scope, 3 with a derived scope); 13 are writers that need a scope
  declaration from the plan step (`manual.task` among them, by definition).
- `test.run` and `review.analyze` are read-only in `PLAN_FLOWS` and get an empty scope; the contract makes that checkable
  (`RUN_READONLY_WROTE`) where before it was a comment.
- `create.workflow.from`, `create.page.from`, `create.service.openapi` and `sync` are the cheapest next derivations
  (their generators name their own output paths).

## Choosers and the decision seam (#617, part of epic #616)

(The step before a chooser, English to a noun-verb card whose unknown words are closed questions of the same shape, is
`packages/core/requirement-card.mjs`: see `docs/REQUIREMENT-CARD.md`, #640.)

(After the card and before the plan, each verb is placed by three fixed questions and assigned to the project's layers, and
the blocks compile to an ordinary plan: `packages/core/placement.mjs`, see `docs/PLACEMENT.md`, #641.)

A chooser is a block that asks ONE closed question with 2-5 options. Each option is a fixed `PLAN_FLOWS` flow plus fixed
`args` (nobody types them), so a chain of answers compiles to an ordinary plan and approval, containment and
`validatePlan` apply unchanged. `packages/core/chooser.mjs` and `packages/core/decision-provider.mjs`; nothing calls a model.

- `defineChooser({ id, question, options: [{ id, label, flow, args, why?, requires?, touches? }], exit? })` validates by
  named code (`CHOOSER_ERROR_CODES`): dotted id, 2-5 options, unique option ids, every flow in `PLAN_FLOWS`, every option's
  `args` accepted by `validatePlan` in a one-step plan (the same `argProblem` the flow blocks use), a writing flow whose
  files cannot be derived (a `declared` flow) carries `touches`. The `exit` is `{ flow: 'manual.task', args }` (default:
  do it by hand) or an `ai` action carrying every `GUARDRAILS` gate (`Fill with AI`, a reviewable diff).
- `chooserSummary(chooser, state)` is the on-demand summary, `{ id, question, options: [{ id, label, enabled, why }], chosen }`,
  at a fixed size (at most 5 options, question 160 / label 60 / why 120 characters, absolute paths redacted). A person's
  screen, an LLM's tool result and a decision model's input are all this object. `state` is
  `{ chosen?, facts?, disabled? }`: an option is disabled by a reason in `disabled`, or when its `requires` are not in `facts`.
- `compileChain(choosers, answers, ctx)` turns `{ [chooserId]: optionId }` into `{ ok, plan, decisions, errors }`. Each
  answer is a step (`deterministic` where the flow allows it), depending on the previous one, with `touches` from the option
  or from `flowBlock(flow).declaredScope(args, { root })`; the plan is returned only when `validatePlan` reports no errors.
  An unknown, missing or disabled answer, or files that cannot be derived, come back as typed errors, never a throw.
  Answer `'exit'` takes the manual exit (a `manual.task` step); an `ai` exit is not compiled into a step.
- Attribution: `ctx.by` (`person`, `llm`, `decision-model`, default `person`) and `ctx.provider`, or per answer
  `{ option, by, provider }`, are recorded per step in `decisions`. They come back BESIDE the plan, not inside it, because
  `validatePlan` rejects unknown top-level fields and is not changed for this.

The decision seam: a provider is `{ suggest(summary) }` and returns `{ option, reason, runnerUp }`. `suggest(summary,
{ provider })` calls it with a deep-frozen copy of the summary (no path, no credential, no project file) and validates
the answer: the option must be an enabled option of that summary and there must be a reason, else the result is `null`
(a throw or a hang, 5 s by default, is `null` too). A provider can only suggest; nothing it returns is executed. Built in:
`rules` (frozen, deterministic: the first enabled option, reason `first available step`, the next as runner-up) and `off`
(always `null`). A plugin such as the decision model of #633 calls `registerDecisionProvider(name, provider)`.

Worked example, run by `test/chooser.test.mjs` so it cannot go stale:

<!-- chooser-example:code -->
```js
import { defineChooser, compileChain } from '@line/construct-core/chooser';

const feature = defineChooser({
  id: 'app.feature',
  question: 'Which feature do you start with?',
  options: [
    { id: 'cart', label: 'Cart', flow: 'create.feature', args: { name: 'cart' }, why: 'The empty cart slice.' },
    { id: 'wishlist', label: 'Wishlist', flow: 'create.feature', args: { name: 'wishlist' } },
  ],
});
const unit = defineChooser({
  id: 'app.unit',
  question: 'What is its first unit?',
  options: [
    { id: 'rules', label: 'Cart rules', flow: 'create.unit', args: { layer: 'domain', name: 'cartRules', feature: 'cart' }, why: 'Pure business rules first.' },
    { id: 'page', label: 'Cart page', flow: 'create.unit', args: { layer: 'page', name: 'CartPage', feature: 'cart' } },
  ],
});

export const result = compileChain([feature, unit], { 'app.feature': 'cart', 'app.unit': 'rules' }, { root: process.cwd(), title: 'Start the cart' });
```

`result` (the files are derived from the arguments and the project's `architecture.yml`, not typed in):

<!-- chooser-example:result -->
```json
{
  "ok": true,
  "plan": {
    "version": 1,
    "ticket": {
      "source": "text",
      "title": "Start the cart"
    },
    "steps": [
      {
        "id": "s1",
        "title": "Cart",
        "flow": "create.feature",
        "args": {
          "name": "cart"
        },
        "executor": "deterministic",
        "touches": {
          "features": [
            "cart"
          ],
          "files": [
            {
              "path": "features/cart/types.ts",
              "change": "create"
            },
            {
              "path": "features/cart/index.ts",
              "change": "create"
            }
          ]
        },
        "rationale": "The empty cart slice."
      },
      {
        "id": "s2",
        "title": "Cart rules",
        "flow": "create.unit",
        "args": {
          "layer": "domain",
          "name": "cartRules",
          "feature": "cart"
        },
        "executor": "deterministic",
        "touches": {
          "features": [
            "cart"
          ],
          "files": [
            {
              "path": "features/cart/domain/CartRules.tsx",
              "change": "create",
              "layer": "domain"
            }
          ]
        },
        "rationale": "Pure business rules first.",
        "dependsOn": [
          "s1"
        ]
      }
    ]
  },
  "decisions": [
    {
      "step": "s1",
      "chooser": "app.feature",
      "option": "cart",
      "by": "person"
    },
    {
      "step": "s2",
      "chooser": "app.unit",
      "option": "rules",
      "by": "person"
    }
  ],
  "errors": []
}
```
