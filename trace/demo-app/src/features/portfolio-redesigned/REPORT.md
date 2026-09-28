# line-matcher report: portfolio-redesigned

**Dynamic parts found:** 25 (13 page values, 12 list fields) · **Actions:** 3 · **Questions asked:** 21

## Matches

| Part | Design showed | Comes from |
|---|---|---|
| refreshedAt | 31 Jul 2026 | field(meta.snapshot_date) → dateShort |
| headline | Grains is carrying your portfolio. Logistics and Packaging are not. | field(narrative.cross_l2_summary) → asText |
| improving | Grains, up on contract coverage and a renegotiated origination mix, and Chemicals, where the solvent index fell two quarters running. | skipped — answer later |
| declining | Logistics, where the maturity gap widened to −0.7 and three high flags are open, and Packaging, where supplier concentration moved the wrong way. IT & Software is flat. | skipped — answer later |
| baselineSpend | $280M | placeholder getBaselineSpend() |
| highCategories | 4 | skipped — answer later |
| savingsRange | $42 - 68M | skipped — answer later |
| qualifiedCount | 25 | skipped — answer later |
| coveredCount | 21 | field(portfolio_at_a_glance.resilience_initiatives.total) → asText |
| resilienceTotal | 21 | field(portfolio_at_a_glance.resilience_initiatives.total) → asText |
| savingsCount | 26 | field(portfolio_at_a_glance.waiting_on_decision.savings_count) → asText |
| oldestDays | 34 | skipped — answer later |
| qualifiedInitiatives | 16 | skipped — answer later |
| row.rank | 01, 02, 03, 04, 05, 06 | skipped — answer later |
| row.name | Logistics, Packaging, IT Services, Professional Services, MRO, Grains & Cereals | display_name → asText |
| row.level | L2, L2, L2, L2, L2, L2 | skipped — answer later |
| row.shareLabel | 37% of total spend, 22.4% of total spend, 21.4% of total spend, 22.4% of total spend, 22.4% of total spend, 22.4% of total spend | skipped — answer later |
| row.oppLabel | 5 qualified opportunities, 3 qualified opportunities, 3 qualified opportunities, 3 qualified opportunities, 3 qualified opportunities, 3 qualified opportunities | skipped — answer later |
| row.acceptedLabel | 5 accepted, 2 accepted, 2 accepted, 2 accepted, 2 accepted, 2 accepted | skipped — answer later |
| row.spend | $78.4M, $62.8M, $45.2M, $27.3M, $14.9M, $11.6M | skipped — answer later |
| row.maturity | 2.0, 1.8, 2.1, 2.3, 2.2, 2.9 | skipped — answer later |
| row.peer | peer 2.7, peer 2.4, peer 2.6, peer 2.5, peer 2.3, peer 2.6 | skipped — answer later |
| row.savingsRangeRow | $4.7M - $5.6M, $5.3M - $7.1M, $3.5M - $4.2M, $1.8M - $2.9M, $0.8M - $1.4M, $3.2M | skipped — answer later |
| row.risk | 72, 69, 67, 59, 84, 72 | risk_score → asText |
| row.spendChange | +$5.1M, -$3.2M, +$1.2M, $0.0, +$5.1M, -$5.1M | placeholder getSpendChange() |
| row order | — | keep the API order |

## Actions

| Action | Where | Does |
|---|---|---|
| open | row | select |
| suggest | page | placeholder handleSuggest() |
| suggest | page | placeholder handleSuggest2() |

## AI decisions to review

- **list.shareLabel** → something else — build a placeholder…
  ollama:qwen2.5-coder:1.5b: Field "spend.pct_of_total": The category's share of the user's total spend, 0 to 1.
- **list.spend** → something else — build a placeholder…
  ollama:qwen2.5-coder:1.5b: Rows are sorted by spend descending.
- **list.spend#from** → combine values from API fields — placeholder function in the domain layer
  ollama:qwen2.5-coder:1.5b: Rows are sorted by spend descending.
- **list.maturity** → something else — build a placeholder…
  ollama:qwen2.5-coder:1.5b: The category maturity score is on a 0 to 100 scale.
- **list.maturity#from** → combine values from API fields — placeholder function in the domain layer
  ollama:qwen2.5-coder:1.5b: GET /api/category-health/portfolio: Portfolio landing page for users managing two or more categories. Rows are sorted by spend descending.
- **list.savingsRangeRow** → something else — build a placeholder…
  ollama:qwen2.5-coder:1.5b: Field "waiting_on_decision.savings_count": Savings initiatives waiting on a decision. A count, never money.
- **list.spendChange** → something else — build a placeholder…
  ollama:qwen2.5-coder:1.5b: GET /api/category-health/portfolio: Portfolio landing page for users managing two or more categories. Rows are sorted by spend descending.
- **list.spendChange#from** → provided by the controller — placeholder function in the controller
  ollama:qwen2.5-coder:1.5b: Rows are sorted by spend descending.
- **value.baselineSpend** → something else — build a placeholder…
  ollama:qwen2.5-coder:1.5b: Rows are sorted by spend descending.
