# Portfolio Health — Figma rebuild

**Source.** Subframe page `4bfd1c16-9d2a-4223-b709-ba46c6ead88c` (canvas *Portfolio Health*). The page is re-authored as plain marked JSX: same structure and copy, without the Subframe components, so the tool can read it.

**API.** The Category Health Report contract, `GET /api/category-health/portfolio` (Screen 4, planned Phase 4, draft shape): an *envelope* with header cards in `portfolio_at_a_glance` and the table rows in `categories[]` (`"list": "categories"` in `feature.json`). The mock data is sized so the six category spends sum to the "$280.2M" the rebuilds show.

**What is worth seeing.** The design lists categories by *needs attention*, the API by spend (descending), so no sort explains the row order. The *Maturity* column shows `2.0` on a 1–5 scale while the API's `maturity_score` is 0–100. The *L3* / *L2* badges break the contract rule to never show those tokens. The `6` in *Risk initiatives* is a tie between the number of categories and `waiting_on_decision.resilience_count`. Most badges, the sparkline and the target figures have no field behind them.

**What the tool does with it.** Header values are matched against the envelope's scalar fields (`portfolio_at_a_glance.spend_you_manage` → "$280.2M", `meta.snapshot_date` → "31 Jul 2026"), table columns against `categories[].*` (`spend.value`, `spend.pct_of_total`, `savings_potential`, `risk_score`), and everything with no field becomes an open item with a hint. `story.md` holds the requirements from the contract (for `--ai`).

**Try it.** Press **Auto**, then open the API contract panel to see which fields the design uses (green) and what it needs that the contract lacks (red). `npm run reset -- portfolio-figma` restores the original files.
