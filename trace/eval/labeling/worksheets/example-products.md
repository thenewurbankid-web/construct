# Labelling worksheet: example-products

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

Endpoints: GET /api/products, POST /api/products, PUT /api/products/:id, DELETE /api/products/:id
List: GET /api/products (3 items)

| field | type | samples |
|---|---|---|
| id | number | 1, 2, 3 |
| name | string | "Desk Lamp", "Notebook", "Backpack" |
| price | number | 4900, 450, 6800 |
| stock | number | 12, 240, 35 |
| addedOn | string | "2026-07-04", "2026-06-18", "2026-08-01" |

## Parts

### list.name

a column value repeated in every row.

```json
{
 "name": "name",
 "header": "Product",
 "examples_in_designed_row_order": [
  "Desk Lamp",
  "Notebook",
  "Backpack"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.price

a column value repeated in every row.

```json
{
 "name": "price",
 "header": "Price",
 "examples_in_designed_row_order": [
  "$4,900",
  "$450",
  "$6,800"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.stock

a column value repeated in every row.

```json
{
 "name": "stock",
 "header": "Stock",
 "examples_in_designed_row_order": [
  "12",
  "240",
  "35"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.addedOn

a column value repeated in every row.

```json
{
 "name": "addedOn",
 "header": "Added",
 "examples_in_designed_row_order": [
  "4 Jul 2026",
  "18 Jun 2026",
  "1 Aug 2026"
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
   "name": "Desk Lamp",
   "price": "$4,900",
   "stock": "12",
   "addedOn": "4 Jul 2026"
  },
  {
   "name": "Notebook",
   "price": "$450",
   "stock": "240",
   "addedOn": "18 Jun 2026"
  },
  {
   "name": "Backpack",
   "price": "$6,800",
   "stock": "35",
   "addedOn": "1 Aug 2026"
  }
 ]
}
```
API order (first rows):
```json
[{"id":1,"name":"Desk Lamp","price":4900,"stock":12,"addedOn":"2026-07-04"},{"id":2,"name":"Notebook","price":450,"stock":240,"addedOn":"2026-06-18"},{"id":3,"name":"Backpack","price":6800,"stock":35,"addedOn":"2026-08-01"}]
```

ANSWER: 
UNSURE: 
NOTE: 

### value.productCount

a value outside the list.

```json
{
 "name": "productCount",
 "example": "3",
 "surrounding_text": "3 287 $4,050"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.stockTotal

a value outside the list.

```json
{
 "name": "stockTotal",
 "example": "287",
 "surrounding_text": "3 287 $4,050"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.avgPrice

a value outside the list.

```json
{
 "name": "avgPrice",
 "example": "$4,050",
 "surrounding_text": "3 287 $4,050"
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
