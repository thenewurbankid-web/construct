# Labelling worksheet: example-portfolio-figma-1

Fill `ANSWER` for every part (`UNSURE: yes` if you cannot tell) and put your name after `LABELLER:`; save the file as `eval/labeling/filled/<same name>.md`. (The JSON worksheet of the same name works too: fill `answer.want` and `labeller`.) Do not look at Trace's output, `answers.json`, `decisions.json` or `ai-cache.json`.

LABELLER: 

## How to answer

- `f:<field>|<format>`: a list column shows an item field, e.g. f:lead|asText  (nested fields use dots: spend.value)
- `a:<agg>(<field>)|<format>`: a page value is an aggregate of the whole list: count(), sum(f), average(f), max(f), min(f), e.g. a:sum(budget)|moneyCompact
- `e:<path>|<format>`: a page value is a single field of the response outside the list, e.g. e:meta.snapshot_date|dateShort
- `s:<field>:asc|desc  or  s:none`: how the rows are ordered (s:none = the API's own order)
- `x:<kind>`: what an action does: create, update, save, remove, select, clear, reload, ignore
- `gap:todo | gap:custom | gap:static | gap:?`: NOTHING in the contract provides it. todo = leave a TODO, custom = someone writes a placeholder, static = it is fixed text, ? = no view on how it is closed
- `u:<field>|<recipe>`: it comes from a field but needs a transformation none of the formats below does; describe the recipe in words

Formats: `asText` (the value as is, 12 -> 12, Lena -> Lena); `moneyCompact` (1234567 -> $1.2M, 45000 -> $45.0K, 900 -> $900); `moneyFull` (1200 -> $1,200); `percent` (0.327 -> 32.7%); `percentWhole` (0.327 -> 33%); `dateShort` (2026-07-31... -> 31 Jul 2026)

- Decide from the design text and the contract only. Do not run Trace and do not open answers.json, decisions.json or ai-cache.json.
- If two contract fields (or two aggregates) reproduce the design equally well, choose the one the design MEANS (use the header, the surrounding words, the docs and the story) and say why in note.
- If you cannot tell, set unsure to true: the part is then left out of every number instead of guessed.

## Contract

Endpoints: GET /api/category-health/portfolio, GET /api/category-health/categories
List: GET /api/category-health/portfolio (rows are in "categories") (6 items)

| field | type | samples |
|---|---|---|
| beroe_l2_id | string | "3c1e7d20-5f0a-4b6c-8d11-0a9e2f7b4c01", "7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02", "9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03", "b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04" |
| display_name | string | "Grains & Cereals", "Packaging", "IT Services", "Logistics" |
| spend.value | number | 91600000, 62800000, 45200000, 38400000 |
| spend.pct_of_total | number | 0.327, 0.224, 0.161, 0.137 |
| maturity_score | number | 58, 36, 42, 40 |
| savings_potential | number | 3200000, 7100000, 4200000, 5600000 |
| risk_score | number | 72, 69, 67, 72 |
| spend_trend.prev_value | number | 88500000, 64900000, 44000000, 33300000 |
| spend_trend.curr_value | number | 91600000, 62800000, 45200000, 38400000 |
| spend_trend.delta_pct | number | 0.035, -0.032, 0.027, 0.153 |
| deep_link | string | "/category-health/categories/3c1e7d20-5f0a-4b6c-8d11-0a9e2f7b4c01/summary", "/category-health/categories/7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02/summary", "/category-health/categories/9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03/summary", "/category-health/categories/b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04/summary" |

Response fields outside the list:

- `meta.user_id` = "u-1042"
- `meta.org_id` = "org-7"
- `meta.snapshot_date` = "2026-07-31T10:00:00Z"
- `narrative.cross_l2_summary` = "Grains is carrying your portfolio. Logistics and Packaging are not."
- `portfolio_at_a_glance.spend_you_manage` = 280200000
- `portfolio_at_a_glance.largest_category.display_name` = "Grains & Cereals"
- `portfolio_at_a_glance.largest_category.share_of_portfolio` = 0.327
- `portfolio_at_a_glance.savings_potential.value` = 24500000
- `portfolio_at_a_glance.savings_potential.pct_of_spend` = 0.087
- `portfolio_at_a_glance.savings_potential.qualified_accepted_pct` = 0.38
- `portfolio_at_a_glance.resilience_initiatives.total` = 21
- `portfolio_at_a_glance.resilience_initiatives.by_impact.high` = 7
- `portfolio_at_a_glance.resilience_initiatives.by_impact.medium` = 13
- `portfolio_at_a_glance.resilience_initiatives.by_impact.low` = 1
- `portfolio_at_a_glance.waiting_on_decision.savings_count` = 26
- `portfolio_at_a_glance.waiting_on_decision.resilience_count` = 6
- `portfolio_at_a_glance.waiting_on_decision.note` = "counts only, no monetary value"

Contract docs: {"fields":{"spend_you_manage":"Total spend across the categories the user manages.","spend.pct_of_total":"The category's share of the user's total spend, 0 to 1.","maturity_score":"Category maturity on a 0 to 100 scale.","risk_score":"Composite risk score for the category.","spend_trend.delta_pct":"Change in spend between the last two spend uploads.","waiting_on_decision.savings_count":"Savings initiatives waiting on a decision. A count, never money."},"endpoints":{"GET /api/category-health/portfolio":"Portfolio landing page for users managing two or more categories. Rows are sorted by spend descending."}}

Requirements:

# Portfolio Health — requirements (from the Category Health Report API reference)

- The portfolio screen is for users who manage two or more categories.
- Rows are sorted by spend descending.
- The spend-trend chip compares the last two spend uploads, not the last two framework runs.
- The waiting-on-decision card shows counts only, never money.
- Never show the tokens L2 or L3 in any user-visible text; use the client-side display name.
- The category maturity score is on a 0 to 100 scale.
- The narrative comes from the cross-category summary of the portfolio response.
- Suggestions under Ask Anything are AI prompts that use a handler of our own, not an API.


## Parts

### list.rank

a column value repeated in every row.

```json
{
 "name": "rank",
 "header": "#",
 "examples_in_designed_row_order": [
  "01",
  "02",
  "03",
  "04",
  "05",
  "06"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.name

a column value repeated in every row.

```json
{
 "name": "name",
 "header": "Category",
 "examples_in_designed_row_order": [
  "Logistics",
  "Packaging",
  "IT Services",
  "Professional Services",
  "MRO",
  "Grains & Cereals"
 ],
 "other_parts_in_the_same_cell": [
  "level"
 ]
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.level

a column value repeated in every row.

```json
{
 "name": "level",
 "header": "Category",
 "examples_in_designed_row_order": [
  "L3",
  "L2",
  "L3",
  "L2",
  "L2",
  "L2"
 ],
 "other_parts_in_the_same_cell": [
  "name"
 ]
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.spend

a column value repeated in every row.

```json
{
 "name": "spend",
 "header": "Spend",
 "examples_in_designed_row_order": [
  "$38.4M",
  "$62.8M",
  "$45.2M",
  "$27.3M",
  "$14.9M",
  "$91.6M"
 ],
 "other_parts_in_the_same_cell": [
  "share"
 ]
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.share

a column value repeated in every row.

```json
{
 "name": "share",
 "header": "Spend",
 "examples_in_designed_row_order": [
  "13.7%",
  "22.4%",
  "16.1%",
  "9.7%",
  "5.3%",
  "32.7%"
 ],
 "other_parts_in_the_same_cell": [
  "spend"
 ]
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.maturity

a column value repeated in every row.

```json
{
 "name": "maturity",
 "header": "Maturity",
 "examples_in_designed_row_order": [
  "2.0",
  "1.8",
  "2.1",
  "2.3",
  "2.2",
  "2.9"
 ],
 "other_parts_in_the_same_cell": [
  "maturityGap",
  "peer"
 ]
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.maturityGap

a column value repeated in every row.

```json
{
 "name": "maturityGap",
 "header": "Maturity",
 "examples_in_designed_row_order": [
  "-0.7",
  "-0.6",
  "-0.5",
  "-0.2",
  "-0.1",
  "+0.3"
 ],
 "other_parts_in_the_same_cell": [
  "maturity",
  "peer"
 ]
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.peer

a column value repeated in every row.

```json
{
 "name": "peer",
 "header": "Maturity",
 "examples_in_designed_row_order": [
  "peer 2.7",
  "peer 2.4",
  "peer 2.6",
  "peer 2.5",
  "peer 2.3",
  "peer 2.6"
 ],
 "other_parts_in_the_same_cell": [
  "maturity",
  "maturityGap"
 ]
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.savings

a column value repeated in every row.

```json
{
 "name": "savings",
 "header": "Savings potential",
 "examples_in_designed_row_order": [
  "$5.6M",
  "$7.1M",
  "$4.2M",
  "$2.9M",
  "$1.4M",
  "$3.2M"
 ],
 "other_parts_in_the_same_cell": [
  "savingsPct"
 ]
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.savingsPct

a column value repeated in every row.

```json
{
 "name": "savingsPct",
 "header": "Savings potential",
 "examples_in_designed_row_order": [
  "14.6%",
  "11.3%",
  "9.3%",
  "10.6%",
  "9.4%",
  "3.5%"
 ],
 "other_parts_in_the_same_cell": [
  "savings"
 ]
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.flagFirst

a column value repeated in every row.

```json
{
 "name": "flagFirst",
 "header": "Needs attention",
 "examples_in_designed_row_order": [
  "3 high flags",
  "largest unclaimed $7.1M",
  "single supplier 9.5%",
  "1 high flag",
  "maturity in line with peers",
  "ahead on maturity"
 ],
 "other_parts_in_the_same_cell": [
  "flagSecond"
 ]
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.flagSecond

a column value repeated in every row.

```json
{
 "name": "flagSecond",
 "header": "Needs attention",
 "examples_in_designed_row_order": [
  "widest maturity gap",
  "2 high flags",
  "$410K past due",
  "rate card 14% over peers",
  "tail spend 31% off-contract",
  "largest category"
 ],
 "other_parts_in_the_same_cell": [
  "flagFirst"
 ]
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.sort

the order of the designed rows.

```json
{
 "designed_rows": [
  {
   "rank": "01",
   "name": "Logistics",
   "level": "L3",
   "spend": "$38.4M",
   "share": "13.7%",
   "maturity": "2.0",
   "maturityGap": "-0.7",
   "peer": "peer 2.7",
   "savings": "$5.6M",
   "savingsPct": "14.6%",
   "flagFirst": "3 high flags",
   "flagSecond": "widest maturity gap"
  },
  {
   "rank": "02",
   "name": "Packaging",
   "level": "L2",
   "spend": "$62.8M",
   "share": "22.4%",
   "maturity": "1.8",
   "maturityGap": "-0.6",
   "peer": "peer 2.4",
   "savings": "$7.1M",
   "savingsPct": "11.3%",
   "flagFirst": "largest unclaimed $7.1M",
   "flagSecond": "2 high flags"
  },
  {
   "rank": "03",
   "name": "IT Services",
   "level": "L3",
   "spend": "$45.2M",
   "share": "16.1%",
   "maturity": "2.1",
   "maturityGap": "-0.5",
   "peer": "peer 2.6",
   "savings": "$4.2M",
   "savingsPct": "9.3%",
   "flagFirst": "single supplier 9.5%",
   "flagSecond": "$410K past due"
  },
  {
   "rank": "04",
   "name": "Professional Services",
   "level": "L2",
   "spend": "$27.3M",
   "share": "9.7%",
   "maturity": "2.3",
   "maturityGap": "-0.2",
   "peer": "peer 2.5",
   "savings": "$2.9M",
   "savingsPct": "10.6%",
   "flagFirst": "1 high flag",
   "flagSecond": "rate card 14% over peers"
  },
  {
   "rank": "05",
   "name": "MRO",
   "level": "L2",
   "spend": "$14.9M",
   "share": "5.3%",
   "maturity": "2.2",
   "maturityGap": "-0.1",
   "peer": "peer 2.3",
   "savings": "$1.4M",
   "savingsPct": "9.4%",
   "flagFirst": "maturity in line with peers",
   "flagSecond": "tail spend 31% off-contract"
  },
  {
   "rank": "06",
   "name": "Grains & Cereals",
   "level": "L2",
   "spend": "$91.6M",
   "share": "32.7%",
   "maturity": "2.9",
   "maturityGap": "+0.3",
   "peer": "peer 2.6",
   "savings": "$3.2M",
   "savingsPct": "3.5%",
   "flagFirst": "ahead on maturity",
   "flagSecond": "largest category"
  }
 ]
}
```
API order (first rows):
```json
[{"beroe_l2_id":"3c1e7d20-5f0a-4b6c-8d11-0a9e2f7b4c01","display_name":"Grains & Cereals","spend.value":91600000,"spend.pct_of_total":0.327,"maturity_score":58,"savings_potential":3200000,"risk_score":72,"spend_trend.prev_value":88500000,"spend_trend.curr_value":91600000,"spend_trend.delta_pct":0.035,"deep_link":"/category-health/categories/3c1e7d20-5f0a-4b6c-8d11-0a9e2f7b4c01/summary"},{"beroe_l2_id":"7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02","display_name":"Packaging","spend.value":62800000,"spend.pct_of_total":0.224,"maturity_score":36,"savings_potential":7100000,"risk_score":69,"spend_trend.prev_value":64900000,"spend_trend.curr_value":62800000,"spend_trend.delta_pct":-0.032,"deep_link":"/category-health/categories/7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02/summary"},{"beroe_l2_id":"9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03","display_name":"IT Services","spend.value":45200000,"spend.pct_of_total":0.161,"maturity_score":42,"savings_potential":4200000,"risk_score":67,"spend_trend.prev_value":44000000,"spend_trend.curr_value":45200000,"spend_trend.delta_pct":0.027,"deep_link":"/category-health/categories/9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03/summary"},{"beroe_l2_id":"b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04","display_name":"Logistics","spend.value":38400000,"spend.pct_of_total":0.137,"maturity_score":40,"savings_potential":5600000,"risk_score":72,"spend_trend.prev_value":33300000,"spend_trend.curr_value":38400000,"spend_trend.delta_pct":0.153,"deep_link":"/category-health/categories/b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04/summary"},{"beroe_l2_id":"e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05","display_name":"Professional Services","spend.value":27300000,"spend.pct_of_total":0.097,"maturity_score":46,"savings_potential":2900000,"risk_score":59,"spend_trend.prev_value":27300000,"spend_trend.curr_value":27300000,"spend_trend.delta_pct":0,"deep_link":"/category-health/categories/e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05/summary"},{"beroe_l2_id":"0f6b3a97-4e2c-4d81-a5f3-7c9e1b8d2a06","display_name":"MRO","spend.value":14900000,"spend.pct_of_total":0.053,"maturity_score":44,"savings_potential":1400000,"risk_score":84,"spend_trend.prev_value":9800000,"spend_trend.curr_value":14900000,"spend_trend.delta_pct":0.52,"deep_link":"/category-health/categories/0f6b3a97-4e2c-4d81-a5f3-7c9e1b8d2a06/summary"}]
```

ANSWER: 
UNSURE: 
NOTE: 

### value.categoryCount

a value outside the list.

```json
{
 "name": "categoryCount",
 "example": "6",
 "surrounding_text": "6 $280.2M 31 Jul 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.spendYouManage

a value outside the list.

```json
{
 "name": "spendYouManage",
 "example": "$280.2M",
 "surrounding_text": "6 $280.2M 31 Jul 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.refreshedAt

a value outside the list.

```json
{
 "name": "refreshedAt",
 "example": "31 Jul 2026",
 "surrounding_text": "6 $280.2M 31 Jul 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.headline

a value outside the list.

```json
{
 "name": "headline",
 "example": "Grains is carrying your portfolio. Logistics and Packaging are not.",
 "surrounding_text": "Grains is carrying your portfolio. Logistics and Packaging are not."
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.improving

a value outside the list.

```json
{
 "name": "improving",
 "example": "Grains, up on contract coverage and a renegotiated origination mix, and Chemicals, where the solvent index fell two quarters running.",
 "surrounding_text": "Grains, up on contract coverage and a renegotiated origination mix, and Chemicals, where the solvent index fell two quarters running."
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.declining

a value outside the list.

```json
{
 "name": "declining",
 "example": "Logistics, where the maturity gap widened to -0.7 and three high flags are open, and Packaging, where supplier concentration moved the wrong way. IT & Software is flat.",
 "surrounding_text": "Logistics, where the maturity gap widened to -0.7 and three high flags are open, and Packaging, where supplier concentration moved the wrong way. IT & Software is flat."
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.spendCard

a value outside the list.

```json
{
 "name": "spendCard",
 "example": "$280M",
 "surrounding_text": "$280M"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.spendYoy

a value outside the list.

```json
{
 "name": "spendYoy",
 "example": "▲ 8.4% YoY",
 "surrounding_text": "▲ 8.4% YoY"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.largestName

a value outside the list.

```json
{
 "name": "largestName",
 "example": "Grains & Cereals",
 "surrounding_text": "Grains & Cereals33%"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.largestShare

a value outside the list.

```json
{
 "name": "largestShare",
 "example": "33%",
 "surrounding_text": "Grains & Cereals33%"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.savingsCard

a value outside the list.

```json
{
 "name": "savingsCard",
 "example": "$24.5M",
 "surrounding_text": "$24.5M"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.acceptedPct

a value outside the list.

```json
{
 "name": "acceptedPct",
 "example": "38%",
 "surrounding_text": "38%"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.acceptedCount

a value outside the list.

```json
{
 "name": "acceptedCount",
 "example": "23 of 60",
 "surrounding_text": "23 of 60"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.resilienceTotal

a value outside the list.

```json
{
 "name": "resilienceTotal",
 "example": "21",
 "surrounding_text": "21"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.impactHigh

a value outside the list.

```json
{
 "name": "impactHigh",
 "example": "7",
 "surrounding_text": "7131"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.impactMedium

a value outside the list.

```json
{
 "name": "impactMedium",
 "example": "13",
 "surrounding_text": "7131"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.impactLow

a value outside the list.

```json
{
 "name": "impactLow",
 "example": "1",
 "surrounding_text": "7131"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.highCategories

a value outside the list.

```json
{
 "name": "highCategories",
 "example": "4",
 "surrounding_text": "4"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.savingsCount

a value outside the list.

```json
{
 "name": "savingsCount",
 "example": "26",
 "surrounding_text": "26"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.savingsTarget

a value outside the list.

```json
{
 "name": "savingsTarget",
 "example": "$42.0M",
 "surrounding_text": "$42.0M"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.oldestDays

a value outside the list.

```json
{
 "name": "oldestDays",
 "example": "34",
 "surrounding_text": "34"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.riskCount

a value outside the list.

```json
{
 "name": "riskCount",
 "example": "6",
 "surrounding_text": "6"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.riskCategories

a value outside the list.

```json
{
 "name": "riskCategories",
 "example": "2",
 "surrounding_text": "2"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.riskTarget

a value outside the list.

```json
{
 "name": "riskTarget",
 "example": "8.0",
 "surrounding_text": "8.0"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### action.row.open

a button or form.

```json
{
 "verb_marker": "open",
 "scope": "row"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### action.page.suggest

a button or form.

```json
{
 "verb_marker": "suggest",
 "scope": "page"
}
```

ANSWER: 
UNSURE: 
NOTE: 
