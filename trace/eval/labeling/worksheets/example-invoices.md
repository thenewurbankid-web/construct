# Labelling worksheet: example-invoices

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

Endpoints: GET /api/invoices, POST /api/invoices, PUT /api/invoices/:id, DELETE /api/invoices/:id
List: GET /api/invoices (4 items)

| field | type | samples |
|---|---|---|
| id | number | 1, 2, 3, 4 |
| number | string | "INV-1041", "INV-1042", "INV-1043", "INV-1044" |
| vendor | string | "Northwind Freight", "Kestrel Packaging", "Bluepeak IT", "Oriel Chemicals" |
| amount | number | 18400000, 48200000, 9700000, 31600000 |
| outstanding | number | 18400000, 48200000, 4000000, 31600000 |
| dueDate | string | "2026-08-21", "2026-08-02", "2026-09-05", "2026-08-09" |
| requester | string | "Prerna", "Lena", "Arjun", "Mia" |
| assignee | string | "Prerna", "Lena", "Arjun", "Mia" |

Requirements:

# Invoices — requirements

- Each invoice records who requested it (the requester) and who approves it (the assignee).
- The list shows the person who requested each invoice, in the "Requested by" column.
- Invoices are listed with the largest amount first.
- The header shows the largest invoice amount.
- Archiving an invoice has no backend support yet, so the Archive button uses a handler of our own.
- The Status column comes from a status the backend does not provide yet.
- The header shows when the data was last synced; the controller supplies this.


## Parts

### list.number

a column value repeated in every row.

```json
{
 "name": "number",
 "header": "Invoice",
 "examples_in_designed_row_order": [
  "INV-1042",
  "INV-1044",
  "INV-1041",
  "INV-1043"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.vendor

a column value repeated in every row.

```json
{
 "name": "vendor",
 "header": "Vendor",
 "examples_in_designed_row_order": [
  "Kestrel Packaging",
  "Oriel Chemicals",
  "Northwind Freight",
  "Bluepeak IT"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.amount

a column value repeated in every row.

```json
{
 "name": "amount",
 "header": "Amount",
 "examples_in_designed_row_order": [
  "$48.2M",
  "$31.6M",
  "$18.4M",
  "$9.7M"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.dueDate

a column value repeated in every row.

```json
{
 "name": "dueDate",
 "header": "Due",
 "examples_in_designed_row_order": [
  "2 Aug 2026",
  "9 Aug 2026",
  "21 Aug 2026",
  "5 Sep 2026"
 ],
 "other_parts_in_the_same_cell": []
}
```

ANSWER: 
UNSURE: 
NOTE: 

### list.requestedBy

a column value repeated in every row.

```json
{
 "name": "requestedBy",
 "header": "Requested by",
 "examples_in_designed_row_order": [
  "Lena",
  "Mia",
  "Prerna",
  "Arjun"
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
  "Overdue",
  "Overdue",
  "Open",
  "Partial"
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
   "number": "INV-1042",
   "vendor": "Kestrel Packaging",
   "amount": "$48.2M",
   "dueDate": "2 Aug 2026",
   "requestedBy": "Lena",
   "status": "Overdue"
  },
  {
   "number": "INV-1044",
   "vendor": "Oriel Chemicals",
   "amount": "$31.6M",
   "dueDate": "9 Aug 2026",
   "requestedBy": "Mia",
   "status": "Overdue"
  },
  {
   "number": "INV-1041",
   "vendor": "Northwind Freight",
   "amount": "$18.4M",
   "dueDate": "21 Aug 2026",
   "requestedBy": "Prerna",
   "status": "Open"
  },
  {
   "number": "INV-1043",
   "vendor": "Bluepeak IT",
   "amount": "$9.7M",
   "dueDate": "5 Sep 2026",
   "requestedBy": "Arjun",
   "status": "Partial"
  }
 ]
}
```
API order (first rows):
```json
[{"id":1,"number":"INV-1041","vendor":"Northwind Freight","amount":18400000,"outstanding":18400000,"dueDate":"2026-08-21","requester":"Prerna","assignee":"Prerna"},{"id":2,"number":"INV-1042","vendor":"Kestrel Packaging","amount":48200000,"outstanding":48200000,"dueDate":"2026-08-02","requester":"Lena","assignee":"Lena"},{"id":3,"number":"INV-1043","vendor":"Bluepeak IT","amount":9700000,"outstanding":4000000,"dueDate":"2026-09-05","requester":"Arjun","assignee":"Arjun"},{"id":4,"number":"INV-1044","vendor":"Oriel Chemicals","amount":31600000,"outstanding":31600000,"dueDate":"2026-08-09","requester":"Mia","assignee":"Mia"}]
```

ANSWER: 
UNSURE: 
NOTE: 

### value.invoiceCount

a value outside the list.

```json
{
 "name": "invoiceCount",
 "example": "4",
 "surrounding_text": "4 invoices · $107.9M billed · largest $48.2M · synced 26 Sep 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.totalBilled

a value outside the list.

```json
{
 "name": "totalBilled",
 "example": "$107.9M",
 "surrounding_text": "4 invoices · $107.9M billed · largest $48.2M · synced 26 Sep 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.largestInvoice

a value outside the list.

```json
{
 "name": "largestInvoice",
 "example": "$48.2M",
 "surrounding_text": "4 invoices · $107.9M billed · largest $48.2M · synced 26 Sep 2026"
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
 "surrounding_text": "4 invoices · $107.9M billed · largest $48.2M · synced 26 Sep 2026"
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

### action.row.archive

a button or form.

```json
{
 "verb_marker": "archive",
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
