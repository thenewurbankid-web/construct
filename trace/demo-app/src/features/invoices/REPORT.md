# line-matcher report: invoices

**Dynamic parts found:** 10 (4 page values, 6 list fields) · **Actions:** 5 · **Questions asked:** 6

## Matches

| Part | Design showed | Comes from |
|---|---|---|
| invoiceCount | 4 | count → asText |
| totalBilled | $107.9M | sum(amount) → moneyCompact |
| largestInvoice | $48.2M | placeholder getLargestInvoice() |
| syncedAt | 26 Sep 2026 | placeholder getSyncedAt() |
| row.number | INV-1042, INV-1044, INV-1041, INV-1043 | number → asText |
| row.vendor | Kestrel Packaging, Oriel Chemicals, Northwind Freight, Bluepeak IT | vendor → asText |
| row.amount | $48.2M, $31.6M, $18.4M, $9.7M | amount → moneyCompact |
| row.dueDate | 2 Aug 2026, 9 Aug 2026, 21 Aug 2026, 5 Sep 2026 | dueDate → dateShort |
| row.requestedBy | Lena, Mia, Prerna, Arjun | placeholder getRequestedBy() |
| row.status | Overdue, Overdue, Open, Partial | placeholder getStatus() |
| row order | — | sort by amount descending |

## Actions

| Action | Where | Does |
|---|---|---|
| edit | row | select |
| archive | row | placeholder handleArchive() |
| delete | row | remove |
| save | page | save |
| cancel | page | clear |

## Open items — what would close them

- **row.requestedBy** (placeholder) — getRequestedBy() is a placeholder in the controller layer.
  → Write the real logic in getRequestedBy(), or close it by data: Make them differ in at least one row. For example, in the row with id 2, change "assignee" to something other than "Lena". Whichever field still shows "Lena" is then the match.
- **row.status** (placeholder) — getStatus() is a placeholder in the controller layer.
  → Write the real logic in getStatus(), or close it by data: If the API has it, add a field to the GET response with these values per row (id 2 → "Overdue", id 4 → "Overdue", id 1 → "Open", id 3 → "Partial"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **largestInvoice** (placeholder) — getLargestInvoice() is a placeholder in the controller layer.
  → Write the real logic in getLargestInvoice(), or close it by data: They peak on the same row (max(amount) is at id 2, max(outstanding) is at id 2). Change "amount" or "outstanding" on that row, or add a row where they peak differently.
- **syncedAt** (placeholder) — getSyncedAt() is a placeholder in the controller layer.
  → Write the real logic in getSyncedAt(), or close it by data: If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **archive (row action)** (placeholder) — handleArchive() is a placeholder in the controller layer.
  → Write the real logic in handleArchive(), or close it by data: Rename it in the design (data-action) to a known verb, or answer with your own placeholder handler.

## Placeholders to fill in

| Part | Function | Layer | Input |
|---|---|---|---|
| row.requestedBy | getRequestedBy() | Controller | controller |
| row.status | getStatus() | Controller | controller |
| largestInvoice | getLargestInvoice() | Controller | controller |
| syncedAt | getSyncedAt() | Controller | controller |
| archive (row action) | handleArchive() | Controller | your handler |

## Layers (7)

- **Route** — the feature is reached at /invoices
- **Controller** — 5 data props and 5 actions must be wired to the page
- **Workflow** — states: loading/ready/failed/creating/updating/removing; events: EDIT, ARCHIVE, DELETE, SAVE, CANCEL
- **Service** — 4 API endpoints are called
- **Domain** — computed values (invoiceCount, totalBilled), formatted row fields, sorting by amount, turning form input into API types
- **Page** — the designed JSX, rewritten to take props
- **Component** — the repeated "invoices" row becomes InvoiceRow

## Questions & answers

- Row part "requestedBy" (e.g. "Lena") matches more than one API field, and the mock data can't tell them apart. Which one is meant?
  → placeholder getRequestedBy(), provided by the controller
- Row part "status" (e.g. "Overdue") can't be produced from any API field. What is it?
  → placeholder getStatus(), provided by the controller
- The designed row order matches more than one sort on the mock data. How should "invoices" be sorted?
  → sort by amount descending
- "largestInvoice" (shows "$48.2M") can be computed more than one way from the mock data. Which is meant?
  → placeholder getLargestInvoice(), provided by the controller
- "syncedAt" (shows "26 Sep 2026") can't be computed from the mock data. What is it?
  → placeholder getSyncedAt(), provided by the controller
- What should the "archive" row action do?
  → placeholder handleArchive(), your own handler

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
