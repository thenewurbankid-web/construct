# Changelog

All notable changes to Construct are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The version policy is
in [docs/VERSIONING.md](docs/VERSIONING.md). Numbers in brackets are pull
request or issue numbers.

## [Unreleased]

### Added
- Backend summary (#634): `construct summarize --backend [<dir>] [--format json]` reads a Node.js / Express backend and reports, read-only, with no model and no rules: the route map (method, full path with `use('/prefix', router)` mounts resolved across files through variables, imports, `require`, router factories such as `createNotesRouter({...})`, chained `router.route('/x').get(...).post(...)`, array and constant paths and registrars such as `mountRoutes(app)`; handler file and function name, own and inherited middleware by registration order and path, `file:line`), each file's role (`route`, `store`, `service`, `auth`, `job`, `util`, `config`, `test`, `other`, with the reason for each, overridable through a `backend:` section of `architecture.yml`, which also takes `dir`), the import graph with named cycles, `process.env` names (never values) and effects (fs, child_process, network, timers) with `file:line`. A plain `http.createServer` handler is read only for `req.url === '/x'` conditions; anything it cannot read (a computed path, a mount that is not a visible router) is listed as "not detected", never guessed. `--format json` prints `backend-summary.v1` (`schemas/backend-summary.v1.json`, bounded, project-relative paths); the MCP `summarize` tool takes an optional `backend: true`. Dogfooded on `ui/server/src`: 122 of 122 route registrations and 50 of 50 `use()` registrations found, none missed or invented, one loop-registered route reported once as computed; about 10 of 63 role verdicts arguable and none forced an override. Left out: Fastify, Koa, Nest, rules, a `framework` option, a Cockpit screen, a plan flow. Express and plain Node servers only. See docs/BACKEND-SUMMARY.md.
- The docs logo moves while the framework is being developed, with no server and no secret (#614): the docs build now writes `dev-status.json` next to `logo.json` (the time of the newest commit of the branch it built, a 15-minute window, and the build time; no names, messages or hashes; `lastActivityAt: null` without history; `CONSTRUCT_DEV_STATUS_LAST_ACTIVITY` overrides it for tests). `site/logo.json` is now `{ "mode": "status", "api": "dev-status.json" }`: the status mode of `assets/js/logo-status.js` accepts an activity file (`lastActivityAt`, optional `windowSec`, active while younger than the window on the visitor's clock; a future time counts as age 0, an unparsable one as inactive) besides the Cockpit endpoint's answer, and `api` in `logo.json` may be a relative path on the site (resolved next to `logo.json`; no scheme, no `//host`, no `..`). The polling rules, `?logo=` overrides and motion are unchanged. Only the unreleased docs (`/next/`) carry it until the next release tag: each release's docs are built from that tag's own site.
- Construct blocks as MCP tools (#649): a new private package `@line/construct-mcp` (`packages/mcp`, bin `construct-mcp`, stdio, on the official MCP TypeScript SDK v2 and zod) exposes eight read-only, plan-only tools: `requirement_parse`, `placement_place` (blocks, open questions and offers, a plan preview with the files each step touches, its proof and wiring), `plan_validate`, `decide`, `summarize`, `validate`, `machine_capabilities` and `traces_stats`. The project root is fixed at startup (`--root`) and never a tool argument; a request or a link that leaves it is refused; results are path-free, secret-free and at most 32 KiB; calls are rate limited (30 a minute, `--rate-limit`); nothing writes, applies a plan or opens the network. Answers are returned as `by: 'llm'` with the client name; no tool records a decision trace yet. Starts in about 175 ms and 70 MB. `@line/construct-core` gains a `./config` export. Setup: `packages/mcp/README.md`, `claude mcp add construct -- node <path>/packages/mcp/bin/construct-mcp.mjs --root <project>`.
- Construct on a low-end machine (#648): `construct doctor [--format json]` now also reads the machine (Node, cores, total and free memory, free disk on the project's drive, ffmpeg and ffprobe, a Playwright browser, Ollama on this machine with a 2 second check, python3, the Kokoro and Chatterbox voices, any `.onnx` or `.gguf` under the state folder) and sorts it into a documented tier, with the reason: **Lite** (command line only: 2 cores, 4 GB of memory, about 1 GB of disk), **Cockpit use** (8 GB) or **Contributor** (build and test this repository: 8 GB workable one heavy job at a time, 16 GB comfortable, about 6 GB of disk); below Lite is a report, not an error. It says what is switched on and off and why, and prints the exact fix line for each missing optional item. Read-only, no model, no network beyond that loopback ping (an `OLLAMA_HOST` on another machine is never contacted); exit 0 except 1 for a Node older than 20 or a machine it cannot read. The JSON keeps `node`, `npm`, `architectureYml` and `enforcers` and adds `supported`, `tier`, `machine`, `enabled`, `disabled`, `optional`, `notes` and `now` (free memory and disk right now, kept apart because they change). New pure `capabilities(machine)` (`packages/core/machine.mjs`, export `@line/construct-core/machine`) says which features run here (model-backed proposals, Cockpit, Studio voice, Playwright proofs); on a Lite machine `openDecision` (so `construct decide` and the Requirement route) imports no decision plugin and answers `rules only: <reason>`, and a capable machine behaves as before. `construct --version` now answers before the engine is loaded (about 40 ms and 45 MB instead of about 640 ms and 165 MB). `packages/tools/dev/benchmark.mjs` measures cold start and peak memory of `--version`, `validate`, `summarize`, `decide --requirement` and the Cockpit server start (until `/api/health` answers), compares them with `packages/tools/dev/budgets.json` and exits 1 on a regression or a missing measurement; the new "System requirements" page (`site/content/user/system-requirements.md`) is generated from the tier constants and the committed benchmark snapshot, and a test fails when they differ.
- Where a shaped screen reads its data from (#621, part of #616, relates to #400): the service of a list, detail or form screen no longer calls an endpoint that may not exist. A closed question `q-source` (one per shaped screen, `q-source-<name>` for several) offers `local` (a typed in-memory store: seed rows in a second domain file, `ProductsStore.domain.ts`, read by a service with no `fetch`, so the screen works with no backend), `endpoint` (`/api/<plural>`, what a shaped step did before; it must exist) and, only when the project has `openapi.yaml`, `openapi.yml` or `openapi.json` at the root or in `api/` with the matching operation, `openapi` (the service requests that operation's path, read with the reader `create service --openapi` now shares, `packages/core/openapi-spec.mjs`). The rules-only default is `openapi` when the operation exists, else `local`. `--source local|endpoint|openapi` on `create.unit`, `create.layer` and `create.proof` (enum in `PLAN_SOURCES`, mirrored in `schemas/plan.v1.json`, files declared in `touches`); no `--source` still means `endpoint`, so existing plans and commands give the same bytes, while the Requirement chain now plans the default above (its steps carry `source`, the local store is one more file). The render proofs stub the source the way it is wired (store data with no network, the OpenAPI path asserted, the fetch stub unchanged for `endpoint`), a local source plans no browser flow, the answer is a decision trace (`requirement.plan.source`), and the Requirement route and screen carry `q-source` as a second **Data source** card beside the shape card. Left out: auth, pagination, write-through caching, a store shared between screens, persisting the local store, fields read from the spec's schema. See `docs/PLACEMENT.md`, "The data source".
- Detail and form screen shapes (#620 and #626, part of #616): two more shapes on the list shape's mechanism (`--shape list|detail|form` on `create.unit`, `create.layer` and `create.proof`, the enum in `PLAN_SHAPES` and `schemas/plan.v1.json`, derived touches, usage text). `--shape detail` writes a read-only screen bound to ONE item: a service `fetch<Entity>({ id, signal })` (the `AbortSignal` forwarded, a 404 is `not-found`, every other failure a typed error result), a hook with a `loading | not-found | ready | error` union in `useTrackedState` (the id is an argument or `?id=` of the address), a pure domain unit that words every field as a label and a text, row, list and notice components, an expression that holds the branches, the page and the controller. `--shape form` writes a form: an input per field except `id` (`type="text"`, `number` or a checkbox, each with its label), validation in a pure `defineDomain` unit (a string is required, a number is required and must be a number, a message per field, typed values out), a submit service (POST as JSON with the `AbortSignal`, a typed result), and a hook holding the values, the messages and an `editing | submitting | submitted | error` union. Both are typed with the factories, pass `construct validate` (phase 1 rules on) with no error and no warning and `tsc --noEmit`, are byte-identical on a second run, and get the same wiring (dependency, `sync`, route entry) and the same proof step as the list. The `q-shape` offer is now per card, with stable ids and the matching shape first as the rules-only default: a list read offers `list | scaffold`, a read of one item ("A user wants to see the details of a product") `detail | scaffold`, a write with properties ("A user wants to add a product with a name and a price"; create, add, submit, save, register, update) `form | scaffold`; the Requirement screen draws them with no client change. The proof of each shape runs offline (`construct test proof`) and names the state that is wrong (detail: loading, not found, ready with every field, error, the 404 and the id in the address; form: fields with labels and typed inputs, a message per invalid field, the stubbed submit called with typed values, submitting, submitted and error), and a page that throws is reported as the state `crashed`. The lexicon gained the write verbs `add` and `register` and the parts `detail`, `name` and `price`. A browser flow exists only for the list shape. See docs/PLACEMENT.md, "The detail and form shapes".
- Alerts (#655): `packages/tools/dev/alert.mjs` raises a GitHub issue (labels `alert` and `off-board`, assigned to the owner so GitHub notifies by email and mobile, titled `[alert] <key>: <title>`, deduplicated by key with a comment on repeat, closed by `resolve`) when a build lane is held, a build run fails or the work-branch docs deploy fails; the CI steps are in `build-on-ready.yml` and `pages.yml`. `alert.mjs status` lists open alerts, failed runs of the last 24 hours and Paperclip agents in trouble; `watch` prints only what is new (state in the user cache dir) for cron and the OG heartbeat, and alerts once a day for the failed scheduled docs build of the frozen `main`. Bodies are redacted of token shapes and cut to 3000 characters. No model, no third-party service, no secret. See docs/ALERTS.md.
- The decision model as a pluggable tool (#633, part of #616): a decision provider suggests the next option of a chain (option, reason, runner-up, optional score) from the fixed-size summary alone. The contract is `{ name, version, suggest(summary) -> { option, reason, score?, runnerUp? } | null }`; the provider gets a frozen, path-hidden copy of four fixed fields (a secret in it is refused) and never executes anything. It is chosen per project by `decision: { provider: rules|off|<name>, plugin: <relative path>, timeoutMs }` in `architecture.yml` (default `rules`, no model): a plugin is imported lazily, only when named, from a file whose real path stays inside the project, and a plugin that fails to load, throws, is slower than `timeoutMs` (default 3 s) or answers something that is not an enabled option is replaced by the rules provider for that question, with a path-free log line. New `construct decide --summary <file|-> [--provider <name>] [--format json]` (the tool an LLM calls: a summary in, one suggestion out) and `construct decide --requirement "<sentence>"` (a suggestion per open question and offer); read-only, exit 2 for a usage error. `POST /api/requirement/read` returns `suggestions` (per question id: option, reason, provider name and version) and `decisionProvider`; the Requirement screen marks the suggested option "suggested by rules" (or the plugin) with its reason, still one click to take and one to change, and records the answer with the suggestion and `accepted: true|false`. A project's plugin file is imported by the Cockpit server only with `CONSTRUCT_DECISION_PLUGINS=on` (a plugin is code the project brings); `construct traces replay --provider <name>` finds the project's plugin and shares the loader with `--plugin`. New `normalizeDecision` in config, `askProvider`, `providerInput` and `suggest`'s `version` and `score`, exports `@line/construct-core/decision-plugin` and `/decision-project`. See docs/DECISION-PROVIDERS.md.
- Decision traces (#643, part of #616): every choice made in a chain is recorded as a versioned `decision-trace.v1` record (the question as offered, the option chosen, who chose, the `rules` suggestion and whether it was taken, later `planValidated`), and any decision provider is scored by replaying them. The Requirement route records a person's answers to the card's open questions, placement questions and the `q-shape` offer; `compileChain` decisions go through `choicesFromChain` and `recordChoices`. Records are append-only JSONL in the state directory (`<state dir>/traces/<project>/`, never the project), deduplicated by a deterministic id, rotated at 2 MiB, refused when they hold a path or a secret shape, never written when `traces: off` is set in `architecture.yml` (default `on`, they stay local), and a failing write (full disk, bad state directory) never breaks the chain. New `construct traces list|stats|replay`: `replay --provider <name> [--chooser <id>] [--min-traces 30] [--plugin <file.mjs>]` reports agreement with what people chose, agreement with vouched-for outcomes, coverage and a `beats`/`ties`/`loses` verdict against the `rules` baseline (promotable only on at least 30 person-made traces); read-only, deterministic, no model, no network. New exports `@line/construct-core/decision-trace`, `/decision-trace-store`, `/decision-trace-adapters`, `/decision-trace-replay`, `/redaction`; `normalizeTraces` in config; the `rules` and `off` providers carry a `version`. Export bundles and training are #647 and #645. See docs/DECISION-TRACES.md.
- `CLIENT-001` (*a `'use client'` file cannot import server-only code*): a file whose first statement is `'use client'`, and every file reachable only through it, may not import a `service`-layer module, the `server-only` package, a database or SDK adapter (default list, extended by the rule's `serverOnly: [...]` in `architecture.yml`) or a module that reads a non-`NEXT_PUBLIC_` `process.env` variable, and may not read one itself. It follows imports, re-exports and `import('...')` through the project's import graph (a file imported by both a server and a client file is judged from the client edge; `import type` never counts; a `'use server'` file is the sanctioned exit), and the finding names the file, the offending import or variable, the client entry chain and the fix (move the call behind a server action or a service). `construct init` scaffolds it as `error`; existing projects keep it `off` and opt in with `rules: { CLIENT-001: error }`. Fixture pair in `fixtures/client-boundary/` ([#644]).
- Builds: every change an end user can see or use is checked and tagged automatically the moment it lands, as many times a day as it happens, one tag per team (`construct`, `cockpit`, `site`, `design`, Studio): `<lane>/build-YYYY-MM-DD-HHMM`, annotated with the capability commits and issue numbers as JSON. What counts (user-facing paths, not tests, CI, board, refactors) and each team's light check are data in `packages/tools/dev/lanes.json`; a GitHub Actions workflow on push to the work and Studio branches runs `packages/tools/dev/build-on-ready.mjs` (dry run by default, `--push` to tag); a failing check holds only its own lane. Deploys stay a separate approved step, and `delivery-report.mjs` now counts builds and lists their capabilities per day and lane ([#639], see docs/VERSIONING.md "Builds").
- Cockpit: clone a private repository with your GitHub login, no pasted token. A separate, opt-in **Connect GitHub for private repositories** consent (a dedicated GitHub App or OAuth app, set by `CONSTRUCT_GITHUB_REPO_CLIENT_ID` / `_SECRET`; unset means the feature is off and invisible, and sign-in stays identity-only) gives a per-session connection held only in the server's memory (never on disk, in a cookie, a log, a job or a response; refreshed server-side, wiped on sign-out, Disconnect and server stop). The clone form then defaults to **Use my GitHub login** with a picker of the repositories the connection can read, the pasted token stays as the fallback, a repository the connection cannot see says which app installation or organisation approval is missing, and Settings shows the account. Clone and pull take `useLogin: true` instead of `token`, for `github.com` only, through the existing one-shot `GIT_ASKPASS` pipe ([#638], part of [#277]).
- Cockpit: a **Requirement** screen (`/requirement`, part of Features, next to Plan; also "Go to Requirement" in the palette and a link on the Plan screen). Paste or pick a plain-English sentence and press Read it: the server's deterministic blocks (`parseRequirement`, `placeCard`, `planFromBlocks`) show the card (nouns, verbs and every check with the word that caused it), any open questions as closed option buttons, the placement blocks with the three answers and the files each will create, and a timeline of what runs in order (page load, server read, presentation, interaction, mutation, redirect) with one plain-English line per step. Approve plan hands the plan to the existing Plan run route (per-file approval, containment and the session gate unchanged); Save as note keeps the card and plan as a Note. No model is used anywhere on the screen. `POST /api/requirement/read` is read-only, below the session and project gates, Origin-checked, JSON only and size-capped (#642, part of #616).

- A generated screen is reachable with no by-hand step (#654, part of #616): the plan of a shaped screen now carries, after the units and before the proof, `construct sync` (the existing flow, declaring the feature's `index.ts` and `.dependency-cruiser.cjs`, so the barrel exports the controller and the hook and SLICE-003 does not warn), the new `create.route` flow (`construct create route Products --feature products [--route /products]`: Next.js creates `app/products/page.tsx` that renders the controller, ROUTE-001 and ROUTE-002 conformant, and removes the init scaffold's dangling root page; react-spa adds the import and a `<Route>` to `src/App.tsx` and drops the dangling `CoreController` import `construct init` leaves; declared touches, previewed diff, idempotent, refuses a route something else owns) and, when `package.json` lists no `@line/construct-core`, the new `add.dependency` flow (`construct create dependency @line/construct-core --version ^0.9.0`: one line, never a package manager). The route is the kebab-case of the screen name; two closed choices with stable ids and rules defaults ride in `planFromBlocks`'s new `offers`: `q-route` (`alternate`, `skip`; asked only when the path is reserved or taken) and `q-dependency` (`add-dependency` with the exact line, `skip`). `planFromBlocks` also returns `wiring` and takes `answers` and `wire: false` (a plan is then as before); `choicesFromWiring` makes the answers recordable decision traces. The full-path test runs only the plan's commands, for react-spa and Next.js, and checks every changed file was declared, `construct validate` 0 errors 0 warnings, `tsc` and the proof. The Cockpit block catalogue lists both flows. See docs/PLACEMENT.md, "The route entry, sync and the dependency".
- Screen proofs (#623, part of #616): a shaped screen comes with the evidence that it works. `construct create proof Products --feature products --entity Product --fields ...` writes a locked, generated `features/products/tests/generated/ProductsScreen.proof.test.ts` (declaring the `frozen:` and `nonLayer:` test regions in `architecture.yml` once) and `construct test proof products` runs it offline (bundled with the project's own esbuild, run with `node --test`: no browser, no server, no new dependency) and classifies the result in the Playwright runner's words: the four states of the page with sample props (loading, empty, items with every field value, error with `role="alert"`), the controller's loading state first, and the service with a stubbed fetch (a 500, a wrong shape and a network failure are error results). A failure names the state (`Expected "empty", the screen shows "blank"`: an app failure; a missing file the proof binds to: a convention failure). The Requirement chain's plan for a list shape now ends with a `create.proof` step and a read-only `test.proof` step (two new plan flows, in `schemas/plan.v1.json`), and `planFromBlocks` returns `proof` (`complete: false` until `proofStatus` of the `verifiedBy` steps is green or explicitly skipped) and `notes`; `{ proof: false }` leaves a plan as it was. With a Playwright config already in the project it also writes and plans the route flow with a mocked API (`--kind playwright`); without one it says so and installs nothing. `proofSummary` is the fixed-size summary with closed option ids (`edit-code`, `fill-with-ai`, `regenerate-screen`, `skip-proof`). See docs/PLACEMENT.md, "The proof step".
- Screen shapes (#619, part of #616): `construct create layer Products --feature products --layers domain,service,hook,component,page,controller --shape list --entity Product --fields id:string,name:string,price:number` writes a list screen that works instead of empty stubs: the entity type and a pure sorter (`defineDomain`), a service that forwards the caller's `AbortSignal` and answers a typed result (`defineService`), a hook holding loading, ready and error state (`useTrackedState`), a row, a list and a notice component (`defineComponent`), a page with no conditional JSX and an expression that decides loading, empty, error or rows (`definePage`, `defineExpression`), and the controller that wires them (`defineController`). Deterministic, no model, byte-identical on a second run, named `Name.layer.ext`, and it passes `construct validate` with the typed-contracts phase 1 rules on and `tsc --noEmit`. `create.unit` and `create.layer` plan steps take the optional `shape`, `entity` and `fields` arguments. In the Requirement chain, a card that asks to see a list of a plural data object ("A user wants to see a list of products") is offered the shape as a closed question `q-shape` (`list` or `scaffold`, `offers` in the placement result, never holding the plan back); answering `list` puts the shape on every unit step. Also: `DOMAIN-002` no longer flags the `defineDomain` import itself. See docs/PLACEMENT.md, "The list shape".

- Cockpit: the Requirement screen draws the screen-shape offer (#651, part of #616). For "A user wants to see a list of products" a **Screen shape** card sits between the placement blocks and the timeline: "List screen, generated with typed code" (marked "suggested", 10 real files that validate) or "Empty scaffold" (empty stubs). Choosing re-reads with `{ id: 'q-shape', option }`; the plan preview (7 steps, each carrying `--shape list`), the timeline and the files list redraw, and the card says who decided (person). An unanswered offer never disables Approve. Approve also waits while a read is in flight, so the plan sent is the plan shown.

## [0.9.0] - 2026-09-24

The MVP release: a five-screen Cockpit with durable Notes, a calmer interface, blocks you can see and switch off, a workspace of your own on a hosted Cockpit, and results you can trust on a real project. Package versions are `0.9.0`; the Cockpit (`ui/`) is not versioned separately yet.

### Added
- `TYPE-001` (off by default, opt-in via `rules: { TYPE-001: error }` in `architecture.yml`): `construct validate` runs the project's own TypeScript (`tsc --noEmit -p tsconfig.json`) and reports each diagnostic as a violation with its `TSxxxx` code, file and line; if TypeScript or the tsconfig is missing it warns `TYPE-001 could not run: <reason>` instead of passing silently ([#495]). A solution-style root tsconfig (`references`, no `files`/`include`, as in a Vite/React template) is now expanded: each referenced project is checked with `tsc --noEmit -p` (never `tsc -b`) and the diagnostics merged; a missing reference or a config that resolves to zero files warns `TYPE-001 could not run: ...` instead of passing, and the checked configs are reported as `typeCheck.checked` ([#579]).
- Cockpit: interactive commands (`/api/create`, `/api/import`, ...) are queued per signed-in login instead of one server-wide queue, so one user's long command no longer delays another's; `CONSTRUCT_MAX_CONCURRENT_COMMANDS` (default 2) caps how many run at once across all users. Each command's console output and exit code are captured per command (`setExitCode`/`withExitCodeSink` in `packages/core/diagnostics.mjs`; core commands no longer write `process.exitCode` directly), so concurrent commands never see each other's output or status ([#569]).
- `defineService(name, fn, { schema })`: an optional response schema, checked at the service's boundary. `schema` is any Standard Schema object (`~standard.validate` — zod 3.24+/4, Valibot, ArkType, or hand-written) or a `safeParse`-shaped one; core imports no schema library. The unit then returns `{ status: 'ok', value }` (typed as the schema's output) or `{ status: 'error', kind: 'schema', issues }` — never a throw — keeping `fn`'s own sync/async-ness; the two-argument form is unchanged ([#585], part of [#575]).
- Cockpit shell: five screens (Features, Pages, Components, Git, Tests) in a left rail, a profile menu (Settings, Local model, Theme, Help, Sign out), and the whole UI blocked until a project is open. Features, Pages and Components browse in the left pane and open in the stage; the Pages screen can show the real app full screen and at device sizes ([#243], [#368], [#369], [#370], [#429], [#431], [#456]).
- Durable Notes: a per-project draft that autosaves 800 ms after you stop typing, survives a reload and a server restart, and offers Keep mine / Load theirs / Compare when another tab saved first. The Plan screen writes its own note: `?note=<id>` follows it, step edits save the plan, editing the text afterwards shows "Plan out of date" (Keep this plan), and Run marks the note ran and keeps it as read-only history (editing it starts a copy). "Ticket" is now "Notes" everywhere users read ([#366], [#373], [#561], [#609]).
- Open a project: clone from GitHub, and a New project action that creates an initialised folder in your workspace ([#330], [#445], [#562]).
- A workspace of your own on a hosted Cockpit: DevOps sets the root (`CONSTRUCT_WORKSPACE_ROOT`), each signed-in user is confined to `<root>/<login>/`, the project picker lists only your projects, and project state is per session so two users can be signed in at once ([#566], [#567], [#568], [#569]).
- Blocks: a uniform block contract (`packages/core/block-contract.mjs`, `block-flows.mjs`, `docs/BLOCK-CONTRACT.md`) with an audit of every plan flow; a Blocks tab in the Features Browser pane lists each block in plain words and lets you turn it off per project or set its default engine. A turned-off block is refused server-side (`COCKPIT_BLOCK_DISABLED`) on every screen that starts it, and nothing starts ([#407], [#543], [#563], [#611]).
- A plan built in the Cockpit declares the files its steps write (`packages/core/plan-touches.mjs` derives them for `create.feature`, `create.unit` and `create.layer`, pinned against the real generators), so the approval gate can approve them one by one; the step card shows "writes <file>" ([#470], [#564]).
- The Cockpit and the CLI give the same result: the per-project execution mode now covers summarize, doctor, review, create, refactor and import as well as validate, each with an engine/CLI byte-identical contract test ([#560]).
- Workflows: `WORKFLOW-004` transition-table completeness and an opt-in typed state union with an exhaustive matcher for generated workflows ([#571], [#572], [#578], [#580]).
- Logos as status lights: the Cockpit logo moves only while the framework is working (a command, the Import Wizard, a Process) and the tab icon flips with it; the docs logo is a status light too, driven by `GET /api/dev-status` (public, booleans only, read from local agent activity, off unless enabled), with its mode and a Logo Lab motion set in `site/logo.json` or in your own browser ([#614]).
- Brand marks (Line, Construct, Cockpit, CLI), a login hero, a reusable animated loader, and a calmer login screen ([#401], [#406], [#424], [#455]).
- Components screen: props read with react-docgen ([#434]). API reference for every package, versioned with the documentation site ([#463], [#464], [#465], [#466], [#467], [#468]).

### Changed
- A calmer Cockpit: Settings drops the "Current resolution" panel, the Dashboard opens with Create and folds Refactor, Research and Import under "More actions", Help opens only "Getting started", the status bar shows one "? Shortcuts", buttons say what they do ("Create feature", "Check impact"), plain words replace derived/inferred ("Computed"/"Guess"), and empty states end with one primary action ([#391], [#565]).
- The documentation site sanitizes rendered HTML with `sanitize-html` and an explicit allowlist instead of a regular-expression pass ([#421]).
- Scenario names are distinguishable in a list ([#307]).

### Fixed
- `IMPORT-001` and the `ROUTE-*` rules now check the root `app/page.tsx` ([#491]); `READ-001` no longer suggests renaming a unit after a type export ([#493]); `construct init` scaffolds a runnable project ([#497]); the process engine, transaction commit and approval gate validate the four constraints `construct validate` enforces ([#546]).
- Stability: model calls time out instead of hanging ([#413]), clone children die with the server ([#422]) and the VCS binary is checked before a clone ([#423]), `heavy.sh` prunes by dead owner and bounds its waits ([#414]).
- The rules reference no longer loses `<Name>` in rule names (it was rendered as an HTML tag).

### Security
- The hosted Cockpit confines each signed-in user to their own directory by realpath, and answers another user's directory with the same refusal as an outside path ([#566]).

## [0.8.0] - 2026-09-23

The first tagged release. It is the 2026-09-20 baseline (below) plus everything shipped up to the
`stable-2026-09-23` freeze. Package versions are `0.8.0`; the Cockpit (`ui/`) is not versioned separately yet.

### Added
- Typed contracts: branded per-layer types and a `defineX` factory for every layer (`defineDomain`, `definePage`, `defineComponent`, `defineExpression`, `defineService`, `defineWorkflow`, `defineController`, `defineRoute`, `defineProvider`), `useTrackedState`, `PropRef`, feature-branded types. Structural prevention: a wrong import is a `tsc` error at the call site ([#501], [#502], [#503], [#504], [#510], [#511]).
- New rules: `EXPR-001..006`, `HOOK-001/002`, `PAGE-008/009`, `COMPONENT-005/006`, `DOMAIN-002` (allowlist purity, flag-gated), `SLICE-004`, `READ-004` (filename encodes layer), `PROP-LINK` (declared versus passed props) ([#505], [#506], [#508], [#509], [#512], [#473]).
- `construct refactor extract-expression`: hoist an inline conditional or loop out of a page or component into a named expression unit, deterministically, with an `--llm` fill option ([#517], [#522]).
- `construct --version` and a real single-file CLI bundle (`npm run build:cli`) ([#525]).
- `construct import` refuses to overwrite a file that already has real content ([#519]).
- Export the layer graph in `architecture.yml` to `eslint-plugin-boundaries` ([#513]).
- Cockpit Pages editor: Palette tab (providers, expressions, components; insert at cursor; "Wrap with..." via preview then approve), and click-to-bind in the Scope tab ([#527], [#532], [#533], [#534]).
- Cockpit: the target app's dev server as a managed process with a live status indicator, branch provenance and app-error cards ([#378]).
- Cockpit: per-project execution mode (`project.execution.mode: engine | cli`); in `cli` mode validate, summarize, doctor, review, create, refactor and import run the real CLI as a subprocess (`--format json`), each with an engine/CLI byte-identical parity contract test ([#541], [#560]). `create`, `refactor`, `import` and `doctor` gained a deterministic `--format json`.
- Live preview v2 spike: `previewFiber` resolves a click to its source file from React internals, on Next.js and Vite ([#443]).
- Docs: generated API reference per package with a JSDoc coverage ratchet ([#463], [#464], [#465], [#466], [#467], [#468]); versioned documentation site published to this repository's own GitHub Pages ([#397]); one copy-paste prompt that lets any model drive the CLI.
- Schemas: reserved free-form `ext` field on plan, process and envelope, with `migratePlan`/`migrateProcess` on the store read path ([#419]).

### Changed
- Repository layout is a workspace: `packages/{core,cli,ast,engine,docs-site,tools}` ([#481], [#482], [#483], [#484], [#486]). The Cockpit compiled build, Docker image and private package were added ([#485]).
- Cockpit: the screens rail stacks above the Browser pane in one collapsible column, and the Pages editor Browser pane is one collapsible group ([#537], [#539]).
- Docs: the User Guide is organised around the product family; brand marks are subtly animated ([#455]).

### Fixed
- `READ-001` strips a correct layer suffix before comparing to the export name; `EXPR-006`/`HOOK-001`/`HOOK-002` recognise the generic-argument factory call shape ([#516], [#521]).

- Every model call is bounded: `CONSTRUCT_LLM_TIMEOUT_SEC` (default 300) kills a hung `claude -p` and aborts a hung Ollama request with an error that names the timeout; every synchronous `git` call in core has a timeout; the Cockpit's command queue abandons a command at `CONSTRUCT_COMMAND_TIMEOUT_SEC` (default 900) instead of wedging behind it ([#413]).
- `tools/dev/heavy.sh` prunes `/tmp/construct-*` by owner liveness (pid in the name or a `.owner` file), never by age alone; its lock wait and RAM wait are bounded (`CONSTRUCT_HEAVY_LOCK_WAIT_SEC`, `CONSTRUCT_HEAVY_RAM_WAIT_SEC`), the RAM wait releases the lock between checks, and a waiter that gives up names the holder; `--prune-only`; tests under `tools/dev/test/` ([#414]).
- A clone never outlives the Cockpit server: live clone process groups are killed on exit and on SIGINT/SIGTERM/SIGHUP; a marker beside the destination lets the next start stop an orphaned `git`, remove the partial folder it left, and accept a retry ([#422]).
- Startup preflight: clone refuses a git older than 2.37.0 (the release that introduced `http.curloptResolve`, per git's release notes) or a missing git with `503 GIT_TOO_OLD`/`GIT_MISSING` instead of running with the DNS pin silently off; `/api/health` reports node and git versions, clone availability, writability and free space of the workspace and the state directory against `CONSTRUCT_HEALTH_MIN_FREE_MB`; process-record saves fsync, clean up their temp file on failure and name a full disk plainly ([#423]).

Known: a batch-order flake in one Pages-editor e2e spec ([#538]).

### Baseline (2026-09-20)

The first tracked baseline. It collects everything shipped since the project began.

#### CLI
- `construct create`, `refactor`, `research` groups over the flat commands; `IMPORT-001` build-order enforcement ([#25]).
- `construct import`, including `--plan` batches, optional `--llm` fill, and the guided `--route` wizard ([#26], [#27]).
- Adopt Construct in a subdirectory of an existing project with `--dir` ([#22]).
- `frozen:` globs for externally authored UI, with write refusal and the wrap-don't-duplicate rules ([#171]).
- `construct create service --openapi`: OpenAPI to RTK Query, no model ([#115], [#118]).
- `construct summarize`: structured, model-free summaries of any unit ([#235]).
- `construct research workflow`: state machines explained in plain English ([#203]).
- `construct research impact`: blast radius of a change, each entry marked derived or inferred ([#294]).
- `construct review <base> <head>`: PR health between two refs ([#344]).
- `construct template list|show|instantiate` for named plans, loaded from a folder you supply ([#353]).
- Per-step and total timing on generation and import commands ([#169]).
- Generators and refactor produce valid identifiers for hyphenated names ([#219], [#220]); a controller without its page is refused by name ([#280]).
- `--llm` fill hardened, with an Ollama provider and per-capability routing ([#107], [#179]).

#### Cockpit
- Run a generated QA test from the Cockpit as a process, with failures told apart by cause ([#389], issue #305).
- Confine the Cockpit to one workspace folder (`CONSTRUCT_WORKSPACE_ROOT`) and start with no project open ([#390], issue #365).
- Web UI over create, refactor, research and import, plus the import wizard chat (Module 5).
- Cockpit shell: light and dark themes, panes, top bar, tab host, Diagnostics and Logs drawer, command palette, narrow layout ([#246], [#253], [#256], [#257], [#258]).
- Pages editor: JSX tree, props inspector, prop-flow diagram, Monaco source view, external-change diff, scope and binding panel, live preview with click to source, click to navigate ([#105], [#228], [#231], [#233], [#237], [#345]).
- Flyde-style visual composer for the snippet editor ([#132]).
- Workflows: render real XState machines, edit states, transitions, context, actions and guards, plain-English panels ([#172], [#178], [#241]).
- Project gate with an allowlisted directory browser ([#239]).
- Processes drawer with list, detail, controls and live logs; approve or reject a bot's artifacts ([#343], [#347]).
- Plan mode: note, impact, plan review and edit, run ([#355]).
- Review mode: pull requests by feature and layer, findings, blast radius, cancellable analyses, keyboard navigation ([#350], [#357], [#363]).
- Files and Flow switch in the Browser pane ([#349]).
- Tests tab: scenario coverage, clone to edit a locked test, step document and edit panel, empty and stale states ([#356], [#361], [#364]).
- Commit on save with a deterministic, impact-counted message ([#327]).
- AI Toolkit: Ollama detection, model pull, model picker ([#108]).
- In-product Help with tutorials ([#168], [#170]); popovers close consistently ([#360]).
- Accessibility pass over every screen and theme ([#262]).

#### Core
- `src/ast/`: all parsing on typescript-estree, in one package ([#95], [#177]).
- Context envelope pipeline and zero-model generators ([#118]).
- Framework targets: `nextjs` and `react-spa`, with per-framework route adapters ([#342]).
- One exceptions module and one layer classifier ([#222]).
- Plan schema with ordered steps that reference real flows ([#293]).
- Process runtime model: lifecycle, per-step status, provenance log, artifacts, control ([#322]).
- Bot runner for the process engine ([#329]) and the approval gate for bot artifacts ([#340]).
- PR health engine ([#344]).
- Locked, per-scenario Playwright spec generation that emits `data-testid` and `data-flow-state` ([#352]).
- Rules: workflow dead-end and unreachable-state checks, `MODULE-001` on the AST, `DRY-001` thin-controller fix, tests-dir lint ([#339], [#354]).
- Workflow narrator: plain-English machine explanation, scenarios, health findings ([#203]).

#### Security
- The UI server restricts CORS and WebSocket origins; it was allow-all ([#143]).
- GitHub OAuth login: every API route and the WebSocket require a session, with an allowlist of logins ([#310]).
- Non-local binds are refused without login.

#### Docs and site
- Docs site on GitHub Pages: user guide and developer docs ([#201], [#226]).
- Site rebuilt problem-first, nine CLI, Cockpit and Core examples in place of tutorials and walkthroughs ([#362]).
- Demo guides and the Demo Style Guide ([#202]); `docs/` for the execution model, impact analysis, PR health, unit summaries and design ([#242], [#272]).
- Design module: concept mocks and specs ([#242], [#309], [#323], [#336], [#358], [#377]).
- Project board and resource-guard tooling (`tools/dev/heavy.sh`) ([#200], [#255]).

[#22]: https://github.com/thenewurbankid-web/construct/issues/22
[#25]: https://github.com/thenewurbankid-web/construct/issues/25
[#26]: https://github.com/thenewurbankid-web/construct/issues/26
[#27]: https://github.com/thenewurbankid-web/construct/issues/27
[#95]: https://github.com/thenewurbankid-web/construct/pull/95
[#105]: https://github.com/thenewurbankid-web/construct/pull/105
[#107]: https://github.com/thenewurbankid-web/construct/pull/107
[#108]: https://github.com/thenewurbankid-web/construct/pull/108
[#115]: https://github.com/thenewurbankid-web/construct/issues/115
[#118]: https://github.com/thenewurbankid-web/construct/pull/118
[#132]: https://github.com/thenewurbankid-web/construct/pull/132
[#143]: https://github.com/thenewurbankid-web/construct/pull/143
[#168]: https://github.com/thenewurbankid-web/construct/pull/168
[#169]: https://github.com/thenewurbankid-web/construct/pull/169
[#170]: https://github.com/thenewurbankid-web/construct/pull/170
[#171]: https://github.com/thenewurbankid-web/construct/pull/171
[#172]: https://github.com/thenewurbankid-web/construct/pull/172
[#177]: https://github.com/thenewurbankid-web/construct/pull/177
[#178]: https://github.com/thenewurbankid-web/construct/pull/178
[#179]: https://github.com/thenewurbankid-web/construct/pull/179
[#200]: https://github.com/thenewurbankid-web/construct/pull/200
[#201]: https://github.com/thenewurbankid-web/construct/pull/201
[#202]: https://github.com/thenewurbankid-web/construct/pull/202
[#203]: https://github.com/thenewurbankid-web/construct/pull/203
[#219]: https://github.com/thenewurbankid-web/construct/pull/219
[#220]: https://github.com/thenewurbankid-web/construct/pull/220
[#222]: https://github.com/thenewurbankid-web/construct/pull/222
[#226]: https://github.com/thenewurbankid-web/construct/pull/226
[#228]: https://github.com/thenewurbankid-web/construct/pull/228
[#231]: https://github.com/thenewurbankid-web/construct/pull/231
[#233]: https://github.com/thenewurbankid-web/construct/pull/233
[#235]: https://github.com/thenewurbankid-web/construct/pull/235
[#237]: https://github.com/thenewurbankid-web/construct/pull/237
[#239]: https://github.com/thenewurbankid-web/construct/pull/239
[#241]: https://github.com/thenewurbankid-web/construct/pull/241
[#242]: https://github.com/thenewurbankid-web/construct/pull/242
[#246]: https://github.com/thenewurbankid-web/construct/pull/246
[#253]: https://github.com/thenewurbankid-web/construct/pull/253
[#255]: https://github.com/thenewurbankid-web/construct/pull/255
[#256]: https://github.com/thenewurbankid-web/construct/pull/256
[#257]: https://github.com/thenewurbankid-web/construct/pull/257
[#258]: https://github.com/thenewurbankid-web/construct/pull/258
[#262]: https://github.com/thenewurbankid-web/construct/pull/262
[#272]: https://github.com/thenewurbankid-web/construct/pull/272
[#277]: https://github.com/thenewurbankid-web/construct/issues/277
[#280]: https://github.com/thenewurbankid-web/construct/pull/280
[#293]: https://github.com/thenewurbankid-web/construct/pull/293
[#294]: https://github.com/thenewurbankid-web/construct/pull/294
[#309]: https://github.com/thenewurbankid-web/construct/pull/309
[#310]: https://github.com/thenewurbankid-web/construct/pull/310
[#322]: https://github.com/thenewurbankid-web/construct/pull/322
[#323]: https://github.com/thenewurbankid-web/construct/pull/323
[#327]: https://github.com/thenewurbankid-web/construct/pull/327
[#329]: https://github.com/thenewurbankid-web/construct/pull/329
[#336]: https://github.com/thenewurbankid-web/construct/pull/336
[#339]: https://github.com/thenewurbankid-web/construct/pull/339
[#340]: https://github.com/thenewurbankid-web/construct/pull/340
[#342]: https://github.com/thenewurbankid-web/construct/pull/342
[#343]: https://github.com/thenewurbankid-web/construct/pull/343
[#344]: https://github.com/thenewurbankid-web/construct/pull/344
[#345]: https://github.com/thenewurbankid-web/construct/pull/345
[#347]: https://github.com/thenewurbankid-web/construct/pull/347
[#349]: https://github.com/thenewurbankid-web/construct/pull/349
[#350]: https://github.com/thenewurbankid-web/construct/pull/350
[#352]: https://github.com/thenewurbankid-web/construct/pull/352
[#353]: https://github.com/thenewurbankid-web/construct/pull/353
[#354]: https://github.com/thenewurbankid-web/construct/pull/354
[#355]: https://github.com/thenewurbankid-web/construct/pull/355
[#356]: https://github.com/thenewurbankid-web/construct/pull/356
[#357]: https://github.com/thenewurbankid-web/construct/pull/357
[#358]: https://github.com/thenewurbankid-web/construct/pull/358
[#360]: https://github.com/thenewurbankid-web/construct/pull/360
[#361]: https://github.com/thenewurbankid-web/construct/pull/361
[#362]: https://github.com/thenewurbankid-web/construct/pull/362
[#363]: https://github.com/thenewurbankid-web/construct/pull/363
[#364]: https://github.com/thenewurbankid-web/construct/pull/364
[#377]: https://github.com/thenewurbankid-web/construct/pull/377
[#389]: https://github.com/thenewurbankid-web/construct/pull/389
[#390]: https://github.com/thenewurbankid-web/construct/pull/390
[#413]: https://github.com/thenewurbankid-web/construct/issues/413
[#414]: https://github.com/thenewurbankid-web/construct/issues/414
[#422]: https://github.com/thenewurbankid-web/construct/issues/422
[#423]: https://github.com/thenewurbankid-web/construct/issues/423
[#378]: https://github.com/thenewurbankid-web/construct/issues/378
[#397]: https://github.com/thenewurbankid-web/construct/issues/397
[#419]: https://github.com/thenewurbankid-web/construct/issues/419
[#443]: https://github.com/thenewurbankid-web/construct/issues/443
[#455]: https://github.com/thenewurbankid-web/construct/issues/455
[#463]: https://github.com/thenewurbankid-web/construct/issues/463
[#464]: https://github.com/thenewurbankid-web/construct/issues/464
[#465]: https://github.com/thenewurbankid-web/construct/issues/465
[#466]: https://github.com/thenewurbankid-web/construct/issues/466
[#467]: https://github.com/thenewurbankid-web/construct/issues/467
[#468]: https://github.com/thenewurbankid-web/construct/issues/468
[#473]: https://github.com/thenewurbankid-web/construct/issues/473
[#481]: https://github.com/thenewurbankid-web/construct/issues/481
[#482]: https://github.com/thenewurbankid-web/construct/issues/482
[#483]: https://github.com/thenewurbankid-web/construct/issues/483
[#484]: https://github.com/thenewurbankid-web/construct/issues/484
[#485]: https://github.com/thenewurbankid-web/construct/issues/485
[#486]: https://github.com/thenewurbankid-web/construct/issues/486
[#495]: https://github.com/thenewurbankid-web/construct/issues/495
[#501]: https://github.com/thenewurbankid-web/construct/issues/501
[#502]: https://github.com/thenewurbankid-web/construct/issues/502
[#503]: https://github.com/thenewurbankid-web/construct/issues/503
[#504]: https://github.com/thenewurbankid-web/construct/issues/504
[#505]: https://github.com/thenewurbankid-web/construct/issues/505
[#506]: https://github.com/thenewurbankid-web/construct/issues/506
[#508]: https://github.com/thenewurbankid-web/construct/issues/508
[#509]: https://github.com/thenewurbankid-web/construct/issues/509
[#510]: https://github.com/thenewurbankid-web/construct/issues/510
[#511]: https://github.com/thenewurbankid-web/construct/issues/511
[#512]: https://github.com/thenewurbankid-web/construct/issues/512
[#513]: https://github.com/thenewurbankid-web/construct/issues/513
[#516]: https://github.com/thenewurbankid-web/construct/issues/516
[#517]: https://github.com/thenewurbankid-web/construct/issues/517
[#519]: https://github.com/thenewurbankid-web/construct/issues/519
[#521]: https://github.com/thenewurbankid-web/construct/issues/521
[#522]: https://github.com/thenewurbankid-web/construct/issues/522
[#525]: https://github.com/thenewurbankid-web/construct/issues/525
[#527]: https://github.com/thenewurbankid-web/construct/issues/527
[#532]: https://github.com/thenewurbankid-web/construct/issues/532
[#533]: https://github.com/thenewurbankid-web/construct/issues/533
[#534]: https://github.com/thenewurbankid-web/construct/issues/534
[#537]: https://github.com/thenewurbankid-web/construct/issues/537
[#538]: https://github.com/thenewurbankid-web/construct/issues/538
[#539]: https://github.com/thenewurbankid-web/construct/issues/539
[#541]: https://github.com/thenewurbankid-web/construct/issues/541
[#560]: https://github.com/thenewurbankid-web/construct/issues/560
[#569]: https://github.com/thenewurbankid-web/construct/issues/569
[#575]: https://github.com/thenewurbankid-web/construct/issues/575
[#579]: https://github.com/thenewurbankid-web/construct/issues/579
[#585]: https://github.com/thenewurbankid-web/construct/issues/585
[#243]: https://github.com/thenewurbankid-web/construct/issues/243
[#307]: https://github.com/thenewurbankid-web/construct/issues/307
[#330]: https://github.com/thenewurbankid-web/construct/issues/330
[#366]: https://github.com/thenewurbankid-web/construct/issues/366
[#368]: https://github.com/thenewurbankid-web/construct/issues/368
[#369]: https://github.com/thenewurbankid-web/construct/issues/369
[#370]: https://github.com/thenewurbankid-web/construct/issues/370
[#373]: https://github.com/thenewurbankid-web/construct/issues/373
[#391]: https://github.com/thenewurbankid-web/construct/issues/391
[#401]: https://github.com/thenewurbankid-web/construct/issues/401
[#406]: https://github.com/thenewurbankid-web/construct/issues/406
[#407]: https://github.com/thenewurbankid-web/construct/issues/407
[#421]: https://github.com/thenewurbankid-web/construct/issues/421
[#424]: https://github.com/thenewurbankid-web/construct/issues/424
[#429]: https://github.com/thenewurbankid-web/construct/issues/429
[#431]: https://github.com/thenewurbankid-web/construct/issues/431
[#434]: https://github.com/thenewurbankid-web/construct/issues/434
[#445]: https://github.com/thenewurbankid-web/construct/issues/445
[#456]: https://github.com/thenewurbankid-web/construct/issues/456
[#470]: https://github.com/thenewurbankid-web/construct/issues/470
[#491]: https://github.com/thenewurbankid-web/construct/issues/491
[#493]: https://github.com/thenewurbankid-web/construct/issues/493
[#497]: https://github.com/thenewurbankid-web/construct/issues/497
[#543]: https://github.com/thenewurbankid-web/construct/issues/543
[#546]: https://github.com/thenewurbankid-web/construct/issues/546
[#561]: https://github.com/thenewurbankid-web/construct/issues/561
[#562]: https://github.com/thenewurbankid-web/construct/issues/562
[#563]: https://github.com/thenewurbankid-web/construct/issues/563
[#564]: https://github.com/thenewurbankid-web/construct/issues/564
[#565]: https://github.com/thenewurbankid-web/construct/issues/565
[#566]: https://github.com/thenewurbankid-web/construct/issues/566
[#567]: https://github.com/thenewurbankid-web/construct/issues/567
[#568]: https://github.com/thenewurbankid-web/construct/issues/568
[#571]: https://github.com/thenewurbankid-web/construct/issues/571
[#572]: https://github.com/thenewurbankid-web/construct/issues/572
[#578]: https://github.com/thenewurbankid-web/construct/issues/578
[#580]: https://github.com/thenewurbankid-web/construct/issues/580
[#609]: https://github.com/thenewurbankid-web/construct/issues/609
[#611]: https://github.com/thenewurbankid-web/construct/issues/611
[#614]: https://github.com/thenewurbankid-web/construct/issues/614
[#638]: https://github.com/thenewurbankid-web/construct/issues/638
[#639]: https://github.com/thenewurbankid-web/construct/issues/639
[#644]: https://github.com/thenewurbankid-web/construct/issues/644
