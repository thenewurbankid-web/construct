**Problem.** A model, or a tired human, puts a `fetch()` call in a page component. It works, it ships, and the page now owns application flow. Nobody notices until the fifth feature copies it. The same rule is written in prose in a hundred READMEs and enforced by none.

The rule lives in `architecture.yml` and `construct validate` checks it in milliseconds, with no model and no network. It names the rule, the file and the line, says why, and says how to fix it. Scaffolding follows the same rules, so a new file starts out in the right place.

This page is CLI only. The same actions from a browser are in the [Cockpit examples](@user-guide/examples/); the code behind them is in the [Core examples](@user-guide/examples/core-plans-and-impact/).

## Do this

### 1. Scaffold a feature, in dependency order

```bash
construct init shop
cd shop
construct create feature billing
construct create layer Invoice --feature billing --layers page,domain,controller,hook
```

Real output. The parts were asked for in a different order than they were built:

```text
Initialized Construct in .../shop (framework: nextjs)
Created feature billing at features/billing (0.01s)
[tool: scaffolded the file(s) above from templates] [llm: 0 calls — filling in the logic is a separate step, by you or whichever LLM you choose]
Created features/billing/domain/Invoice.tsx (0.01s)
Created features/billing/hooks/useInvoice.tsx (0.00s)
Created features/billing/pages/InvoicePage.tsx (0.00s)
Created features/billing/controllers/InvoiceController.tsx (0.00s)
Total: 0.03s
[tool: scaffolded the file(s) above from templates] [llm: 0 calls — filling in the logic is a separate step, by you or whichever LLM you choose]
```

Two things to notice. The parts are always built in dependency order (domain, then hook, then page, then controller) whatever order you type them, so imports resolve. And every command ends with a line that says whether a model was involved. Here: `0 calls`.

### 2. Break a rule on purpose

Add a data fetch to the page, then validate:

```bash
printf '\nexport async function load() { return fetch("/api/invoices"); }\n' >> features/billing/pages/InvoicePage.tsx
construct validate
```

```text
❌ PAGE-004 [architecture]
  features/billing/pages/InvoicePage.tsx:7
  Page calls fetch().
  Why: Pages cannot own application flow.
  Expected: controller or workflow
  Fix: Move the responsibility to controller or workflow.
```

The exit code is `1` because this is an error. Warnings, such as a public export with no description, are printed but do not fail the run.

## You get

| You get | Evidence above |
|---|---|
| The rule, file, line, reason and fix in one place | the `PAGE-004` block |
| A pass/fail you can put in CI | exit code `1` with an error |
| No model in the loop unless you ask | `[llm: 0 calls]` on every command |
| Per-step timing, from Construct itself | `(0.01s)` per file, `Total: 0.03s` |

Every rule id and its default severity is listed in the [Rule reference](@developers/rules-reference/); severity and time-boxed exceptions are covered in [Validate and tune the rules](@user-guide/how-to/tune-rules/).

## Why it matters

A rule break is caught in milliseconds, with the file, the line and the fix, before the fifth feature copies it.

Checked against commit `d23283f` on 2026-09-23.
