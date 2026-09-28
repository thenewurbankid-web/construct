# line-matcher report: metrics

**Dynamic parts found:** 6 (6 page values, 0 list fields) · **Actions:** 0 · **Questions asked:** 1

## Matches

| Part | Design showed | Comes from |
|---|---|---|
| regionCount | 4 | count → asText |
| totalRevenue | $364.0M | sum(revenue) → moneyCompact |
| bestRevenue | $120.0M | max(revenue) → moneyCompact |
| lowestCost | $33.0M | min(cost) → moneyCompact |
| avgConversion | 18.5% | average(conversion) → percent |
| asOf | 26 Sep 2026 | skipped — answer later |

## Actions

| Action | Where | Does |
|---|---|---|

## Open items — what would close them

- **asOf** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "26 Sep 2026".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.

## Skipped — answer later

- "asOf" (shows "26 Sep 2026") can't be computed from the mock data. What is it?

## Layers (6)

- **Route** — the feature is reached at /metrics
- **Controller** — 6 data props and 0 actions must be wired to the page
- **Workflow** — states: loading/ready/failed; events: none
- **Service** — 1 API endpoints are called
- **Domain** — computed values (regionCount, totalRevenue, bestRevenue, lowestCost, avgConversion)
- **Page** — the designed JSX, rewritten to take props

## Questions & answers

- "asOf" (shows "26 Sep 2026") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later

## Files

- features/metrics/route/MetricsRoute.jsx
- features/metrics/controller/MetricsController.jsx
- features/metrics/workflow/metrics.workflow.js
- features/metrics/service/metrics.service.js
- features/metrics/domain/metrics.domain.js
- features/metrics/domain/metrics.domain.test.js
- features/metrics/page/MetricsPage.jsx
- features/metrics/mocks/metrics.mock.js
