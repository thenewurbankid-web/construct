# Information architecture: five screens, four slots

Status: concept (nothing here is implemented). Mocks: `mocks/ia-*.html`, PNGs `mocks/png/ia-*--{dark,light}.png`
(built by `node docs/design/mocks/build-ia.mjs`, styles in `mocks/ia.css`). Supersedes the Explore / Plan / Build /
Review **modes** of `cockpit-layout.md` (see "Reversal" below). Owner brief: 2026-09-20.

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
