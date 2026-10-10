# Labelling worksheet: example-roster

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

Endpoints: GET /api/roster, POST /api/roster, PUT /api/roster/:id, DELETE /api/roster/:id
List: GET /api/roster (3 items)

| field | type | samples |
|---|---|---|
| id | number | 1, 2, 3 |
| project | string | "Apollo", "Borealis", "Cirrus" |
| lead | string | "Lena", "Arjun", "Mia" |
| deputy | string | "Lena", "Arjun", "Mia" |
| budget | number | 120000, 80000, 45000 |
| forecast | number | 120000, 80000, 45000 |

Requirements:

# Roster — requirements

- Owner is the project lead.
- Backup is the project's deputy.
- The planned total is the sum of all budgets.
- The forecast total is the sum of all forecasts.


## Parts

### list.project

a column value repeated in every row.

```json
{
 "name": "project",
 "header": "Project",
 "examples_in_designed_row_order": [
  "Apollo",
  "Borealis",
  "Cirrus"
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
  "Arjun",
  "Mia"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.backup

a column value repeated in every row.

```json
{
 "name": "backup",
 "header": "Backup",
 "examples_in_designed_row_order": [
  "Lena",
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
   "project": "Apollo",
   "owner": "Lena",
   "backup": "Lena"
  },
  {
   "project": "Borealis",
   "owner": "Arjun",
   "backup": "Arjun"
  },
  {
   "project": "Cirrus",
   "owner": "Mia",
   "backup": "Mia"
  }
 ]
}
```
API order (first rows):
```json
[{"id":1,"project":"Apollo","lead":"Lena","deputy":"Lena","budget":120000,"forecast":120000},{"id":2,"project":"Borealis","lead":"Arjun","deputy":"Arjun","budget":80000,"forecast":80000},{"id":3,"project":"Cirrus","lead":"Mia","deputy":"Mia","budget":45000,"forecast":45000}]
```

ANSWER: 
UNSURE: 
NOTE: 

### value.projectCount

a value outside the list.

```json
{
 "name": "projectCount",
 "example": "3",
 "surrounding_text": "3 $245.0K $245.0K"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.plannedTotal

a value outside the list.

```json
{
 "name": "plannedTotal",
 "example": "$245.0K",
 "surrounding_text": "3 $245.0K $245.0K"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.forecastTotal

a value outside the list.

```json
{
 "name": "forecastTotal",
 "example": "$245.0K",
 "surrounding_text": "3 $245.0K $245.0K"
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
