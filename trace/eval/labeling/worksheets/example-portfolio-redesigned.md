# Labelling worksheet: example-portfolio-redesigned

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
  "level",
  "shareLabel",
  "oppLabel",
  "acceptedLabel"
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
  "L2",
  "L2",
  "L2",
  "L2",
  "L2",
  "L2"
 ],
 "other_parts_in_the_same_cell": [
  "name",
  "shareLabel",
  "oppLabel",
  "acceptedLabel"
 ]
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.shareLabel

a column value repeated in every row.

```json
{
 "name": "shareLabel",
 "header": "Category",
 "examples_in_designed_row_order": [
  "37% of total spend",
  "22.4% of total spend",
  "21.4% of total spend",
  "22.4% of total spend",
  "22.4% of total spend",
  "22.4% of total spend"
 ],
 "other_parts_in_the_same_cell": [
  "name",
  "level",
  "oppLabel",
  "acceptedLabel"
 ]
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.oppLabel

a column value repeated in every row.

```json
{
 "name": "oppLabel",
 "header": "Category",
 "examples_in_designed_row_order": [
  "5 qualified opportunities",
  "3 qualified opportunities",
  "3 qualified opportunities",
  "3 qualified opportunities",
  "3 qualified opportunities",
  "3 qualified opportunities"
 ],
 "other_parts_in_the_same_cell": [
  "name",
  "level",
  "shareLabel",
  "acceptedLabel"
 ]
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.acceptedLabel

a column value repeated in every row.

```json
{
 "name": "acceptedLabel",
 "header": "Category",
 "examples_in_designed_row_order": [
  "5 accepted",
  "2 accepted",
  "2 accepted",
  "2 accepted",
  "2 accepted",
  "2 accepted"
 ],
 "other_parts_in_the_same_cell": [
  "name",
  "level",
  "shareLabel",
  "oppLabel"
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
  "$78.4M",
  "$62.8M",
  "$45.2M",
  "$27.3M",
  "$14.9M",
  "$11.6M"
 ],
 "other_parts_in_the_same_cell": []
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
  "maturity"
 ]
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.savingsRangeRow

a column value repeated in every row.

```json
{
 "name": "savingsRangeRow",
 "header": "Potential savings",
 "examples_in_designed_row_order": [
  "$4.7M - $5.6M",
  "$5.3M - $7.1M",
  "$3.5M - $4.2M",
  "$1.8M - $2.9M",
  "$0.8M - $1.4M",
  "$3.2M"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.risk

a column value repeated in every row.

```json
{
 "name": "risk",
 "header": "Composite risk score",
 "examples_in_designed_row_order": [
  "72",
  "69",
  "67",
  "59",
  "84",
  "72"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.spendChange

a column value repeated in every row.

```json
{
 "name": "spendChange",
 "header": "Spend change",
 "examples_in_designed_row_order": [
  "+$5.1M",
  "-$3.2M",
  "+$1.2M",
  "$0.0",
  "+$5.1M",
  "-$5.1M"
 ],
 "other_parts_in_the_same_cell": []
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
   "level": "L2",
   "shareLabel": "37% of total spend",
   "oppLabel": "5 qualified opportunities",
   "acceptedLabel": "5 accepted",
   "spend": "$78.4M",
   "maturity": "2.0",
   "peer": "peer 2.7",
   "savingsRangeRow": "$4.7M - $5.6M",
   "risk": "72",
   "spendChange": "+$5.1M"
  },
  {
   "rank": "02",
   "name": "Packaging",
   "level": "L2",
   "shareLabel": "22.4% of total spend",
   "oppLabel": "3 qualified opportunities",
   "acceptedLabel": "2 accepted",
   "spend": "$62.8M",
   "maturity": "1.8",
   "peer": "peer 2.4",
   "savingsRangeRow": "$5.3M - $7.1M",
   "risk": "69",
   "spendChange": "-$3.2M"
  },
  {
   "rank": "03",
   "name": "IT Services",
   "level": "L2",
   "shareLabel": "21.4% of total spend",
   "oppLabel": "3 qualified opportunities",
   "acceptedLabel": "2 accepted",
   "spend": "$45.2M",
   "maturity": "2.1",
   "peer": "peer 2.6",
   "savingsRangeRow": "$3.5M - $4.2M",
   "risk": "67",
   "spendChange": "+$1.2M"
  },
  {
   "rank": "04",
   "name": "Professional Services",
   "level": "L2",
   "shareLabel": "22.4% of total spend",
   "oppLabel": "3 qualified opportunities",
   "acceptedLabel": "2 accepted",
   "spend": "$27.3M",
   "maturity": "2.3",
   "peer": "peer 2.5",
   "savingsRangeRow": "$1.8M - $2.9M",
   "risk": "59",
   "spendChange": "$0.0"
  },
  {
   "rank": "05",
   "name": "MRO",
   "level": "L2",
   "shareLabel": "22.4% of total spend",
   "oppLabel": "3 qualified opportunities",
   "acceptedLabel": "2 accepted",
   "spend": "$14.9M",
   "maturity": "2.2",
   "peer": "peer 2.3",
   "savingsRangeRow": "$0.8M - $1.4M",
   "risk": "84",
   "spendChange": "+$5.1M"
  },
  {
   "rank": "06",
   "name": "Grains & Cereals",
   "level": "L2",
   "shareLabel": "22.4% of total spend",
   "oppLabel": "3 qualified opportunities",
   "acceptedLabel": "2 accepted",
   "spend": "$11.6M",
   "maturity": "2.9",
   "peer": "peer 2.6",
   "savingsRangeRow": "$3.2M",
   "risk": "72",
   "spendChange": "-$5.1M"
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

### value.refreshedAt

a value outside the list.

```json
{
 "name": "refreshedAt",
 "example": "31 Jul 2026",
 "surrounding_text": "31 Jul 2026"
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
 "example": "Logistics, where the maturity gap widened to −0.7 and three high flags are open, and Packaging, where supplier concentration moved the wrong way. IT & Software is flat.",
 "surrounding_text": "Logistics, where the maturity gap widened to −0.7 and three high flags are open, and Packaging, where supplier concentration moved the wrong way. IT & Software is flat."
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.baselineSpend

a value outside the list.

```json
{
 "name": "baselineSpend",
 "example": "$280M",
 "surrounding_text": "$280M"
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

### value.savingsRange

a value outside the list.

```json
{
 "name": "savingsRange",
 "example": "$42 - 68M",
 "surrounding_text": "$42 - 68M"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.qualifiedCount

a value outside the list.

```json
{
 "name": "qualifiedCount",
 "example": "25",
 "surrounding_text": "25"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.coveredCount

a value outside the list.

```json
{
 "name": "coveredCount",
 "example": "21",
 "surrounding_text": "21"
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

### value.qualifiedInitiatives

a value outside the list.

```json
{
 "name": "qualifiedInitiatives",
 "example": "16",
 "surrounding_text": "16"
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
