# Adapter persistence: runtime-only vs. saved into the contract

Status: **decided 2026-09-30 — Option A, runtime-only.** Shashank confirmed via
interaction `8d6d6fe3` (LIN-128). Re-filed interaction `2a6e0207`, which had
expired unanswered. LIN-90 §5 (adapter creation) builds against Option A;
`docs/NEXT.md` R6.24 is unblocked.

## The question

`docs/design/run-api-panel-and-wires.md` §5 defines the adapter flow: when a
run's wire has no compatible API endpoint, the user maps fields through a
transform and clicks "Save adapter & attach". That save has to go somewhere.
Two places are on the table, and they are not a spectrum — picking one forecloses
the other unless we build both, so this needs a decision before `contract-panel.mjs`
grows a mapping concept it doesn't have today.

## Option A — runtime-only (adapter lives with the run)

The mapping is stored alongside the run's own state (wherever wire attachments
already live, e.g. the run's saved-flow JSON per `docs/PROJECT_BOARD.md`'s
"Named, reusable flow save/load in core" work), never touching the contract
file on disk. `loadContract`/`saveContract` (`src/contract.mjs:32,143`) stay
exactly as they are — a contract stays a straight parse of the OpenAPI/Swagger
document, nothing Trace-specific gets written into it.

**Tradeoffs**
- Keeps the contract-drift guarantee airtight: `diffContracts` (`src/drift.mjs`)
  compares two OpenAPI documents; an adapter baked into the contract file would
  be invisible to a real diff tool and could get silently overwritten the next
  time someone re-imports the spec from the backend.
- Cheapest to build: it reuses the run/flow persistence that already exists
  instead of inventing a new contract extension format.
- Costs: the adapter doesn't travel with the contract. A second run against
  the same API, or a teammate opening the same contract in a fresh run, hits
  the same mismatch and has to re-create the mapping. There's no single place
  to audit "which endpoints have adapters" across runs — you'd have to open
  every run that uses this API.

## Option B — saved into the contract (adapter travels with the API)

The mapping is written back into (or alongside) the contract file itself —
either a Trace-specific extension block in the OpenAPI document (e.g. an
`x-trace-adapter` vendor extension on the operation, which the spec explicitly
allows) or a sibling file next to it that `loadContract` learns to also read.
Every run that wires up that endpoint sees the adapter already applied.

**Tradeoffs**
- One mapping serves every run and every teammate — no repeated setup, and the
  contract becomes the single source of truth for "this endpoint needs a
  transform," which is closer to how the disagreement rule already treats
  drift (`docs/CAPABILITY-ROW.md` row 30: decide once, store the decision).
  This project's charter (`AGENTS.md`) frames the adapter itself as the fix for
  a contract/backend disagreement, which reads as a property of the contract,
  not of one run.
  - Costs: touches shared, versioned state. `saveContract` today writes back
  exactly what was read (`describeContract`/round-trip); adding a second
  writer that injects adapter mappings means two code paths can now modify the
  same file, and a re-import from the live backend (drift's normal flow) has
  to know to preserve or re-validate the adapter instead of clobbering it.
  Also raises the multi-run conflict question directly (two runs editing the
  same contract's adapter differently) that the byte-identical-import
  guarantee doesn't currently have to think about, and it's shared with
  whichever run or user picked the mapping — an adapter is a per-relationship
  decision (this run's wire, this backend's actual shape) more than a
  property of the abstract contract, so "saved into the contract" also means
  deciding whose adapter wins when two runs disagree.

## Recommendation

Option A, runtime-only, to start. It is the smaller build (reuses existing
run/flow persistence, zero changes to `contract.mjs`'s read/write contract),
keeps the contract-drift guarantee simple (a contract file is still exactly
what the backend or spec says, nothing layered in), and avoids the shared-state
conflict question in Option B until there's a concrete case that needs sharing.
If reuse across runs turns out to matter in practice, Option B can be added
later as a promotion step ("save this run's adapter back into the contract")
without having to walk back Option A — the reverse isn't true.

## Design constraint on the Option A implementation (added 2026-09-30, owner directive)

Shashank's acceptance came with one condition: Option A must not foreclose
promoting to Option B later. Concretely, LIN-90 §5's adapter storage should:

- Give each adapter a shape that is a direct candidate for an `x-trace-adapter`
  vendor extension (same field-mapping structure, keyed by the same operation
  identifier `contract.mjs` already uses for the endpoint), not an ad hoc,
  run-specific format that would need translating before it could travel.
- Keep the adapter read/write behind one small accessor (e.g. `getAdapterFor(runState, operationId)` /
  `saveAdapterFor(runState, operationId, mapping)`) rather than inlining the
  run-state lookup at every call site, so a later promotion step only has to
  change that accessor's storage target, not every caller.
- Avoid any run-state-only field (like a wire id that only makes sense inside
  one saved flow) inside the mapping itself — the mapping's keys must resolve
  the same way whether it lives in run state or in the contract.
