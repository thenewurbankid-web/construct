# Backend summary (`construct summarize --backend`, #634)

An on-demand, read-only summary of a Node.js / Express backend: what it serves, what each file is for, what imports what,
which environment variables it reads and which effects it performs. Deterministic, no model, no rules, and it never
restructures the target project. It is the backend counterpart of the layer summary the front end gets (`summarize`
reads `features/*/<layer>` folders; a backend has no such folders, so this reads the code).

```bash
construct summarize --backend ui/server/src                 # the compact human view
construct summarize --backend ui/server/src --format json   # backend-summary.v1, schemas/backend-summary.v1.json
construct summarize --backend                               # backend.dir from architecture.yml, else the project root
```

Paths in the output are relative to the project root (the nearest ancestor holding `architecture.yml`, else the scanned
directory itself); no absolute path and no environment value ever appears. Code: `packages/core/backend-summary.mjs`
(scan, assembly, human view), `backend-routes.mjs` (the cross-file route walk), `backend-roles.mjs` (roles and the
`backend:` config), and the per-file facts in `packages/ast/backendFacts.mjs` and `backendEffects.mjs`.

## What it reports

1. **Route map.** Method, full path (mount prefixes resolved), handler file and function name when it is a named or
   imported function, the route's own middleware in order, the middleware inherited from earlier `use()` calls at a
   matching path (a session gate, a body parser: by id, listed once under `middleware`), and `file:line`. Forms read:
   `app|router.get|post|put|patch|delete|all|head|options`, `use(path, router)` where the router is a variable, an import
   (default, named, namespace, `require`), a router factory call (`createNotesRouter({...})`, including a factory that
   returns another factory's router), chained `router.route('/x').get(...).post(...)`, array and constant paths
   (`BASE + '/x'`), route registrars (`mountRoutes(app)`, `auth.mountRoutes(app)` when `auth` is `createAuth()` returning
   an object literal) and CommonJS (`require`, `module.exports = router`). A four-parameter error handler is listed but
   never inherited. A plain `http.createServer` handler is read only for `req.url === '/x'` (optionally `&& req.method === 'POST'`)
   and `switch (req.url)` cases; other path conditions are counted, and a handler with none says "not detected".
2. **Module roles.** Each file is `route`, `store`, `service`, `auth`, `job`, `util`, `config`, `test` or `other`, with the
   reason: the test naming convention, the express app file, a route word in the name (`Api`, `Routes`), an auth, job,
   store, service, config or util word in the name, content that registers routes or exports a router, a folder name, then
   content signals (serves WebSockets: route; spawns processes or calls the network: service; writes files: store; only
   reads files: service; timers: job; only reads env: config; exports and touches nothing: util). What no signal claims is
   `other`. It is a label for reading, not a rule; nothing restricts what may import what.
3. **Import graph.** Edges between scanned files (type-only imports are erased and left out), cycles named with one concrete
   loop, relative imports that leave the scanned directory or resolve to nothing, and the packages imported.
4. **Environment and effects.** `process.env` names (`.X`, `['X']`, `?.X`, destructuring, `NODE_ENV` included) with
   `file:line`, never a value; effects with `file:line`: `fs` and `fs/promises`, `child_process`, network (`fetch`,
   `http`/`https`/`net` requests and servers, `ws`, `axios`-style clients, `listen`) and timers. A call counts only when its
   callee is bound to the real module, so a local variable called `fs` or `spawn` is not an effect.
5. **Not detected, never guessed.** A computed route path is shown as written and flagged `dynamicPath`; a mount that is not
   a visible `express.Router()`, a plain http handler with no `url === '/x'` condition and a file that does not parse are
   listed under `detection.notDetected`. Routers no app mounts are reported as `unmounted` with their local paths.

Bounds: the JSON lists are cut to `BACKEND_LIMITS` (600 routes, 3000 edges, 1000 files, ...), `counts` keep the true
totals and `truncated` says what was left out; the scan reads at most 3000 files of at most 1 MB, skips `node_modules`,
`dist`, `build` and friends, and never follows a link.

## Configuration

Nothing is required. An `architecture.yml` may add a `backend:` section (read on its own, so it works in a project with
no other Construct configuration; a typo fails loudly):

```yaml
backend:
  dir: ui/server/src          # the default directory of `summarize --backend` and of the MCP tool; must stay inside the project
  roles:                      # role -> globs, project-relative; an override beats every signal and says so in the reason
    store: ['ui/server/src/health.mjs', 'ui/server/src/db/**']
    job: ui/server/src/autoCommit.mjs
```

## MCP

`summarize` with `backend: true` (packages/mcp) returns the same summary bounded to a client's budget: the route table (the
first 80 routes), the framework, counts, role and effect counts, environment variable names, cycles, unclassified files and
what was not detected, under 32 KiB. The directory is never an argument: it is `backend.dir`, else the project root, and
must stay inside the root the server was started on.

