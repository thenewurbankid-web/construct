# orders — missing API, fixed in a later run

**Scenario.** The design is ahead of the API. Three different kinds of gap, all red in the tree:

| Gap | Where it shows | What would close it |
|---|---|---|
| The **Status** column has no field behind it | red `no transform → not in API` | add a `status` field to the rows of the GET response |
| **Delete** and **Save** need endpoints the API doesn't have (`DELETE`, `PUT`) | red `endpoint missing` | add `PUT /api/orders/:id` and `DELETE /api/orders/:id` to `openapi.json` |
| The form has a **Notes** input that no request body contains | red `no request field` | add `notes` to the POST request example |

**Questions asked:** 3 (Status, Delete, Save) · **Open items in Auto mode:** all of the above, each with the exact edit that closes it.

**The "later run" demo**
1. Press **Auto** (Watch on). Note the red paths and the "Open items" hints.
2. Copy the prepared fix over the contract ("Backend ships the fix"): `cp examples/orders/fixed.openapi.json examples/orders/openapi.json`. (A demo shell can do the same by uploading `fixed.openapi.json` through `POST /api/openapi?example=orders`.) **Reset** puts the original `openapi.json` back
3. Nothing else to do: the watcher re-runs automatically. Status, Delete, Save and Notes all close **in one recalculation**,
   because each is re-matched from scratch against the new data. Nothing to answer.

Answers you gave earlier for a part that now matches exactly are ignored (an exact match is never asked).
