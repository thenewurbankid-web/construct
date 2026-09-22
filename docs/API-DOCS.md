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
  a small in-repo script instead (`packages/tools/api-coverage/`).

## Packages

Same grouping as the Trinity Modules tab (`API_PACKAGES` in `packages/docs-site/lib/apiDocs.mjs`): Core engine (`src/*.mjs`),
Engine (`src/engine/**`), AST (`src/ast`), Cockpit server (`ui/server/src`), Cockpit client shared
(`ui/client/components`, `ui/client/lib`) and features (`ui/client/features/**`), Tools (`packages/tools/**`), Docs site
(`site/**`). Test, story and `.d.ts` files and files with no exports are skipped.

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
(first sentence). Coverage is enforced by the ratchet in `packages/tools/api-coverage/` (baseline only decreases):

```
node packages/tools/api-coverage/check.mjs            # fails if the gap count rises above packages/tools/api-coverage/baseline.json
node packages/tools/api-coverage/check.mjs --report   # lists every exported function/class missing a description, @param or @returns
node packages/tools/api-coverage/check.mjs --update   # rewrites the baseline; refuses to raise it
```

## Known limits

- Package versions in `package.json` (root is still `1.0.0`) are what pages show when `--version` is not passed; release
  builds pass `--version X.Y`.
- Cockpit client symbols typed only by props (`__namedParameters`) show the props type name; prop tables come from
  react-docgen in slice 3 (#466).
- A package with exactly one entry point renders as a single module instead of a module list (no current package).
