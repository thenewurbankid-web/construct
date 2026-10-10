# Labelling worksheet: example-deals

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

Endpoints: GET /api/deals, POST /api/deals, PUT /api/deals/:id
List: GET /api/deals (6 items)

| field | type | samples |
|---|---|---|
| id | number | 1, 2, 3, 4 |
| name | string | "Atlas Renewal", "Borealis Expansion", "Cirrus Pilot", "Delta Upgrade" |
| account | string | "Northwind", "Kestrel", "Bluepeak", "Oriel" |
| contactFirst | string | "Lena", "Arjun", "Mia", "Ravi" |
| contactLast | string | "Kumar", "Rao", "Shah", "Nair" |
| owner | string | "Prerna", "Mia", "Ravi", "Lena" |
| csm | string | "Prerna", "Mia", "Ravi", "Lena" |
| value | number | 84000000, 152500000, 27500000, 61250000 |
| margin | number | 0.325, 0.281, 0.412, 0.198 |
| closeOn | string | "2026-10-14", "2026-10-02", "2026-11-20", "2026-10-29" |

Requirements:

# Deals — requirements

- The Owner column shows the salesperson who owns the deal.
- The CSM column shows the customer success manager, who takes over after the deal is won.
- The Contact column shows the customer contact's first and last name together, separated by a space.
- Deals are listed with the largest value first.
- The Stage column comes from a deal stage that the backend does not provide yet.
- The Forecast button opens a forecasting view that we have not built, so it uses a handler of our own.
- The weighted pipeline is the sum, over all deals, of the deal value times its margin.
- The header shows when the data was last synced; the controller supplies this.


## Parts

### list.name

a column value repeated in every row.

