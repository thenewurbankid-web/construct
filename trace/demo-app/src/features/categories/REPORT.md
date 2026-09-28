# line-matcher report: categories

**Dynamic parts found:** 7 (4 page values, 3 list fields) · **Actions:** 4 · **Questions asked:** 1

## Matches

| Part | Design showed | Comes from |
|---|---|---|
| categoryCount | 4 | count → asText |
| totalSpend | $278.0M | sum(spend) → moneyCompact |
| largestSpend | $91.6M | max(spend) → moneyCompact |
| refreshedAt | 31 Jul 2026 | TODO — not in API |
| row.name | Grains & Cereals, Logistics, Packaging, IT Services | name → asText |
| row.spend | $91.6M, $78.4M, $62.8M, $45.2M | spend → moneyCompact |
| row.owner | Lena, Prerna, Arjun, Mia | owner → asText |
| row order | — | sort by spend descending |

## Actions

| Action | Where | Does |
|---|---|---|
| edit | row | select |
| delete | row | remove |
| save | page | save |
| cancel | page | clear |

## Open items — what would close them

- **refreshedAt** (missing) — Nothing computed from the list (count, sum, average, min, max) gives "31 Jul 2026".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.

## Layers (7)

- **Route** — the feature is reached at /categories
- **Controller** — 5 data props and 4 actions must be wired to the page
- **Workflow** — states: loading/ready/failed/creating/updating/removing; events: EDIT, DELETE, SAVE, CANCEL
- **Service** — 4 API endpoints are called
- **Domain** — computed values (categoryCount, totalSpend, largestSpend), formatted row fields, sorting by spend, turning form input into API types
- **Page** — the designed JSX, rewritten to take props
- **Component** — the repeated "categories" row becomes CategoryRow

## Questions & answers

- "refreshedAt" (shows "31 Jul 2026") can't be computed from the mock data. What is it?
  → data the API doesn't provide yet — leave a TODO

## Files

- features/categories/route/CategoriesRoute.jsx
- features/categories/controller/CategoriesController.jsx
- features/categories/workflow/categories.workflow.js
- features/categories/service/categories.service.js
- features/categories/domain/categories.domain.js
- features/categories/domain/categories.domain.test.js
- features/categories/page/CategoriesPage.jsx
- features/categories/component/CategoryRow.jsx
- features/categories/mocks/categories.mock.js
