The repository is a single Node package (`construct-architecture`, ESM, Node 20+) with separately installed sub-projects for the UI.

```text
bin/construct.mjs        CLI entry: dispatches to src/cli.mjs
src/                     the tool
  cli.mjs                command implementations (create, refactor, research, import, validate, sync, pipeline, ...)
  config.mjs             architecture.yml loading, DEFAULT_RULES, framework/data-layer normalisation
  registry.mjs           merges enforcer results into one pass/fail
  architecture-*.mjs     layer graph + architecture enforcer
  soc-enforcer.mjs       separation-of-concerns rules
  readability-enforcer.mjs
  frozen*.mjs            frozen (externally authored) presentation support
  generators.mjs         per-layer templates and generation
  import.mjs, route-resolver.mjs, llm-fill.mjs   the import flow and LLM-filled files
  llm.mjs                the LLM provider registry (the only place a model is called)
  engine/                envelope, pipeline, transactional writer, workflow tools
schemas/envelope.v1.json  the Context Envelope schema
fixtures/                real sample projects used by tests and docs
test/                    node:test suites for src/
ui/client                the Cockpit front end (Next.js)
ui/server                the Cockpit backend (Node, wraps src/ in-process)
ui/e2e                   Playwright end-to-end tests
packages/tools/          small standalone helper tools
packages/ast/            the AST package (parse, walk, extract, generate)
packages/docs-site/lib/  this documentation site's generator (site/content, site/build.mjs stay under site/)
site/                    this documentation site's content and build driver
docs/                    long-form docs reused on this site
```

Moved into `packages/*` so far (#480): `tools/` -> `packages/tools/`, `site/lib/` -> `packages/docs-site/lib/`,
`src/ast/` -> `packages/ast/`. `src/engine/`, the rest of `src/*.mjs` and `bin/` move in the same epic's
remaining steps.

## Dependencies you install

`npm install` at the repository root is enough for the CLI and `npm test`. The UI needs its own installs in `ui/client` and `ui/server` (and `ui/e2e` to run browser tests). There is no workspace tooling: each directory has its own `package.json`.

## How the pieces relate

```text
bin/construct.mjs -> src/cli.mjs -> generators / enforcers / import / refactor / research
                                        |
                                        +-> packages/ast     (all source parsing and generation)
                                        +-> src/engine       (pipeline, envelope, transactional writes, workflows)
                                        +-> src/llm.mjs      (optional model calls, isolated)

ui/server -> imports src/ directly (no shell-out to the CLI) -> HTTP + WebSocket -> ui/client
```

The UI backend calls the same functions the CLI calls, in-process, and adds no model calls of its own.
