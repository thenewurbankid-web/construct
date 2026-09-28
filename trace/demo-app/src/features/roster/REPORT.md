# line-matcher report: roster

**Dynamic parts found:** 6 (3 page values, 3 list fields) · **Actions:** 4 · **Questions asked:** 4

## Matches

| Part | Design showed | Comes from |
|---|---|---|
| projectCount | 3 | count → asText |
| plannedTotal | $245.0K | sum(budget) → moneyCompact |
| forecastTotal | $245.0K | sum(forecast) → moneyCompact |
| row.project | Apollo, Borealis, Cirrus | project → asText |
| row.owner | Lena, Arjun, Mia | skipped — answer later |
| row.backup | Lena, Arjun, Mia | skipped — answer later |
| row order | — | keep the API order |

## Actions

| Action | Where | Does |
|---|---|---|
| edit | row | select |
| delete | row | remove |
| save | page | save |
| cancel | page | clear |

## AI decisions to review

- **value.plannedTotal** → sum(budget) of the list, shown as moneyCompact
  ollama:qwen2.5-coder:1.5b: The planned total is the sum of all budgets.
- **value.forecastTotal** → sum(forecast) of the list, shown as moneyCompact
  ollama:qwen2.5-coder:1.5b: The planned total is the sum of all budgets.

## Open items — what would close them

- **row.owner** (skipped) — "lead" and "deputy" both reproduce "Lena", "Arjun", "Mia", so the mock data can't tell them apart.
  → Make them differ in at least one row. For example, in the row with id 1, change "deputy" to something other than "Lena". Whichever field still shows "Lena" is then the match.
- **row.backup** (skipped) — "lead" and "deputy" both reproduce "Lena", "Arjun", "Mia", so the mock data can't tell them apart.
  → Make them differ in at least one row. For example, in the row with id 1, change "deputy" to something other than "Lena". Whichever field still shows "Lena" is then the match.

## Skipped — answer later

- Row part "owner" (e.g. "Lena") matches more than one API field, and the mock data can't tell them apart. Which one is meant?
- Row part "backup" (e.g. "Lena") matches more than one API field, and the mock data can't tell them apart. Which one is meant?

## Layers (7)

- **Route** — the feature is reached at /roster
- **Controller** — 4 data props and 4 actions must be wired to the page
- **Workflow** — states: loading/ready/failed/creating/updating/removing; events: EDIT, DELETE, SAVE, CANCEL
- **Service** — 4 API endpoints are called
- **Domain** — computed values (projectCount, plannedTotal, forecastTotal), turning form input into API types
- **Page** — the designed JSX, rewritten to take props
- **Component** — the repeated "roster" row becomes RosterRow

## Questions & answers

- Row part "owner" (e.g. "Lena") matches more than one API field, and the mock data can't tell them apart. Which one is meant?
  → left open (auto mode) — answer later
- Row part "backup" (e.g. "Lena") matches more than one API field, and the mock data can't tell them apart. Which one is meant?
  → left open (auto mode) — answer later
- "plannedTotal" (shows "$245.0K") can be computed more than one way from the mock data. Which is meant?
  → sum(budget) of the list, shown as moneyCompact
- "forecastTotal" (shows "$245.0K") can be computed more than one way from the mock data. Which is meant?
  → sum(forecast) of the list, shown as moneyCompact

## Files

- features/roster/route/RosterRoute.jsx
- features/roster/controller/RosterController.jsx
- features/roster/workflow/roster.workflow.js
- features/roster/service/roster.service.js
- features/roster/domain/roster.domain.js
- features/roster/domain/roster.domain.test.js
- features/roster/page/RosterPage.jsx
- features/roster/component/RosterRow.jsx
- features/roster/mocks/roster.mock.js
