# Information architecture: five screens, four slots

Status: concept (nothing here is implemented). Mocks: `mocks/ia-*.html`, PNGs `mocks/png/ia-*--{dark,light}.png`
(built by `node docs/design/mocks/build-ia.mjs`, styles in `mocks/ia.css`). Supersedes the Explore / Plan / Build /
Review **modes** of `cockpit-layout.md` (see "Reversal" below). Owner brief: 2026-09-20. Section 8 (POC parity) revises Pages and Components to be preview-first and adds the inline Generate control.

## 1. The shape

Primary screens (top navigation, `<nav aria-label="Screens">`): **Features, Pages, Components, Git, Tests**.
Every screen fills the same four slots; a slot is a registered list of tabs (id, title, badge, render), so a
screen is a set of slot fillers, not a hand-built layout (`ia-slot-matrix`).

| Slot | Role | Existing primitive |
|---|---|---|
| Left panel | Browse: pick the thing (tabs choose what is listed) | `ShellLayout` left pane, `TabHost` |
| Center stage | The thing itself: preview, diagram, diff, forms | `ShellLayout` mid |
| Right panel | Inspect and act; **verbs are tabs** (Plan, Findings, Source, Diff...) | `ShellLayout` right pane, `TabHost` |
| Bottom panel | Run: Processes, Approvals, Diagnostics, Logs, identical on every screen | `ShellLayout` drawer (renamed "bottom panel") |

Top bar, left to right: brand, project switcher, screen nav, command palette, running-processes pill, **profile
menu**. The local-model pill moves into the profile menu and the status bar (one status, two places, same
data). Modes are gone from the top bar.

The bottom panel is the "visible from every screen" home the owner asked for: Processes (running plans,
pause/cancel), Approvals (model output waiting for a human, today `ArtifactReview`), Diagnostics (validate),
Logs. Its tab badges and the top-bar pill mirror the counts, so approvals are never hidden behind a screen.

## 2. Profile menu (`ia-account-menu`)

GitHub avatar + login from `/auth/session`, a disclosure (not `role=menu`, per `popovers.md` and today's
`UserMenu`). Items: **Settings** (opens `/settings` in the stage: project directory, model choice; git and auto-commit settings live on the Git screen), **Local model**
(status chip, opens `/ollama` in the stage: install guidance, pull, picker), **Theme** (Dark / Light / System),
**Help and shortcuts** (`/help`, `?`), **Sign out** ("Ends this session only"). No new behaviour: it re-homes
`ScreensNav`'s Settings / Local Model / Help entries and `ThemeToggle`. At 390px it is a bottom sheet
(`ia-narrow`, third phone).

## 3. Capability map: existing capability -> new home

Audited from `ui/client/app/*` (routes), `ui/client/features/*` and `features/shell/domain/{Modes,Screens}.ts`.
Routes/URLs stay; only navigation and labels change first.

