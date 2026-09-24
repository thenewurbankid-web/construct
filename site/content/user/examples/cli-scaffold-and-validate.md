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
construct create layer Core --feature core --layers page,controller
```

The last command gives the entry page `app/page.tsx` the `CoreController` it imports, which `init` prints a note about; without it `validate` would also report that import as unresolved.

Real output. The parts were asked for in a different order than they were built:

```text
Initialized Construct in .../shop (framework: nextjs)
Scaffolded 6 project file(s): package.json, tsconfig.json, next.config.mjs, next-env.d.ts, app/layout.tsx, .gitignore
Next: cd shop && npm install && npm run dev
Note: the entry file imports features/core/controllers/CoreController, which does not exist yet; generate it (construct generate layer core --feature core --layers domain,service,workflow,hook,component,page,controller) or `construct validate` and the dev server will report the unresolved import.
Created feature billing at features/billing (0.01s)
[tool: scaffolded the file(s) above from templates] [llm: 0 calls — filling in the logic is a separate step, by you or whichever LLM you choose]
Created features/billing/domain/Invoice.tsx (0.01s)
Created features/billing/hooks/useInvoice.tsx (0.00s)
Created features/billing/pages/InvoicePage.tsx (0.00s)
Created features/billing/controllers/InvoiceController.tsx (0.00s)
Total: 0.03s
[tool: scaffolded the file(s) above from templates] [llm: 0 calls — filling in the logic is a separate step, by you or whichever LLM you choose]
Created features/core/pages/CorePage.tsx (0.02s)
Created features/core/controllers/CoreController.tsx (0.00s)
Total: 0.02s
[tool: scaffolded the file(s) above from templates] [llm: 0 calls — filling in the logic is a separate step, by you or whichever LLM you choose]
```

Two things to notice. The parts are always built in dependency order (domain, then hook, then page, then controller) whatever order you type them, so imports resolve. And every `create` command ends with a line that says whether a model was involved. Here: `0 calls`.

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

The exit code is `1` because this is an error. Warnings are printed after it but do not fail the run. Here there are three `SLICE-003` warnings, because the new hook and controllers are not exported from their feature's `index.ts` yet (the block above is that run trimmed to the error). A public export with no description is another common one (`READ-003`).

## You get

| You get | Evidence above |
|---|---|
| The rule, file, line, reason and fix in one place | the `PAGE-004` block |
| A pass/fail you can put in CI | exit code `1` with an error |
| No model in the loop unless you ask | `[llm: 0 calls]` on every `create` command |
| Per-step timing, from Construct itself | `(0.01s)` per file, `Total: 0.03s` |

Every rule id and its default severity is listed in the [Rule reference](@developers/rules-reference/); severity and time-boxed exceptions are covered in [Validate and tune the rules](@user-guide/how-to/tune-rules/).

## Why it matters

A rule break is caught in milliseconds, with the file, the line and the fix, before the fifth feature copies it.

Checked against commit `a33b5fa` on 2026-09-24.
