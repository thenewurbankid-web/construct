# orgs-items-reviews — a three-path-parameter endpoint (LIN-250/TR-49)

**Scenario.** Same as `orgs-items`: a plain items list/create/update/delete, every dynamic part of the
design matched. Plus one endpoint the design does not reference at all —
`GET /api/orgs/{orgId}/items/{itemId}/reviews/{reviewId}` — with THREE path parameters (`orgId`, `itemId`,
`reviewId`) instead of `orgs-items`'s two. Before LIN-250/TR-49 this stayed listed-only (`wired: false`,
`isWired` capped the generator at two params); now it generates its own Service function with all three ids
in the signature, the same way the two-param case already did.

**What the tool does**
- `itemCount` = the number of items; `qtyTotal` = the sum of `qty`.
- Each column is one API field; Edit, Delete and Save each have an endpoint, same as `orgs-items`.
- `GET /api/orgs/{orgId}/items/{itemId}/reviews/{reviewId}` fits no CRUD role (it is not the collection, and
  `/api/items/{id}` is already the single-param update/remove path), so it lands in `findEndpoints`'s `extra`
  and emits
  `export const getApiOrgsItemsReviews = (orgId, itemId, reviewId) => request("GET", \`/api/orgs/${orgId}/items/${itemId}/reviews/${reviewId}\`);`
  (the function name is derived deterministically from the path, same rule as `orgs-items`'s `getOrgsItems`).

**Questions asked:** 0 · **Open items:** 0

**Open items:** none — the three-param endpoint is wired and generated, not left as a gap.

**Try it:** press **Auto**. It finishes with every connection solid, and the generated `.service.js` has an
extra three-argument function for the `orgs/{orgId}/items/{itemId}/reviews/{reviewId}` endpoint that nothing
in the page uses — proof that the generator's `param`/`toUrl` (already a global regex over every `:param`,
`src/emit.mjs`) were never actually limited to two, only `isWired`'s cap was.
