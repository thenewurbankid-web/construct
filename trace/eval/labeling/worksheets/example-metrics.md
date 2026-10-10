# Labelling worksheet: example-metrics

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

Endpoints: GET /api/metrics
List: GET /api/metrics (4 items)

| field | type | samples |
|---|---|---|
| id | number | 1, 2, 3, 4 |
| region | string | "North", "South", "East", "West" |
| revenue | number | 120000000, 95000000, 61000000, 88000000 |
| cost | number | 70000000, 52000000, 33000000, 49000000 |
| conversion | number | 0.18, 0.24, 0.12, 0.2 |

## Parts

### value.regionCount

a value outside the list.

```json
{
 "name": "regionCount",
 "example": "4",
 "surrounding_text": "4 $364.0M $120.0M $33.0M 18.5% 26 Sep 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.totalRevenue

a value outside the list.

```json
{
 "name": "totalRevenue",
 "example": "$364.0M",
 "surrounding_text": "4 $364.0M $120.0M $33.0M 18.5% 26 Sep 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.bestRevenue

a value outside the list.

```json
{
 "name": "bestRevenue",
 "example": "$120.0M",
 "surrounding_text": "4 $364.0M $120.0M $33.0M 18.5% 26 Sep 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.lowestCost

a value outside the list.

```json
{
 "name": "lowestCost",
 "example": "$33.0M",
 "surrounding_text": "4 $364.0M $120.0M $33.0M 18.5% 26 Sep 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.avgConversion

a value outside the list.

```json
{
 "name": "avgConversion",
 "example": "18.5%",
 "surrounding_text": "4 $364.0M $120.0M $33.0M 18.5% 26 Sep 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 

### value.asOf

a value outside the list.

```json
{
 "name": "asOf",
 "example": "26 Sep 2026",
 "surrounding_text": "4 $364.0M $120.0M $33.0M 18.5% 26 Sep 2026"
}
```

ANSWER: 
UNSURE: 
NOTE: 
