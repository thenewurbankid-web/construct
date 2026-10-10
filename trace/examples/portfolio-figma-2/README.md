# Portfolio Health — Figma rebuild 2

**Source.** Subframe page `525f9df2-85e1-45ed-89e1-9114f8e42b83` (canvas *Portfolio Health*). The page is re-authored as plain marked JSX: same structure and copy, without the Subframe components, so the tool can read it.

**API.** The Category Health Report contract, `GET /api/category-health/portfolio` (Screen 4, planned Phase 4, draft shape): an *envelope* with header cards in `portfolio_at_a_glance` and the table rows in `categories[]` (`"list": "categories"` in `feature.json`). The mock data is sized so the six category spends sum to the "$280.2M" the rebuilds show.

**What is worth seeing.** Same content as *rebuild 1* with small copy differences (a real minus sign, `8.4% YoY` without the arrow, `target 8`), so the two examples produce the same matches and gaps. That is the point of having both: a design tool's near-duplicate pages don't add new information for the wiring.

**What the tool does with it.** Header values are matched against the envelope's scalar fields (`portfolio_at_a_glance.spend_you_manage` → "$280.2M", `meta.snapshot_date` → "31 Jul 2026"), table columns against `categories[].*` (`spend.value`, `spend.pct_of_total`, `savings_potential`, `risk_score`), and everything with no field becomes an open item with a hint. `story.md` holds the requirements from the contract (for `--ai`).

**Try it.** Press **Auto**, then open the API contract panel to see which fields the design uses (green) and what it needs that the contract lacks (red). `npm run reset -- portfolio-figma` restores the original files.
