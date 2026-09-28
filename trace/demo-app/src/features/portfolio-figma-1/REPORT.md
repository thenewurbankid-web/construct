# line-matcher report: portfolio-figma-1

**Dynamic parts found:** 36 (24 page values, 12 list fields) · **Actions:** 3 · **Questions asked:** 24

## Matches

| Part | Design showed | Comes from |
|---|---|---|
| categoryCount | 6 | skipped — answer later |
| spendYouManage | $280.2M | field(portfolio_at_a_glance.spend_you_manage) → moneyCompact |
| refreshedAt | 31 Jul 2026 | field(meta.snapshot_date) → dateShort |
| headline | Grains is carrying your portfolio. Logistics and Packaging are not. | field(narrative.cross_l2_summary) → asText |
| improving | Grains, up on contract coverage and a renegotiated origination mix, and Chemicals, where the solvent index fell two quarters running. | skipped — answer later |
| declining | Logistics, where the maturity gap widened to -0.7 and three high flags are open, and Packaging, where supplier concentration moved the wrong way. IT & Software is flat. | skipped — answer later |
| spendCard | $280M | skipped — answer later |
| spendYoy | ▲ 8.4% YoY | skipped — answer later |
| largestName | Grains & Cereals | field(portfolio_at_a_glance.largest_category.display_name) → asText |
| largestShare | 33% | field(portfolio_at_a_glance.largest_category.share_of_portfolio) → percentWhole |
| savingsCard | $24.5M | field(portfolio_at_a_glance.savings_potential.value) → moneyCompact |
| acceptedPct | 38% | field(portfolio_at_a_glance.savings_potential.qualified_accepted_pct) → percentWhole |
| acceptedCount | 23 of 60 | skipped — answer later |
| resilienceTotal | 21 | field(portfolio_at_a_glance.resilience_initiatives.total) → asText |
| impactHigh | 7 | field(portfolio_at_a_glance.resilience_initiatives.by_impact.high) → asText |
| impactMedium | 13 | field(portfolio_at_a_glance.resilience_initiatives.by_impact.medium) → asText |
| impactLow | 1 | field(portfolio_at_a_glance.resilience_initiatives.by_impact.low) → asText |
| highCategories | 4 | skipped — answer later |
| savingsCount | 26 | field(portfolio_at_a_glance.waiting_on_decision.savings_count) → asText |
| savingsTarget | $42.0M | skipped — answer later |
| oldestDays | 34 | skipped — answer later |
| riskCount | 6 | skipped — answer later |
| riskCategories | 2 | skipped — answer later |
| riskTarget | 8.0 | skipped — answer later |
| row.rank | 01, 02, 03, 04, 05, 06 | skipped — answer later |
| row.name | Logistics, Packaging, IT Services, Professional Services, MRO, Grains & Cereals | display_name → asText |
| row.level | L3, L2, L3, L2, L2, L2 | skipped — answer later |
| row.spend | $38.4M, $62.8M, $45.2M, $27.3M, $14.9M, $91.6M | skipped — answer later |
| row.share | 13.7%, 22.4%, 16.1%, 9.7%, 5.3%, 32.7% | spend.pct_of_total → percent |
| row.maturity | 2.0, 1.8, 2.1, 2.3, 2.2, 2.9 | skipped — answer later |
| row.maturityGap | -0.7, -0.6, -0.5, -0.2, -0.1, +0.3 | skipped — answer later |
| row.peer | peer 2.7, peer 2.4, peer 2.6, peer 2.5, peer 2.3, peer 2.6 | skipped — answer later |
| row.savings | $5.6M, $7.1M, $4.2M, $2.9M, $1.4M, $3.2M | savings_potential → moneyCompact |
| row.savingsPct | 14.6%, 11.3%, 9.3%, 10.6%, 9.4%, 3.5% | placeholder getSavingsPct() |
| row.flagFirst | 3 high flags, largest unclaimed $7.1M, single supplier 9.5%, 1 high flag, maturity in line with peers, ahead on maturity | skipped — answer later |
| row.flagSecond | widest maturity gap, 2 high flags, $410K past due, rate card 14% over peers, tail spend 31% off-contract, largest category | skipped — answer later |
| row order | — | keep the API order |

## Actions

