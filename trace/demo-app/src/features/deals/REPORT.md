# line-matcher report: deals

**Dynamic parts found:** 17 (8 page values, 9 list fields) · **Actions:** 3 · **Questions asked:** 8

## Matches

| Part | Design showed | Comes from |
|---|---|---|
| dealCount | 6 | count → asText |
| pipeline | $453.1M | sum(value) → moneyCompact |
| avgDeal | $75.5M | average(value) → moneyCompact |
| largest | $152.5M | max(value) → moneyCompact |
| smallest | $9.8M | min(value) → moneyCompact |
| avgMargin | 28.8% | average(margin) → percent |
| weighted | $137.6M | skipped — answer later |
| syncedAt | 26 Sep 2026 | skipped — answer later |
| row.name | Borealis Expansion, Ember Platform, Atlas Renewal, Delta Upgrade, Cirrus Pilot, Fjord Support | name → asText |
| row.account | Kestrel, Harbor, Northwind, Oriel, Bluepeak, Vantage | account → asText |
| row.contact | Arjun Rao, Prerna Iyer, Lena Kumar, Ravi Nair, Mia Shah, Kabir Sen | skipped — answer later |
| row.owner | Mia, Arjun, Prerna, Lena, Ravi, Mia | skipped — answer later |
| row.csm | Mia, Arjun, Prerna, Lena, Ravi, Mia | skipped — answer later |
| row.value | $152.5M, $118.0M, $84.0M, $61.3M, $27.5M, $9.8M | value → moneyCompact |
| row.margin | 28.1%, 36.0%, 32.5%, 19.8%, 41.2%, 15.0% | margin → percent |
| row.closeOn | 2 Oct 2026, 5 Dec 2026, 14 Oct 2026, 29 Oct 2026, 20 Nov 2026, 3 Nov 2026 | closeOn → dateShort |
| row.stage | Proposal, Proposal, Negotiation, Negotiation, Qualified, Won | skipped — answer later |
| row order | — | sort by value descending |

## Actions

| Action | Where | Does |
|---|---|---|
| edit | row | select |
| save | page | save |
| cancel | page | clear |

## Open items — what would close them

- **row.contact** (skipped) — No API field, with any built-in format, produces "Arjun Rao", "Prerna Iyer", "Lena Kumar", "Ravi Nair", "Mia Shah", "Kabir Sen".
  → If the API has it, add a field to the GET response with these values per row (id 2 → "Arjun Rao", id 5 → "Prerna Iyer", id 1 → "Lena Kumar", id 4 → "Ravi Nair"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.owner** (skipped) — "owner" and "csm" both reproduce "Mia", "Arjun", "Prerna", "Lena", "Ravi", "Mia", so the mock data can't tell them apart.
  → Make them differ in at least one row. For example, in the row with id 2, change "csm" to something other than "Mia". Whichever field still shows "Mia" is then the match.
- **row.csm** (skipped) — "owner" and "csm" both reproduce "Mia", "Arjun", "Prerna", "Lena", "Ravi", "Mia", so the mock data can't tell them apart.
  → Make them differ in at least one row. For example, in the row with id 2, change "csm" to something other than "Mia". Whichever field still shows "Mia" is then the match.
- **row.stage** (skipped) — No API field, with any built-in format, produces "Proposal", "Proposal", "Negotiation", "Negotiation", "Qualified", "Won".
  → If the API has it, add a field to the GET response with these values per row (id 2 → "Proposal", id 5 → "Proposal", id 1 → "Negotiation", id 4 → "Negotiation"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **weighted** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "$137.6M".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **syncedAt** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "26 Sep 2026".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **forecast (row action)** (skipped) — "forecast" isn't a verb the tool knows (create, add, update, save, delete, remove, edit, select, cancel, reset, refresh).
  → Rename it in the design (data-action) to a known verb, or answer with your own placeholder handler.
- **delete (row action)** (skipped) — "delete" looks like "remove", but the API for it (remove) wasn't given.
  → Add a DELETE endpoint to the API contract (the feature's OpenAPI file: edit it or upload a new one); it is wired as soon as you re-run.
- **input notes** (gap) — The form has an input "notes" but no example request body has it.
  → Add "notes" to the request example of the POST/PUT in the API contract (the feature's OpenAPI file), or remove the input from the design.
- **input owner** (gap) — The API request expects "owner" but the form has no input for it.
  → Add an input named "owner" to the design's form, or remove "owner" from the request example.

## Skipped — answer later

- Row part "contact" (e.g. "Arjun Rao") can't be produced from any API field. What is it?
- Row part "owner" (e.g. "Mia") matches more than one API field, and the mock data can't tell them apart. Which one is meant?
- Row part "csm" (e.g. "Mia") matches more than one API field, and the mock data can't tell them apart. Which one is meant?
- Row part "stage" (e.g. "Proposal") can't be produced from any API field. What is it?
- "weighted" (shows "$137.6M") can't be computed from the mock data. What is it?
- "syncedAt" (shows "26 Sep 2026") can't be computed from the mock data. What is it?
- What should the "forecast" row action do?
- "delete" looks like "remove", but the API for it (remove) wasn't given. What should it do?

## Layers (7)

- **Route** — the feature is reached at /deals
- **Controller** — 9 data props and 3 actions must be wired to the page
- **Workflow** — states: loading/ready/failed/creating/updating; events: EDIT, SAVE, CANCEL
- **Service** — 3 API endpoints are called
- **Domain** — computed values (dealCount, pipeline, avgDeal, largest, smallest, avgMargin), formatted row fields, sorting by value, turning form input into API types
- **Page** — the designed JSX, rewritten to take props
- **Component** — the repeated "deals" row becomes DealRow

## Questions & answers

- Row part "contact" (e.g. "Arjun Rao") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "owner" (e.g. "Mia") matches more than one API field, and the mock data can't tell them apart. Which one is meant?
  → left open (auto mode) — answer later
- Row part "csm" (e.g. "Mia") matches more than one API field, and the mock data can't tell them apart. Which one is meant?
  → left open (auto mode) — answer later
- Row part "stage" (e.g. "Proposal") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- "weighted" (shows "$137.6M") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- "syncedAt" (shows "26 Sep 2026") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- What should the "forecast" row action do?
  → left open (auto mode) — answer later
- "delete" looks like "remove", but the API for it (remove) wasn't given. What should it do?
  → left open (auto mode) — answer later

## Gaps

- The API expects "owner" but the form has no input for it.

## Files

- features/deals/route/DealsRoute.jsx
- features/deals/controller/DealsController.jsx
- features/deals/workflow/deals.workflow.js
- features/deals/service/deals.service.js
- features/deals/domain/deals.domain.js
- features/deals/domain/deals.domain.test.js
- features/deals/page/DealsPage.jsx
- features/deals/component/DealRow.jsx
- features/deals/mocks/deals.mock.js