- **value.baselineSpend#from** → provided by the controller — placeholder function in the controller
  ollama:qwen2.5-coder:1.5b: GET /api/category-health/portfolio: Portfolio landing page for users managing two or more categories. Rows are sorted by spend descending.
- **value.savingsRange** → something else — build a placeholder…
  ollama:qwen2.5-coder:1.5b: Field "waiting_on_decision.savings_count": Savings initiatives waiting on a decision. A count, never money.
- **value.qualifiedCount** → something else — build a placeholder…
  ollama:qwen2.5-coder:1.5b: Field "waiting_on_decision.savings_count": Savings initiatives waiting on a decision. A count, never money.
- **value.qualifiedInitiatives** → something else — build a placeholder…
  ollama:qwen2.5-coder:1.5b: Field "waiting_on_decision.savings_count": Savings initiatives waiting on a decision. A count, never money.
- **action.page.suggest** → something else — name my own handler (placeholder)…
  ollama:qwen2.5-coder:1.5b: Suggestions under Ask Anything are AI prompts that use a handler of our own, not an API.

## Open items — what would close them

- **row.rank** (skipped) — No API field, with any built-in format, produces "01", "02", "03", "04", "05", "06".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "01", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "02", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "03", beroe_l2_id e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05 → "04"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.level** (skipped) — No API field, with any built-in format, produces "L2", "L2", "L2", "L2", "L2", "L2".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "L2", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "L2", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "L2", beroe_l2_id e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05 → "L2"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.shareLabel** (skipped) — No API field, with any built-in format, produces "37% of total spend", "22.4% of total spend", "21.4% of total spend", "22.4% of total spend", "22.4% of total spend", "22.4% of total spend".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "37% of total spend", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "22.4% of total spend", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "21.4% of total spend", beroe_l2_id e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05 → "22.4% of total spend"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.oppLabel** (skipped) — No API field, with any built-in format, produces "5 qualified opportunities", "3 qualified opportunities", "3 qualified opportunities", "3 qualified opportunities", "3 qualified opportunities", "3 qualified opportunities".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "5 qualified opportunities", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "3 qualified opportunities", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "3 qualified opportunities", beroe_l2_id e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05 → "3 qualified opportunities"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.acceptedLabel** (skipped) — No API field, with any built-in format, produces "5 accepted", "2 accepted", "2 accepted", "2 accepted", "2 accepted", "2 accepted".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "5 accepted", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "2 accepted", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "2 accepted", beroe_l2_id e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05 → "2 accepted"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.spend** (skipped) — No API field, with any built-in format, produces "$78.4M", "$62.8M", "$45.2M", "$27.3M", "$14.9M", "$11.6M".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "$78.4M", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "$62.8M", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "$45.2M", beroe_l2_id e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05 → "$27.3M"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.maturity** (skipped) — No API field, with any built-in format, produces "2.0", "1.8", "2.1", "2.3", "2.2", "2.9".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "2.0", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "1.8", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "2.1", beroe_l2_id e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05 → "2.3"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.peer** (skipped) — No API field, with any built-in format, produces "peer 2.7", "peer 2.4", "peer 2.6", "peer 2.5", "peer 2.3", "peer 2.6".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "peer 2.7", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "peer 2.4", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "peer 2.6", beroe_l2_id e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05 → "peer 2.5"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.savingsRangeRow** (skipped) — No API field, with any built-in format, produces "$4.7M - $5.6M", "$5.3M - $7.1M", "$3.5M - $4.2M", "$1.8M - $2.9M", "$0.8M - $1.4M", "$3.2M".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "$4.7M - $5.6M", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "$5.3M - $7.1M", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "$3.5M - $4.2M", beroe_l2_id e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05 → "$1.8M - $2.9M"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.spendChange** (placeholder) — getSpendChange() is a placeholder in the controller layer.
  → Write the real logic in getSpendChange(), or close it by data: If the API has it, add a field to the GET response with these values per row (beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "+$5.1M", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "-$3.2M", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "+$1.2M", beroe_l2_id e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05 → "$0.0"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **improving** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "Grains, up on contract coverage and a renegotiated origination mix, and Chemicals, where the solvent index fell two quarters running.".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **declining** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "Logistics, where the maturity gap widened to −0.7 and three high flags are open, and Packaging, where supplier concentration moved the wrong way. IT & Software is flat.".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **baselineSpend** (placeholder) — getBaselineSpend() is a placeholder in the controller layer.
  → Write the real logic in getBaselineSpend(), or close it by data: If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **highCategories** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "4".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **savingsRange** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "$42 - 68M".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **qualifiedCount** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "25".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **oldestDays** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "34".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **qualifiedInitiatives** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "16".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **row order** (skipped) — No sort on any field gives the designed row order.
  → Add a field the design is sorted by, or answer "keep the API order".
- **suggest (page action)** (placeholder) — handleSuggest() is a placeholder in the controller layer.
  → Write the real logic in handleSuggest(), or close it by data: Rename it in the design (data-action) to a known verb, or answer with your own placeholder handler.
- **suggest (page action)** (placeholder) — handleSuggest() is a placeholder in the controller layer.
  → Write the real logic in handleSuggest(), or close it by data: Rename it in the design (data-action) to a known verb, or answer with your own placeholder handler.

## Skipped — answer later

- Row part "rank" (e.g. "01") can't be produced from any API field. What is it?
- Row part "level" (e.g. "L2") can't be produced from any API field. What is it?
- Row part "shareLabel" (e.g. "37% of total spend") can't be produced from any API field. What is it?
- Row part "oppLabel" (e.g. "5 qualified opportunities") can't be produced from any API field. What is it?
- Row part "acceptedLabel" (e.g. "5 accepted") can't be produced from any API field. What is it?
- Row part "spend" (e.g. "$78.4M") can't be produced from any API field. What is it?
- Row part "maturity" (e.g. "2.0") can't be produced from any API field. What is it?
- Row part "peer" (e.g. "peer 2.7") can't be produced from any API field. What is it?
- Row part "savingsRangeRow" (e.g. "$4.7M - $5.6M") can't be produced from any API field. What is it?
- The designed row order matches more than one sort on the mock data. How should "categories" be sorted?
- "improving" (shows "Grains, up on contract coverage and a renegotiated origination mix, and Chemicals, where the solvent index fell two quarters running.") can't be computed from the mock data. What is it?
- "declining" (shows "Logistics, where the maturity gap widened to −0.7 and three high flags are open, and Packaging, where supplier concentration moved the wrong way. IT & Software is flat.") can't be computed from the mock data. What is it?
- "highCategories" (shows "4") can't be computed from the mock data. What is it?
- "savingsRange" (shows "$42 - 68M") can't be computed from the mock data. What is it?
- "qualifiedCount" (shows "25") can't be computed from the mock data. What is it?
- "oldestDays" (shows "34") can't be computed from the mock data. What is it?
- "qualifiedInitiatives" (shows "16") can't be computed from the mock data. What is it?

## Placeholders to fill in

| Part | Function | Layer | Input |
|---|---|---|---|
| row.spendChange | getSpendChange() | Controller | controller |
| baselineSpend | getBaselineSpend() | Controller | controller |
| suggest (page action) | handleSuggest() | Controller | your handler |
| suggest (page action) | handleSuggest2() | Controller | your handler |

## Layers (7)

- **Route** — the feature is reached at /portfolio
- **Controller** — 14 data props and 3 actions must be wired to the page
- **Workflow** — states: loading/ready/failed; events: OPEN, SUGGEST, SUGGEST
- **Service** — 2 API endpoints are called
- **Domain** — computed values (refreshedAt, headline, coveredCount, resilienceTotal, savingsCount)
- **Page** — the designed JSX, rewritten to take props
- **Component** — the repeated "categories" row becomes PortfolioRedesignedRow

## Questions & answers

- Row part "rank" (e.g. "01") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "level" (e.g. "L2") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "shareLabel" (e.g. "37% of total spend") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "oppLabel" (e.g. "5 qualified opportunities") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "acceptedLabel" (e.g. "5 accepted") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "spend" (e.g. "$78.4M") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "maturity" (e.g. "2.0") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "peer" (e.g. "peer 2.7") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "savingsRangeRow" (e.g. "$4.7M - $5.6M") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "spendChange" (e.g. "+$5.1M") can't be produced from any API field. What is it?
  → placeholder getSpendChange(), provided by the controller
- The designed row order matches more than one sort on the mock data. How should "categories" be sorted?
  → left open (auto mode) — answer later
- "improving" (shows "Grains, up on contract coverage and a renegotiated origination mix, and Chemicals, where the solvent index fell two quarters running.") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- "declining" (shows "Logistics, where the maturity gap widened to −0.7 and three high flags are open, and Packaging, where supplier concentration moved the wrong way. IT & Software is flat.") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- "baselineSpend" (shows "$280M") can't be computed from the mock data. What is it?
  → placeholder getBaselineSpend(), provided by the controller
- "highCategories" (shows "4") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- "savingsRange" (shows "$42 - 68M") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- "qualifiedCount" (shows "25") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- "oldestDays" (shows "34") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- "qualifiedInitiatives" (shows "16") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- What should the "suggest" action do?
  → placeholder handleSuggest(), your own handler
- What should the "suggest" action do?
  → placeholder handleSuggest(), your own handler

## Files

- features/portfolio-redesigned/route/PortfolioRedesignedRoute.jsx
- features/portfolio-redesigned/controller/PortfolioRedesignedController.jsx
- features/portfolio-redesigned/workflow/portfolio-redesigned.workflow.js
- features/portfolio-redesigned/service/portfolio-redesigned.service.js
- features/portfolio-redesigned/domain/portfolio-redesigned.domain.js
- features/portfolio-redesigned/domain/portfolio-redesigned.domain.test.js
- features/portfolio-redesigned/page/PortfolioRedesignedPage.jsx
- features/portfolio-redesigned/component/PortfolioRedesignedRow.jsx
- features/portfolio-redesigned/mocks/portfolio-redesigned.mock.js
