**Problem.** A workflow (a state machine) is the part of an app nobody can read at a glance, and its tests are either missing or written once by hand and never updated when the flow changes. "Does it cover every path?" is answered by hope.

It reads the state machine from the code, enumerates every route through it, explains each in plain English, and writes one locked Playwright test per route. Change the flow, regenerate, and the tests follow. No model is involved.

This page is CLI only. The Tests screen, cloning and the step editor are in the [Cockpit examples](@user-guide/examples/cockpit-tests/).

## Do this

### 1. Every route through a flow, in English

```bash
construct research workflow login --format scenarios
```

```text
== features/login/workflows/Login.tsx ==

Happy path
  Route: idle → success
  Given the flow starts in *idle*
  When "submit" happens — only if it is valid
  Then the flow moves to *success*
  And the flow ends — *success* is an end state

Otherwise, then submit is valid (ends in success)
  Route: idle → rejected → success
  Given the flow starts in *idle*
  When "submit" happens, when none of the conditions above apply
  Then the flow moves to *rejected*
  And when "submit" happens — only if it is valid
  Then the flow moves to *success*
  And the flow ends — *success* is an end state
  Note: in *rejected* the flow can start that step over when "submit" happens, so this part can repeat.

Explained 1 machine(s) in 1 file(s) (0.03s)
[tool: produced the read-only report above] [llm: 0 calls]
```

### 2. One locked test per route

Generated tests live in a region only the generator may write, outside the normal parts. Declare both once in `architecture.yml`:

```yaml
frozen:
  - features/*/tests/generated/**
nonLayer:
  - features/*/tests/**
```

Without them the command refuses and prints exactly these lines. With them:

```bash
construct generate tests login
```

```text
Wrote features/login/tests/generated/login--ends-success-via-submit-otherwise-then-submit-if-is-valid.spec.ts
Wrote features/login/tests/generated/login--happy-path.spec.ts
2 spec(s) for feature "login" (2 written, 0 unchanged; 2 pending a fixture), start URL /login (0.08s)
```

Run it again and nothing changes:

```text
Unchanged features/login/tests/generated/login--ends-success-via-submit-otherwise-then-submit-if-is-valid.spec.ts
Unchanged features/login/tests/generated/login--happy-path.spec.ts
2 spec(s) for feature "login" (0 written, 2 unchanged; 2 pending a fixture), start URL /login (0.08s)
```

Each file starts with the scenario in the same Given/When/Then words as step 1, records a hash of the flow it came from, and is marked locked. The test finds your page elements by a naming convention (`data-testid` is the event name in kebab-case, `data-flow-state` shows the current state). If an attribute is missing, the failure says so and tells you not to file a product bug. "Pending a fixture" means a branch needs something the page cannot choose (a failing service, a guard); those are written as `test.fixme` naming what is needed.

Options: `--dry-run` shows what would be written, `--prune` removes generated files for routes that no longer exist. Only `features/<feature>/tests/generated/` is ever written, and a file without the generated marker is never overwritten.

## You get

| You get | Evidence above |
|---|---|
| Every path through the flow, listed | `Happy path`, `Otherwise, then submit is valid (ends in success)` |
| Tests that follow the flow | regenerate after a change; untouched routes stay `Unchanged` |
| Your own edits are safe | generated tests are locked; clone one to change it |
| No model | `[llm: 0 calls]` |

## Why it matters

Every route through a flow is explained and tested, and the tests follow the flow when it changes.

Checked against commit `b6f4032` on 2026-09-26.
