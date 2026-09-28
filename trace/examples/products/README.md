# products — everything matches

**Scenario.** The happy path. Every dynamic part of the design can be produced from the mock API, in exactly one way,
and every button has an endpoint behind it.

**What the tool does**
- `productCount` = the number of items; `stockTotal` = the sum of `stock`; `avgPrice` = the average of `price`, shown in full dollars.
- Each column is one API field with one formatter (`price` as money, `addedOn` as a short date).
- The designed row order is the API order, so no sort is needed.
- The form's three inputs are all in the example request bodies; Edit, Delete and Save each have an endpoint.

**Questions asked:** 0 · **Open items:** 0

**Try it:** press **Auto**. It finishes with every connection solid and nothing in the "Open items" panel.
Then edit a price in `openapi.json` and watch it re-run (Watch is on by default).