| Existing capability (route / feature) | New home: screen + slot | Note |
|---|---|---|
| Dashboard `/` (Create / Refactor forms, layer checkboxes) | Features, center stage: "New feature" and "Refactor" actions | `/` and `/dashboard` land on Features. The dashboard cards retire; forms are kept whole |
| Dashboard Research form (`ResearchForm`) | Features: left Notes, center note, right Plan | Merges with the Plan screen: "Research this note" is the same block as `/api/research` |
| Import wizard `/wizard` | Features, center stage ("Import a project") and reachable from the project switcher / Open a project | Not a screen of its own; wizard state machine unchanged |
| Plan `/plan` (note, impact, plan, run) | Features: Notes list (left), note + impact (center), **Plan** tab (right); **Run** = the Processes tab (bottom) | Was mode Plan / Build |
| Notes (title + text, `TicketPane`) | Features, left "Notes" tab + center note editor | Now durable (section 5) |
| Processes drawer (`processes/*`) | Bottom panel, Processes tab, every screen | Same component, renamed slot |
| Artifact approval (`ArtifactReview`) | Bottom panel, Approvals tab (opens the diff in the stage) | Model output never applies without this |
| Pages editor `/pages` (navigator, preview) | Pages: left (Pages, Flow tabs), center (live preview) | |
| Inspector, scope links, external-change notice, snippet diff | Pages: right tabs Inspector / Scope / Source / Diff | Same tabs as `pages-editor-in-shell` |
| Source view (`SourcePanel`, Monaco) | Right panel **Source** tab on Pages and Components | |
| Snippet flow canvas, auto-map | Pages: right Inspector / Scope tab (canvas can expand into the stage) | |
| Browser pane / flow tree (`flow-browser`) | Pages: left **Flow** tab (route -> controller -> hook...); Features: feature tree | Deterministic, from imports |
| Workflows `/workflows` (machines, narrative, edit) | Components: left **Workflows** tab, center diagram / narrative, right Flow tab | Open question 1 |
| Tests `/tests` (list, detail, step editor, clone, coverage, record) | Tests: left list / Coverage, center steps + result, right Edit step / Record / Freshness; runs in bottom Processes | `TestsController` unchanged |
| Review `/review` (list, change, findings, plan match, auto-fix, PR health, `BranchList`) | **Git**: left Changes / Branches / **PRs** / Commits, center change view + blast radius, right Findings / Detail / Plan match; fix proposals in bottom Approvals | Review stops being a mode; it is a verb inside Git (`ia-git`) |
| Git settings (`AutoCommitSettings`), commit-on-save, dirty-tree prompt (`git-session`), commit indicator | **Git**: right **Commit** tab (auto-commit on save, dirty-tree choice); stage prompt for a dirty tree; the status-bar commit indicator links to Git > Commits | Owner decision: git settings belong to Git, not the profile menu |
| Clone / connect a git repo (#330 slice A, being built) | **Git** stage "Connect remote" / "Clone a repository" when the project has no remote (`ia-git-connect`), and the no-project prompt (`ia-no-project`). Clones always land in the single workspace root | Only its position is designed here |
| Summarize (`/api/units/summary`, `/api/features/:name/summary`) | Features: center feature summary; one-line summary in the Inspector of Pages / Components | |
| Validate / rules (`/api/validate`, `DiagnosticsList`) | Bottom panel Diagnostics tab + status bar; rule ids inline in Inspector and Git findings | |
| Logs (`LogsList`, `/api/logs`) | Bottom panel Logs tab | |
| Local model `/ollama` | Profile menu > Local model | Status stays visible in the status bar |
| Settings `/settings` | Profile menu > Settings | |
| Help `/help` (tutorials, CLI reference) | Profile menu > Help and shortcuts; also palette | |
| Theme toggle | Profile menu > Theme | |
| Sign in / out (`auth`, `UserMenu`) | Login screen before the shell; sign out in the profile menu | |
| Project switcher, Open a project (`project-gate`, `ProjectSwitcher`) | Top bar switcher; no-project state in the stage (`ia-no-project`, built separately) | Not redesigned here |
| Command palette | Global, Ctrl K, gains "Go to Features / Pages / ..." | |
| `ScreensNav` ("Screens" tab in the browser pane) | **Retire** | Replaced by the top nav |
| `ProjectInfoPanel` | Features right panel, **Project** tab (shown when nothing is selected) | |
| Modes (Explore / Plan / Build / Review, `Modes.ts`) | **Retire as top-level**; become verbs (below) | Reversal, flagged for owner |
| `/states` showcase | Keep route, out of the nav | Used by `shared-states.spec.js` |

### Where the four modes go (a reversal of an earlier owner decision, #243 / #285)

| Was | Becomes |
|---|---|
| Explore | The default state of every screen: browse left, inspect right. Not a place, so no button |
| Plan | Features: right **Plan** tab (Note -> Impact -> Plan) |
| Build / Run | The **Run plan** button; work shows in the bottom Processes and Approvals tabs |
| Review | A verb inside the **Git** screen (Findings / Detail / Plan match beside the PR) |

This reverses the owner's choice of modes. The reasons to confirm it: the five screens already name what you
are working on (nouns), so a second axis of verbs on top made every screen live under two labels; verbs read
better as tabs inside the noun. Nothing is lost: each mode's content has a slot above.

## 4. No-project state (`ia-no-project`)

The workspace-scoped "Open a project" prompt is being built separately. The frame shows only its position:
center stage of the Features screen, screen nav dimmed (not removable: it keeps the shell stable), left and
right panels say why they are empty, bottom panel and profile menu stay usable (you can still sign out,
change theme or fix the model with no project). "Clone a repository" (#330 slice A, being built) sits beside "Open a project" here and as "Connect remote" on the Git screen when a project has no remote (`ia-git-connect`); clones land in the single workspace root.

## 5. Notes: durable drafts (`ia-features`, `ia-notes-states`)

Vocabulary (owner decision): the title and free text describing a change you want is a **Note**; the steps are
the **Plan**. Not a tracker ticket.

Today: the note and the unsaved plan live only in React state (`usePlanScreen`), so a reload loses them. Only a
plan that has been RUN becomes a record, in the per-user state dir keyed by project
(`src/engine/processStore.mjs`).

Proposal:
- **Where**: `<stateDir>/notes/<projectKey>/<noteId>.json`, next to `processes/`, using the same
  `resolveStateDir()` and `projectKey()` (so `CONSTRUCT_STATE_DIR` sandboxes it too). Outside the project, so
  it never appears in `git status`, is never walked by validate, never committed. The directory listing is
  the index (no index file), as in processStore.
- **Format**: `{ id, title, body, plan: Step[] | null, status: "draft" | "plan-ready" | "ran", rev, createdAt,
  updatedAt, processId | null }`. Written atomically (temp file + `rename`). Size cap 256 KiB per note.
- **Where the code lives**: `ui/server` (proprietary side) importing the two path helpers from core, one-way
  dependency; no change to the open-core boundary. Endpoints (proposed): `GET/POST /api/notes`,
  `GET/PUT/DELETE /api/notes/:id`.
- **Autosave**: 800 ms after the last keystroke, flushed on blur; the text is never blocked; indicator "Saving",
  "Saved on this machine 12:41" (polite live region).
- **Concurrency / stale**: optimistic `rev`. `PUT` sends `If-Match: <rev>`; a mismatch returns `409` with the
  current copy and the UI shows "This note changed in another tab" with Keep mine / Load theirs / Compare.
  Nothing is silently overwritten. A failed write (disk full) leaves the text in the page with Retry.
- **Plan freshness**: editing the text after a plan is proposed marks the plan "Out of date" (never silently
  regenerates; regeneration is a visible step, possibly a model step).
- **Run**: pressing Run copies note + plan into a process record and sets the note to `ran` with `processId`;
  it becomes read-only history ("Duplicate to iterate").
- **Privacy**: saving is a local file write. Nothing leaves the machine and no model is called to save, list or
  reload a note. A model reads a note only when a Plan step tagged **Local model** runs, which is already the
  provenance the Plan tab shows.
- **Hosted mode** (`run-hosted.sh`, GitHub login): key by login as well (`notes/<login>/<projectKey>/`) so
  users of one server do not see each other's notes. Slice 6 must decide this with the auth owner.

## 6. Accessibility and keyboard

- **Landmarks**: `banner` (top bar), `navigation` "Screens", `complementary` "Left panel: Browse" and "Right
  panel: Inspect", `main` = center stage, `region` "Bottom panel: Run". Slots use `role=tablist/tab/tabpanel` with
  arrow-key roving (existing `TabKeys`).
- **Focus order** = visual order: top bar (project, screens, palette, processes pill, profile) -> left -> stage
  -> right -> bottom. **F6 / Shift F6** cycle in that order (extend today's cycle to include the top bar and the
  bottom panel when open). Existing: Ctrl B left, Ctrl Alt B right, Ctrl J bottom, Ctrl K palette. Proposed: Alt
  1 to 5 for the five screens (Ctrl 1-5 is the browser's).
- **Screen nav** is links with `aria-current="page"` (as the modes are today), so the current screen is read
  aloud and it survives a reload.
- **Profile menu**: disclosure, focus moves in on open, Escape closes and returns to the trigger, no focus trap
  (`popovers.md`). Theme control is a radio group.
- **Contrast**: only tokens from `tokens.md`. The selected screen is shown by weight and underline, not colour
  alone. Draft / Plan ready / Ran and Deterministic / Local model / You are text labels plus colour.
- **Targets** >= 24 px; the five screen links are 44 px high. **Reduced motion**: spinners are static
  "Saving..." text.
- **Narrow (<900 px)**: one panel at a time from a bottom bar **Browse / Stage / Inspect / Run** (was Browser /
  Stage / Tools). The Run tab carries the process/approval count. At 390 px the five screen links do not fit at
  full length: they shrink to short labels (`Comp.`) with the full name as `aria-label`, and this is the point
  to re-check if a sixth screen is added (open question 1). The profile menu becomes a bottom sheet.
- Review checklist (`principles.md`) to be run per slice; the axe scan per screen and theme lands with slice 8.

## 7. Migration slicing (routes stay; labels first; no folder changes)

Rules for every slice: no rename/move of folders (readability is presentation only); all existing routes keep
working; the whole `ui/e2e` suite (~65 specs) is run at each slice; a spec that asserts a label being changed
is edited in the same slice with a stated reason. Sizes: XS <0.5d, S ~1d, M 2-3d, L ~1wk.

| # | Slice (implementation ticket, "Design: #N") | Size | Specs it touches (edit) | Must stay green |
|---|---|---|---|---|
| 1 | **Profile menu**: extend `UserMenu` with Settings / Local model / Theme / Help; keep old nav entries too (both work) | S | `auth.spec.js`, `popover-dismiss.spec.js`, `theme-switch.spec.js` (add a menu path) | `settings-llm`, `ollama*`, `help-*`, `form-controls-theming` |
| 2 | **Screen nav replaces mode nav**: labels Features / Pages / Components / Git / Tests, routes `/`, `/pages`, `/workflows`?, `/review`, `/tests` (Components target: see open question 1); `Modes.ts` -> `Screens` set; `activeOn` mapping | M | `shell-topbar.spec.js` (asserts the 4 mode labels), `shell-tabs.spec.js`, `plan-mode.spec.js`, `review-mode.spec.js`, `smoke`, `walkthrough`, `narrow-layout`, `demos/*` (navigation clicks) | `shell-layout`, `shell-topbar-density`, `a11y` |
| 3 | **Retire `ScreensNav`; move Settings/Local Model/Help/Theme/Sign out only to the profile menu** (Dashboard forms re-homed to Features) | S | `auth.spec.js`, `settings-llm`, `ollama.spec.js`, `ollama-model-picker`, `help-tutorials`, `help-collapsible-sections`, `dashboard-card-sizing`, `demos/setup-settings` | `smoke`, `walkthrough` |
| 4 | **Bottom panel = Run on every screen**: rename slot, add Approvals tab (from `ArtifactReview`), processes pill unchanged | M | `shell-drawer-palette`, `processes-drawer`, `processes-approval`, `review-processes` (label/role only) | `timing-display`, `pages-editor-external-change` |
| 5 | **Features screen**: left Notes / Features tabs, note in the stage, Plan as right tab, Run to bottom; `/plan` and `/dashboard` redirect or alias | L | `plan-mode.spec.js`, `demos/*` (research flow), `dashboard-card-sizing` | `processes-*`, `shell-*` |
| 6 | **Durable Notes**: `notesStore` + `/api/notes` + autosave + stale rule + Notes list (back end and UI) | M | new `notes.spec.js`, `plan-mode.spec.js` (reload keeps the note) | `plan-mode` |
| 7 | **Git screen**: Changes / Branches / PRs / Commits left, re-slot Review (Findings / Detail / Plan match) right, Commit tab (git settings, commit-on-save), fixes to Approvals, Connect remote empty state | M | `review-mode`, `review-findings`, `review-tree-keyboard`, `review-processes`, `commit-on-save` (git settings move to the Commit tab) | `processes-approval` |
| 8 | **Pages / Components / Tests re-slot + Workflows tab**: verify each fills the four slots via the tab registry (mostly done); add Project tab | M | `pages-editor-shell`, `pages-editor-layout`, `workflows-shell`, `workflows-layout`, `tests-tab`, `tests-states` | all `pages-editor-*`, `workflows*`, `tests-*` |
| 9 | **Keyboard and narrow pass**: F6 order incl. top bar and bottom, Alt 1-5, bottom bar Browse / Stage / Inspect / Run, axe per screen and theme | S | `narrow-layout`, `shell-layout`, `a11y`, `theme-switch` | whole suite |

Order rationale: 1-3 add and move navigation with both paths alive first; 4 gives approvals a global home
before 5 and 7 need it; 6 is independent of layout and can run in parallel with 4-5; 8-9 verify and harden.
Each UI slice also needs its own Playwright spec and screenshot on its issue (CLAUDE.md rule 11).

## Open questions for the owner

1. **The duplicated "components"** in the brief: I read it as a typo and guess **Workflows** (a Workflows screen
   exists today and has no other home). Design: Components screen with left tabs Components | Workflows.
   If you meant Workflows as its own sixth screen, promoting it is one registry entry plus a nav label (the
   390px nav is the only pressure). Recommendation: keep it inside Components.
2. **Confirm the reversal of the modes** (Explore / Plan / Build / Review become verbs inside screens, Review =
   a verb inside the Git screen). Recommendation: yes.
3. **Is the Dashboard retired?** Recommendation: yes; `/` lands on Features, Create / Refactor / Import become
   actions in its stage, and the dashboard cards go.
4. **Notes retention**: keep forever with manual delete, or expire? Recommendation: keep, never auto-delete
   (they are small); "Ran" notes stay as history.
5. **Bottom panel scope**: current project only, or all projects? Recommendation: current project with an "All
   projects" toggle, since processes are stored per project.
6. **Settings as a page or a dialog** from the profile menu? Recommendation: keep `/settings` and
   `/ollama` as full pages in the stage (they hold real forms), reached from the menu.

## 8. POC parity: a preview-first, IDE-like Cockpit

Owner (2026-09-20): "app experience close to the cockpit poc but with our features integrated for the better",
"like an IDE, easy to use, less clutter, and at each possible step an option to click and generate". Reference:
the owner's `cockpit` POC repo (read for experience only; no code or assets used). Mocks: `ia-pages`,
`ia-pages-next`, `ia-pages-change`, `ia-components`, `ia-generate-states`, `ia-preview-states`,
`ia-side-preview`. This section revises sections 1 and 3 for Pages and Components; the four slots do not change.

### 8.1 What changes

- **Pages and Components are preview-first.** The centre stage is the live app (or one component on its own). The
  left panel is the tree of what is on screen, the right panel is the inspector, and selection is shared: click in
  the preview, the tree row and the inspector follow, and the reverse.
- **On Features, Tests and Git the preview is an optional side view** (a "Preview beside" toggle in the stage, see
  `ia-side-preview`), not the default. Features anchors Notes to a node; Tests picks an element to fill a step
  target; Git shows the diff where it lands.
- **Quiet by default, detail on selection (IDE feel).** First-draft Pages screen: 6 overlay toggles, up to 4
  badges on every tree row, 6 always-open inspector sections, a legend. Revised: one "Overlays" menu (plus Pick), at
  most **one dot** on an unselected row (a finding or a change), chips only on the **selected** row, the inspector
  opens one section (Props) and shows the rest as one-line collapsed summaries ("Findings 2", "Tests 2 pass"),
  no legend (dots and chips carry text labels and tooltips). Rule for every future overlay: it may add a dot, never
  a chip, to an unselected row.
- **IDE conventions**: an editor **tab strip** above the stage (the preview is a pinned first tab; source files
  the user opens become tabs), a **breadcrumb** (Pages > /login > LoginForm), **Ctrl P** quick-open ("Go to file, node
  or route", the tree filter box is the same control), **Ctrl K** for commands (existing), F6 pane cycling
  (existing). The top-bar screen nav plays the role of the activity bar; we do not add a second icon rail.

### 8.2 Our capabilities plugged into the selection ("for the better")

Everything below is computed by an existing or planned deterministic block, shown only for the **selected** node or
file, and labelled by provenance (Deterministic, Local model, You).

| Selection shows | Where | Source today |
|---|---|---|
| Impact ("Change touches 3 features") | inspector "Impact" section, chip on the selected tree row, one-line card in the preview | `/api/units`, `src/engine/impact.mjs` |
| Flow arrows and workflow state | Components: "Flow" inset + State switcher; Pages: Overlays > Flow | workflows viewer, `workflowExtractor` |
| Tests and coverage | inspector "Tests"; Tests screen side view | Tests feature (`ui/server/src/testsApi.mjs`) |
| Git: changed vs main, who changed it | Overlays > Git (a dot on changed rows; blame in the inspector) | `ui/server/src/git.mjs` (blame is a gap) |
| Review findings pinned to nodes | a numbered pin on the node in the preview; "Findings" section | Review feature, `prHealth` |
| Rule violations inline | callout in the inspector, marker in Source | validate, `DiagnosticsList` |
| Notes anchored to a node | a pin on the node; "Notes" section; Notes list shows the anchor | needs Notes (#373) plus an anchor field |
| Plan from a selection | inspector **Change** tab (`ia-pages-change`) | see 8.3 |

### 8.3 Plan from a selection, with impact preview and per-artifact approval

Select a node, open **Change** (or press `C`), choose a verb (Move, Rename, Extract, Wrap in..., Delete), fill the
one argument. The panel lists the steps with provenance, the preview draws **dashed boxes on everything that will
change** (impact preview), and the artifacts appear in a per-file checklist. Nothing is written until the user
approves; the checked files become one approval in the bottom Approvals tab (`processes/ArtifactReview`). Move and
Rename map to `construct refactor move|rename`, which are LLM-free by definition.

### 8.4 POC capability -> our equivalent today -> gap

Our equivalents are read from `ui/client/features/pages-editor`, `ui/server/src`, `src/engine` and the merged
tickets (live preview #223, source view #233, scope links #223, workspace #365). "Not verified" means I did not
run it.

| POC capability | Our equivalent today | Gap |
|---|---|---|
| Live preview of the target app in a canvas, HMR | `LivePreviewPanel`: an iframe on a dev-server URL the user types; the app's own HMR; click bridge via `constructPreview()` (#223) | We do not start the server; no viewport presets; no isolated single-component view; centre of gravity is a side card today |
| Mixed DOM + component tree from React fibers | Source-derived tree (`/api/pages/tree`, `TreePanel`), flow tree (`flow-browser`) | Not a live-DOM tree. Keep source-derived (works without the server); add selection sync from the preview |
| Alt+Click in the preview jumps to source | Click bridge selects the element and opens its source (needs the plugin); `/api/nav/open` | Alt modifier and the explicit Pick toggle not verified; add both |
| Picker mode toggle | none as a separate mode (not verified) | Add Pick, needed once clicks should also follow links in the app |
| Bindings inspector, edit props | `InspectorPanel`, `PropRow`, `/api/pages/props` (edit) | Add/delete a prop with its usage-site binding in one action: not verified |
| Scope panel with colour-coded links | `ScopePanel`, `ScopeLinkGraph` (#223) | None; the links must also use text or shape, not colour alone |
| Monaco source editor with diagnostics | Read-only Monaco with validation markers (#233); snippet editor writes via a diff preview | Editable full-file Monaco with write-back through the diff |
| Type inference on props | none found (not verified) | Candidate deterministic block |
| Rename value, literal/variable toggle | `pages-editor-propflow-rename`, `-values` specs, snippet rewire/move/add-child/remove | Coverage is good; expose as verbs in Change |
| Expression wrapping (If, Loop, Switch) | none | Candidate mechanical block ("Wrap in...") |
| Create page / component / expression from the UI | Dashboard Create form (`/api/create` -> `construct create`), import wizard | "+" in the tree with a preview of the new file; expressions are POC-specific, not planned |
| Terminal panel | none, deliberately | We do not offer a free shell (it bypasses the blocks and their provenance). Dev server output goes to Logs in the bottom panel |
| Project picker | Open a project + workspace jail (#365) | None |
| Docs panel | Help (`/help`) in the profile menu | None |
| Feature / flow canvases | `flow-browser`, Workflows | Fold into Pages Flow tab and Components Flow overlay |
| URL-synced selection | routes only (not verified) | Deep link to a selection: candidate |

### 8.5 What needs the target app's dev server, and how it fits the workspace jail

**Needs the server running:** the rendered canvas, click/Alt+Click/Pick to source, live reload, the isolated
component view and the workflow State switcher (rendering a component alone needs a route in the target app that
mounts it; that is an extension of `constructPreview()`, not built). **Works from the files alone:** tree, impact,
findings, Notes, plan, Change, diff, test list, Generate, Source (`ia-preview-states` shows both lists).

How it fits the jail (#365): the Cockpit only serves and starts things **inside the workspace root, for the open
project**.
- The dev server is **a process in the bottom Run panel** ("dev server, storefront, running on :5173"), with
  Start, Restart, Stop and its output in Logs. It is stopped on Close project and Sign out.
- It starts only when the user presses **Start dev server**, after the exact command from the project's
  `package.json` (`scripts.dev`) has been shown once per project. Starting a dev server runs project code, so it is
  never automatic. A project outside the workspace root is refused with an explanation (`ia-preview-states`).
- It binds to 127.0.0.1 on a free port; the preview only loads that origin. "Use a URL instead" (attach to a server the
  user started) stays, restricted to localhost.
- **Not designed:** hosted mode (`run-hosted.sh`, remote browser). A remote user cannot reach a 127.0.0.1 dev server;
  it needs a same-origin proxy. Until decided, the preview is local-mode only and hosted mode shows the tree-only
  experience (open question 3).

### 8.6 The inline Generate control (`ia-generate-states`, headline: `ia-pages-next`)

A single reusable **slot component** so every step that can be produced looks and behaves the same: a small split
control `[ Mechanical | AI ][ Generate ]`, with a "Preview diff" link where a diff can be computed without running.
It appears in the inspector's "Suggested next steps" and next to any step of a plan; nowhere else, and only on the
selected item (quiet by default).

**Contract (props in, events out).** In: `actionId`, `label`, `mechanical` (block name and command, or `null`),
`ai` (allowed, model, or `null`), `willSend` (files, bytes, calls, computed before running), `target`. Out: `run`,
`cancel`, `chooseMode`. Result: an **artifact** handed to Approvals; the control never writes files itself.

**Guardrails (project Vision):**
1. **Mechanical is the default** and is labelled Deterministic, "0 model calls". A deterministic block that exists is
   always the first choice.
2. **AI is opt-in per action**, uses the configured local model, and *before running* states exactly what would be
   sent (which files, how many bytes) and how many model calls. Claude is not offered here (a separate Settings
   opt-in, open question 4).
3. **Output always lands as a reviewable diff/artifact** under the existing per-artifact approval; nothing applies
   silently.
4. **No block yet** is stated: where no deterministic block exists the control reads "AI only", and the row says
   "no block yet". Each such use is logged as a **request for a mechanical block** (backlog signal), never a silent
   fallback to a model.
5. Provenance uses the existing badges (Deterministic / Local model / You).

**States:** idle (mechanical), AI chosen (disclosure of what will be sent), running with **Cancel** (a process in the
Run panel), result (diff in Approvals), **refused: model offline** (nothing was sent; offers Use Mechanical instead
and Open Local model), disabled with the reason ("Select part of the page first"), AI only (no block yet).

**Remembered:** the Mechanical / AI choice is stored per user and per action kind ("fill a layer", "propose a fix"),
in the browser's local settings (as layout is today), default Mechanical, and reset to Mechanical when the model is
offline. Choosing AI is never sticky across a different action kind.

### 8.7 Where Generate appears, and what exists today (honest catalogue)

`--llm <provider>` (claude, ollama) is accepted today by **`create`, `generate` and `import`** only, and fills the file
bodies (one call per file, layer constraints included); which files exist is always decided deterministically.
Process steps tagged local-model (`botRunner`) also report provider and call count. `refactor` is LLM-free by
definition. Nothing else in `src/` takes `--llm`.

| Action | Mechanical block today | AI today | Verdict |
|---|---|---|---|
| Create feature / layer / component / page | `construct create feature|layer|<layer>` (template stubs) | `--llm` writes a body into each stub | Both; mechanical = stub |
| Fill a layer (real body) | none beyond the stub | `--llm` on create / generate / import | AI is the only way to get a real body: say so |
| Add the missing layer files | `construct create layer --layers`; `validate` finds what is missing | none | Exists (UI wiring needed) |
| Auto-map props | `/api/pages/automap` (deterministic, cross-file) | none | Exists; type inference is a gap |
| Add test ids | `assignTestIds` in `src/engine/testAttributes.mjs`, used by `testGenerator` and `pageTransformer` (at import time only) | none | Block exists as a library function; **not exposed** as a command or UI action |
| Generate tests for this route | `testGenerator` from the feature flow (`featureFlow`), Tests tab | none | Exists (UI wiring needed from Pages) |
| Suggest plan steps from a Note | deterministic impact and templates (`impact.mjs`, `planTemplate.mjs`) | free text to steps: none | No block for free text yet; mechanical candidate below |
| Write a commit message | `commitMessage.mjs` (deterministic serial, slug, subject) | none | Mechanical only; AI would only polish and is not offered |
| Summarise a diff | counts and health (`prHealth`, `unitSummary`) | no prose summary | Prose summary: no block yet |
| Propose a fix for a finding | `refactor move|rename` for layer-placement findings | none | Mostly no block yet, rule by rule |
| Rename / move from a selection | `construct refactor rename|move` (feature and layer scope) | none | Exists; UI needs selection-to-arguments |
| Extract to component | none (snippet add-child / move / remove exist) | none | **No block yet** |

**Candidate mechanical blocks (backlog candidates; not filed, verify before filing):**
1. *Expose add-test-ids*: `construct annotate tests <file>` over the existing `assignTestIds`, plus a UI action.
2. *Extract to component*: rule = selected JSX subtree becomes a new file in the feature's components layer, free
   identifiers become props, the original site is replaced by the usage, imports are fixed.
3. *Free-text Note to plan steps*: match nouns in the Note against feature, page and component names and seed the
   template steps for those units (no model); AI only rephrases.
4. *Templated diff summary*: one sentence per layer ("2 hooks changed, 1 service added") from `prHealth` data.
5. *Per-rule mechanical fixes*, starting with COMPONENT-002 (component imports a service): create the hook stub and
   rewrite the import.
6. *Prop type inference* from usage sites and default literals (the POC's type button).
7. *"Wrap in..." block* (conditional, loop) for JSX.
8. *Isolated component harness* route in `constructPreview()` (needed for the Components screen and State switcher).
9. *Add / delete a prop with its usage-site binding* as one block (verify what `/api/pages/props` already covers).

### 8.8 Keyboard additions

Ctrl P quick-open; `C` on a selection opens Change; `G` on a selection focuses its Suggested next steps; Pick
toggles with `P`; Alt+Click opens source; Escape leaves Pick or Change. All focusable, all listed under `?`. The
preview iframe is a landmark ("Live preview") with a skip link, and selection changes are announced ("Selected
LoginForm, 2 findings") in a polite live region. Overlay state is never colour-only (dot plus tooltip and text in
the inspector).

### 8.9 Re-cut of the migration slices

Slice 8 (#375) is split, and four slices are added. All still keep the existing e2e specs green; no folder changes.

| # | Slice | Size | Specs touched | Depends on |
|---|---|---|---|---|
| 8 (#375, re-scoped) | **Pages preview-first**: editor tabs, breadcrumb, Ctrl P, tree dots, collapsible inspector, Overlays menu, Pick | L | `pages-editor-shell`, `-layout`, `-live-preview`, `-click-navigate`, `-editing`, `-source-view`, `-scope-links`, `-flow-*`, `-autoscroll` | 2, 4 |
| 10 | **Live preview dev server as a process** (Start / Stop, states, workspace-scoped, Logs) | M | `pages-editor-live-preview`, `processes-drawer`; new `preview-devserver.spec.js` | 4, #365 |
| 11 | **Overlays on the selection** (impact, tests, git, findings, Notes pins) and the **Preview beside** side view on Features / Tests / Git | L | `pages-editor-*` (inspector sections), `tests-tab`, `review-findings` | 8, 6, 7 |
| 12 | **Components screen** (isolated component view, State switcher, Flow inset) incl. the harness route | M | `workflows-shell`, `workflows-layout`, `workflows-narrative` | 8, 10 |
| 13 | **Change from a selection** (Move, Rename, Extract, Wrap in; impact preview; per-file approval) | L | `pages-editor-propflow-rename`, `processes-approval`, `review-processes` | 4, 8 |
| 14 | **Inline Generate control** (component, contract, remembered choice, "what will be sent", first wired actions: missing layers, auto-map, tests for this route) | M | `plan-mode`, `pages-editor-automap-crossfile`, `tests-tab`; new `generate.spec.js` | 4 |

Order: 8 and 10 can run in parallel after 4; 14 is independent of the preview and can start after 4; 11, 12, 13
follow.

### 8.10 Open questions for this revision (max 4)

1. **Who starts the dev server?** The Cockpit starts `scripts.dev` (after showing the exact command once per project)
   or it only attaches to a URL the user started. Recommendation: Cockpit starts it with that one-time confirmation;
   URL attach stays.
2. **One extra line in the target app.** The isolated component view and State switcher need the preview plugin to
   serve a component route. Click-to-source already requires `constructPreview()`; extending that same plugin is one
   more capability, not another edit. Recommendation: yes, and say so in the "Click-to-source is off" card.
3. **Hosted mode.** Recommendation: preview is local-mode only for now; hosted shows the tree-only experience until a
   same-origin proxy is designed.
4. **AI provider in Generate.** Recommendation: the configured local model only; Claude needs a separate explicit
   opt-in in Settings, and the choice is remembered per browser, per action kind.

## 9. Story: a feature-level story.md (mocks `ia-story`, `ia-story-states`, `ia-story-modes`, `ia-story-indicators`, `ia-story-consent`, `ia-clip-bridge`, `ia-clipper`)

**Idea.** A feature can carry a **story**: the ticket that asked for it, kept next to the feature and compared
mechanically with what the code, scenarios and tests do. No new folder and no new layer: one file,
`features/<name>/story.md`, with layer notes as `## headings` inside it. If `validate` objects to a `.md` at the
feature root, declare `nonLayer: features/*/story.md` (#348 precedent); verify before building. The Story is the
"why", the Note is a draft of a change, the Plan is the "how"; they link but stay separate.

### 9.1 Activation and the three modes

**Activation.** Everything story-dependent (indicator, compare, `@story` coverage, Generate-from-story) exists **only
when a `story.md` exists for the feature**. Without one there is a single quiet **Add a story** action, which
creates `story.md` from a template as a normal diff. Three modes, all valid (`ia-story-modes`):

| Mode | File has | What runs | Model calls |
|---|---|---|---|
| a. Link + parse pattern | `url` + `parse` selectors | fetch, apply selectors, fingerprint | 0 |
| b. Direct content | the story text, no `url` | nothing fetched; indicator compares story vs code only (no freshness check) | 0 |
| c. Link without a pattern (**public pages the server can fetch itself only**) | `url` only | page text fetched, the configured AI extracts fields | see 9.6 |

### 9.2 File shape: user-owned vs tool-owned

```
---
sources:                                   # USER-OWNED: you write it, or the picker proposes it as a diff
  - url: https://acme.atlassian.net/browse/STORE-142
    parse: { title: { xpath: "//h1[@data-testid='issue.title']" },     # {css} | {xpath}; a plain string is CSS
             description: 'div.description', acceptance: 'ul.acceptance > li',
             status: { css: 'span.status' } }                                 # optionally a url pattern
---
<!-- construct:tool-begin fetchedAt=2026-09-20T12:02:00Z sourceHash=<sha256 of picked fields> blockHash=<sha256 of this block> -->
# Refund a delivered order                 # TOOL-OWNED snapshot (title, description, status)
- S1 Refund button shows only on delivered orders
<!-- construct:tool-end -->

## Acceptance notes                        # USER-OWNED: your edits, layer notes as ## headings
```
The **template lives in the file** (selectors are user text: hand-editable, versioned, shareable with the team).
Acceptance ids `S1..Sn` are assigned once and never renumbered. **Auto-save only ever rewrites the block between the
markers**, never user text.

### 9.3 One call: `StoryApi.fetch(url)` and a strategy per link

The screen makes one client-side call, `StoryApi.fetch(url)`, backed by `POST /api/story/fetch`; the service picks a
strategy automatically and every screen and indicator looks the same either way, plus a small "via" label
(`ia-clip-bridge`, `ia-story-indicators`):
1. **Public page -> server**: SSRF-guarded fetch and HTML parse (9.6). Default.
2. **Login-only page -> your browser (userscript bridge)**, recommended (9.7).
3. **Server-side headless browser with a stored login profile per host: optional, later, owner decision, not
   recommended for v1.** Honest costs: the server would hold live Jira or GitHub session cookies at rest (a credential;
   the blast radius is everything that login can read); SSO and MFA cannot be completed headlessly, so it needs an
   interactive remote-login window; Chromium is heavy; remote page scripts would execute on the server (sandbox and
   SSRF concerns); scraping terms may forbid it. The strategy slot, a per-host opt-in and the indicator
   (`via: server browser`) are reserved; nothing is built.

### 9.4 Freshness, auto-save and git

- **Checked every time the story is needed** (not a time threshold): each use does a cheap fetch, computes a
  **fingerprint** (hash of the picked fields, plus etag / updated-at when the source offers it) and compares it with
  `sourceHash`. The file is **rewritten only if it changed**. It is **single-flight with a short debounce**: "every
  time it is needed", never per keystroke or per render.
- **Auto-saves** one `story.md` per feature; there is no manual save.
- **Git position (reasoned):** `story.md` is the tool's own record, so the tool block auto-saves and does **not** go
  through the per-artifact Approvals tab (that gate is for changes to product code and model output). Every rewrite is
  still an ordinary file change, so it follows the existing commit modes (auto-commit on by default; dirty-tree asks),
  appears as a normal diff/commit, and is announced in the indicator: "ticket changed, snapshot updated, view diff".
  A refreshed snapshot is **never pushed** automatically.
- **Offline or connector missing:** use the snapshot and say so ("using snapshot from 12:02").
- **Conflict:** if the tool block was edited by hand (its hash differs from `blockHash`), refresh pauses and asks:
  keep mine / use the ticket. Hand edits are never overwritten silently.

### 9.5 Compare (mechanical first)

Acceptance ids and keywords against scenarios, routes, machine states and tests, as three lists: **Missing from the
code**, **In the code, not in the story**, **Matched**. Tests may carry `@story S2`, so the Tests screen shows
acceptance coverage. Rows can offer the inline Generate control (8.6). AI compare is optional behind the Mechanical |
AI toggle; it may only cite acceptance lines and code units, and every citation is verified mechanically before it is
shown. A hash of the generated summary drives "may be out of date / mark reviewed".

### 9.6 Security

**Server fetch of a user-supplied URL (SSRF)**, the hosted server is internet-facing: https only; host allowlist
(`github.com`; Atlassian only if configured); resolve DNS first and refuse private, loopback, link-local and metadata
addresses (v4 and v6, including 169.254.169.254), re-checked after redirects; at most 3 redirects, each hop
re-validated; 1 MB and 10 s caps; no cookies, no `Authorization`, `GET` only; **no JavaScript executed**; the result is
untrusted text (escaped, control characters stripped, never rendered as HTML, no link followed).

**A story file is not a permission.** A `story.md` that arrives in a cloned or foreign repository can name any URL and
so make the user's browser read a logged-in page. Therefore the **first use of any (host, url) from a file needs an
explicit in-Cockpit consent** (`ia-story-consent`): "This story wants to read <url> from <host> using your browser
login: allow once / always for this host / deny", with an extra warning when the file did not originate here.
Approvals are listed and revocable. **Selectors are data**: length cap (200), plain query-selector syntax only, no
`javascript:` or script pseudo-forms, rejected with an explanation otherwise.

**AI extraction (mode c)**, honest and safer:
- **Preferred: AI proposes the parse pattern once.** The model sees a stripped copy of the page text once (scripts,
  styles and attributes removed, 64 KB cap), proposes selectors, and the user reviews them as a **diff in the front
  matter**. After approval every refresh is mechanical with **zero model calls**.
- **If the user chooses extraction on every use**, the control (8.6) shows exactly what is sent (sanitised text, size,
  number of model calls) and requires the AI toggle and consent. A **mechanical verification** step then requires
  every extracted field to be **quoted text found in the fetched page text**; anything not present is rejected or
  flagged, so extraction cannot invent content. The result is a reviewable diff to the tool-owned block.
- **The AI never sees a whole logged-in page.** There is **no whole-page mode through the userscript bridge**:
  login-only pages are always read with an explicit parse pattern, fields only. For a login-only page with no
  pattern the UI offers **Pick fields** (click to pick) or **AI proposes a pattern**. For the latter the bridge sends
  back only a **structure-only skeleton** (tag, `id`, `class`, `data-testid` tree; text truncated to 40 characters; no
  attribute values, `href`, form values or scripts; at most 32 KB), and the user sees the exact skeleton before it is
  sent. Chosen over a "candidate-text outline" because that would carry real ticket text to the model; a skeleton is
  enough to propose selectors. The proposal comes back as a diff to the front matter (see above).

### 9.6b Selectors: CSS and XPath

`parse` values are data: a plain string is CSS; `{css: "..."}` and `{xpath: "..."}` are explicit. **Validation (both):**
length cap 200; CSS evaluated only through `querySelectorAll`; XPath only through `document.evaluate` (in the browser)
or an XPath 1.0 engine over a parsed HTML tree (on the server), as a **node-set path only**: no `document()`,
`id()`-style functions that reach outside the tree, no `javascript:` or script forms, no attribute value used as a URL;
anything else is rejected with a plain explanation (`ia-story-consent`). **Multiple matches:** for single-value fields
(title, status, description) **more than one match is an error** ("matches 3, make it more specific", shown in the
picker with the count and a preview); zero matches is the "did not match: re-pick" state; the list field
(`acceptance`) takes **all matches in document order**. **The picker** emits the most stable form: `data-testid` or `id`
first, then a short CSS path or XPath, never positional indexes (`nth-child`, `[3]`), and shows the match count and a
text preview before proposing the diff.
- **Server-side XPath (public pages):** parse the HTML, then evaluate XPath 1.0. Candidate stack, licences checked on
  the npm registry on 2026-09-20: `parse5` (MIT) or `linkedom` (ISC) for the HTML tree, `xpath` (MIT) for evaluation,
  `css-select` (BSD-2-Clause) for CSS; `jsdom` (MIT) is a heavier fallback. Needs a small spike to confirm the
  `xpath` package works over the chosen DOM; nothing is installed by this design.
- **In the userscript:** native `document.evaluate` and `querySelectorAll`, no libraries.

### 9.7 The userscript bridge and the picker (`ia-clip-bridge`, `ia-clipper`)

"Think like Greasemonkey." The user is logged in in **their own browser**. One userscript (Tampermonkey or
Violentmonkey, `construct-clipper.user.js`; bookmarklets are blocked by GitHub and Jira CSP; a tiny extension can follow)
does two things:
- **Bridge.** It also `@match`es the Cockpit origin. The Cockpit page sends a request (`window.postMessage` or a
  `CustomEvent` with a handshake nonce; the script checks `event.source === window` and the nonce) containing the URL
  and the `parse` selectors read from `story.md`. The script uses `GM_xmlhttpRequest` (with the user's own cookies) to
  fetch that page, applies the selectors, and posts back **only the picked fields** as structured JSON. The Cockpit
  saves them through its own authenticated call (session cookie, foreign-Origin refusal, size caps), as untrusted text.
  **No credential, cookie or token ever reaches the server; no cross-site POST or clip token is needed.**
- **Picker.** On a ticket page the user clicks elements to pick key, title, description, acceptance criteria, status
  (outlined and labelled), showing the match count and a preview. It **proposes selectors as a diff to `story.md`**, which the user approves in the Cockpit;
  selectors can also be typed by hand. Deterministic, no AI.

**Bounds** (this lets a web page make the user's browser read logged-in pages, so it is deliberately narrow): the
script serves only a host **the user approved once for this Cockpit origin** ("Allow this Cockpit to read tickets from
acme.atlassian.net", revocable) **and** a URL the Cockpit has already consented to (9.6); returns only the picked
fields, never the page; rate-limits (10 reads per minute); never returns page text beyond the picked fields (and, on request, the structure-only skeleton above); is configured for one Cockpit origin and validates it; keeps a
user-visible **activity log** in the userscript menu. **Threat: XSS in the Cockpit page.** It could ask the script for
tickets; per-host approval, per-URL consent, fields-only responses, rate limit and the log bound the damage to
already-approved tickets, and no credential is exposed.

**Honest limits.** Needs a userscript manager installed and the Cockpit tab open. Otherwise the last snapshot is used
and the indicator says so. Public GitHub issues need no clipper. Manual paste remains only as a last resort.

### 9.8 Indicator states (`ia-story-indicators`)

One quiet mark on the feature (tree row and Story tab header), text plus a dot, plus a "via: server / your browser"
label, identical whichever strategy served it: **In sync (3/5 matched)**, **Ticket changed upstream, snapshot updated
(view diff)**, **Story stale vs code (mark reviewed)**, **Checking**, **Using snapshot from 12:02** (offline, clipper off
or AI unavailable), **Approve host**, **Template did not match: re-pick**, **Snapshot edited by hand: refresh paused**,
**No story yet: Add a story**, **Direct content (story vs code only)**, **Login-only, no pattern yet (Pick fields / AI proposes a pattern)**, and (later)
the server-browser variant.

### 9.9 What needs the owner

- **Hosting `construct-clipper.user.js`**: served by the Cockpit (always matches the server) or published from a repo or
  the site (a stable install URL); an **update channel** (`@updateURL`/`@downloadURL`) and who signs off releases.
- Whether Atlassian hosts are ever allowlisted for server fetch (rare; most Jira is private).
- Whether the optional server-browser strategy is ever wanted (9.3): a security and cost decision.
- A tiny browser extension later (store accounts and review).

### 9.10 Slices (revised; sizes and specs)

| # | Slice | Size | Specs touched / new |
|---|---|---|---|
| 15 (#383) | **story.md format and mechanical block**: parse, tool block writer (markers, `sourceHash`, `blockHash`), ids S1..Sn, three-list compare, drift hash, `@story` reader | M | unit tests; `nonLayer` check |
| 16 (#384) | **`StoryApi.fetch` + `POST /api/story/fetch`**: strategy selection, public-page strategy (all SSRF rules), consent store per (host, url), selector validation | M | server tests per refusal; new `story-fetch.spec.js` |
| 17 (#385) | **Story tab and indicators**: Add a story, front matter view, auto-save with commit-mode behaviour, every-use freshness (single-flight), all states of `ia-story-indicators`, Keep out of git | L | `plan-mode`, `shell-tabs`, `commit-on-save`; new `story-tab.spec.js` |
| 18 (#386) | **Userscript bridge + picker** (nonce handshake, per-host approval, fields-only, rate limit, activity log, selectors written to story.md as a diff) | L | new `story-bridge.spec.js` against a fixture ticket page |
| 19 (#387) | **AI proposes the pattern once (from the skeleton for login-only pages); verified per-use extraction for public pages (mode c)**; CSS and XPath support and validation | M | new `story-ai-extract.spec.js` |
| 20 (#388) | **AI compare with verified citations, `@story` coverage on the Tests screen** | S | `tests-tab`, `tests-states` |

The clip-token endpoint of the first draft is dropped: the bridge needs no token. Order: 15, then 16 and 18 in
parallel, then 17, then 19 and 20.
