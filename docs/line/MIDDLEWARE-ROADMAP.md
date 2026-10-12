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

## Self-improving loop (owner, 2026-10-12): AI writes middleware on its own
When a new case comes in that the static tools can't handle, Line's AI creates a middleware for it automatically, uses it right away, and stores it in the user's local copy of Line.
1. **Detect:** the drafter, a fix, an import or a check returns "no static answer". This is the same miss signal as im1.
2. **Draft:** Line's Qwen (code fill, grammar-constrained) writes a middleware for the right hook. It gets only the slotted case, the hook's schema and the nearest existing static code as examples.
3. **Prove:**
   - The draft must pass its own test (the case that triggered it, plus negatives the AI generates).
   - It must not break any existing Line test or eval case. Run the affected subset fast, and the full set in the background.
   - It runs in the sandbox (pure, no network or file access).
   - If it fails, there is one repair attempt from the exact error (im2), then the case goes to the person.
4. **Use:** the middleware's proposal joins the ladder for this case. It is still checked by Construct and still approved by the person before any project write. Nothing it does skips the plan.
5. **Store locally:** `line/middleware/<hook>/<id>`, written through the writer and logged, tagged `author: qwen` and `status: auto`.
   - It stays "auto" until the person keeps it, with a one-click "Keep" or "Remove" on the What Line knows → Memory/Middleware view.
   - An auto middleware is disabled automatically when a later case refuses its output, or when the person edits away from it twice.
6. **Learn:** kept middleware feeds cs2's rule factory, sharing, and Line-1's training worlds (slotted only).

The guardrails don't change: the person approves project writes; middleware only proposes; and everything is local unless the person shares it.

## "Line internals" page (owner, 2026-10-12): see and extend every static block
One static Cockpit page that shows all of Line's static blocks and internal framework to the person, and lets them extend any of it in JS through middleware.
- **Catalog:** every static block, grouped by middleware hook:
  - classifiers and pattern matchers (drafter verbs, lexicon, intent catalog);
  - route templates;
  - typed fixes per rule;
  - piece descriptors and roles;
  - Import fit rules;
  - checks and rules.

  Each block shows what it does in one sentence, its input and output schema, examples, and how often it decided recently (from the miss reports and the cs2 collector).
- **Extend:** on any block, choose "Write your own" to open an editor with:
  - the hook's typed input/output;
  - a starter function;
  - the block's own cases as tests.

  The person writes a pattern matcher or a better algorithm in plain JS (`run(input)`). Run tests in the sandbox, see the results next to the static block's results on the same cases, then Save. A person-authored middleware is stored as `kept`.
- **Compare and replace:** if the person's function beats the static block on the held-out cases, offer to put it ahead of the static one for this project. Never silently.
- Same guardrails: sandbox, slots only, tests required, proposals still checked by Construct and approved by the person. The page itself is read-only for agents.
- Build it after `mw-ladder` merges. It uses `middleware/contract.mjs`, `sandbox.mjs`, `store.mjs` and the Settings middleware panel.
