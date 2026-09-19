# fixtures/impact-shared

A small, deliberately shaped project for testing impact analysis (#288).

- `features/shared` owns one presentation component, `CurrencyLabel`, exposed
  through its public `index.ts`.
- `billing`, `checkout` and `reporting` are full vertical slices that each
  consume that component through `features/shared/index.ts` — the sanctioned
  cross-feature path — so a naive "who imports this file" query sees a single
  edge while the real answer is three features. This is what
  `consumerFeatures()` in `src/engine/impact.mjs` exists to get right.
- Each slice is a clean layer chain (domain -> service -> workflow -> hook ->
  controller, and component -> page -> controller), so depth limits are easy to
  reason about from a seed at any layer.

`construct validate --dir fixtures/impact-shared` reports one intentional
SLICE-001 finding: `shared` is a partial slice (components only), which is what
a shared-UI slice looks like in practice, and it gives the impact report a real
pre-existing rule finding to surface.
