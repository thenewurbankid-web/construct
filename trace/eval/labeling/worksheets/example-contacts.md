# Labelling worksheet: example-contacts

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

Endpoints: GET /api/contacts, POST /api/contacts, PUT /api/contacts/:id, DELETE /api/contacts/:id
List: GET /api/contacts (3 items)

| field | type | samples |
|---|---|---|
| id | number | 1, 2, 3 |
| first | string | "Lena", "Arjun", "Mia" |
| last | string | "Kumar", "Rao", "Shah" |
| email | string | "lena@example.com", "arjun@example.com", "mia@example.com" |
| city | string | "Pune", "Delhi", "Mumbai" |

Requirements:

# Contacts — requirements

- The Name column shows the contact's first name and last name together, separated by a space.
- Initials are the first letter of the first name followed by the first letter of the last name, in capitals.
- The header shows when the directory was last updated; the backend will add an endpoint for this later.
- The Call button starts a phone call with a handler of our own; the backend has no call API.


## Parts

### list.fullName

a column value repeated in every row.

```json
{
 "name": "fullName",
 "header": "Name",
 "examples_in_designed_row_order": [
  "Lena Kumar",
  "Arjun Rao",
  "Mia Shah"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.initials

a column value repeated in every row.

```json
{
 "name": "initials",
 "header": "Initials",
 "examples_in_designed_row_order": [
  "LK",
  "AR",
  "MS"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.email

a column value repeated in every row.

```json
{
 "name": "email",
 "header": "Email",
 "examples_in_designed_row_order": [
  "lena@example.com",
  "arjun@example.com",
  "mia@example.com"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.city

a column value repeated in every row.

```json
{
 "name": "city",
 "header": "City",
 "examples_in_designed_row_order": [
  "Pune",
  "Delhi",
  "Mumbai"
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
   "fullName": "Lena Kumar",
   "initials": "LK",
   "email": "lena@example.com",
   "city": "Pune"
  },
  {
   "fullName": "Arjun Rao",
   "initials": "AR",
   "email": "arjun@example.com",
   "city": "Delhi"
  },
  {
   "fullName": "Mia Shah",
   "initials": "MS",
   "email": "mia@example.com",
   "city": "Mumbai"
  }
 ]
}
```
API order (first rows):
```json
[{"id":1,"first":"Lena","last":"Kumar","email":"lena@example.com","city":"Pune"},{"id":2,"first":"Arjun","last":"Rao","email":"arjun@example.com","city":"Delhi"},{"id":3,"first":"Mia","last":"Shah","email":"mia@example.com","city":"Mumbai"}]
```

ANSWER: 
UNSURE: 
NOTE: 

### value.contactCount

a value outside the list.

```json
{
 "name": "contactCount",
 "example": "3",
 "surrounding_text": "3 26 Sep 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.directoryUpdated

a value outside the list.

```json
{
 "name": "directoryUpdated",
 "example": "26 Sep 2026",
 "surrounding_text": "3 26 Sep 2026"
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

### action.row.call

a button or form.

```json
{
 "verb_marker": "call",
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
