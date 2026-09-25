# Unit summaries: understand any part of a project without reading code

`summarizeUnit` (and `construct summarize <ref>`) returns a deterministic, LLM-free, structured summary of any
unit in a Construct project: the project, a feature, one layer, a file, a component/hook/service/domain/page/
controller/workflow, a single export, a route, a package (any directory, including Construct's own `packages/ast`),
a rule, the Context Envelope, or a generator. Same input on the same tree gives byte-identical output.

It is built entirely from existing blocks (the AST package, the layer graph, the enforcers, the workflow
narrator), so it costs no tokens to produce and never drifts from the code. Contract:
[`schemas/unit-summary.v1.json`](../schemas/unit-summary.v1.json). Code: `packages/engine/unitSummary.mjs` (API),
`packages/engine/units/` (shared facts + one small summarizer per kind, registered in `units/registry.mjs`).

## Addressing a unit

A reference is `kind:id`, or a bare name/path that the resolver matches (exact path/name first). If a bare
reference matches several units you get `UNIT_AMBIGUOUS` with the candidate refs, never a guess.

| Kind | Id | Example |
|---|---|---|
| `project` | `.` | `project:.` |
| `feature` | feature name | `login`, `feature:login` |
| `layer` | `<feature>/<layer>` or `<layer>` | `layer:login/hook` |
| `file` | project-relative path | `features/login/index.ts` |
| `component` `hook` `service` `domain` `page` `controller` `workflow` | path, file name, export name, or `feature/name` | `useLogin`, `workflow:features/login/workflows/Login.tsx` |
| `export` | `path#name` | `features/login/hooks/useLogin.tsx#useLogin` |
| `route` | URL | `/login` |
| `package` | any directory | `packages/ast`, `packages/engine` |
| `rule` | rule id | `PAGE-006` |
| `envelope` | `v1` | `envelope` |
| `generator` | `workflow` `controller` `page` `service` `layer` `pipeline` | `generator:workflow` |

## Detail levels and size budgets

| detail | budget | use it for |
|---|---|---|
| `brief` | ~500 tokens | orient: is it healthy, what is in it, where next |
| `standard` | ~2,000 tokens | work on it: files + purposes, signatures, props, endpoints, rule findings |
| `full` | ~8,000 tokens | about to change it: exports, file-level edges, state-by-state machine narration |

Budgets are enforced (arrays are trimmed largest-first; `budget.omitted` says what was dropped). `include`
keeps only the named `sections`.

## Result shape (all kinds)

`schemaVersion, ok, kind, id, ref, name, path, detail, summary` (plain English), `sections` (per kind),
`health` (`status` ok/warnings/issues, `findings`, features also `completeness`), `links` (parent/children refs),
`next` (suggested follow-up refs with the CLI command), `budget`.

Feature sections: `layers` (present/missing), `files` (path, purpose, exports), `contracts` (public API, routes,
hook signatures, component props, service endpoints), `dataFlow` (page -> hook -> workflow -> service edges),
`workflows` (each machine in plain English + health findings), `dependencies` (used by / uses / packages),
`rules` (violations and exceptions scoped to the feature), `tests`.

`flow` (standard and full; #328, #334) shows how a URL reaches the feature: routes are the roots (discovered per
`project.framework`: `nextjs` reads `app/**/page.tsx`, `react-spa` reads the route table in the route layer
file, `<Route>` trees and `createBrowserRouter` objects; a framework with no adapter shows no routes), a route
that renders several features is a fan-out (ordered by the route file's imports), and under each controller a
`behaviour` branch (hook, workflow, service, domain) and a `render` branch (page, component) follow the real
import graph. A file used twice in one route is drawn once and marked `shownAbove`; a controller reached by
several routes repeats under each. `types.ts` and `index.ts` are left out. A feature no route reaches gets an
info note ("No route reaches this feature"), also listed in `health.findings`. The flow is set aside while
other sections are trimmed to the budget, so it can push a summary past it (`budget.exceeded`); brief omits it.
The Cockpit draws it in the Browser pane's Files | Flow switch (`GET /api/flow/:feature`, read-only, the name is
checked against the project's real feature list; #328).

Errors are structured, never thrown or console-only: `{ schemaVersion, ok:false, error:{ code, message,
candidates?, hint? } }` with `code` in `INVALID_ARGUMENT, UNKNOWN_KIND, ROOT_NOT_FOUND, UNIT_NOT_FOUND,
UNIT_AMBIGUOUS, INTERNAL_ERROR`.

## CLI

```
construct summarize <ref> [--kind K] [--detail brief|standard|full] [--include a,b] [--format json|markdown] [--dir D]
construct summarize --list [--kind K]
construct summarize --usage        # machine-readable usage note for agents
```

Errors print the JSON error on stdout and exit 2 (internal error: 3). The older `summarize --feature/--since/
--format compact|prose|md` forms are unchanged.

Real output (`construct summarize --list --kind feature --dir example`, abridged):

```json
{ "schemaVersion": 1, "ok": true, "kind": "feature", "count": 3,
  "units": [ { "kind": "feature", "id": "core", "ref": "feature:core" }, { "kind": "feature", "id": "login", "ref": "feature:login" }, ... ] }
```

Real ambiguity error (`construct summarize Login --dir example`, exit code 2): `UNIT_AMBIGUOUS` with candidates
`component:features/login/components/Login.tsx`, `service:...`, `domain:...`, `workflow:...`.

Real brief markdown (`construct summarize hook:useLogin --dir example --detail brief --format markdown`) is
checked in as golden JSON under `test/golden/unit-summary/` for every kind.

## REST (ui/server, read-only, scoped to the current project root, same origin guard as the rest)

```
GET /api/units?kind=
GET /api/units/summary?ref=&kind=&detail=&include=a,b
GET /api/features                       # alias
GET /api/features/:name/summary?detail= # alias of kind=feature
```

HTTP status: 200 ok, 400 invalid/unknown kind, 404 not found, 409 ambiguous, 500 internal.

## For bots: how to call it

1. `construct summarize --usage` (or `unitApiManifest()`): the current kinds, ref grammar, budgets, error codes.
2. `construct summarize --list` to discover refs; `--list --kind feature` for the feature index.
3. Start every task with `--detail brief`. Read `health.status` and `next[]`; follow `next[].ref` or `links.children`.
4. Use `--detail standard` for the unit you will work in and `--detail full` only for the one you will edit.
5. On `UNIT_AMBIGUOUS`, pick one of `error.candidates[].ref` and retry; on `UNIT_NOT_FOUND`, use the suggestions.
6. Prefer this over reading files: it is deterministic and cheaper. It does not replace reading the exact lines you edit.

The API is pure (JSON in, JSON out) so it can be exposed as an MCP tool later without change; no MCP server exists yet.

## Extending

Register a new kind with `registry.register({ kind, description, list(ctx), resolve(ctx, ref, {explicit}),
summarize(ctx, id, detail) })` and pass `{ registry }` to the API. Reuse `units/facts.mjs` (file facts, tests,
violations) instead of re-parsing.

## Known limits

- Import resolution follows relative imports and `tsconfig` `@/*`-style aliases only; other aliases are treated as external.
- Public-API names for `export *` re-exports are module specifiers, as in the parser.
- `tests` are found by colocation and file-name match, not by import analysis.
- `generator` and `envelope` describe Construct itself and are resolved from the installed Construct, not the target project.
- Workflow narration covers XState machines the existing extractor understands.

## Backend code

`construct summarize --backend <dir>` is the backend counterpart (Node.js / Express: route map, module roles, import graph,
environment names and effects): see [BACKEND-SUMMARY.md](BACKEND-SUMMARY.md).
