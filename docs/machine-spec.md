# machine-spec.v1 — an English requirement, checked

`machine-spec.v1` is the JSON contract between the one fuzzy step (someone — a person, a form, or a
model — breaks an English requirement into states, events, transitions and functions) and everything
deterministic after it (#576): `construct research spec` refuses a spec that cannot become a real
machine or that silently dropped a sentence; only an accepted spec goes on to generate the state union,
the XState machine and the typed function stubs (R2, `--generate`, below). A unit test per machine is
a separate step, `construct generate tests --unit` (#583), once the workflow exists.

- Schema: `packages/core/research/machine-spec.v1.schema.json` (draft-07).
- Validator: `packages/core/research/machine-spec.mjs` (`validateMachineSpec`, `renderMachineSpecReport`).
- Generator, R2 (#593): `packages/core/research/specToCode.mjs` (`buildWorkflowDescriptor`, `functionStubSource`, `generateFromSpec`).
- Worked example (passes): `packages/core/research/examples/machine-spec.v1.example.json`.
- Failing examples, one per refusal: `fixtures/machine-spec/{unreachable-state,untyped-function,uncovered-sentence}.json`.

To draft one with a model, hand it the schema plus the worked example — not instructions. The example
is the documentation.

## The shape (from the worked example, "sign-in with retry")

```json
{
  "version": 1,
  "name": "sign-in with retry",
  "feature": "auth",
  "requirement": [
    { "id": "s1", "text": "A visitor signs in with an email and a password." },
    { "id": "s4", "text": "If the credentials are invalid, the visitor sees the reason and can try again." },
    { "id": "s6", "text": "The sign-in page must load in under two seconds." }
  ],
  "outOfScope": [
    { "req": "s6", "reason": "A performance budget, not machine behaviour: checked by a Lighthouse threshold in CI." }
  ],
  "states": [
    { "id": "idle", "initial": true, "req": ["s1"] },
    { "id": "failed", "description": "The reason is shown; the form is editable again.", "req": ["s4"] },
    { "id": "signedIn", "final": true, "req": ["s3"] }
  ],
  "events": [
    { "id": "SUBMIT", "payload": "{ email: string; password: string }", "req": ["s1"] },
    { "id": "RETRY", "req": ["s4"] }
  ],
  "transitions": [
    { "id": "t1", "from": "idle", "to": "checking", "event": "SUBMIT", "req": ["s1", "s2"] },
    { "id": "t3", "from": "checking", "to": "lockedOut", "event": "INVALID", "guard": "attemptsExhausted", "req": ["s5"] },
    { "id": "t5", "from": "failed", "to": "idle", "event": "RETRY", "req": ["s4"] }
  ],
  "functions": [
    {
      "name": "recordFailedAttempt",
      "input": "{ attempts: number }",
      "output": "{ attempts: number; exhausted: boolean }",
      "precondition": "attempts is a non-negative integer (0 before the first failure).",
      "postcondition": "attempts is one higher than the input; exhausted is true exactly when the new count is 3 or more.",
      "req": ["s5"]
    }
  ]
}
```

| Field | What it is |
|---|---|
| `requirement[]` | The English, one sentence per entry, verbatim, with an `id`. Reading order. |
| `outOfScope[]` | Sentences that deliberately produce nothing, each with a `reason`. |
| `states[]` | `id`, optional `initial` (exactly one), `final`, `description`. |
| `events[]` | `id`, optional `payload` (a TypeScript type), `description`. |
| `transitions[]` | `from`, `to`, `event`, optional `guard` (a named boolean condition), `id`, `description`. |
| `functions[]` | `name` (a TypeScript identifier), `input` and `output` (TypeScript types; `void` for none), `precondition`, `postcondition`. |
| `req` | On every state, event, transition and function: the sentence id(s) it came from. |
| `ext` | Free-form, ignored by validators. |

Every sentence is either claimed by some item's `req` or listed under `outOfScope` — never neither,
never both.

## The command

```
construct research spec <file> [--generate [--feature <name>]] [--format json|text] [--dir <path>]
```

Exit 0 when the spec passes, 1 on any `SPEC-*` failure, 2 when the file cannot be read or is not JSON
(or, with `--generate`, when neither the spec nor `--feature` names a feature). `--format json` prints
the same shape as `construct validate --format json` — `{ status, file, counts, violations }`, each
violation with `rule`, `module`, `severity`, `file`, `path` (the item inside the spec, e.g.
`transitions[2].to`), `message`, `why`, `expected` — so a Cockpit table or a model retry loop can point
at the exact item.

```
$ construct research spec fixtures/machine-spec/unreachable-state.json
❌ SPEC-007 [machine-spec]
  fixtures/machine-spec/unreachable-state.json at states[5]
  State "passwordReset" cannot be reached from the initial state "idle".
  Why: A state nothing leads to is either a missing transition or a state the requirement never asked for.
  Expected: a transition into it from a reachable state

1 problem(s) in fixtures/machine-spec/unreachable-state.json — fix them and run again; nothing is generated from a spec that fails.
```

## `--generate`, R2 (#593): spec to code

On an accepted spec, `--generate` calls `packages/core/research/specToCode.mjs`'s `generateFromSpec`
to write real code, deterministically, no LLM:

- **The workflow**, via `packages/engine/workflowGenerator.mjs`'s existing `generateWorkflow` with
  `{ stateUnion: true }` (#580): `initial` is the state marked `initial`; each state becomes
  `{ type: final ? 'final' : undefined, on: {...} }`; transitions are grouped by `(from, event)`
  (`SPEC-006` already guarantees the grouping is never ambiguous), guarded entries ordered before the
  unguarded fallback so XState tries them first. Also writes `<Name>WorkflowState.ts` (the typed state
  union and exhaustive matcher).
- **A named stub per guard**, new in `workflowGenerator.mjs`'s `compileWorkflow` (#593): every `guard`
  a transition names gets a `setup({ guards: {...} })` entry that returns `false` with a `// TODO:`
  comment naming the req sentence(s) the guarded transition exists to satisfy — a transition never
  points at a dangling guard name, even before the real predicate is written.
- **One function stub per `functions[]` entry**, through `defineService`
  (`packages/core/typed-contracts/factories.ts`) — the v1 schema has no per-function layer field, so
  every function lands in the **service** layer; a future schema version could add one. Its
  `input`/`output` type strings are parsed and re-printed via `workflowGenerator.mjs`'s
  `parseTypeString` (the same step the workflow's context fields already use); its precondition,
  postcondition and req sentence text land as comments directly above the stub, which throws rather
  than returning a fabricated value.

Never overwrites an existing file — same policy as `construct init`'s project scaffold
(`packages/core/scaffold.mjs`) (#497): a target that already exists is reported `Skipped ... (already
exists, not overwritten)`, so running the same spec against the same project twice writes nothing new
the second time. `--feature` is used only when the spec itself has no `feature` field; it is a usage
error (exit 2) for neither to name one.

```
$ construct research spec packages/core/research/examples/machine-spec.v1.example.json --generate
✓ machine-spec.v1 ... passed — 6 sentence(s): 5 covered, 1 out of scope; 5 state(s), 4 event(s), 5 transition(s), 3 function(s)
Wrote features/auth/types.ts
Wrote features/auth/index.ts
Wrote features/auth/workflows/SignInWithRetryWorkflow.tsx
Wrote features/auth/workflows/SignInWithRetryWorkflowState.ts
Wrote features/auth/services/verifyCredentials.ts
Wrote features/auth/services/recordFailedAttempt.ts
Wrote features/auth/services/openDashboard.ts
Generated feature "auth": 7 file(s) written, 0 skipped.
```

`features/auth/services/verifyCredentials.ts` (one of the three function stubs):

```ts
import { defineService } from '<relative path to @construct/typed-contracts>';

// Generated by `construct research spec --generate` (#593) from a machine-spec.v1 function entry.
// Precondition: email and password are both non-empty strings.
// Postcondition: Resolves { ok: true, session } when the pair matches an account; otherwise { ok: false, reason } with a reason that does not say which of the two was wrong.
// req: s1 ("A visitor signs in with an email and a password."), s3 (...), s4 (...)
export const verifyCredentials = defineService("verifyCredentials", (props: {
    email: string;
    password: string;
}): Promise<{
    ok: true;
    session: Session;
} | {
    ok: false;
    reason: string;
}> => {
  throw new Error("Not implemented: verifyCredentials (see the precondition/postcondition comment above).");
});
```

The generated project passes `construct validate` cleanly (`test/specToCode.test.mjs` runs the real
validator over it, not a claim).

### Known gaps

- `events[].payload` (a TS type string) is not yet threaded into the generated event union —
  `<Name>Event` stays `{ type: 'EVENT' }` only, same as plain `construct generate workflow --from`
  today. Typing it is separate follow-up work inside `workflowGenerator.mjs`'s `buildEventUnionType`.
- A function's `input`/`output` type string can reference a type the stub file never declares or
  imports (e.g. the worked example's `Session`) — `machine-spec.mjs`'s `SPEC-008` only checks that a
  type string is present and non-empty, not that every name it references resolves. The stub still
  compiles as *shape* (parsed and re-printed via `parseTypeString`); wiring it to a real, importable
  type is a follow-up (R3/R4?) once functions can also carry their own imports.

## The checks

Structure first (`SPEC-001`), then meaning only once the structure is sound.

| Code | Refuses |
|---|---|
| `SPEC-001` | Anything outside the schema's shape: unknown, missing or mistyped field (path names it). |
| `SPEC-002` | An id used twice in the same list (sentences, states, events, transition ids, function names, out-of-scope entries). |
| `SPEC-003` | Not exactly one state marked `initial`. |
| `SPEC-004` | A transition whose `from` or `to` is not a declared state (`expected` lists the states). |
| `SPEC-005` | A transition whose `event` is not a declared event. |
| `SPEC-006` | Two transitions with the same `from`, `event` and `guard` — the second could never fire. |
| `SPEC-007` | A state not reachable from the initial state by walking the transitions. |
| `SPEC-008` | A function with no `input` or `output` type. |
| `SPEC-009` | A `req` (or `outOfScope.req`) naming a sentence that is not in `requirement`. |
| `SPEC-010` | A sentence neither covered by any item's `req` nor listed under `outOfScope`. |
| `SPEC-011` | A sentence listed under `outOfScope` that an item still claims. |
| `SPEC-012` | A transition leaving a `final` state. |

The schema and the validator are kept in lockstep by `test/machineSpec.test.mjs` (ajv, dev-only):
what the schema can express, both refuse; the graph walk and the coverage checks are the validator's own.
