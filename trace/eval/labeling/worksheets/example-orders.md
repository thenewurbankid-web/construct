# Labelling worksheet: example-orders

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

Endpoints: GET /api/orders, POST /api/orders
List: GET /api/orders (3 items)

| field | type | samples |
|---|---|---|
| id | number | 1, 2, 3 |
| number | string | "ORD-201", "ORD-202", "ORD-203" |
| customer | string | "Northwind", "Kestrel", "Bluepeak" |
| total | number | 1200, 560, 8900 |
| placedOn | string | "2026-09-01", "2026-09-03", "2026-09-07" |

## Parts

### list.number

a column value repeated in every row.

```json
{
 "name": "number",
 "header": "Order",
 "examples_in_designed_row_order": [
  "ORD-201",
  "ORD-202",
  "ORD-203"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.customer

a column value repeated in every row.

```json
{
 "name": "customer",
 "header": "Customer",
 "examples_in_designed_row_order": [
  "Northwind",
  "Kestrel",
  "Bluepeak"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.total

a column value repeated in every row.

```json
{
 "name": "total",
 "header": "Total",
 "examples_in_designed_row_order": [
  "$1,200",
  "$560",
  "$8,900"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.placedOn

a column value repeated in every row.

```json
{
 "name": "placedOn",
 "header": "Placed",
 "examples_in_designed_row_order": [
  "1 Sep 2026",
  "3 Sep 2026",
  "7 Sep 2026"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.status

a column value repeated in every row.

```json
{
 "name": "status",
 "header": "Status",
 "examples_in_designed_row_order": [
  "Shipped",
  "Pending",
  "Shipped"
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
   "number": "ORD-201",
   "customer": "Northwind",
   "total": "$1,200",
   "placedOn": "1 Sep 2026",
   "status": "Shipped"
  },
  {
   "number": "ORD-202",
   "customer": "Kestrel",
   "total": "$560",
   "placedOn": "3 Sep 2026",
   "status": "Pending"
  },
  {
   "number": "ORD-203",
   "customer": "Bluepeak",
   "total": "$8,900",
   "placedOn": "7 Sep 2026",
   "status": "Shipped"
  }
 ]
}
```
API order (first rows):
```json
[{"id":1,"number":"ORD-201","customer":"Northwind","total":1200,"placedOn":"2026-09-01"},{"id":2,"number":"ORD-202","customer":"Kestrel","total":560,"placedOn":"2026-09-03"},{"id":3,"number":"ORD-203","customer":"Bluepeak","total":8900,"placedOn":"2026-09-07"}]
```

ANSWER: 
UNSURE: 
NOTE: 

### value.orderCount

a value outside the list.

```json
{
 "name": "orderCount",
 "example": "3",
 "surrounding_text": "3 $10,660"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.totalValue

a value outside the list.

```json
{
 "name": "totalValue",
 "example": "$10,660",
 "surrounding_text": "3 $10,660"
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