| Action | Where | Does |
|---|---|---|
| open | row | select |
| suggest | page | placeholder handleSuggest() |
| suggest | page | placeholder handleSuggest2() |

## AI decisions to review

- **list.maturity** → something else — build a placeholder…
  ollama:qwen2.5-coder:1.5b: The category maturity score is on a 0 to 100 scale.
- **list.maturity#from** → combine values from API fields — placeholder function in the domain layer
  ollama:qwen2.5-coder:1.5b: GET /api/category-health/portfolio: Portfolio landing page for users managing two or more categories. Rows are sorted by spend descending.
- **list.maturityGap** → something else — build a placeholder…
  ollama:qwen2.5-coder:1.5b: The category maturity score is on a 0 to 100 scale.
- **list.maturityGap#from** → combine values from API fields — placeholder function in the domain layer
  ollama:qwen2.5-coder:1.5b: GET /api/category-health/portfolio: Portfolio landing page for users managing two or more categories. Rows are sorted by spend descending.
- **list.savingsPct** → something else — build a placeholder…
  ollama:qwen2.5-coder:1.5b: Field "spend.pct_of_total": The category's share of the user's total spend, 0 to 1.
- **list.savingsPct#from** → provided by the controller — placeholder function in the controller
  ollama:qwen2.5-coder:1.5b: Field "spend_trend.delta_pct": Change in spend between the last two spend uploads.
- **value.spendCard** → something else — build a placeholder…
  ollama:qwen2.5-coder:1.5b: Rows are sorted by spend descending.
- **value.spendCard#from** → combine values from API fields — placeholder function in the domain layer
  ollama:qwen2.5-coder:1.5b: GET /api/category-health/portfolio: Portfolio landing page for users managing two or more categories. Rows are sorted by spend descending.
- **value.spendYoy** → something else — build a placeholder…
  ollama:qwen2.5-coder:1.5b: Rows are sorted by spend descending.
- **value.spendYoy#from** → combine values from API fields — placeholder function in the domain layer
  ollama:qwen2.5-coder:1.5b: Rows are sorted by spend descending.
- **value.acceptedCount** → something else — build a placeholder…
  ollama:qwen2.5-coder:1.5b: Field "waiting_on_decision.savings_count": Savings initiatives waiting on a decision. A count, never money.
- **value.savingsTarget** → something else — build a placeholder…
  ollama:qwen2.5-coder:1.5b: Field "waiting_on_decision.savings_count": Savings initiatives waiting on a decision. A count, never money.
- **value.riskTarget** → something else — build a placeholder…
  ollama:qwen2.5-coder:1.5b: Field "risk_score": Composite risk score for the category.
- **action.page.suggest** → something else — name my own handler (placeholder)…
  ollama:qwen2.5-coder:1.5b: Suggestions under Ask Anything are AI prompts that use a handler of our own, not an API.

## Open items — what would close them

- **row.rank** (skipped) — No API field, with any built-in format, produces "01", "02", "03", "04", "05", "06".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "01", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "02", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "03", beroe_l2_id e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05 → "04"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.level** (skipped) — No API field, with any built-in format, produces "L3", "L2", "L3", "L2", "L2", "L2".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "L3", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "L2", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "L3", beroe_l2_id e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05 → "L2"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.spend** (skipped) — "spend.value" and "spend_trend.curr_value" both reproduce "$38.4M", "$62.8M", "$45.2M", "$27.3M", "$14.9M", "$91.6M", so the mock data can't tell them apart.
  → Make them differ in at least one row. For example, in the row with beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04, change "spend_trend.curr_value" to something other than "$38.4M". Whichever field still shows "$38.4M" is then the match.
