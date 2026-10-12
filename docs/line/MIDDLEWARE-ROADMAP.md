# Line middleware: next sprint (owner, 2026-10-12)

When Line's static algorithms can't handle a case (no tool, no typed fix, no template, an unknown verb), a person, the person's coding agent or Line's own Qwen can write a small **middleware** util that handles it. Middleware runs inside Line's pipeline, under Line's rules. It can be kept per project, shared, and later merged into Line itself, possibly through a marketplace.

## Shape (contract first)
- **A middleware is a typed plugin** with these fields:
  - `{ id, version, hook, input schema, output schema, sentence, author: person|agent|qwen, licence }`.
  - `hook` is a closed set of extension points: `classify` (new verb or phrase → intent), `route` (new route template), `fix` (new typed fix for a refusal code), `descriptor` (new piece role), `extract` (new import fit rule), `check` (new finding).
- **Pure and deterministic.** Middleware runs in a sandbox: no network, no file system, no clock. It gets the slotted input and returns closed outputs. It can never write directly. A middleware's proposal still goes through Construct's checks, the plan, and a person's approval.
- **Tests are required.** A middleware ships with its own cases: the case that triggered it, plus negatives. A middleware without passing tests, or one that breaks any existing Line test, is refused.
- **Order in the ladder:** static → project middleware → Line-1 → Qwen → jev. Middleware is tried after the built-in static rules and before any model.

## Where it comes from
- **Misses become candidates.** im1's miss reports and cs2's rule factory already find the cases static code can't handle. Each one offers "write a middleware for this": the person writes it, the person's agent drafts it, or Line's Qwen drafts it. The draft gets the miss case as its test, and the person approves it.
- **Kept per project** under `line/middleware/`, versioned, through the writer.

## Sharing and a possible marketplace
- **Share:** the person can export a middleware (code, tests, licence, slotted cases only, no project words; the leak guard applies) to a shared index.
- **Promote into Line:** a shared middleware that passes the release gate (it improves the held-out eval and breaks nothing) can be merged into Line's static layer in a later version. That's the same path as cs2's accuracy gate.
- **Marketplace (later):** browse, install and rate middleware. Installing re-runs its tests against the project. Licences must be permissive, with the author credited.
- **Feeds Line-1:** accepted middleware cases also become verified training worlds for the Line model (synthetic and slotted, never user code).

## Sprint steps (after the board reaches 100%)
1. **Middleware contract and sandbox:** hook set, schemas, the deterministic runner, refusals in one sentence.
2. **Ladder integration:** a middleware tier in `decide()`, the drafter and the fix registry. Proposals still go through checks and approval.
3. **Authoring flow:** from a miss, "write a middleware". The person, their agent, or Qwen drafts it with the miss as its test, and the person approves it.
4. **Project store and versioning:** `line/middleware/`, through the writer, with enable/disable per middleware.
5. **Export/share with the leak guard, and promotion into Line through the release gate.**
6. **(Later) a marketplace design:** index, install, ratings, licences.