```json
{
 "name": "name",
 "header": "Deal",
 "examples_in_designed_row_order": [
  "Borealis Expansion",
  "Ember Platform",
  "Atlas Renewal",
  "Delta Upgrade",
  "Cirrus Pilot",
  "Fjord Support"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.account

a column value repeated in every row.

```json
{
 "name": "account",
 "header": "Account",
 "examples_in_designed_row_order": [
  "Kestrel",
  "Harbor",
  "Northwind",
  "Oriel",
  "Bluepeak",
  "Vantage"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.contact

a column value repeated in every row.

```json
{
 "name": "contact",
 "header": "Contact",
 "examples_in_designed_row_order": [
  "Arjun Rao",
  "Prerna Iyer",
  "Lena Kumar",
  "Ravi Nair",
  "Mia Shah",
  "Kabir Sen"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.owner

a column value repeated in every row.

```json
{
 "name": "owner",
 "header": "Owner",
 "examples_in_designed_row_order": [
  "Mia",
  "Arjun",
  "Prerna",
  "Lena",
  "Ravi",
  "Mia"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.csm

a column value repeated in every row.

```json
{
 "name": "csm",
 "header": "CSM",
 "examples_in_designed_row_order": [
  "Mia",
  "Arjun",
  "Prerna",
  "Lena",
  "Ravi",
  "Mia"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.value

a column value repeated in every row.

```json
{
 "name": "value",
 "header": "Value",
 "examples_in_designed_row_order": [
  "$152.5M",
  "$118.0M",
  "$84.0M",
  "$61.3M",
  "$27.5M",
  "$9.8M"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.margin

a column value repeated in every row.

```json
{
 "name": "margin",
 "header": "Margin",
 "examples_in_designed_row_order": [
  "28.1%",
  "36.0%",
  "32.5%",
  "19.8%",
  "41.2%",
  "15.0%"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.closeOn

a column value repeated in every row.

```json
{
 "name": "closeOn",
 "header": "Close",
 "examples_in_designed_row_order": [
  "2 Oct 2026",
  "5 Dec 2026",
  "14 Oct 2026",
  "29 Oct 2026",
  "20 Nov 2026",
  "3 Nov 2026"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.stage

a column value repeated in every row.

```json
{
 "name": "stage",
 "header": "Stage",
 "examples_in_designed_row_order": [
  "Proposal",
  "Proposal",
  "Negotiation",
  "Negotiation",
  "Qualified",
  "Won"
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
   "name": "Borealis Expansion",
   "account": "Kestrel",
   "contact": "Arjun Rao",
   "owner": "Mia",
   "csm": "Mia",
   "value": "$152.5M",
   "margin": "28.1%",
   "closeOn": "2 Oct 2026",
   "stage": "Proposal"
  },
  {
   "name": "Ember Platform",
   "account": "Harbor",
   "contact": "Prerna Iyer",
   "owner": "Arjun",
   "csm": "Arjun",
   "value": "$118.0M",
   "margin": "36.0%",
   "closeOn": "5 Dec 2026",
   "stage": "Proposal"
  },
  {
   "name": "Atlas Renewal",
   "account": "Northwind",
   "contact": "Lena Kumar",
   "owner": "Prerna",
   "csm": "Prerna",
   "value": "$84.0M",
   "margin": "32.5%",
   "closeOn": "14 Oct 2026",
   "stage": "Negotiation"
  },
  {
   "name": "Delta Upgrade",
   "account": "Oriel",
   "contact": "Ravi Nair",
   "owner": "Lena",
   "csm": "Lena",
   "value": "$61.3M",
   "margin": "19.8%",
   "closeOn": "29 Oct 2026",
   "stage": "Negotiation"
  },
  {
   "name": "Cirrus Pilot",
   "account": "Bluepeak",
   "contact": "Mia Shah",
   "owner": "Ravi",
   "csm": "Ravi",
   "value": "$27.5M",
   "margin": "41.2%",
   "closeOn": "20 Nov 2026",
   "stage": "Qualified"
  },
  {
   "name": "Fjord Support",
   "account": "Vantage",
   "contact": "Kabir Sen",
   "owner": "Mia",
   "csm": "Mia",
   "value": "$9.8M",
   "margin": "15.0%",
   "closeOn": "3 Nov 2026",
   "stage": "Won"
  }
 ]
}
```
API order (first rows):
```json
[{"id":1,"name":"Atlas Renewal","account":"Northwind","contactFirst":"Lena","contactLast":"Kumar","owner":"Prerna","csm":"Prerna","value":84000000,"margin":0.325,"closeOn":"2026-10-14"},{"id":2,"name":"Borealis Expansion","account":"Kestrel","contactFirst":"Arjun","contactLast":"Rao","owner":"Mia","csm":"Mia","value":152500000,"margin":0.281,"closeOn":"2026-10-02"},{"id":3,"name":"Cirrus Pilot","account":"Bluepeak","contactFirst":"Mia","contactLast":"Shah","owner":"Ravi","csm":"Ravi","value":27500000,"margin":0.412,"closeOn":"2026-11-20"},{"id":4,"name":"Delta Upgrade","account":"Oriel","contactFirst":"Ravi","contactLast":"Nair","owner":"Lena","csm":"Lena","value":61250000,"margin":0.198,"closeOn":"2026-10-29"},{"id":5,"name":"Ember Platform","account":"Harbor","contactFirst":"Prerna","contactLast":"Iyer","owner":"Arjun","csm":"Arjun","value":118000000,"margin":0.36,"closeOn":"2026-12-05"},{"id":6,"name":"Fjord Support","account":"Vantage","contactFirst":"Kabir","contactLast":"Sen","owner":"Mia","csm":"Mia","value":9800000,"margin":0.15,"closeOn":"2026-11-03"}]
```

ANSWER: 
UNSURE: 
NOTE: 

### value.dealCount

a value outside the list.

```json
{
 "name": "dealCount",
 "example": "6",
 "surrounding_text": "6 $453.1M $75.5M $152.5M $9.8M 28.8% $137.6M 26 Sep 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.pipeline

a value outside the list.

```json
{
 "name": "pipeline",
 "example": "$453.1M",
 "surrounding_text": "6 $453.1M $75.5M $152.5M $9.8M 28.8% $137.6M 26 Sep 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.avgDeal

a value outside the list.

```json
{
 "name": "avgDeal",
 "example": "$75.5M",
 "surrounding_text": "6 $453.1M $75.5M $152.5M $9.8M 28.8% $137.6M 26 Sep 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.largest

a value outside the list.

```json
{
 "name": "largest",
 "example": "$152.5M",
 "surrounding_text": "6 $453.1M $75.5M $152.5M $9.8M 28.8% $137.6M 26 Sep 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.smallest

a value outside the list.

```json
{
 "name": "smallest",
 "example": "$9.8M",
 "surrounding_text": "6 $453.1M $75.5M $152.5M $9.8M 28.8% $137.6M 26 Sep 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.avgMargin

a value outside the list.

```json
{
 "name": "avgMargin",
 "example": "28.8%",
 "surrounding_text": "6 $453.1M $75.5M $152.5M $9.8M 28.8% $137.6M 26 Sep 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.weighted

a value outside the list.

```json
{
 "name": "weighted",
 "example": "$137.6M",
 "surrounding_text": "6 $453.1M $75.5M $152.5M $9.8M 28.8% $137.6M 26 Sep 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.syncedAt

a value outside the list.

```json
{
 "name": "syncedAt",
 "example": "26 Sep 2026",
 "surrounding_text": "6 $453.1M $75.5M $152.5M $9.8M 28.8% $137.6M 26 Sep 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### action.row.edit

a button or form.

```json
{
 "verb_marker": "edit",
 "scope": "row"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### action.row.forecast

a button or form.

```json
{
 "verb_marker": "forecast",
 "scope": "row"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### action.row.delete

a button or form.

```json
{
 "verb_marker": "delete",
 "scope": "row"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### action.page.save

a button or form.

```json
{
 "verb_marker": "save",
 "scope": "page"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### action.page.cancel

a button or form.

```json
{
 "verb_marker": "cancel",
 "scope": "page"
}
```

ANSWER: 
UNSURE: 
NOTE: 
