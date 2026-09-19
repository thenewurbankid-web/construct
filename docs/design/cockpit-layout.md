# Cockpit layout: the 3-pane shell

Status: concept (nothing here is implemented). Mocks: `mocks/*.html`, PNGs in
`mocks/png/` (each in `--dark` and `--light`). Layout idea credit: the owner's
prototype repo `thenewurbankid-web/cockpit` (read for layout only; no code or
assets used).

## The idea, and what we improve

The owner's layout: **browser on the left, live preview in the middle, tools on
the right.** It maps directly onto how Construct works: pick a thing (left), see
it (middle), understand and change it (right). We keep that exactly and add what
a production, multi-feature tool needs:

| Need | Addition |
|---|---|
| Many features, not one editor | Top bar: project switcher, **mode switch (Explore / Research / Build)**, command palette, global process + model status |
| Right panel does too many things at once | **Contextual tabs**: Inspector / Scope / Source / Diff (badge) / Flow; only relevant tabs enabled |
| Long-running work is invisible | **Bottom drawer**: Diagnostics / Logs / Processes, plus a top-bar "2 running" pill |
| Fixed pane widths | **Resizable + collapsible panes** (drag or arrow keys, Ctrl+B / Ctrl+Alt+B collapse), sizes remembered per project |
| Old sidebar nav (Dashboard, Wizard, Pages, Workflows, Local model, Settings, Help) | Those become modes/screens reached from the command palette and a compact menu; the left pane becomes the project **Browser** |
| Only the happy path | Designed empty / loading / error / model-offline states |
| Desktop only | **Narrow layout**: one pane at a time with a bottom tab bar |
| Dark only | Dark and light at parity (tokens.md) |

Shell anatomy (all sizes are defaults):

```
+--------------------------------------------------------------------------+
| top bar 44: brand | project switcher | Explore Research Build | Ctrl K ... |
+----------+------------------------------------------+-------------------+
| Browser  |  canvas toolbar (crumbs, viewport, pick)  | tabs: Inspector.. |
| 264      |  Preview / diagram / research impact      | 360               |
| tabs:    |  (the "stage")                            | contextual panel  |
| Features |                                          |                   |
| Pages    |                                          |                   |
| Workflows|                                          |                   |
+----------+------------------------------------------+-------------------+
| drawer (collapsible, 96-290): Diagnostics | Logs | Processes             |
+--------------------------------------------------------------------------+
| status bar 24: validate result, sync state, model, shortcuts             |
+--------------------------------------------------------------------------+
```

