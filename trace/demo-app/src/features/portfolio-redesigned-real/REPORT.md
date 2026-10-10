# line-matcher report: portfolio-redesigned-real

**Dynamic parts found:** 13 (7 page values, 6 list fields) · **Actions:** 1 · **Questions asked:** 9

## Matches

| Part | Design showed | Comes from |
|---|---|---|
| maxYourPortfolioSummary2 | 31 Jul 2026 | field(meta.snapshot_date) → dateShort |
| baselineSpend5 | $280M | skipped — answer later |
| potentialSavings2 | $42 - 68M | skipped — answer later |
| categoriesCovered | 21 | field(portfolio_at_a_glance.resilience_initiatives.total) → asText |
| resilienceInitiatives2 | 21 | field(portfolio_at_a_glance.resilience_initiatives.total) → asText |
| savingsInitiatives2 | 26 | field(portfolio_at_a_glance.waiting_on_decision.savings_count) → asText |
| qualifiedInitiatives | 16 | skipped — answer later |
| row.rank | 01, 02, 03, 04, 05, 06 | skipped — answer later |
| row.spend | $78.4M, $62.8M, $45.2M, $27.3M, $14.9M, $11.6M | skipped — answer later |
| row.maturity | 2.0, 1.8, 2.1, 2.3, 2.2, 2.9 | skipped — answer later |
| row.potentialSavings | $4.7M - $5.6M, $5.3M - $7.1M, $3.5M - $4.2M, $1.8M - $2.9M, $0.8M - $1.4M, $3.2M | skipped — answer later |
| row.compositeRiskScore | 72, 69, 67, 59, 84, 72 | skipped — answer later |
| row.spendChange | +$5.1M, -$3.2M, +$1.2M, $0.0, +$5.1M, -$5.1M | skipped — answer later |
| row order | — | keep the API order |

## Actions

| Action | Where | Does |
|---|---|---|
| open | row | select |

## Open items — what would close them

- **row.rank** (skipped) — No API field, with any built-in format, produces "01", "02", "03", "04", "05", "06".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id 3c1e7d20-5f0a-4b6c-8d11-0a9e2f7b4c01 → "01", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "02", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "03", beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "04"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.spend** (skipped) — No API field, with any built-in format, produces "$78.4M", "$62.8M", "$45.2M", "$27.3M", "$14.9M", "$11.6M".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id 3c1e7d20-5f0a-4b6c-8d11-0a9e2f7b4c01 → "$78.4M", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "$62.8M", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "$45.2M", beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "$27.3M"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.maturity** (skipped) — No API field, with any built-in format, produces "2.0", "1.8", "2.1", "2.3", "2.2", "2.9".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id 3c1e7d20-5f0a-4b6c-8d11-0a9e2f7b4c01 → "2.0", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "1.8", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "2.1", beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "2.3"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.potentialSavings** (skipped) — No API field, with any built-in format, produces "$4.7M - $5.6M", "$5.3M - $7.1M", "$3.5M - $4.2M", "$1.8M - $2.9M", "$0.8M - $1.4M", "$3.2M".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id 3c1e7d20-5f0a-4b6c-8d11-0a9e2f7b4c01 → "$4.7M - $5.6M", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "$5.3M - $7.1M", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "$3.5M - $4.2M", beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "$1.8M - $2.9M"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.compositeRiskScore** (skipped) — No API field, with any built-in format, produces "72", "69", "67", "59", "84", "72".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id 3c1e7d20-5f0a-4b6c-8d11-0a9e2f7b4c01 → "72", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "69", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "67", beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "59"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.spendChange** (skipped) — No API field, with any built-in format, produces "+$5.1M", "-$3.2M", "+$1.2M", "$0.0", "+$5.1M", "-$5.1M".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id 3c1e7d20-5f0a-4b6c-8d11-0a9e2f7b4c01 → "+$5.1M", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "-$3.2M", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "+$1.2M", beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "$0.0"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **baselineSpend5** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "$280M".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **potentialSavings2** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "$42 - 68M".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **qualifiedInitiatives** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "16".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **page** (gap) — Could not line up the designed rows of "categoryOverview" with the mock list — using API order.
  → Fix the input named in the message, then re-run.

## Skipped — answer later

- Row part "rank" (e.g. "01") can't be produced from any API field. What is it?
- Row part "spend" (e.g. "$78.4M") can't be produced from any API field. What is it?
- Row part "maturity" (e.g. "2.0") can't be produced from any API field. What is it?
- Row part "potentialSavings" (e.g. "$4.7M - $5.6M") can't be produced from any API field. What is it?
- Row part "compositeRiskScore" (e.g. "72") can't be produced from any API field. What is it?
- Row part "spendChange" (e.g. "+$5.1M") can't be produced from any API field. What is it?
- "baselineSpend5" (shows "$280M") can't be computed from the mock data. What is it?
- "potentialSavings2" (shows "$42 - 68M") can't be computed from the mock data. What is it?
- "qualifiedInitiatives" (shows "16") can't be computed from the mock data. What is it?

## Layers (7)

- **Route** — the feature is reached at /portfolio
- **Controller** — 8 data props and 1 actions must be wired to the page
- **Workflow** — states: loading/ready/failed; events: OPEN
- **Service** — 2 API endpoints are called
- **Domain** — computed values (maxYourPortfolioSummary2, categoriesCovered, resilienceInitiatives2, savingsInitiatives2)
- **Page** — the designed JSX, rewritten to take props
- **Component** — the repeated "categoryOverview" row becomes PortfolioRedesignedRealRow

## Questions & answers

- Row part "rank" (e.g. "01") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "spend" (e.g. "$78.4M") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "maturity" (e.g. "2.0") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "potentialSavings" (e.g. "$4.7M - $5.6M") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "compositeRiskScore" (e.g. "72") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "spendChange" (e.g. "+$5.1M") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- "baselineSpend5" (shows "$280M") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- "potentialSavings2" (shows "$42 - 68M") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- "qualifiedInitiatives" (shows "16") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later

## Gaps

- Could not line up the designed rows of "categoryOverview" with the mock list — using API order.

## Files

- features/portfolio-redesigned-real/route/PortfolioRedesignedRealRoute.jsx
- features/portfolio-redesigned-real/controller/PortfolioRedesignedRealController.jsx
- features/portfolio-redesigned-real/workflow/portfolio-redesigned-real.workflow.js
- features/portfolio-redesigned-real/service/portfolio-redesigned-real.service.js
- features/portfolio-redesigned-real/domain/portfolio-redesigned-real.domain.js
- features/portfolio-redesigned-real/domain/portfolio-redesigned-real.domain.test.js
- features/portfolio-redesigned-real/page/PortfolioRedesignedRealPage.jsx
- features/portfolio-redesigned-real/component/PortfolioRedesignedRealRow.jsx
- features/portfolio-redesigned-real/mocks/portfolio-redesigned-real.mock.js
