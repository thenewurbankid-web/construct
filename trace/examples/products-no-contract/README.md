# products-no-contract: a page with no API contract yet

**Scenario.** The design exists, the backend has not handed over an API description. This folder has `page.jsx` and
`feature.json` and **no `openapi.json` / `openapi.yaml`**, so the tool has no contract.

**What happens.** A run is allowed, in every mode, and it is honest about it:

- one notice at the top of the run, `REPORT.md`, `REPORT.html` and the run summary: *No API contract for this feature: upload a Swagger/OpenAPI file*
- one item for the Backend team to provide the contract; every part that needs the API says it is waiting for the contract, instead of a per-field message
- the generated code is only stubs (a service call that fails on purpose, an empty mock, TODO values); the tree shows everything as missing
- no questions are asked until there is a contract

**Try it**
1. Press **Auto** (or `node src/cli.mjs examples/products-no-contract --auto --out /tmp/out`). Read the notice and the open items.
2. In the UI open the *API contract* section and upload a Swagger/OpenAPI file (or drop it on the box), for example
   `cp examples/products/openapi.json examples/products-no-contract/openapi.json` in a terminal.
3. Run again (Watch on: it re-runs by itself). The same page now closes exactly as `products` does.

**Reset** removes an uploaded contract again, so this example starts with none.
