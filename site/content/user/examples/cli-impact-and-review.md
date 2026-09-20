**Problem.** A change that looks local is not. Someone edits a shared component and three other features break. A pull request shows a pile of changed lines, not what they mean. Asking a model "what does this touch?" costs tokens and gives a different answer each time.

**What Construct does about it.** It already knows which feature and layer every file belongs to and who imports whom. `research impact` computes the blast radius from that graph, and `review` compares two git refs against your own rules. Both are read-only, offline and repeatable.

This page is CLI only. The Review screen is in the [Cockpit examples](@user-guide/examples/cockpit-review/).

## 1. What does changing this file touch?

The repository ships a small fixture with a shared component used by three features:

```bash
construct research impact features/shared/components/CurrencyLabel.tsx \
  --dir fixtures/impact-shared --format markdown
```

Trimmed output (the full report also lists every file with the reason it is included):

```text
Impact of component:features/shared/components/CurrencyLabel.tsx: 4 feature(s) (shared, billing, checkout, reporting), 6 file(s) across 1 layer(s), depth 2; 4 warning(s); 0 rule error(s), 0 rule warning(s); every entry derived deterministically.

## Warnings

- **CROSS-FEATURE** (warning, derived): The seeds live in 1 feature(s) (shared) but the impact reaches 3 more: billing, checkout, reporting.
- **PUBLIC-API** (warning, derived): 1 implicated file(s) are re-exported from features/shared/index.ts: changing them changes feature "shared"'s public API.
- **SHARED-COMPONENT** (warning, derived): features/shared/components/CurrencyLabel.tsx is used by 3 other feature(s): billing, checkout, reporting. A change here is not feature-local.
```

Same input, same tree, same bytes. Running the JSON form twice and hashing it:

```text
$ construct research impact features/shared/components/CurrencyLabel.tsx --dir fixtures/impact-shared --format json | sha256sum
23ffcf296120b0fc81ae9a488315189cdad748ccda74dfdc876e37fb9cb3493a  -
$ construct research impact features/shared/components/CurrencyLabel.tsx --dir fixtures/impact-shared --format json | sha256sum
23ffcf296120b0fc81ae9a488315189cdad748ccda74dfdc876e37fb9cb3493a  -
```

Other ways to seed the same report: a git range (`--since main`), a list of files (`--files a,b`), or a ticket written in English (`--ticket "..."`). Anything guessed from ticket text is marked `inferred`; anything reached from a unit you named is `derived`.

## 2. What does this branch actually change?

On a branch where a page gained a `fetch()` call:

```bash
construct review main feature/invoice-fetch --format markdown
```

Trimmed output:

```text
# PR health

1 file changed across 1 feature (billing): 1 finding (0 mechanical, 1 for a conversation).

## Declared vs actual scope (not measured)

Scope is not measured for this change.

No plan is linked. That is normal for hand-written work and outside contributions. Every other check still runs.

## Rule regressions

1 new rule violation on this change (6 already there, not counted).

- **conversation** [error] PAGE-004 is newly violated in features/billing/pages/InvoicePage.tsx — Page calls fetch().

## Public surface

1 public file changed; no export was removed (0 added).

## What the flow now does

No workflow files changed, so the flows behave as before.
```

Rule regressions counts only violations that are new on the head branch: the 6 that were already there are a number, never blamed on this change. Findings are split into those a Construct block can fix mechanically and those that need a human decision; the two are never mixed. Pass `--plan <file>` and the scope check compares what the plan declared with what the branch touched.

Nothing is written. Refs are validated, git runs from temporary detached checkouts that are removed afterwards, and your working tree, index and branches are unchanged after the run.

## 3. What you can rely on

| You get | Evidence above |
|---|---|
| A blast radius without asking a model | `every entry derived deterministically` |
| The same answer every time | identical `sha256` on two runs |
| Review that knows your rules | `1 new rule violation ... (6 already there, not counted)` |
| No side effects | read-only by construction |

Checked against commit `081150b` on 2026-09-20.
