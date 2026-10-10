# line-matcher report: products

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

- **Route** — the feature is reached at /products
- **Controller** — 4 data props and 4 actions must be wired to the page
- **Workflow** — states: loading/ready/failed/creating/updating/removing; events: EDIT, DELETE, SAVE, CANCEL
- **Service** — 4 API endpoints are called
- **Domain** — computed values (productCount, stockTotal, avgPrice), formatted row fields, turning form input into API types
- **Page** — the designed JSX, rewritten to take props
- **Component** — the repeated "products" row becomes ProductRow

## Files

- features/products/route/ProductsRoute.jsx
- features/products/controller/ProductsController.jsx
- features/products/workflow/products.workflow.js
- features/products/service/products.service.js
- features/products/domain/products.domain.js
- features/products/domain/products.domain.test.js
- features/products/page/ProductsPage.jsx
- features/products/component/ProductRow.jsx
- features/products/mocks/products.mock.js
