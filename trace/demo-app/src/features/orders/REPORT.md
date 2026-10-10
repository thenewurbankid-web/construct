# line-matcher report: orders

**Dynamic parts found:** 7 (2 page values, 5 list fields) · **Actions:** 2 · **Questions asked:** 3

## Matches

| Part | Design showed | Comes from |
|---|---|---|
| orderCount | 3 | count → asText |
| totalValue | $10,660 | sum(total) → moneyFull |
| row.number | ORD-201, ORD-202, ORD-203 | number → asText |
| row.customer | Northwind, Kestrel, Bluepeak | customer → asText |
| row.total | $1,200, $560, $8,900 | total → moneyFull |
| row.placedOn | 1 Sep 2026, 3 Sep 2026, 7 Sep 2026 | placedOn → dateShort |
| row.status | Shipped, Pending, Shipped | skipped — answer later |
| row order | — | keep the API order |

## Actions

| Action | Where | Does |
|---|---|---|
| edit | row | select |
| cancel | page | clear |

## Open items — what would close them

- **row.status** (skipped) — No API field, with any built-in format, produces "Shipped", "Pending", "Shipped".
  → If the API has it, add a field to the GET response with these values per row (id 1 → "Shipped", id 2 → "Pending", id 3 → "Shipped"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **delete (row action)** (skipped) — "delete" looks like "remove", but the API for it (remove) wasn't given.
  → Add a DELETE endpoint to the API contract (the feature's OpenAPI file: edit it or upload a new one); it is wired as soon as you re-run.
- **save (page action)** (skipped) — "save" looks like "save", but the API for it (update) wasn't given.
  → Add a PUT endpoint to the API contract (the feature's OpenAPI file: edit it or upload a new one); it is wired as soon as you re-run.
- **input notes** (gap) — The form has an input "notes" but no example request body has it.
  → Add "notes" to the request example of the POST/PUT in the API contract (the feature's OpenAPI file), or remove the input from the design.

## Skipped — answer later

- Row part "status" (e.g. "Shipped") can't be produced from any API field. What is it?
- "delete" looks like "remove", but the API for it (remove) wasn't given. What should it do?
- "save" looks like "save", but the API for it (update) wasn't given. What should it do?

## Layers (7)

- **Route** — the feature is reached at /orders
- **Controller** — 3 data props and 2 actions must be wired to the page
- **Workflow** — states: loading/ready/failed; events: EDIT, CANCEL
- **Service** — 2 API endpoints are called
- **Domain** — computed values (orderCount, totalValue), formatted row fields, turning form input into API types
- **Page** — the designed JSX, rewritten to take props
- **Component** — the repeated "orders" row becomes OrderRow

## Questions & answers

- Row part "status" (e.g. "Shipped") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- "delete" looks like "remove", but the API for it (remove) wasn't given. What should it do?
  → left open (auto mode) — answer later
- "save" looks like "save", but the API for it (update) wasn't given. What should it do?
  → left open (auto mode) — answer later

## Files

- features/orders/route/OrdersRoute.jsx
- features/orders/controller/OrdersController.jsx
- features/orders/workflow/orders.workflow.js
- features/orders/service/orders.service.js
- features/orders/domain/orders.domain.js
- features/orders/domain/orders.domain.test.js
- features/orders/page/OrdersPage.jsx
- features/orders/component/OrderRow.jsx
- features/orders/mocks/orders.mock.js
