# What the import block reuses from Construct

## Trace as a package-to-be of Construct (T17.1)

Trace (this repo, `line-matcher`) is not a package of Construct today — Construct is a private, unpublished
monorepo (#480 pending) — but it is meant to become one. Until then, the two talk through exactly one seam, at
run time, never at import/build time:

```
  Trace (line-matcher)                                  Construct (private monorepo, unpublished)
 ┌───────────────────────────────────────┐              ┌──────────────────────────────────────────┐
 │                                        │  CONSTRUCT_ROOT (env, unset by default)                 │
 │  src/construct.mjs                     │  = /Users/shashank/Repositories/                        │
 │  ── the ONE seam ──                     │    construct-worktrees/cockpit-main  (read-only)        │
 │  importConstructAst(root):              │──────────────────────────▶│  packages/ast/index.mjs    │
 │    dynamic import, cached, once          │   dynamic import()        │   parseJsx                │
 │    root unset / bad path / import        │   (never a static import, │   walkAst                 │
 │    throws / an export missing            │    never a build-time     │   jsxNameToString          │
 │      => returns null                     │    dependency)             │   spliceNode               │
 │                                        │                              │   renderAttrValue          │
 │  loadConstructAst(): the cached result, │                              └──────────────────────────────┘
 │  or null                                │
 └───────────────┬────────────────────────┘
                  │ null  ──────────────────────────────▶  falls back to Trace's OWN code
                  │                                          src/import/fallback-ast.mjs
                  │                                          same 5 functions, on @babel/parser
                  │                                          (jsx + typescript plugins) — already
                  │                                          a Trace dependency, no new one added
                  ▼
        src/import/construct-ast.mjs
        picks Construct's functions when present, else the fallback (ENGINE = "construct" | "babel")
        Both modes give identical output: import.test.mjs asserts it for the 11 examples + 3 real pages
                  │
                  ▼
        src/import/{parse,extract-parts,suggest-markers,apply-markers}.mjs  (src/extract.mjs delegates here)
```

**Reused today** (the only Construct block Trace actually calls): `packages/ast` — `parseJsx`, `walkAst`,
`jsxNameToString`, `spliceNode`, `renderAttrValue` — through the seam above. Because the fallback gives the same
result, Construct is a swap-in today, not a requirement; the payoff is that the same call keeps working once
Trace becomes a package of Construct and can import the parser directly instead of through `CONSTRUCT_ROOT`.

**Reused today, besides `packages/ast`** (T16.9/T16.10 audit, 2026-09-27): `core/text-diff.mjs` `buildDiffView`
(via `loadConstructTextDiff`, see the T27 section below — already wired before this audit) and
`engine/transactionalWriter` `createTransaction` (via the new `loadConstructTransactionalWriter` in
`src/construct.mjs`, wrapped by `src/write-transaction.mjs`'s `createWriteTransaction`, called from
`pipeline.mjs`'s file-writing step). The latter buffers one run's generated feature files and commits them
together, so a failure partway through generation (a bad template, a `prettier` error) can never leave a
half-written feature on disk — but `commit()` is always called with an overriding `validate` that accepts
unconditionally, never Construct's default `validateArchitecture`: see the "not forced" entry for
`core/validate.mjs` just below for why. `src/write-transaction.test.mjs` runs the same fixture against both the
fallback and the real Construct module, the same pattern as `import.test.mjs`/`drift.test.mjs`.

**Named to reuse, still not wired up** (per this project's `CLAUDE.md` reuse map; audited 2026-09-27, no
current caller in `src/`): `engine/workflowNarrator` + `workflowScenarios` + `workflowExtractor` (would let a
report explain the generated XState workflow in plain English; feasible — `plan.mjs` already carries everything
`workflowNarrator`'s input shape needs — but building the `{states, transitions, ...}` descriptor from `plan` by
hand, with no caller asking for the narration yet, was left for when a concrete report/UI need for it exists,
rather than adding an unused code path).

**Deliberately not forced** (audited 2026-09-27, in addition to the ones already documented in `CLAUDE.md`):
- `core/validate.mjs` `aggregateValidation` + `DEFAULT_ENFORCERS` (T16.4): confirmed by reading
  `packages/core/config.mjs`'s `DEFAULT_LAYERS` — Construct's architecture enforcer expects **plural** layer
  folders (`controllers/`, `services/`, `workflows/`, `pages/`, `components/`) and a `route` pattern shaped for
  Next.js (`app/**/page.tsx`); Trace's generated features use **singular** folders (`controller/`, `service/`,
  ...) and an Express-style `route/` file. Running `DEFAULT_ENFORCERS` as-is against any of the 11 examples
  would flag every generated file as "not a recognized architecture layer" — not a real problem to fix, an
  artifact of the folder-name mismatch — so nothing calls it. Renaming Trace's generated layer folders to match
  would change every example's generated output, which is out of scope here (and its own, separate decision).
  This is also why this atom's premise (a `--construct-layout` flag from "T19") does not match what is in this
  tree: no such flag, and no `architecture.yml`, exists anywhere in `line-matcher/` today — reported rather than
  guessed at.
- `core/diagnostics.mjs` `makeViolation` (T16.10): its `assertValidViolation` hard-requires `module` to be one
  of exactly `'architecture' | 'separation-of-concerns' | 'readability'` (`VALID_MODULES`) — Construct's own
  concern categories, not Trace's (an AI-drafted-content check, a match gap, ...). Forcing one of those three
  labels onto a Trace concern would be its own small guess, so Trace's existing gap/violation shapes
  (`contract.mjs`'s gaps, `ask.mjs`'s questions) are kept instead.
- `engine/jsxSourceAnnotator` (T16.10): adds `data-cx-src="file:line:col"` for a live dev-server's
  click-to-source mapping back to an editor. Trace's page preview (`src/page-preview.mjs`) already solves the
  adjacent problem it actually has — colouring a *static* rendered page by match state — with its own
  match-tree `data-id`s; there is no live, editable dev-server view in Trace for a source-position attribute to
  serve.
- `core/dir-browser.mjs` `listDirectories` (T16.10): an allowlisted, paginated directory browser for letting a
  person pick a project folder from arbitrary paths. Trace has no feature that browses a user-supplied
  filesystem path today — every directory listing in `src/` (`server.mjs`'s example list, `build-info.mjs`,
  `reset-cli.mjs`, ...) reads a single fixed, trusted path (the repo's own `examples/` folder), so there is
  nothing for the allowlist/pagination machinery to protect yet. Reusing it now would add an unused capability
  rather than close a gap.

**Deliberately not forced** (documented reasons in `CLAUDE.md`): `core/llm` `callLlm` (no system prompt/schema/
stream/Anthropic/OpenAI support — Trace's own `src/ai/provider.mjs` covers this), `engine/pipeline` + its
`envelope`/`renderLayer` (no bindings, `.tsx` stubs only — an unrelated concept from Trace's own "envelope"
list-wrapper idea, see `docs/CONSTRUCT-REUSE.md`'s note below), `service-generator`/`unitSummary` (need an
`operationId`; they summarise a Construct *project*, not a Trace *run*).

> **T16.3 — the promised note on Trace's own "envelope":** Trace's "envelope" (an API list response that wraps
> the array under a key, e.g. `{ categories: [...], meta: {...} }`, per `feature.json`'s `list`/`listKey`) has
> nothing to do with Construct's `engine/pipeline` `envelope` above — see `docs/CONCEPT.md` (item 2 and the
> vocabulary table: "The word 'envelope' is not used [in the demo UI]: it already means the API response wrapper
> in this tool") and `src/ui/vocab.mjs`'s `BANNED` list. The "unwrap" (response → items + envelope scalars)
> direction already had one entry point before this audit — `envelopeOf`/`listItems`/`envScalars` in
> `src/match.mjs`, reused by `src/inspector/options.mjs` and `src/ai/index.mjs` — except `src/emit.mjs` kept its
> own second, inline copy of the same destructuring to build the domain test's `data` fixture. That copy is now
> gone; `emit.mjs` calls `envelopeOf` too, so there is exactly one place this is unwrapped. The "wrap" (items +
> envelope → response) direction was checked and has no runtime call site to route through a shared function:
> both places that rebuild the full response (`emit.mjs`'s mock-API route handler and initial `db` seed) do it
> as literal generated-code text, executed later inside the *generated* mock server on that file's own mutable
> state — not as a value Trace computes at generation time — so a "wrap" helper here would have no caller. Adding
> one anyway was not done, to avoid dead code.

> **A discrepancy worth flagging, not silently resolved:** this project's `CLAUDE.md` names Construct's
> `ast/index.mjs` exports as `parseJsxTree, jsxEdit`. The adapter actually implemented and tested here
> (`src/construct.mjs`, `AST_EXPORTS`) imports `parseJsx, walkAst, jsxNameToString, spliceNode, renderAttrValue` —
> five different names. The diagram above and the "Reused, and how it is imported" section below follow the
> verified, tested code; if `CLAUDE.md`'s names refer to a newer or different Construct revision, that should be
> reconciled by whoever maintains both, not guessed here.

## Reused, and how it is imported

`packages/ast` (Construct's AST package, on `origin/main`), loaded **at run time, only when `CONSTRUCT_ROOT` is set**:

- `src/construct.mjs` is the ONE seam: it dynamically imports `$CONSTRUCT_ROOT/packages/ast/index.mjs` (cached, once, at start-up) and returns `{parseJsx, walkAst, jsxNameToString, spliceNode, renderAttrValue}`, or `null` when the variable is unset, the path is wrong, the import throws, or an export is missing. Nothing in Trace imports Construct statically, and nothing under `packages/` is required at runtime. A read-only checkout is `/Users/shashank/Repositories/construct-worktrees/cockpit-main`.
- `src/import/construct-ast.mjs` picks Construct's functions when present, else `src/import/fallback-ast.mjs`: the same five functions on `@babel/parser` (`jsx` + `typescript` plugins, already a dependency) with a small generic walker and attribute writer. `ENGINE` says which one runs (`"construct"` or `"babel"`). No dependency was added.
- Both modes give the same results: `import.test.mjs` runs the same probe in child processes (CONSTRUCT_ROOT unset, bad, and the cockpit-main checkout) and asserts identical extraction, suggestions and applied output for the 11 examples and the 3 real pages (that test is skipped, with a message, when no checkout exists), and the golden hashes hold in both.
- What Construct's package gives when it is on: `parseJsx` (typescript-estree, JSX + TypeScript), `walkAst` (estree-walker), `jsxNameToString`, and `spliceNode` / `renderAttrValue` for the writes. Every change is an exact-offset text splice, so formatting outside the touched tags is byte-identical and no prettier pass is needed (true in both modes).
- Because the two modes are equal, Construct is a swap-in today, not a requirement; the value is that the same block keeps working when Trace becomes a package of Construct and calls its parser directly.

Spike evidence (scratch script, not kept): (a) parse ok on the 3 pages (Construct mode, 7 to 20 ms; the Babel fallback parses them too) (427/438/381 elements, 73/75/88 member-tag openings, 1/2/6 fragments); (b) member tags, fragments, `JSXText` with entities decoded (`&amp;` becomes `&`, `&#8722;` becomes the minus sign, same as Babel), `{"x"}` and template-literal children all reachable from the raw estree; (c) `setAttributeText` splices without touching other bytes, but see gap 1.

`extract()` in `src/extract.mjs` now delegates to `extractParts`. The 11 examples' extraction JSON is pinned by sha256 (`src/import/import.test.mjs`), and a full `--all --auto` run of the examples in a scratch copy produced byte-identical generated code before and after.

## What did not fit, and why (Babel is still used here)

- `src/rewrite-page.mjs`, `src/page-preview.mjs`, `src/ai/context.mjs` still edit and draw JSX with Babel nodes (`@babel/traverse`, `@babel/generator`). They were not asked to change and rewriting them would risk the byte-identical generated code. Their `parsePage` now retries with the `typescript` plugin when the JSX-only parse fails, so a TSX page does not crash them. The generated Page file for a TSX page keeps its type annotations, so `pipeline.mjs` formats it with prettier `babel-ts` when the page file is `.ts/.tsx`.
- `src/import/` uses Babel only in the fallback (`fallback-ast.mjs`).

## T27 (contract drift): `packages/core/text-diff.mjs`, and why it's a partial fit

`buildDiffView` (row 21 of Construct's `docs/capabilities.md`, "External-change tracking + text diff") is a
**line-text** differ: given two strings, it runs jsdiff's `diffLines` and shapes the hunks into a renderer-agnostic
view model. T27's core need is a **structural** diff of two parsed OpenAPI documents — added/removed endpoints,
a renamed path parameter, a changed response shape — which is comparison of parsed JSON trees keyed by
method+path, not a text diff of the two files. Diffing the raw contract *text* would report the drift as
arbitrary line churn (whitespace, key order, unrelated reordering) rather than "DELETE /api/widgets/{id} was
removed", so it does not fit as the primary primitive, and `line-matcher/src/drift.mjs` does its own structural
comparison instead (reusing `openapi.mjs`'s existing, already-tested `parseDocument`/`toApis` for the parsing
half, so no second contract parser is written).

Where it *does* fit, and is reused: for a `response-changed`/`request-changed` entry, `drift.mjs` also builds a
line diff of the two example bodies (pretty-printed JSON, before vs after) via `buildDiffView`, loaded through
`src/construct.mjs`'s `loadConstructTextDiff()` (the same seam and the same null-when-`CONSTRUCT_ROOT`-unset
pattern as `loadConstructAst()`). This is exactly the "renderer-agnostic before/after text diff" the module was
built for, used as an optional, additive `textDiff` field for display; when Construct is unavailable the
structural report is unchanged and that field is simply absent, so nothing is re-implemented client-side to make
up for it (see `line-matcher/src/drift.test.mjs`, which exercises this against the real checkout when present).

## Gaps to report to the Construct owners

1. `setAttributeText` (jsxEdit.mjs) inserts the attribute right before `>` / `/>`. In a multi-line tag that gives `\n    data-x="y">` (no indent, on the closing-bracket line) and for `<img src="a" />` it drops the space before `/>`. Trace writes its own layout-aware insertion (own line, same indent as the last attribute) using `spliceNode`/`renderAttrValue` (in both modes). A variant that follows the tag's layout would remove that code.
2. No batch/multi-edit primitive: every `*Text` function returns one element's new text, so applying N edits needs manual right-to-left offset handling. A `applyEdits(source, edits)` on `{start, end, text}` would help every caller.
3. `parseJsxTree` records carry elements only (no text or `{"literal"}` children, no expression containers), so text-aware callers must use `parseJsx` + `walkAst` and rebuild children themselves.
4. No offset to `{line, column}` helper: `lineOf(source, index)` returns a line only and re-splits the prefix on every call. Trace keeps a line-start table.
5. `packages/ast` is not in the main checkout of this repo nor on the `studio-export` branch (only on `origin/main`), and its dependencies (`@typescript-eslint/typescript-estree`, `estree-walker`, `typescript`) resolve only from the checkout's own `node_modules`, which is why Trace loads it from `CONSTRUCT_ROOT` with a fallback until Construct is published (#480).
6. Text entity decoding follows TypeScript's table; only `&amp;`, `&nbsp;` and numeric entities were checked against Babel (the 11-example golden passes).
