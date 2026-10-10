# line-matcher report: products-no-contract

> **No API contract for this feature: upload a Swagger/OpenAPI file.** Until then every part that needs the API stays open and the generated code is stubs.

**Dynamic parts found:** 7 (3 page values, 4 list fields) · **Actions:** 2 · **Questions asked:** 0

## Matches

| Part | Design showed | Comes from |
|---|---|---|
| productCount | 3 | no API contract yet |
| stockTotal | 287 | no API contract yet |
| avgPrice | $4,050 | no API contract yet |
| row.name | Desk Lamp, Notebook, Backpack | no API contract yet |
| row.price | $4,900, $450, $6,800 | no API contract yet |
| row.stock | 12, 240, 35 | no API contract yet |
| row.addedOn | 4 Jul 2026, 18 Jun 2026, 1 Aug 2026 | no API contract yet |
| row order | — | keep the API order |

## Actions

| Action | Where | Does |
|---|---|---|
| edit | row | select |
| cancel | page | clear |

## Open items — what would close them

- **API contract** (missing) — No API contract for this feature: upload a Swagger/OpenAPI file.
  → Upload the Swagger/OpenAPI file for this feature (it is saved as openapi.json or openapi.yaml in the feature folder), then run again.
- **row.name** (missing) — There is no API contract for this feature, so this part can't be matched to the API yet.
  → Upload the Swagger/OpenAPI file for this feature and run again; this part is matched as soon as the contract has what it needs.
- **row.price** (missing) — There is no API contract for this feature, so this part can't be matched to the API yet.
  → Upload the Swagger/OpenAPI file for this feature and run again; this part is matched as soon as the contract has what it needs.
- **row.stock** (missing) — There is no API contract for this feature, so this part can't be matched to the API yet.
  → Upload the Swagger/OpenAPI file for this feature and run again; this part is matched as soon as the contract has what it needs.
- **row.addedOn** (missing) — There is no API contract for this feature, so this part can't be matched to the API yet.
  → Upload the Swagger/OpenAPI file for this feature and run again; this part is matched as soon as the contract has what it needs.
- **productCount** (missing) — There is no API contract for this feature, so this part can't be matched to the API yet.
  → Upload the Swagger/OpenAPI file for this feature and run again; this part is matched as soon as the contract has what it needs.
- **stockTotal** (missing) — There is no API contract for this feature, so this part can't be matched to the API yet.
  → Upload the Swagger/OpenAPI file for this feature and run again; this part is matched as soon as the contract has what it needs.
- **avgPrice** (missing) — There is no API contract for this feature, so this part can't be matched to the API yet.
  → Upload the Swagger/OpenAPI file for this feature and run again; this part is matched as soon as the contract has what it needs.
- **delete (row action)** (missing) — "delete" looks like "remove", but there is no API contract to say which endpoint it calls.
  → Upload the Swagger/OpenAPI file for this feature and run again; this part is matched as soon as the contract has what it needs.
- **save (page action)** (missing) — "save" looks like "save", but there is no API contract to say which endpoint it calls.
  → Upload the Swagger/OpenAPI file for this feature and run again; this part is matched as soon as the contract has what it needs.
- **input name** (gap) — The form has an input "name", but there is no API contract to say what the request expects.
  → Upload the Swagger/OpenAPI file for this feature and run again; this part is matched as soon as the contract has what it needs.
- **input price** (gap) — The form has an input "price", but there is no API contract to say what the request expects.
  → Upload the Swagger/OpenAPI file for this feature and run again; this part is matched as soon as the contract has what it needs.
- **input stock** (gap) — The form has an input "stock", but there is no API contract to say what the request expects.
  → Upload the Swagger/OpenAPI file for this feature and run again; this part is matched as soon as the contract has what it needs.

## Layers (7)

- **Route** — the feature is reached at /products-no-contract
- **Controller** — 4 data props and 2 actions must be wired to the page
- **Workflow** — states: loading/ready/failed; events: EDIT, CANCEL
- **Service** — 0 API endpoints are called
- **Domain** — turning form input into API types
- **Page** — the designed JSX, rewritten to take props
- **Component** — the repeated "products" row becomes ProductsNoContractRow

## Files

- features/products-no-contract/route/ProductsNoContractRoute.jsx
- features/products-no-contract/controller/ProductsNoContractController.jsx
- features/products-no-contract/workflow/products-no-contract.workflow.js
- features/products-no-contract/service/products-no-contract.service.js
- features/products-no-contract/domain/products-no-contract.domain.js
- features/products-no-contract/domain/products-no-contract.domain.test.js
- features/products-no-contract/page/ProductsNoContractPage.jsx
- features/products-no-contract/component/ProductsNoContractRow.jsx
- features/products-no-contract/mocks/products-no-contract.mock.js
