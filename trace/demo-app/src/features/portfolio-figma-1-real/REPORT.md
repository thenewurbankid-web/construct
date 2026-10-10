# line-matcher report: portfolio-figma-1-real

**Dynamic parts found:** 16 (9 page values, 7 list fields) · **Actions:** 1 · **Questions asked:** 14

## Matches

| Part | Design showed | Comes from |
|---|---|---|
| yourCategories | 6 | skipped — answer later |
| spendYouManage | $280.2M | field(portfolio_at_a_glance.spend_you_manage) → moneyCompact |
| refreshed | 31 Jul 2026 | field(meta.snapshot_date) → dateShort |
| yourPortfolioAtA | $280 | skipped — answer later |
| yourPortfolioAtA2 | ▲ 8.4% YoY | skipped — answer later |
| savingsPotential | $24.5 | skipped — answer later |
| resilienceBasedInitiatives | 21 | field(portfolio_at_a_glance.resilience_initiatives.total) → asText |
| numberOfSavingsInitiatives | 26 | field(portfolio_at_a_glance.waiting_on_decision.savings_count) → asText |
| riskInitiatives | 6 | skipped — answer later |
| row.rank | 01, 02, 03, 04, 05, 06 | skipped — answer later |
| row.spend | $38.4M, $62.8M, $45.2M, $27.3M, $14.9M, $91.6M | skipped — answer later |
| row.spend2 | 13.7%, 22.4%, 16.1%, 9.7%, 5.3%, 32.7% | skipped — answer later |
| row.maturity | 2.0, 1.8, 2.1, 2.3, 2.2, 2.9 | skipped — answer later |
| row.maturity2 | -0.7, -0.6, -0.5, -0.2, -0.1, +0.3 | skipped — answer later |
| row.savingsPotential | $5.6M, $7.1M, $4.2M, $2.9M, $1.4M, $3.2M | skipped — answer later |
| row.savingsPotential2 | 14.6%, 11.3%, 9.3%, 10.6%, 9.4%, 3.5% | skipped — answer later |
| row order | — | keep the API order |

## Actions

| Action | Where | Does |
|---|---|---|
| open | row | select |

## Open items — what would close them

- **row.rank** (skipped) — No API field, with any built-in format, produces "01", "02", "03", "04", "05", "06".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id 3c1e7d20-5f0a-4b6c-8d11-0a9e2f7b4c01 → "01", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "02", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "03", beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "04"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.spend** (skipped) — No API field, with any built-in format, produces "$38.4M", "$62.8M", "$45.2M", "$27.3M", "$14.9M", "$91.6M".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id 3c1e7d20-5f0a-4b6c-8d11-0a9e2f7b4c01 → "$38.4M", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "$62.8M", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "$45.2M", beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "$27.3M"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.spend2** (skipped) — No API field, with any built-in format, produces "13.7%", "22.4%", "16.1%", "9.7%", "5.3%", "32.7%".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id 3c1e7d20-5f0a-4b6c-8d11-0a9e2f7b4c01 → "13.7%", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "22.4%", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "16.1%", beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "9.7%"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.maturity** (skipped) — No API field, with any built-in format, produces "2.0", "1.8", "2.1", "2.3", "2.2", "2.9".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id 3c1e7d20-5f0a-4b6c-8d11-0a9e2f7b4c01 → "2.0", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "1.8", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "2.1", beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "2.3"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.maturity2** (skipped) — No API field, with any built-in format, produces "-0.7", "-0.6", "-0.5", "-0.2", "-0.1", "+0.3".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id 3c1e7d20-5f0a-4b6c-8d11-0a9e2f7b4c01 → "-0.7", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "-0.6", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "-0.5", beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "-0.2"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.savingsPotential** (skipped) — No API field, with any built-in format, produces "$5.6M", "$7.1M", "$4.2M", "$2.9M", "$1.4M", "$3.2M".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id 3c1e7d20-5f0a-4b6c-8d11-0a9e2f7b4c01 → "$5.6M", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "$7.1M", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "$4.2M", beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "$2.9M"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.savingsPotential2** (skipped) — No API field, with any built-in format, produces "14.6%", "11.3%", "9.3%", "10.6%", "9.4%", "3.5%".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id 3c1e7d20-5f0a-4b6c-8d11-0a9e2f7b4c01 → "14.6%", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "11.3%", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "9.3%", beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "10.6%"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **yourCategories** (skipped) — field(portfolio_at_a_glance.waiting_on_decision.resilience_count) and count() both give "6".
  → Change "portfolio_at_a_glance.waiting_on_decision.resilience_count" or null in at least one row so the results differ.
