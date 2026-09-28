# Portfolio health — Redesigned

**Source.** Subframe page `a652d09f-ac57-4603-95cf-c9efa67d2f0a` (canvas *Portfolio Health*). The page is re-authored as plain marked JSX: same structure and copy, without the Subframe components, so the tool can read it.

**API.** The Category Health Report contract, `GET /api/category-health/portfolio` (Screen 4, planned Phase 4, draft shape): an *envelope* with header cards in `portfolio_at_a_glance` and the table rows in `categories[]` (`"list": "categories"` in `feature.json`). The mock data is sized so the six category spends sum to the "$280.2M" the rebuilds show.

**What is worth seeing.** This design disagrees with the API and with the rebuilds: it shows Logistics at `$78.4M` where the data (and the rebuilds) say `$38.4M`; *Potential savings* is a range (`$42 - 68M`) built from two fields; *Spend change* is a delta in dollars while the contract only has `spend_trend.delta_pct`; *Categories covered* shows `21`, which happens to equal `resilience_initiatives.total`, so the tool matches it by value even though it is probably a copy-paste slip in the design. Values that are equal are not the same thing, so read those matches.

**What the tool does with it.** Header values are matched against the envelope's scalar fields (`portfolio_at_a_glance.spend_you_manage` → "$280.2M", `meta.snapshot_date` → "31 Jul 2026"), table columns against `categories[].*` (`spend.value`, `spend.pct_of_total`, `savings_potential`, `risk_score`), and everything with no field becomes an open item with a hint. `story.md` holds the requirements from the contract (for `--ai`).

**Try it.** Press **Auto**, then open the API contract panel to see which fields the design uses (green) and what it needs that the contract lacks (red). `npm run reset -- portfolio-redesigned` restores the original files.
