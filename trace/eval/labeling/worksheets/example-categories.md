# Labelling worksheet: example-categories

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

Endpoints: GET /api/categories, POST /api/categories, PUT /api/categories/:id, DELETE /api/categories/:id
List: GET /api/categories (4 items)

| field | type | samples |
|---|---|---|
| id | number | 1, 2, 3, 4 |
| name | string | "Logistics", "Packaging", "IT Services", "Grains & Cereals" |
| spend | number | 78400000, 62800000, 45200000, 91600000 |
| owner | string | "Prerna", "Arjun", "Mia", "Lena" |

## Parts

### list.name

a column value repeated in every row.

```json
{
 "name": "name",
 "header": "Category",
 "examples_in_designed_row_order": [
  "Grains & Cereals",
  "Logistics",
  "Packaging",
  "IT Services"
 ],
 "other_parts_in_the_same_cell": []
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
  "$91.6M",
  "$78.4M",
  "$62.8M",
  "$45.2M"
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
  "Lena",
  "Prerna",
  "Arjun",
  "Mia"
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
   "name": "Grains & Cereals",
   "spend": "$91.6M",
   "owner": "Lena"
  },
  {
   "name": "Logistics",
   "spend": "$78.4M",
   "owner": "Prerna"
  },
  {
   "name": "Packaging",
   "spend": "$62.8M",
   "owner": "Arjun"
  },
  {
   "name": "IT Services",
   "spend": "$45.2M",
   "owner": "Mia"
  }
 ]
}
```
API order (first rows):
```json
[{"id":1,"name":"Logistics","spend":78400000,"owner":"Prerna"},{"id":2,"name":"Packaging","spend":62800000,"owner":"Arjun"},{"id":3,"name":"IT Services","spend":45200000,"owner":"Mia"},{"id":4,"name":"Grains & Cereals","spend":91600000,"owner":"Lena"}]
```

ANSWER: 
UNSURE: 
NOTE: 

### value.categoryCount

a value outside the list.

```json
{
 "name": "categoryCount",
 "example": "4",
 "surrounding_text": "4 categories · $278.0M total spend · largest $91.6M · refreshed 31 Jul 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.totalSpend

a value outside the list.

```json
{
 "name": "totalSpend",
 "example": "$278.0M",
 "surrounding_text": "4 categories · $278.0M total spend · largest $91.6M · refreshed 31 Jul 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.largestSpend

a value outside the list.

```json
{
 "name": "largestSpend",
 "example": "$91.6M",
 "surrounding_text": "4 categories · $278.0M total spend · largest $91.6M · refreshed 31 Jul 2026"
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
 "surrounding_text": "4 categories · $278.0M total spend · largest $91.6M · refreshed 31 Jul 2026"
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
