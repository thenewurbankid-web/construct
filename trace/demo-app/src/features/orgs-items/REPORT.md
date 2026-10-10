# line-matcher report: orgs-items

**Dynamic parts found:** 5 (2 page values, 3 list fields) · **Actions:** 4 · **Questions asked:** 0

## Matches

| Part | Design showed | Comes from |
|---|---|---|
| itemCount | 3 | count → asText |
| qtyTotal | 69 | sum(qty) → asText |
| row.name | Pallet Jack, Shrink Wrap, Barcode Scanner | name → asText |
| row.sku | PJ-100, SW-220, BS-310 | sku → asText |
| row.qty | 6, 48, 15 | qty → asText |
| row order | — | keep the API order |

## Actions

| Action | Where | Does |
|---|---|---|
| edit | row | select |
| delete | row | remove |
| save | page | save |
| cancel | page | clear |

## Layers (7)

- **Route** — the feature is reached at /orgs-items
- **Controller** — 3 data props and 4 actions must be wired to the page
- **Workflow** — states: loading/ready/failed/creating/updating/removing; events: EDIT, DELETE, SAVE, CANCEL
- **Service** — 5 API endpoints are called
- **Domain** — computed values (itemCount, qtyTotal), turning form input into API types
- **Page** — the designed JSX, rewritten to take props
- **Component** — the repeated "items" row becomes OrgsItemRow

## Files

- features/orgs-items/route/OrgsItemsRoute.jsx
- features/orgs-items/controller/OrgsItemsController.jsx
- features/orgs-items/workflow/orgs-items.workflow.js
- features/orgs-items/service/orgs-items.service.js
- features/orgs-items/domain/orgs-items.domain.js
- features/orgs-items/domain/orgs-items.domain.test.js
- features/orgs-items/page/OrgsItemsPage.jsx
- features/orgs-items/component/OrgsItemRow.jsx
- features/orgs-items/mocks/orgs-items.mock.js