## Dogfood: `ui/server/src` (measured 2026-09-25)

The target is the Cockpit's Express server: `index.mjs` registers 58 routes and 21 `app.use()` calls, thirteen `*Api.mjs` /
`devActivity.mjs` files return routers from `createXRouter()` factories, `auth.mjs` registers routes through a returned
`mountRoutes(app)`, and the rest are stores, services, job runners and helpers. The reference is the source itself.

| Check | Independent | Detected | Missed | Invented |
| --- | --- | --- | --- | --- |
| Route registrations: lines matching `\b(app\|router)\.(get\|post\|put\|patch\|delete\|all)\(` in the 63 non-test files | 122 | 122 | 0 | 0 |
| `use()` registrations: lines matching `\b(app\|router)\.use\(` | 50 | 50 (14 mounts of a router, 58 middleware entries: one line can name several paths) | 0 | 0 |
| Express's own runtime table (import the real `app`, walk `app._router.stack`) | 124 routes | 122 | 0 (see below) | 0 |
| Mounted routers reached from the app | 14 | 14 | 0 | 0 |
| Routers no app mounts | 0 | 0 | | |

The one difference from the runtime table is by construction: `requirementApi.mjs:211` registers
``router.post(`/proof/${name}`, ...)`` in a loop, which Express expands to three routes. It is reported once, with the
computed path as written, flagged `dynamicPath` and listed under `notDetected`, not guessed into three. Every detected
route matches a runtime route by method and path (parameter names normalised). The `test/backend-summary.test.mjs`
dogfood test repeats the line-level comparison on every run, so a new registration form that this reader misses fails the suite.

Roles: 63 non-test files, 67 test files. No role has to be overridden for the route map, the graph or the effects to be
right. Judged by reading, about 10 of the 63 verdicts are questionable (all arguable, none absurd): `health.mjs`,
`coreVerbs.mjs`, `pagesEditor.mjs`, `workflowsViewer.mjs` and `workspace.mjs` are labelled `store` because they write files
(they are closer to services); `reviewAnalyses.mjs`, `reviewPlans.mjs` and `testRuns.mjs` are in-memory registries labelled
`util`; `testSeams.mjs` is `util` (it reads environment seams); `testsEnv.mjs` is `config` from the word "env". The kill
criterion (most roles need an override) is far from met.

Excerpt (`construct summarize --backend ui/server/src`, 130 files of which 67 test, 122 routes, 14 mounts, 119 import edges,
0 cycles, 14 environment variables, 165 effects):

```text
ROUTES (122)
  GET     /api/health                        (inline)                  +2 inherited  ui/server/src/index.mjs:204
  GET     /auth/login                        auth.mjs:handleLogin      +2 inherited  ui/server/src/auth.mjs:612
  POST    /api/settings                      (inline)                  +5 inherited  ui/server/src/index.mjs:293
  PUT     /api/notes/:id                     handle(...)               +9 inherited  ui/server/src/notesApi.mjs:125
  POST    /api/tests/:feature/run/cancel     handle(...)               +7 inherited  ui/server/src/testsApi.mjs:140
  POST    /api/requirement/proof/${name} ~   (inline)                  +7 inherited  ui/server/src/requirementApi.mjs:211
MOUNTS AND MIDDLEWARE
  m5    use /api                 auth.requireSession  ui/server/src/index.mjs:230
  mount /api/notes             -> ui/server/src/notesApi.mjs (router)  from ui/server/src/index.mjs:1116
ROLES (route 22, store 8, service 10, auth 2, job 7, util 12, config 2, test 67)
    ui/server/src/notesStore.mjs  [name: "store" in the file name]
```

## Left out (MVP)

Fastify, Koa, Nest and other frameworks; any rule (`construct validate` does not read this); a `framework` option; a Cockpit
screen; a plan flow (`summarize.backend` is not in `PLAN_FLOWS` yet); route paths built at run time from a loop over a list
(reported as computed, not expanded); routers passed through function arguments or stored in objects other than the
factory-returns-an-object pattern; `import.meta.env`; a bare `process.env` (a spread) names no variable and is not listed.