- **yourPortfolioAtA** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "$280".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **yourPortfolioAtA2** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "▲ 8.4% YoY".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **savingsPotential** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "$24.5".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **riskInitiatives** (skipped) — field(portfolio_at_a_glance.waiting_on_decision.resilience_count) and count() both give "6".
  → Change "portfolio_at_a_glance.waiting_on_decision.resilience_count" or null in at least one row so the results differ.
- **promptSuggestion01 (page action)** (skipped) — "promptSuggestion01" isn't a verb the tool knows (create, add, update, save, delete, remove, edit, select, cancel, reset, refresh).
  → Rename it in the design (data-action) to a known verb, or answer with your own placeholder handler.
- **promptSuggestion02 (page action)** (skipped) — "promptSuggestion02" isn't a verb the tool knows (create, add, update, save, delete, remove, edit, select, cancel, reset, refresh).
  → Rename it in the design (data-action) to a known verb, or answer with your own placeholder handler.
- **page** (gap) — Could not line up the designed rows of "categoryOverview" with the mock list — using API order.
  → Fix the input named in the message, then re-run.

## Skipped — answer later

- Row part "rank" (e.g. "01") can't be produced from any API field. What is it?
- Row part "spend" (e.g. "$38.4M") can't be produced from any API field. What is it?
- Row part "spend2" (e.g. "13.7%") can't be produced from any API field. What is it?
- Row part "maturity" (e.g. "2.0") can't be produced from any API field. What is it?
- Row part "maturity2" (e.g. "-0.7") can't be produced from any API field. What is it?
- Row part "savingsPotential" (e.g. "$5.6M") can't be produced from any API field. What is it?
- Row part "savingsPotential2" (e.g. "14.6%") can't be produced from any API field. What is it?
- "yourCategories" (shows "6") can be computed more than one way from the mock data. Which is meant?
- "yourPortfolioAtA" (shows "$280") can't be computed from the mock data. What is it?
- "yourPortfolioAtA2" (shows "▲ 8.4% YoY") can't be computed from the mock data. What is it?
- "savingsPotential" (shows "$24.5") can't be computed from the mock data. What is it?
- "riskInitiatives" (shows "6") can be computed more than one way from the mock data. Which is meant?
- What should the "promptSuggestion01" action do?
- What should the "promptSuggestion02" action do?

## Layers (7)

- **Route** — the feature is reached at /portfolio
- **Controller** — 10 data props and 1 actions must be wired to the page
- **Workflow** — states: loading/ready/failed; events: OPEN
- **Service** — 2 API endpoints are called
- **Domain** — computed values (spendYouManage, refreshed, resilienceBasedInitiatives, numberOfSavingsInitiatives)
- **Page** — the designed JSX, rewritten to take props
- **Component** — the repeated "categoryOverview" row becomes PortfolioFigma1RealRow

## Questions & answers

- Row part "rank" (e.g. "01") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "spend" (e.g. "$38.4M") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "spend2" (e.g. "13.7%") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "maturity" (e.g. "2.0") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "maturity2" (e.g. "-0.7") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "savingsPotential" (e.g. "$5.6M") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "savingsPotential2" (e.g. "14.6%") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- "yourCategories" (shows "6") can be computed more than one way from the mock data. Which is meant?
  → left open (auto mode) — answer later
- "yourPortfolioAtA" (shows "$280") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- "yourPortfolioAtA2" (shows "▲ 8.4% YoY") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- "savingsPotential" (shows "$24.5") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- "riskInitiatives" (shows "6") can be computed more than one way from the mock data. Which is meant?
  → left open (auto mode) — answer later
- What should the "promptSuggestion01" action do?
  → left open (auto mode) — answer later
- What should the "promptSuggestion02" action do?
  → left open (auto mode) — answer later

## Gaps

- Could not line up the designed rows of "categoryOverview" with the mock list — using API order.

## Files

- features/portfolio-figma-1-real/route/PortfolioFigma1RealRoute.jsx
- features/portfolio-figma-1-real/controller/PortfolioFigma1RealController.jsx
- features/portfolio-figma-1-real/workflow/portfolio-figma-1-real.workflow.js
- features/portfolio-figma-1-real/service/portfolio-figma-1-real.service.js
- features/portfolio-figma-1-real/domain/portfolio-figma-1-real.domain.js
- features/portfolio-figma-1-real/domain/portfolio-figma-1-real.domain.test.js
- features/portfolio-figma-1-real/page/PortfolioFigma1RealPage.jsx
- features/portfolio-figma-1-real/component/PortfolioFigma1RealRow.jsx
- features/portfolio-figma-1-real/mocks/portfolio-figma-1-real.mock.js
