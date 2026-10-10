# orgs-items — a two-path-parameter endpoint (LIN-223)

**Scenario.** Same as `products`: a plain items list/create/update/delete, every dynamic part of the
design matched. Plus one endpoint the design does not reference at all — `GET /api/orgs/{orgId}/items/{id}` —
with TWO path parameters (`orgId`, `id`). Before LIN-223 this stayed listed-only (`wired: false`); now it
generates its own Service function with both ids in the signature.

**What the tool does**
- `itemCount` = the number of items; `qtyTotal` = the sum of `qty`.
- Each column is one API field; Edit, Delete and Save each have an endpoint, same as `products`.
- `GET /api/orgs/{orgId}/items/{id}` fits no CRUD role (it is not the collection, and `/api/items/{id}` is
  already the single-param update/remove path), so it lands in `findEndpoints`'s `extra` and emits
  `export const getOrgsItems = (orgId, id) => request("GET", \`/api/orgs/${orgId}/items/${id}\`);`.

**Questions asked:** 0 · **Open items:** 0

**Try it:** press **Auto**. It finishes with every connection solid, and the generated `.service.js` has an
extra two-argument function for the `orgs/{orgId}/items/{id}` endpoint that nothing in the page uses.