- **row.maturity** (skipped) — No API field, with any built-in format, produces "2.0", "1.8", "2.1", "2.3", "2.2", "2.9".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "2.0", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "1.8", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "2.1", beroe_l2_id e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05 → "2.3"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.maturityGap** (skipped) — No API field, with any built-in format, produces "-0.7", "-0.6", "-0.5", "-0.2", "-0.1", "+0.3".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "-0.7", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "-0.6", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "-0.5", beroe_l2_id e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05 → "-0.2"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.peer** (skipped) — No API field, with any built-in format, produces "peer 2.7", "peer 2.4", "peer 2.6", "peer 2.5", "peer 2.3", "peer 2.6".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "peer 2.7", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "peer 2.4", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "peer 2.6", beroe_l2_id e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05 → "peer 2.5"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.savingsPct** (placeholder) — getSavingsPct() is a placeholder in the controller layer.
  → Write the real logic in getSavingsPct(), or close it by data: If the API has it, add a field to the GET response with these values per row (beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "14.6%", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "11.3%", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "9.3%", beroe_l2_id e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05 → "10.6%"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.flagFirst** (skipped) — No API field, with any built-in format, produces "3 high flags", "largest unclaimed $7.1M", "single supplier 9.5%", "1 high flag", "maturity in line with peers", "ahead on maturity".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "3 high flags", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "largest unclaimed $7.1M", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "single supplier 9.5%", beroe_l2_id e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05 → "1 high flag"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.flagSecond** (skipped) — No API field, with any built-in format, produces "widest maturity gap", "2 high flags", "$410K past due", "rate card 14% over peers", "tail spend 31% off-contract", "largest category".
  → If the API has it, add a field to the GET response with these values per row (beroe_l2_id b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04 → "widest maturity gap", beroe_l2_id 7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02 → "2 high flags", beroe_l2_id 9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03 → "$410K past due", beroe_l2_id e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05 → "rate card 14% over peers"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **categoryCount** (skipped) — field(portfolio_at_a_glance.waiting_on_decision.resilience_count) and count() both give "6".
  → Change "portfolio_at_a_glance.waiting_on_decision.resilience_count" or null in at least one row so the results differ.
- **improving** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "Grains, up on contract coverage and a renegotiated origination mix, and Chemicals, where the solvent index fell two quarters running.".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **declining** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "Logistics, where the maturity gap widened to -0.7 and three high flags are open, and Packaging, where supplier concentration moved the wrong way. IT & Software is flat.".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **spendCard** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "$280M".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **spendYoy** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "▲ 8.4% YoY".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **acceptedCount** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "23 of 60".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **highCategories** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "4".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **savingsTarget** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "$42.0M".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **oldestDays** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "34".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **riskCount** (skipped) — field(portfolio_at_a_glance.waiting_on_decision.resilience_count) and count() both give "6".
  → Change "portfolio_at_a_glance.waiting_on_decision.resilience_count" or null in at least one row so the results differ.
- **riskCategories** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "2".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **riskTarget** (skipped) — Nothing computed from the list (count, sum, average, min, max) gives "8.0".
  → If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **row order** (skipped) — No sort on any field gives the designed row order.
  → Add a field the design is sorted by, or answer "keep the API order".
- **suggest (page action)** (placeholder) — handleSuggest() is a placeholder in the controller layer.
  → Write the real logic in handleSuggest(), or close it by data: Rename it in the design (data-action) to a known verb, or answer with your own placeholder handler.
- **suggest (page action)** (placeholder) — handleSuggest() is a placeholder in the controller layer.
  → Write the real logic in handleSuggest(), or close it by data: Rename it in the design (data-action) to a known verb, or answer with your own placeholder handler.

## Skipped — answer later

- Row part "rank" (e.g. "01") can't be produced from any API field. What is it?
- Row part "level" (e.g. "L3") can't be produced from any API field. What is it?
- Row part "spend" (e.g. "$38.4M") matches more than one API field, and the mock data can't tell them apart. Which one is meant?
- Row part "maturity" (e.g. "2.0") can't be produced from any API field. What is it?
- Row part "maturityGap" (e.g. "-0.7") can't be produced from any API field. What is it?
- Row part "peer" (e.g. "peer 2.7") can't be produced from any API field. What is it?
- Row part "flagFirst" (e.g. "3 high flags") can't be produced from any API field. What is it?
- Row part "flagSecond" (e.g. "widest maturity gap") can't be produced from any API field. What is it?
- The designed row order matches more than one sort on the mock data. How should "categories" be sorted?
- "categoryCount" (shows "6") can be computed more than one way from the mock data. Which is meant?
- "improving" (shows "Grains, up on contract coverage and a renegotiated origination mix, and Chemicals, where the solvent index fell two quarters running.") can't be computed from the mock data. What is it?
- "declining" (shows "Logistics, where the maturity gap widened to -0.7 and three high flags are open, and Packaging, where supplier concentration moved the wrong way. IT & Software is flat.") can't be computed from the mock data. What is it?
- "spendCard" (shows "$280M") can't be computed from the mock data. What is it?
- "spendYoy" (shows "▲ 8.4% YoY") can't be computed from the mock data. What is it?
- "acceptedCount" (shows "23 of 60") can't be computed from the mock data. What is it?
- "highCategories" (shows "4") can't be computed from the mock data. What is it?
- "savingsTarget" (shows "$42.0M") can't be computed from the mock data. What is it?
- "oldestDays" (shows "34") can't be computed from the mock data. What is it?
- "riskCount" (shows "6") can be computed more than one way from the mock data. Which is meant?
- "riskCategories" (shows "2") can't be computed from the mock data. What is it?
- "riskTarget" (shows "8.0") can't be computed from the mock data. What is it?

## Placeholders to fill in

| Part | Function | Layer | Input |
|---|---|---|---|
| row.savingsPct | getSavingsPct() | Controller | controller |
| suggest (page action) | handleSuggest() | Controller | your handler |
| suggest (page action) | handleSuggest2() | Controller | your handler |

## Layers (7)

- **Route** — the feature is reached at /portfolio
- **Controller** — 25 data props and 3 actions must be wired to the page
- **Workflow** — states: loading/ready/failed; events: OPEN, SUGGEST, SUGGEST
- **Service** — 2 API endpoints are called
- **Domain** — computed values (spendYouManage, refreshedAt, headline, largestName, largestShare, savingsCard, acceptedPct, resilienceTotal, impactHigh, impactMedium, impactLow, savingsCount), formatted row fields
- **Page** — the designed JSX, rewritten to take props
- **Component** — the repeated "categories" row becomes PortfolioFigma1Row

## Questions & answers

- Row part "rank" (e.g. "01") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "level" (e.g. "L3") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "spend" (e.g. "$38.4M") matches more than one API field, and the mock data can't tell them apart. Which one is meant?
  → left open (auto mode) — answer later
- Row part "maturity" (e.g. "2.0") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "maturityGap" (e.g. "-0.7") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "peer" (e.g. "peer 2.7") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "savingsPct" (e.g. "14.6%") can't be produced from any API field. What is it?
  → placeholder getSavingsPct(), provided by the controller
- Row part "flagFirst" (e.g. "3 high flags") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- Row part "flagSecond" (e.g. "widest maturity gap") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- The designed row order matches more than one sort on the mock data. How should "categories" be sorted?
  → left open (auto mode) — answer later
- "categoryCount" (shows "6") can be computed more than one way from the mock data. Which is meant?
  → left open (auto mode) — answer later
- "improving" (shows "Grains, up on contract coverage and a renegotiated origination mix, and Chemicals, where the solvent index fell two quarters running.") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- "declining" (shows "Logistics, where the maturity gap widened to -0.7 and three high flags are open, and Packaging, where supplier concentration moved the wrong way. IT & Software is flat.") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- "spendCard" (shows "$280M") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- "spendYoy" (shows "▲ 8.4% YoY") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- "acceptedCount" (shows "23 of 60") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- "highCategories" (shows "4") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- "savingsTarget" (shows "$42.0M") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- "oldestDays" (shows "34") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- "riskCount" (shows "6") can be computed more than one way from the mock data. Which is meant?
  → left open (auto mode) — answer later
- "riskCategories" (shows "2") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- "riskTarget" (shows "8.0") can't be computed from the mock data. What is it?
  → left open (auto mode) — answer later
- What should the "suggest" action do?
  → placeholder handleSuggest(), your own handler
- What should the "suggest" action do?
  → placeholder handleSuggest(), your own handler

## Files

- features/portfolio-figma-1/route/PortfolioFigma1Route.jsx
- features/portfolio-figma-1/controller/PortfolioFigma1Controller.jsx
- features/portfolio-figma-1/workflow/portfolio-figma-1.workflow.js
- features/portfolio-figma-1/service/portfolio-figma-1.service.js
- features/portfolio-figma-1/domain/portfolio-figma-1.domain.js
- features/portfolio-figma-1/domain/portfolio-figma-1.domain.test.js
- features/portfolio-figma-1/page/PortfolioFigma1Page.jsx
- features/portfolio-figma-1/component/PortfolioFigma1Row.jsx
- features/portfolio-figma-1/mocks/portfolio-figma-1.mock.js
