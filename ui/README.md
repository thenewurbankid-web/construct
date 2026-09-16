# Construct Web UI

A local, click-through web UI over Construct's four capabilities
(create / refactor / research / import), plus a chat-style interface for
the `import --route` guided wizard. This is additive: nothing in `src/` or
`bin/` behaves differently than before, and the core CLI/REPL/tests are
untouched except for one new, thin, additive export in `src/cli.mjs`
(`runImportRouteWizardEventDriven` — see the comment above it).

## Layout

```
ui/
  server/   Node.js backend (Express + ws). Imports src/cli.mjs (etc.)
            directly — no subprocess, no shelling out to the `construct`
            binary. Own package.json/node_modules, independent of the
            core project's dependencies.
  client/   React frontend (Vite). Dashboard (create/refactor/research/
            import forms), Settings (LLM provider + project directory),
            the Import Wizard (chat), and Help (CLI + UI docs). Own
            package.json/node_modules.
  e2e/      Playwright end-to-end tests that drive both of the above in a
            real browser (not curl, not just a build check). Own
            package.json/node_modules, kept separate from client/ since it
            tests the app rather than being part of it.
```

## Why a backend at all (not just calling the CLI from the browser)

The backend is what actually calls Construct's real, exported functions
(`create`, `refactor`, `research`, `importCommand` from `src/cli.mjs`) in
the same process/module graph as this repo — same code, same behavior as
running `construct <command>` from a terminal, just invoked as a function
call instead of a subprocess. The one exception is the import wizard: it's
inherently a multi-turn conversation (a prompt, wait for an answer, another
prompt, …), so it's exposed over a WebSocket instead of a single REST call.

## Install

From this `ui/` directory (each side has its own `package.json`):

```bash
cd ui/server && npm install
cd ui/client && npm install
```

## Run (two terminals)

```bash
# Terminal 1 — backend, default port 4000
cd ui/server
npm start
# or: npm run dev   (restarts on file changes)

# Terminal 2 — frontend, default port 5173
cd ui/client
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api/*` and
`/ws/*` to `http://localhost:4000` (see `ui/client/vite.config.js`) — no
CORS configuration needed in normal dev use. Override the backend's
address with `CONSTRUCT_UI_API=http://host:port npm run dev` if it runs
somewhere else. The backend's own port is configurable via `PORT` (e.g.
`PORT=4001 npm start`).

## Storybook

`ui/client` has Storybook configured (`ui/client/.storybook/main.js` +
`preview.js`, framework `@storybook/react-vite`, reusing the same
Vite/React setup as the real app) so components can be developed and
visually reviewed in isolation, one story per component. `preview.js`
imports the app's real `src/styles.css`, so every story renders against
the actual black/grey glassmorphism theme tokens (see "Theme" below), not
an unstyled default canvas.

```bash
cd ui/client
npm run storybook          # dev server, default port 6006
npm run build-storybook    # static build to ui/client/storybook-static/
```

