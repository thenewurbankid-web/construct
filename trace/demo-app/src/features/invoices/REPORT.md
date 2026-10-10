# line-matcher report: invoices

**Dynamic parts found:** 10 (4 page values, 6 list fields) · **Actions:** 4 · **Questions asked:** 6

## Matches

| Part | Design showed | Comes from |
|---|---|---|
| invoiceCount | 4 | count → asText |
| totalBilled | $107.9M | sum(amount) → moneyCompact |
| largestInvoice | $48.2M | skipped — answer later |
| syncedAt | 26 Sep 2026 | skipped — answer later |
| row.number | INV-1042, INV-1044, INV-1041, INV-1043 | number → asText |
| row.vendor | Kestrel Packaging, Oriel Chemicals, Northwind Freight, Bluepeak IT | vendor → asText |
| row.amount | $48.2M, $31.6M, $18.4M, $9.7M | amount → moneyCompact |
| row.dueDate | 2 Aug 2026, 9 Aug 2026, 21 Aug 2026, 5 Sep 2026 | dueDate → dateShort |
| row.requestedBy | Lena, Mia, Prerna, Arjun | skipped — answer later |
| row.status | Overdue, Overdue, Open, Partial | skipped — answer later |
| row order | — | keep the API order |

## Actions

| Action | Where | Does |
|---|---|---|
| edit | row | select |
| delete | row | remove |
| save | page | save |
| cancel | page | clear |

## Open items — what would close them

- **row.requestedBy** (skipped) — "requester" and "assignee" both reproduce "Lena", "Mia", "Prerna", "Arjun", so the mock data can't tell them apart.
  → Make them differ in at least one row. For example, in the row with id 2, change "assignee" to something other than "Lena". Whichever field still shows "Lena" is then the match.
- **row.status** (skipped) — No API field, with any built-in format, produces "Overdue", "Overdue", "Open", "Partial".
  → If the API has it, add a field to the GET response with these values per row (id 2 → "Overdue", id 4 → "Overdue", id 1 → "Open", id 3 → "Partial"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **largestInvoice** (skipped) — max(amount) and max(outstanding) both give "$48.2M".
  → They peak on the same row (max(amount) is at id 2, max(outstanding) is at id 2). Change "amount" or "outstanding" on that row, or add a row where they peak differently.
- **syncedAt** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "26 Sep 2026".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **row order** (skipped) — sort by amount descending; sort by outstanding descending; sort by dueDate ascending all give the designed order for these 4 rows.
  → Add or edit a row so these orders differ (for example give the last row the largest value of the second field). The sort that still matches the design is then the right one.
- **archive (row action)** (skipped) — "archive" isn't a verb the tool knows (create, add, update, save, delete, remove, edit, select, cancel, reset, refresh).
  → Rename it in the design (data-action) to a known verb, or answer with your own placeholder handler.

## Skipped — answer later

- Row part "requestedBy" (e.g. "Lena") matches more than one API field, and the mock data can't tell them apart. Which one is meant?
- Row part "status" (e.g. "Overdue") can't be produced from any API field. What is it?
- The designed row order matches more than one sort on the mock data. How should "invoices" be sorted?
- "largestInvoice" (shows "$48.2M") can be computed more than one way from the mock data. Which is meant?
- "syncedAt" (shows "26 Sep 2026") can't be computed from the mock data. What is it?
- What should the "archive" row action do?

## Layers (7)

- **Route** — the feature is reached at /invoices
- **Controller** — 5 data props and 4 actions must be wired to the page
- **Workflow** — states: loading/ready/failed/creating/updating/removing; events: EDIT, DELETE, SAVE, CANCEL
- **Service** — 4 API endpoints are called
- **Domain** — computed values (invoiceCount, totalBilled), formatted row fields, turning form input into API types
- **Page** — the designed JSX, rewritten to take props
- **Component** — the repeated "invoices" row becomes InvoiceRow

## Questions & answers

- Row part "requestedBy" (e.g. "Lena") matches more than one API field, and the mock data can't tell them apart. Which one is meant?
  → left open (auto mode) — answer later
- Row part "status" (e.g. "Overdue") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- The designed row order matches more than one sort on the mock data. How should "invoices" be sorted?
  → left open (auto mode) — answer later
- "largestInvoice" (shows "$48.2M") can be computed more than one way from the mock data. Which is meant?
  → left open (auto mode) — answer later
- "syncedAt" (shows "26 Sep 2026") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- What should the "archive" row action do?
  → left open (auto mode) — answer later

## Files

- features/invoices/route/InvoicesRoute.jsx
- features/invoices/controller/InvoicesController.jsx
- features/invoices/workflow/invoices.workflow.js
- features/invoices/service/invoices.service.js
- features/invoices/domain/invoices.domain.js
- features/invoices/domain/invoices.domain.test.js
- features/invoices/page/InvoicesPage.jsx
- features/invoices/component/InvoiceRow.jsx
- features/invoices/mocks/invoices.mock.js