Modes change what the three panes hold, not the frame:
**Explore** = browser / preview / inspector tabs (today's Pages Editor and Workflows);
**Research** = request / impact / plan; **Build** = browser / preview / diff,
with the drawer on Processes.

Breakpoints: >= 1280 all three panes; 900-1279 right pane becomes an overlay
tab strip on the canvas; < 900 one pane at a time with a bottom tab bar
(Browser / Preview / Tools / Processes). Resizers are focusable separators.

## Per-screen rationale

Every screen: what changed versus today, and why.

### 1. `cockpit-shell` (default, Explore mode)
- **Today**: a 200px left nav of page links; each page is its own layout
  (Pages Editor already has a 3-column grid at `1fr 1fr 1.2fr`, but the
  columns are page-specific, not a shared shell).
- **Change**: the shared frame above; selection in the Browser drives the
  preview and the tabs; clicking an element in the preview (existing
  Alt+Click / pick mode) selects it and opens Inspector on it. Layer chips
  (page / component / workflow) reuse Construct vocabulary. Diagnostics drawer
  shows `construct validate` results in plain language with the rule id.
- **Why**: one mental model across features; the owner's proven layout;
  stakeholders always see the same frame.

### 2. `pages-editor-in-shell`
- **Today**: separate panels for tree, source, preview, scope links,
  external-change notice, snippet diff.
- **Change**: those become tabs of the right panel (Source, Scope, Diff with a
  badge when something changed on disk) instead of stacked sections; the
  external-change notice is a callout at the top of Diff with Accept / Keep
  mine; the preview shows "Changed on disk" and reloads. Selection follows the
  source cursor.
- **Why**: one thing at a time, less scrolling, review is a clear
  "look at the diff, decide" step; the preview stays visible throughout.

### 3. `workflows-in-shell`
- **Today**: Workflows page with browser, machine canvas, edit panel,
  narrative.
- **Change**: Browser tab "Workflows" lists machines; the stage is the machine
  diagram (Diagram / Narrative toggle); the right **Flow** tab shows the
  selected state in plain language, its context and actions/guards.
- **Why**: same frame as Pages; narrative for stakeholders one click from the
  diagram; editing is in context ("Edit transitions"), not a permanent toolbar.

### 4. `research-mode` (roadmap: research -> plan -> execute)
- **Today**: a Research form on the Dashboard.
- **Change**: left = the ticket and constraints (from `architecture.yml`);
  middle = **impact** (features and files touched, with layer and why, computed
  deterministically; shared-component warnings); right = the **plan**: ordered
  steps each tagged Deterministic / Local model / You, estimated time, and
  "Run plan in Build mode".
- **Why**: makes the product flow visible and reviewable before anything runs,
  and shows exactly where a model is involved (Vision: blocks first).

### 5. `processes-drawer` (roadmap: Processes section)
- **Change**: drawer opens to Processes: the running plan's steps with status
  and progress, Pause / Cancel, a live log with provenance (`ok`, `llm`,
  `warn`); the right panel's Diff tab collects the files the plan changed and
  waits for approval. Top-bar pill mirrors the count; clicking it opens the
  drawer.
- **Why**: managed, visible, interruptible work; approval gate for model output.

### 6. `command-palette`
- **Change**: Ctrl K palette searches files/components/pages and runs commands
  (Research this ticket, switch mode, toggle drawer). Footer states every
  command is a Construct block, the same as the CLI.
- **Why**: keyboard-first navigation; replaces the old nav and scales as
  features grow.

### 7. `states-and-narrow`
- Empty (no project, nothing selected), loading (preview starting, analysing),
  error (preview failed with a fix action, model offline with "deterministic
  steps still work"), and the 390px one-pane layout with a bottom tab bar.
- **Why**: today these are mostly blank or raw text; production needs a next
  action in every state.

## Implementation plan (ordered, independently shippable)

Each step keeps the app working and all existing e2e specs green (run the whole
`ui/e2e` suite; the specs named are the ones most likely to break and must be
re-verified explicitly). Sizes: XS <0.5d, S ~1d, M 2-3d, L ~1wk.
Existing routes stay valid until the last step.

| # | Sub-issue | Size | Keeps green (existing specs) |
|---|---|---|---|
| 1 | **Tokens: add semantic set + aliases + light theme block + theme switch** (no visual change in dark) | S | `form-controls-theming`, `dashboard-card-sizing`, `smoke`, `walkthrough` |
| 2 | **Pane primitives**: `ShellLayout` with resizable/collapsible panes and slots (props: `left`, `mid`, `right`, `drawer`), keyboard resizers, persisted sizes; storybook-style isolated test | M | `pages-editor-layout`, `workflows-layout` |
| 3 | **Top bar**: project switcher, mode switch (routes to existing screens for now), status pills (model status from existing Ollama state), theme toggle; replaces left NavBar; palette trigger inert | M | `smoke`, `walkthrough`, `help-tutorials`, `help-collapsible-sections`, `settings-llm`, `ollama`, `ollama-model-picker`; keep NavBar link accessible names reachable or update specs with a reason |
| 4 | **Right-panel tab host** (slot registry: id, title, badge, render) and move Inspector / Scope / Source / Diff into it | M | `pages-editor-editing`, `-scope-links`, `-source-view`, `-snippet-diff`, `-external-change`, `-spread-props`, `-propflow-*` |
| 5 | **Pages editor inside the shell** (Browser left, LivePreview middle, tab host right; selection sync) | L | all `pages-editor-*` incl. `-live-preview`, `-autoscroll`, `-automap-crossfile`, `-flow-*` |
| 6 | **Workflows inside the shell** (machine canvas as stage, Flow tab) | M | `workflows`, `workflows-editing`, `workflows-layout`, `workflows-narrative` |
| 7 | **Bottom drawer** with Diagnostics (from validate) and Logs | M | `pages-editor-external-change`, `timing-display` |
| 8 | **Command palette** (Ctrl K; navigation + mode/drawer commands; block registry hook for later) | M | `smoke`, `walkthrough` |
| 9 | **States and narrow layout**: shared Empty/Loading/Error components, model-offline banner, < 900px one-pane + tab bar | M | `wizard-concurrent`, `wizard-blank-answer`, `ollama`, `settings-llm` |
| 10 | **Migrate remaining screens** (Dashboard, Import Wizard, Settings, Local model, Help) into the shell as modes/pages; retire `NavBar` and `.glass-panel` on shell surfaces | L | `dashboard-card-sizing`, `wizard-*`, `settings-llm`, `ollama*`, `help-*`, `walkthrough`, `demos/*` |
| 11 | **Accessibility pass**: axe scan per screen and theme in Playwright, focus ring, landmarks, tab semantics, reduced motion | S | whole suite |
| 12 | **Processes UI**: process store + drawer tab + top-bar pill (depends on the Processes backend epic) | L | new specs; none existing |
| 13 | **Research mode screen** (request / impact / plan; depends on the research-mode epic) | L | Dashboard research flow specs in `demos/` |

Order rationale: 1-2 are invisible foundations; 3-6 move existing features
without changing behaviour; 7-9 add shell capabilities; 10 completes the
migration; 11 hardens; 12-13 wait on backend epics and can be built against the
mocks in parallel by another stream once 2-4 exist. Each UI step also needs its
own Playwright spec plus screenshot on its issue (CLAUDE.md rule 11).

## Open questions for the owner
- Mode names (Explore / Research / Build) and whether Explore should be
  called "Inspect".
- Is the project switcher local folders only, or also remote repos later?
- Should the drawer default open or closed on first run (mocks show open with
  content; empty state is closed)?
- Layout persistence scope: per project or global.
