The repository is an npm workspaces monorepo (ESM, Node 20+) with separately installed sub-projects for the UI.

```text
packages/cli/construct.mjs   CLI entry (bin): dispatches to packages/core/cli.mjs
packages/core/               command implementations, config, generators, validators (the deterministic CLI blocks)
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
  plan.mjs, validate.mjs, summarize.mjs, impact.mjs   the package's public exports map surface
packages/ast/             the AST package (parse, walk, extract, generate)
packages/engine/          envelope, pipeline, transactional writer, workflow tools
packages/tools/            small standalone helper tools (dev scripts, project board, API coverage)
packages/docs-site/lib/   this documentation site's generator (site/content, site/build.mjs stay under site/)
schemas/envelope.v1.json  the Context Envelope schema
fixtures/                real sample projects used by tests and docs
test/                    node:test suites for packages/core, packages/ast, packages/engine
ui/client                the Cockpit front end (Next.js)
ui/server                the Cockpit backend (Node, wraps the core packages in-process)
ui/e2e                   Playwright end-to-end tests
site/                    this documentation site's content and build driver
docs/                    long-form docs reused on this site
```

Physical package split (#480): `tools/` -> `packages/tools/`, `site/lib/` -> `packages/docs-site/lib/`,
`src/ast/` -> `packages/ast/`, `src/engine/` -> `packages/engine/`, the rest of `src/*.mjs` -> `packages/core/`,
`bin/construct.mjs` -> `packages/cli/construct.mjs`. `ui/server` and `ui/client` (the Cockpit) were not moved --
Docker will package them in place, no directory change. `packages/core` and `packages/cli` are meant to ship on
a private npm registry as `@line/construct-core` and `@line/construct` (MIT, open source; not yet actually
published -- `npm pack --dry-run` only so far). `packages/ast` and `packages/engine` are workspace-internal
(`"private": true`) and are not independently published; `packages/core` reaches them by a plain relative import
(`../ast/...`, `../engine/...`), which only resolves inside this checkout or a full workspace install -- a real
standalone `npm install @line/construct-core` will not carry those two sibling packages along, so `impact` and
part of `validate`/`summarize` will not resolve for an external installer until that gap is closed (bundling, or
publishing ast/engine as their own packages).

## Dependencies you install

`npm install` at the repository root installs the whole `packages/*` workspace (symlinked into `node_modules/@line/*`)
plus the CLI and `npm test`. The UI needs its own installs in `ui/client` and `ui/server` (and `ui/e2e` to run
browser tests) -- those are not workspace members. `packages/tools/github-comment-bridge` is also not a workspace
member; it is a standalone tool with its own `package.json`/lockfile, installed separately.

## How the pieces relate

```text
packages/cli/construct.mjs -> packages/core/cli.mjs -> generators / enforcers / import / refactor / research
                                        |
                                        +-> packages/ast          (all source parsing and generation)
                                        +-> packages/engine       (pipeline, envelope, transactional writes, workflows)
                                        +-> packages/core/llm.mjs (optional model calls, isolated)

ui/server -> imports the core packages directly (no shell-out to the CLI) -> HTTP + WebSocket -> ui/client
```

The UI backend calls the same functions the CLI calls, in-process, and adds no model calls of its own.
