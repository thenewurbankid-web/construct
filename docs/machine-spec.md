# machine-spec.v1 — an English requirement, checked

`machine-spec.v1` is the JSON contract between the one fuzzy step (someone — a person, a form, or a
model — breaks an English requirement into states, events, transitions and functions) and everything
deterministic after it (#576): `construct research spec` refuses a spec that cannot become a real
machine or that silently dropped a sentence; only an accepted spec goes on to generate the state union,
the XState machine, the typed function stubs and their tests (R2).

- Schema: `packages/core/research/machine-spec.v1.schema.json` (draft-07).
- Validator: `packages/core/research/machine-spec.mjs` (`validateMachineSpec`, `renderMachineSpecReport`).
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
construct research spec <file> [--format json|text] [--dir <path>]
```

Exit 0 when the spec passes, 1 on any `SPEC-*` failure, 2 when the file cannot be read or is not JSON.
`--format json` prints the same shape as `construct validate --format json` — `{ status, file, counts,
violations }`, each violation with `rule`, `module`, `severity`, `file`, `path` (the item inside the
spec, e.g. `transitions[2].to`), `message`, `why`, `expected` — so a Cockpit table or a model retry
loop can point at the exact item.

```
$ construct research spec fixtures/machine-spec/unreachable-state.json
❌ SPEC-007 [machine-spec]
  fixtures/machine-spec/unreachable-state.json at states[5]
  State "passwordReset" cannot be reached from the initial state "idle".
  Why: A state nothing leads to is either a missing transition or a state the requirement never asked for.
  Expected: a transition into it from a reachable state

1 problem(s) in fixtures/machine-spec/unreachable-state.json — fix them and run again; nothing is generated from a spec that fails.
```

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
