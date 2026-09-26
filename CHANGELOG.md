# Changelog

All notable changes to Construct are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The version policy is
in [docs/VERSIONING.md](docs/VERSIONING.md). Numbers in brackets are pull
request or issue numbers.

## [Unreleased]

## [0.9.1] - 2026-09-26

A patch release: two fixes from the v0.10.0 line, backported onto 0.9.0. Package versions are `0.9.1`.

### Fixed
- A workflow unit is typed as what it is at runtime ([#658]): `defineWorkflow(name, fn)` returns a function, but `WorkflowUnit` was typed as a config object, so calling one was `TS2349`. The type is now the branded function (`WorkflowUnit<Fn>`, defaulting to the widest workflow function, so every `Forbid<>` slot and bare `WorkflowUnit` use is unchanged), and `defineWorkflow` keeps the exact machine `fn` returns; `fn` may return a real XState machine as well as a `{ id, initial, states }` config (new `WorkflowMachine` type). The runtime was not changed: the function shape already matched every caller, the existing test and the other units. The generated wizard's hook now runs `SignupWorkflow({})` instead of reaching past the unit for `signupMachine`, and the unit is `defineWorkflow('SignupWorkflow', () => signupMachine)` in place of a config rebuilt from the machine; `signupMachine` stays exported because `generate tests --unit` reads an exported machine. New `examples/workflow.ts`, compiled by `test/typed-contracts-tsc.test.mjs` (it fails with `TS2349` on the old types).
- `GET /api/validate` in `cli` execution mode goes through the per-login command queue and the concurrency cap like every other `cli`-mode verb ([#612]): a validate waits for an earlier command of the same login instead of overlapping a write to the project, counts against `CONSTRUCT_MAX_CONCURRENT_COMMANDS`, and an abandoned one answers 504 at the command deadline. `engine` mode is unchanged. Test: `ui/server/src/validateQueue.test.mjs`.

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
[#612]: https://github.com/thenewurbankid-web/construct/issues/612
[#658]: https://github.com/thenewurbankid-web/construct/issues/658
