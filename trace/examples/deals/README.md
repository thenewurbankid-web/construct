# deals — a complex screen: many transformations at once

**Scenario.** A sales-pipeline screen that uses almost the whole transform library on one page, and
then adds the kinds of gaps real screens have. Every design value below is produced by the tool from the
mock API, except the ones listed under "open".

## The transformations (all matched automatically)

| Design part | Shows | How the tool produces it |
|---|---|---|
| `dealCount` | `6` | count of the list |
| `pipeline` | `$453.1M` | **sum** of `value`, compact money |
| `avgDeal` | `$75.5M` | **average** of `value`, compact money |
| `largest` | `$152.5M` | **max** of `value`, compact money |
| `smallest` | `$9.8M` | **min** of `value`, compact money |
| `avgMargin` | `28.8%` | **average** of `margin`, percent |
| column *Value* | `$152.5M` | `value` as compact money |
| column *Margin* | `28.1%` | `margin` as percent |
| column *Close* | `2 Oct 2026` | `closeOn` as a short date |
| columns *Deal*, *Account* | text | `name`, `account` as text |
| row order | largest first | sort by `value`, descending (the close-date order differs, so it is unambiguous) |
| form inputs | | text → string, number → number, converted by the domain layer |

## What stays open (10 items in Auto mode; each has a hint)

| Item | Kind | What would close it |
|---|---|---|
| *Contact* `Lena Kumar` | no field has it | answer "combine fields" (`contactFirst` + `contactLast`), or add a `contact` field. With `--ai` and the story, a model may draft the expression, which is only kept if it reproduces all six rows. |
| *Owner* and *CSM* | **tie**: `owner` and `csm` are identical in every row | answer each, or make one differ in one row. The second question carries a note about the first answer. |
| *Stage* | missing field | add `stage` to the GET rows, or leave a TODO |
| *Weighted pipeline* `$137.6M` | not an aggregate the tool has (sum of value × margin) | placeholder (controller, a new endpoint, or a field-based one), or add a `weighted` field |
| *Synced* | not in the list data | controller placeholder |
| *Forecast* button | unknown verb | your own handler |
| *Delete* button | needs `DELETE`, which the API lacks | add `DELETE /api/deals/{id}` to `openapi.json` |
| form input *Notes* | no request body has it | add `notes` to the POST/PUT example |
| API field *owner* | the API expects it, the form has no input | add an `owner` input to the design |

**Try it.** Press **Auto**, read the tree (green paths are the transformations) and the open items. Then
answer the questions with placeholders, or add a `delete` operation and a `stage` field to `openapi.json` with Watch on
and watch four items close in one re-run.
