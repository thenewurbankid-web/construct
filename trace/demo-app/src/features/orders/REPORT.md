# line-matcher report: orders

**Dynamic parts found:** 7 (2 page values, 5 list fields) · **Actions:** 3 · **Questions asked:** 3

## Matches

| Part | Design showed | Comes from |
|---|---|---|
| orderCount | 3 | count → asText |
| totalValue | $10,660 | sum(total) → moneyFull |
| row.number | ORD-201, ORD-202, ORD-203 | number → asText |
| row.customer | Northwind, Kestrel, Bluepeak | customer → asText |
| row.total | $1,200, $560, $8,900 | total → moneyFull |
| row.placedOn | 1 Sep 2026, 3 Sep 2026, 7 Sep 2026 | placedOn → dateShort |
| row.status | Shipped, Pending, Shipped | placeholder getStatus() |
| row order | — | keep the API order |

## Actions

| Action | Where | Does |
|---|---|---|
| edit | row | select |
| delete | row | placeholder handleDelete() |
| cancel | page | clear |

## AI decisions to review

- **list.status** → something else — build a placeholder…
  ollama:qwen2.5-coder:1.5b: The column headed "Status" shows status.
- **list.status#from** → provided by the controller — placeholder function in the controller
  ollama:qwen2.5-coder:1.5b: The column headed "Status" shows status.
- **action.row.delete** → something else — name my own handler (placeholder)…
  ollama:qwen2.5-coder:1.5b: The button labelled "Delete" is the delete action.

## Open items — what would close them

- **row.status** (placeholder) — getStatus() is a placeholder in the controller layer.
  → Write the real logic in getStatus(), or close it by data: If the API has it, add a field to the GET response with these values per row (id 1 → "Shipped", id 2 → "Pending", id 3 → "Shipped"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **delete (row action)** (placeholder) — handleDelete() is a placeholder in the controller layer.
  → Write the real logic in handleDelete(), or close it by data: Add a DELETE endpoint to "apis" in feature.json; it is wired as soon as you re-run.
- **save (page action)** (skipped) — "save" looks like "save", but the API for it (update) wasn't given.
  → Add a PUT endpoint to "apis" in feature.json; it is wired as soon as you re-run.
- **input notes** (gap) — The form has an input "notes" but no example request body has it.
  → Add "notes" to the request example of the POST/PUT in feature.json, or remove the input from the design.

## Skipped — answer later

- "save" looks like "save", but the API for it (update) wasn't given. What should it do?

## Placeholders to fill in

| Part | Function | Layer | Input |
|---|---|---|---|
| row.status | getStatus() | Controller | controller |
| delete (row action) | handleDelete() | Controller | your handler |

## Layers (7)

- **Route** — the feature is reached at /orders
- **Controller** — 3 data props and 3 actions must be wired to the page
- **Workflow** — states: loading/ready/failed; events: EDIT, DELETE, CANCEL
- **Service** — 2 API endpoints are called
- **Domain** — computed values (orderCount, totalValue), formatted row fields, turning form input into API types
- **Page** — the designed JSX, rewritten to take props
- **Component** — the repeated "orders" row becomes OrderRow

## Questions & answers

- Row part "status" (e.g. "Shipped") can't be produced from any API field. What is it?
  → placeholder getStatus(), provided by the controller
- "delete" looks like "remove", but the API for it (remove) wasn't given. What should it do?
  → placeholder handleDelete(), your own handler
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