Every component in `ui/client/src/components/ui/` (see "Theme and
reusable components" below) has a co-located `<Name>.stories.jsx`. Kept
deliberately minimal: only `@storybook/addon-docs` beyond the framework
itself — the addons `storybook init` offers by default
(`@storybook/addon-vitest`'s browser-mode Vitest+Playwright integration,
`@storybook/addon-a11y`, `@chromatic-com/storybook`, `@storybook/addon-mcp`)
were left out as unnecessary scope; this repo's real regression guard for
the rendered app is the separate Playwright suite in `ui/e2e` (see below),
and duplicating that stack behind a Storybook addon would add dependencies
without adding coverage.

## Theme

`ui/client/src/styles.css`'s `:root` defines the whole visual language
(black/grey glassmorphism) as CSS custom properties — a near-black `--bg`
with two faint radial glow tokens, translucent
`--panel-glass`/`--panel-glass-strong` fills with `--panel-blur` via
`backdrop-filter`, `--border`/`--border-strong`, and `--text`/`--muted`
(`--accent`/`--tool`/`--llm`/`--error` are unchanged from before — they
carry meaning, not just decoration, and already read fine against the
darker glass backdrop). The shared `.glass-panel` class documents the
background/border/blur recipe once; every panel-like surface across
Dashboard/Settings/Wizard/Help/ProjectGate consumes the same tokens.

## Reusable UI components

`ui/client/src/components/ui/` holds the themed, reusable functional
components every page builds its forms/panels out of, instead of each
page hand-rolling its own `<button>`/`<select>`/`<div className="...">`
markup:

- **Button** — every button in the app (`variant="primary"`, the default;
  `variant="ghost"` exists as a themed lower-emphasis option, not yet used
  by any page).
- **GlassPanel** — the `.glass-panel` surface as a component. Takes an
  `as` prop for the rendered tag (`form`, `nav`, `div`, …) and a
  `className` that's *appended* rather than replaced, since several call
  sites still need their own layout class alongside the shared glass
  treatment (e.g. `<GlassPanel as="form" className="command-form">` — the
  exact class ui/e2e's Playwright suite locates the Create form by).
- **Field** — the label/hint wrapper around a form control.
- **Input** / **Select** — thin, themed passthroughs to real
  `<input>`/`<select>` elements (deliberately trivial: Playwright's
  `getByPlaceholder`, native `<select>` interaction, etc. all keep working
  unchanged since the underlying DOM node is untouched).
- **Badge** — the tool/llm/llm-none/error status label, generalized out of
  what `AttributionBadge` used to hand-roll per `<span>` (also now used by
  `AttributionBadge` itself, and by the prose in the Help page).

Every one of these has a Storybook story (see above) rendered on the real
theme. Refactoring existing pages onto them was a pure extraction — no
class names Playwright/ui/e2e depends on changed, and the full e2e suite
was re-run after the refactor to confirm no regression (see "What was
verified" below).

## End-to-end tests (Playwright)

`ui/e2e/` drives the real, rendered app in an actual browser (Chromium) —
navigating pages, clicking buttons, filling forms, and asserting on what's
actually painted (including computed CSS visibility, not just DOM
presence). This is the one layer of verification the two dev-server
sections above don't cover: `npm run build` only checks the code compiles,
and `curl` against `/api/*` only checks the backend, neither of which ever
loads a page.

Install (one-time):

```bash
cd ui/e2e
npm install
npx playwright install chromium   # downloads the Chromium browser binary
```

Run:

```bash
cd ui/e2e
npm test           # headless — starts both dev servers automatically, runs all tests, tears them down after
npm run test:headed   # same, but with a visible browser window
npm run test:smoke    # just the trivial "does the harness even work" smoke test
```

You do **not** need to start `ui/server`/`ui/client` yourself first —
`ui/e2e/playwright.config.js`'s `webServer` option starts `npm start` in
`ui/server` and `npm run dev` in `ui/client` before the first test and
stops them after the run (or reuses them if they're already running on
:4000/:5173, e.g. during local debugging with `npm run test:headed`).

`tests/smoke.spec.js` is a minimal "did the harness even work" check
(loads `/`, asserts the Dashboard or ProjectGate heading renders, no
console/page errors). `tests/walkthrough.spec.js` is the fuller pass: it
points the backend at a fresh empty temp directory, walks through the
ProjectGate → init → Dashboard (create a feature, check the tool/LLM
attribution badges render with a non-zero, visible computed style, not
just present in the DOM) → Settings (LLM provider dropdown, project
directory field) → Import Wizard (starts a session and answers several
real questions, deliberately with a seed route that fails fast at local
route-resolution so the pass never needs to shell out to the `claude`
CLI) → Help (waits for `/api/help` to actually resolve and populate real
content) flow, taking one screenshot per step into `ui/e2e/screenshots/`.

Both dev servers' console/page errors are captured live during every test
(`page.on('console', ...)`/`page.on('pageerror', ...)`) and printed at the
end of the run if any showed up, rather than being silently ignored.

## Using it

1. **Pick your project once.** On load, the app fetches project status
   (`GET /api/settings`) once at the top level (`App.jsx`) and every
   Dashboard/Wizard route is gated on it: if the selected project directory
   doesn't resolve to a Construct project (`valid: false` / `needsInit:
   true`), those pages show a "No Construct project here yet" screen with an
   **Initialize Construct here** button (calls `POST /api/init`, i.e. the
   real `construct init`) instead of rendering their forms — see
   `ui/client/src/components/ProjectGate.jsx`. Settings and Help stay
   reachable either way, since Settings is how you fix it.
2. **Settings** — set the LLM provider (sourced live from `src/llm.mjs`'s
   `PROVIDERS` map — currently just `claude`) and the project directory
   every command targets (passed as `--dir` to the underlying functions,
   exactly like the CLI's `--dir`). Saving refreshes the app-wide project
   status the gate above reads, so switching to (or initializing) a valid
   project immediately unblocks Dashboard/Wizard without a reload. Nothing
   is persisted to disk; restarting the backend resets to its defaults
   (project directory defaults to wherever the backend process was started
   from).
3. **Dashboard** — forms for `create` (feature / vertical slice / single
   layer), `refactor` (move / rename), `research` (summarize / doctor), and
   a non-interactive `import` (single unit or an approved plan file). Each
   result panel shows the command's deterministic output, and — separately
   — the `[tool: ...] [llm: ...]` attribution line every one of these
   commands ends with in the CLI (`printAttribution` in `src/cli.mjs`), so
   it's never collapsed into a generic success toast.
4. **Import Wizard** — the guided, whole-route import as a chat. Optionally
   seed it with a route, click "Start wizard session", and answer its
   questions as they arrive. Progress lines stream in as their own chat
   bubbles the instant they happen (not batched at the end); its one LLM
   call (route analysis) is shown as a distinct attribution bubble, same
   split as everywhere else. Only one wizard session may run at a time per
   backend process (see "Limitations" below).
5. **Help** — documents both the CLI and this UI: a getting-started
   tutorial, an explanation of the tool/LLM attribution badges, a guide to
   every screen, and a full CLI reference. The CLI reference section is
   fetched from `GET /api/help` (new, read-only), which returns text
   imported directly from `src/usage.mjs` and `src/repl.mjs`'s
   `HELP_TOPICS`/`TOPIC_ORDER`/`getTopLevelHelpText()` — the same strings
   `construct` and `construct repl`'s `help` actually print — rather than a
   hand-copied duplicate that could drift from the real CLI. (`src/usage.mjs`
   is a new, tiny module: the usage banner literally extracted out of
   `bin/construct.mjs`'s top-level `USAGE` constant unchanged, so it can be
   imported without also importing — and re-running — the bin script's own
   argv-dispatch logic.)

## Endpoints (for reference)

REST (`ui/server/src/index.mjs`), all `POST` except settings' `GET`:

- `GET /api/help` — `{ usage, topLevelHelp, topics: string[], helpTopics: Record<string,string> }`,
  all sourced live from `src/usage.mjs` and `src/repl.mjs` (read-only, no side effects)
- `GET|POST /api/settings` — `{ projectDir?, llmProvider? }` in (POST only; GET takes
  nothing); both return `{ projectDir, llmProvider, availableProviders,
  resolvedProjectRoot, valid, needsInit }`. `resolvedProjectRoot` is
  `findProjectRoot(projectDir)` (src/config.mjs) — the exact upward search
  `getRoot` in src/cli.mjs uses to resolve every command's root, so `valid`
  here means exactly what it means when a command actually runs (a
  subdirectory of an existing project counts; an arbitrary directory with no
  `architecture.yml` above it doesn't). `needsInit` is `!valid`.
- `POST /api/init` — no body; runs `init` (from `src/cli.mjs`, same as
  `construct init`) against the *currently selected* project directory.
  Responds `{ ok, output, attribution, error?, ...settings-shape above }` —
  same envelope as the command endpoints below, plus the refreshed
  project-status fields so the frontend can update in one round trip.
- `POST /api/create` — `{ kind: 'feature'|'layer'|'single', name, feature?, layer?, layers? }`
- `POST /api/refactor` — `{ action: 'move'|'rename', name, newName?, feature, from?, to?, layer? }`
- `POST /api/research` — `{ action: 'summarize'|'doctor', feature?, format?, since? }`
- `POST /api/import` — `{ mode: 'unit'|'plan', name?, feature?, layers?, from?, planPath?, llm? }`

Every command endpoint responds `{ ok, output: string[], attribution: {tool, llm} | null, error? }`.

WebSocket: `/ws/wizard` —
`{ type: 'start', seedRoute? }` / `{ type: 'answer', text }` from the
client; `{ type: 'log'|'question'|'done', text?, kind? }` from the server.

## What was verified

- `npm test` in the repo root: 245/245 passing, both before and after
  these changes.
- `ui/client`: `npm run build` (Vite production build) completes with no
  errors; `npm run dev` starts cleanly and serves the app.
- `ui/server`: starts cleanly; `POST /api/settings`, `POST /api/research`
  (`doctor`), `POST /api/create` (feature + vertical slice), and
  `POST /api/refactor` (move) were exercised end-to-end against a scratch
  Construct project with `curl`, confirming both the HTTP response and the
  actual files written/moved on disk, with correct tool/llm attribution.
- The Import Wizard's WebSocket flow was driven end-to-end with a scripted
  client through a full session — including a real call to the installed
  `claude` CLI for the route-analysis step — against a scratch Next.js
  route fixture, confirming files were scaffolded with TODO(import)
  breadcrumbs and the attribution line correctly reported "1 call(s) to
  analyze the route" alongside "0 calls to write the logic".

## Known limitations / follow-ups

- **No auth.** This is a local dev tool wrapping filesystem-mutating
  commands; it's assumed to run on localhost for one trusted user. Add
  auth before exposing it beyond that.
- **Actual browser rendering** is now covered by `ui/e2e/` (Playwright,
  see "End-to-end tests" above) — it drives a real Chromium instance
  through the ProjectGate, Dashboard (including a real create action and
  its attribution badges), Settings, Import Wizard, and Help screens, and
  captures a screenshot of each. Earlier passes had only checked that the
  dev server starts without errors and the production build has no
  build/type errors, without ever loading a page.
- **One wizard session at a time per backend process.** The event-driven
  wizard adapter (`runImportRouteWizardEventDriven` in `src/cli.mjs`)
  patches `console.log`/`warn`/`error` for the duration of a run, which is
  process-global — a second concurrent session would interleave the first
  one's captured output. The backend rejects a second `start` while one is
  already active. Fine for a single local user; would need per-session log
  capture (not global monkey-patching) to support real concurrency.
- **Settings aren't persisted** — by design, to keep this additive and
  simple; restarting the backend resets the project directory/LLM provider
  to their defaults. Would be easy to add a small JSON file if wanted.
- **The wizard's project directory is applied via `process.chdir()`** at
  session start (it has no `--dir` flag of its own, unlike every other
  command in `src/cli.mjs`), which is also process-global. Combined with
  the one-session-at-a-time constraint above, this is safe today but worth
  keeping in mind if this ever grows into a multi-project, multi-session
  tool.
