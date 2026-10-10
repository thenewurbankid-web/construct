# line-matcher report: products-history

**Dynamic parts found:** 7 (3 page values, 4 list fields) · **Actions:** 4 · **Questions asked:** 0

## Matches

| Part | Design showed | Comes from |
|---|---|---|
| productCount | 3 | count → asText |
| stockTotal | 287 | sum(stock) → asText |
| avgPrice | $4,050 | average(price) → moneyFull |
| row.name | Desk Lamp, Notebook, Backpack | name → asText |
| row.price | $4,900, $450, $6,800 | price → moneyFull |
| row.stock | 12, 240, 35 | stock → asText |
| row.addedOn | 4 Jul 2026, 18 Jun 2026, 1 Aug 2026 | addedOn → dateShort |
| row order | — | keep the API order |

## Actions

| Action | Where | Does |
|---|---|---|
| edit | row | select |
| delete | row | remove |
| save | page | save |
| cancel | page | clear |

## Layers (7)

- **Route** — the feature is reached at /products-history
- **Controller** — 4 data props and 4 actions must be wired to the page
- **Workflow** — states: loading/ready/failed/creating/updating/removing; events: EDIT, DELETE, SAVE, CANCEL
- **Service** — 5 API endpoints are called
- **Domain** — computed values (productCount, stockTotal, avgPrice), formatted row fields, turning form input into API types
- **Page** — the designed JSX, rewritten to take props
- **Component** — the repeated "products" row becomes ProductsHistoryRow

## Files

- features/products-history/route/ProductsHistoryRoute.jsx
- features/products-history/controller/ProductsHistoryController.jsx
- features/products-history/workflow/products-history.workflow.js
- features/products-history/service/products-history.service.js
- features/products-history/domain/products-history.domain.js
- features/products-history/domain/products-history.domain.test.js
- features/products-history/page/ProductsHistoryPage.jsx
- features/products-history/component/ProductsHistoryRow.jsx
- features/products-history/mocks/products-history.mock.js
