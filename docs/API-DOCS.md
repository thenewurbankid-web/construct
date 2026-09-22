# API reference generation

Epic #463. Every package and module gets a Javadoc-style reference on the documentation site, generated from the
source of the same ref the site is built from (`/<X.Y>/` from the tag, `/next/` from `main`; see
[VERSIONING.md](VERSIONING.md)). Generated at build time, never committed, no LLM anywhere in the generator.

## Decision: TypeDoc + typedoc-plugin-markdown

| Package | Licence (`npm view <pkg> license`) | Role |
| --- | --- | --- |
| `typedoc` 0.28 | Apache-2.0 | Reads JSDoc in `.mjs` (via `allowJs`) and TSDoc in `.ts`/`.tsx`; one tool for the whole repo |
| `typedoc-plugin-markdown` 4.13 | MIT | Renders markdown, one file per module (`outputFileStrategy: modules`), which our own site renderer turns into pages |

Both are dev dependencies at the repo root. Spike on real sources (`src/*.mjs`, `src/engine`, `src/ast`,
`ui/server/src`, `ui/client/features`, `tools`, `site`): TypeDoc produces signature, `@param` with types and
descriptions, `@returns`, `@example`, `@since`, source links and one page per module for JS and TS alike. All eight
packages render (about 800 modules) in about 20 seconds.

Rejected:

- **jsdoc + jsdoc-to-markdown** (Apache-2.0 / MIT): ignores `.mjs` unless reconfigured (its default source filter
  returned "no input files" on `src/engine/pipeline.mjs`), and cannot read TypeScript or TSX at all, so it would need
  a second tool for `ui/client`.
- **documentation.js** (ISC): JS-first, weaker TypeScript story, less maintained; not pursued because TypeDoc
  already covers both languages (not run in the spike).
- **eslint-plugin-jsdoc**: licence is BSD-3-Clause, not in the MIT/Apache set we default to, so the coverage ratchet is
  a small in-repo script instead (`tools/api-coverage/`).

## Packages

Same grouping as the Trinity Modules tab (`API_PACKAGES` in `site/lib/apiDocs.mjs`): Core engine (`src/*.mjs`),
Engine (`src/engine/**`), AST (`src/ast`), Cockpit server (`ui/server/src`), Cockpit client shared
(`ui/client/components`, `ui/client/lib`) and features (`ui/client/features/**`), Tools (`tools/**`), Docs site
(`site/**`). Test, story and `.d.ts` files and files with no exports are skipped.

## Cockpit client: real prop tables (slice 3, #466)

`site/lib/apiDocs.mjs`'s `withPropsTable()` runs `describeSource` (`src/engine/describeDocgen.mjs`, the same
react-docgen adapter `ui/server/src/componentsApi.mjs` uses for the Cockpit's own Components screen) over every
`.tsx`/`.jsx` module with exactly one function export, and replaces TypeDoc's opaque `#### Parameters /
##### __namedParameters` breakdown with a real `#### Props` table (name, type, required, default, description).
Read-only, no project code evaluated, no LLM. Known scope cut: a file with more than one exported component (or
none) is left exactly as TypeDoc rendered it — one export per file is the common case for a component, and
disambiguating props across several exports in one file needs more than this block does today.

## Cockpit server REST reference (slice 3, #466)

`site/lib/serverRoutes.mjs`'s `collectServerRoutes()` reads the *real* Express route table — every direct
`app.<method>(...)` in `ui/server/src/index.mjs`, plus every `app.use('/mount', createXRouter(...))` sub-router it
imports, walked the same way inside that router's own file — groups routes by their first `/api/<group>` path
segment, and renders one page per group under `developers/api/cockpit-server/rest/<group>/` (method, path, a
light params surface: path `:params`, `req.query.x`/`req.body.x`, including one hop through a `const body =
req.body...` local alias, and the route's own leading comment). Regex-based, like the rest of this generator;
never imports or runs the server. Known scope cuts: request/response *body shape* comes only from what a handler
visibly destructures off `req.query`/`req.body` (no JSDoc `@param`/type inference over route handlers exists in
this codebase today, unlike the plain functions TypeDoc documents), and `cloneApi.mjs`-style "two router
factories in one file" is handled by bounding each factory to its own declaration-to-next-`export` window, which
assumes factories never interleave (true today, checked by `site/test/serverRoutes.test.mjs`).

## Run

```
npm ci
npm run docs:api                              # full site build into site/dist, API pages under developers/api/
node site/build.mjs --out /tmp/docs --no-search --api core,engine,ast   # only some packages (faster)
node site/build.mjs --out /tmp/docs --no-api                            # no API pages
node site/build.mjs --version 0.9 ...         # stamps pages "v0.9"; without --version the package.json version is used
```

`build()` in `site/build.mjs` takes `api: false | true | ['core', ...]` (default `false` for library callers, the
CLI defaults to all packages). Each run is stateless: TypeDoc output goes to a temp directory and is rendered into the
site, then deleted. `site/build-all.mjs` needs no change; each ref builds with its own `site/build.mjs`.

## Writing docs the generator can use

Plain JSDoc: a description, `@param {type} name description`, `@returns {type} description`, one `@example` on public
entry points, `@since 0.8`. A file's leading `//` or block comment becomes the module summary on the index pages
(first sentence). Coverage is enforced by the ratchet in `tools/api-coverage/` (baseline only decreases):

```
node tools/api-coverage/check.mjs            # fails if the gap count rises above tools/api-coverage/baseline.json
node tools/api-coverage/check.mjs --report   # lists every exported function/class missing a description, @param or @returns
node tools/api-coverage/check.mjs --update   # rewrites the baseline; refuses to raise it
```

## Known limits

- Package versions in `package.json` (root is still `1.0.0`) are what pages show when `--version` is not passed; release
  builds pass `--version X.Y`.
- A package with exactly one entry point renders as a single module instead of a module list (no current package).
- Ticket-ref scrubbing (`site/lib/markdown.mjs`'s `stripTicketRefs`) targets the phrasings authored prose docs
  use ("(see #96)", "Tracked under issue #104"); it does not catch every free-form ticket mention inside a raw
  source comment (a mid-paragraph "#77 follow-up to #53 — ..." after a line break, for example). `apiDocs.mjs`'s
  `headerSummary()` and this slice's own `serverRoutes.mjs`/`cliCommands.mjs` add their own stronger scrubbing
  for the text they generate; the pre-existing TypeDoc module pages from slices 1-2 (every package's per-export
  JSDoc prose) can still show one — filed as a follow-up, out of scope for #466/#467/#468.
