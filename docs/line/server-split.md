# Splitting ui/server/src/index.mjs into routers (plan, not code)

Step cm1, item 5. A written plan only; nothing here is implemented yet.

## Why

`ui/server/src/index.mjs` is 1,429 lines. About half of its routes already live in their own
`create*Router` modules (plan, envelopes, debug, review, components, line, line ops, line render, notes,
blocks, stories, tests, clone, GitHub, processes, dev server). The rest, roughly 75 routes, are written
inline: pages editor (about 30), workflows (5), git session (5), Ollama (4), settings and project (6),
the CLI verbs (create, refactor, research, import, init), nav (3), units and features (4), validate,
lint-buffer and logs. That makes it a single point of failure in the "no single point of failure" sense
of LINE.md: one file every Cockpit change touches, so parallel work collides there, and no part of it
can be tested or mocked alone.

## What stays in index.mjs

Only wiring, in this order, so the order that makes the server safe stays visible in one screen:

1. Environment and safety: `CLIENT_ORIGIN`, `host`, `port`, `resolveHarnessSeams`, `createAuth`,
   `createRepoConnections`, the dev-server service (it must exist before auth, because signing out stops it).
2. `app`, CORS, the JSON body parser with its `/api/notes` and `/api/blocks` exceptions, the fixed
   bad-JSON answer.
3. Public routes: `/api/health`, `/api/dev-status`, the auth routes.
4. THE GATE (`auth.requireSession`), then `userWorkspaceMiddleware`. Every router is mounted below this
   line, never above it.
5. One `app.use(prefix, createXRouter(deps))` per router, in today's order (Express matches in order, and
   `/api/line` is mounted three times on purpose).
6. `createUiServer`, `start`, `isEntrypoint`, and the `app`/`auth` exports the tests use.

Target: under 300 lines, no route handlers.

## Shared dependencies, passed in, never imported back

A small `ui/server/src/routerDeps.mjs` builds the object every router receives, so no router imports
`index.mjs` (which would start a server or recreate auth) and each one can be given a mock:

- `getRoot()`: the open project's contained root, or `{ ok: false, error }` with one sentence. Today this
  closure is pasted five times with two different sentences; it becomes one function (keep both sentences
  as they are until a Cockpit copy review picks one).
- `currentRoot()`, `respond(res, result)`, `handlePagesEditorError`, `handleAutoCommitError`.
- `afterSave(root, relPath, isNew)` and `saveAndRespond(...)`: the auto-commit and page-change tracking
  after a write.
- `clientOrigin`, `devServer`, `processesService`, `cloneJobs` where a router needs them.

## The routers, one module and one commit each

Each new module follows the existing pattern (`createXRouter(deps)` returning an `express.Router()`;
a contract test next to it). Order is by risk, lowest first, so each step can ship alone:

| # | Module | Routes moved | Notes |
|---|---|---|---|
| 1 | `routerDeps.mjs` | none | The shared deps above; index.mjs uses it first, with no route moved. |
| 2 | `helpApi.mjs` | `/api/help` | Pure read. |
| 3 | `ollamaApi.mjs` | `/api/ollama/status`, `models`, `pull`, `DELETE models/:name` | Already backed by `ollama.mjs`. |
| 4 | `settingsApi.mjs` | `/api/settings` (GET, POST), `/api/fs/browse`, `/api/project/tree` | `projectStatusFor`, `settingsErrorBody`, `applySettings` move with it. |
| 5 | `verbsApi.mjs` | `/api/init` (and its `use` guard), `/api/create`, `/api/refactor`, `/api/research`, `/api/import` | Handlers already sit in `writeVerbsApi.mjs` and `researchApi.mjs`; this only moves the mounting. |
| 6 | `navApi.mjs` | `/api/nav/page`, `/api/nav/file`, `/api/nav/open` | `ui/server/src/navRoutes.test.mjs` already exercises these through `app`. |
| 7 | `workflowsApi.mjs` | `/api/workflows/*` (5 routes) | Backed by `workflowsViewer.mjs`. |
| 8 | `gitSessionApi.mjs` | `/api/git/session`, `config`, `dirty-answer`, `commit`, `plan` | Must mount before `/api/git/remote`'s router, as today. |
| 9 | `unitsApi` router | `/api/units`, `/api/units/summary`, `/api/features`, `/api/features/:name/summary` | `sendUnits` moves with it; handlers already in `unitsApi.mjs`. |
| 10 | `checksApi.mjs` | `/api/validate`, `/api/lint-buffer`, `/api/logs`, `/api/flow/:feature` | Thin wrappers today. |
| 11 | `pagesApi.mjs` | every `/api/pages/*` route (about 30) | The largest and most used; split in two commits if the diff is hard to review: reads (features, list, tree, source, node GET, props GET, unmapped, scope-links, impact, git-status, palette, changes) then writes (lint, quickfix, node POST, props POST, palette insert/wrap, automap, snippet-*). |

After step 11, index.mjs holds only the wiring listed above.

## How each step is proven safe

- A route table snapshot test, written before step 1: it lists every `method + path` the real `app`
  answers (walking `app._router.stack`, including nested routers and their mount prefixes) and compares
  it with a committed list. Every step must leave the list byte-identical; only a step that means to
  change a route may update it.
- The gate test: every path in the snapshot except the public ones answers 401 without a session when
  auth is required (the same check `auth.test.mjs` makes for a few routes today, over all of them).
- Each new router gets its own test that mounts it on a bare `express()` with mocked deps (a fake
  `getRoot`, a fake `afterSave`), so it runs without the rest of the server: the "typed contract, mock,
  own tests" rule (LINE-MODULE) applied inside the server.
- The existing server tests (`ui/server/src/*.test.mjs`) and the
  Playwright suite (`ui/e2e`) run unchanged after every step, through `packages/tools/dev/heavy.sh`.
- `construct validate --profile line` on this repo must not gain findings, and the tsc ratchet must not
  regress, at every step.

## Risks and how the plan handles them

- **Mount order changes behaviour.** Express matches in order: `/api/line` is mounted three times,
  `/api/git/remote` shares a prefix with the git session routes, `/api/init` has a `use` guard before its
  POST. The snapshot test above catches a route that moves; the order of `app.use` lines in index.mjs
  stays the order of today's registrations.
- **A route escaping the gate.** Every router is mounted below `auth.requireSession`; the gate test
  covers every snapshot path, so a router mounted above the gate fails a test instead of shipping.
- **Body-parser exceptions.** `/api/notes` and `/api/blocks` keep their own parsers; the bypass
  condition stays in index.mjs next to the parser, not inside a router.
- **Hidden module state.** `pageChangeTracker`, the dev-server service and the clone jobs are created
  once; routers receive them, they never create their own.

## Out of scope

Changing any route's path, request or response; the WebSocket handlers (`wizardSocket.mjs`,
`processesSocket.mjs`), which are already separate; moving the server onto Construct's own layers (the
dogfooding epic in CLAUDE.md), which this split makes easier but does not attempt.
