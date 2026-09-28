# Rules and Envelopes composers (#395)

Status: concept (nothing here is implemented). Part of epic #395 "Compose and modify architecture
rules and envelopes from the Cockpit." Mocks: `mocks/ia-rules.html` (read-only list/detail), `mocks/
ia-rules-edit.html` (a rule edited as a pending diff), `mocks/ia-envelopes.html` (envelope/flow
composer), `mocks/ia-rules-states.html` (empty/loading/error, illustrative cards), `mocks/
ia-rules-narrow.html` (390px, Browse/Stage/Inspect), built by `node docs/design/mocks/build-rules.mjs`,
styles reused from `ia.css` (no new stylesheet needed). PNGs in `mocks/png/ia-rules*--{dark,light}.png`,
`mocks/png/ia-envelopes--{dark,light}.png`. This extends the five-screen shell (`ia-five-screens.md`,
#367) rather than adding a sixth screen.

## 0. Read before drawing: what a "rule" and an "envelope" already are

- **`architecture.yml`** (`packages/core/config.mjs`) is one file per project: `version`, `preset`,
  `project.framework` (`nextjs` default, or `react-spa` — `FRAMEWORKS` in `config.mjs`), `features.root`,
  `rules` (rule id -> `off | warning | error`, defaulted from `DEFAULT_RULES` in `config.mjs`, e.g.
  `'ROUTE-001': { severity: 'error', name: 'Routes delegate to controllers' }`, `'PAGE-004': {
  severity: 'error', name: 'Pages cannot call fetch' }`, `'COMPONENT-002': { severity: 'error', name:
  'Components cannot import controllers' }`), `exceptions` (`packages/core/exceptions.mjs`: `{ path:
  <glob>, rule: <id> | rules: [<id>...], expires?: <ISO date>, reason?: <string> }`, expired ones stop
  suppressing and are themselves flagged by `EXCEPTION-EXPIRED`), `frozen` (`packages/core/frozen.mjs`:
  globs that are read-only — "wrap via a controller instead of forking"), `nonLayer` (globs excluded
  from layer classification, e.g. `features/*/story.md` per `ia-five-screens.md` section 9).
- **"Route adapters"** (named in the epic) is `project.framework`: the only thing that differs per
  target framework is where the route layer's entry physically lives — Next.js App Router uses one
  `page.tsx` per route folder (`ROUTE-001`/`ROUTE-002` enforce "imports a controller and nothing
  else"); `react-spa` centralizes routing in one `src/App.tsx` matching a different pattern
  (`REACT_SPA_LAYERS` in `config.mjs`). There is no separate "adapters" list to edit — there is one
  picker (the framework) that changes which pattern the `route` layer enforces, shown read-only
  alongside it so a person can see the consequence before switching.
- **`construct validate`** already computes violations per rule per file (`diagnostics.mjs`'s
  `makeViolation`) and already surfaces in the bottom Diagnostics tab and status bar
  (`ia-five-screens.md` section 3: "Validate / rules -> Bottom panel Diagnostics tab + status bar; rule
  ids inline in Inspector and Git findings"). The Rules composer does not reinvent this: it reuses the
  same `/api/validate` call, scoped by rule, to show "this rule fires on N files today" and, on a
  pending change, "this makes M files newly violate `<rule>`" (the epic's stated impact-preview
  example, "this makes 14 files newly violate PAGE-004").
- **Envelopes** (`schemas/envelope.v1.json`, `packages/engine/{envelope,pipeline}.mjs`) are the state
  handed between `construct pipeline run` steps: `{ version: 1, feature, status: pending|committed|
  aborted, layers: {layer: [paths]}, steps: [{layer, name}], unboundSlots, events, diagnostics, ext }`.
  A **flow** (the epic's "reusable named flow") is an ordered `steps` list plus, per step, the
  arguments `construct pipeline run` needs beyond `{layer, name}` today (the schema's `steps` shape is
  deliberately minimal — a flow with named args is a Cockpit-level convenience over it, not a schema
  change; see open question 1). The engine that actually runs a step stays in `packages/engine/
  pipeline.mjs` (open-source, unchanged); the composer only produces and stores the ordered step list
  that gets handed to it, same separation the epic states ("envelope engine stays in core").
- **Existing reviewable-diff precedent**, read and reused rather than reinvented: the Git screen's
  Changes tab (`git-panel.md`) stages one whole file at a time and shows its diff via `DiffView.tsx`;
  the Pages "Change from a selection" flow (`ia-five-screens.md` 8.3, `ia-pages-change.html`) computes
  steps, draws dashed impact boxes on everything that will change, and lists artifacts in a per-file
  checklist that becomes one Approvals entry. Both composers below follow that same shape: **edit ->
  computed diff -> impact preview -> per-artifact approval**, never a direct write.

## 1. Placement decision

**"Rules" and "Envelopes" are two new left-panel tabs on the Features screen** (`Notes | Features |
Rules | Envelopes`), each filling the same center-stage/right-panel/bottom-panel slots the Features
screen already uses — not a profile-menu Settings page, and not a sixth top-level screen.

**Rationale.** `architecture.yml` and a saved flow are project-wide config, so the instinct is
Settings; but Settings (`ia-five-screens.md` section 2) is deliberately reserved for *environment* —
project directory, model choice, account — things you set once and rarely revisit, rendered as plain
forms with no diff or impact preview. Rules and envelopes are the opposite: they are edited in the same
rhythm as building a feature (a rule change is itself a reviewable diff with a violation-count impact,
exactly like a plan step; a flow is literally what a plan's steps become when saved for reuse), they
need the same three-slot shape Git and Pages already use for "browse the things, inspect the selected
one, see its diff" (a plain form cannot show "N files affected" or a step-by-step envelope preview),
and they need the same bottom-panel Diagnostics/Approvals wiring every other change-producing screen
already has. Keeping them as tabs inside Features (rather than a sixth screen) costs one registry entry
each, matches the "a screen is a set of slot fillers" principle (`ia-five-screens.md` section 1), and
needs no folder-structure change, per the epic's own constraint.

## 2. Rules composer

Mock: `ia-rules.html` (read-only), `ia-rules-edit.html` (editing).

### 2.1 Left panel: Rules tab

A flat, filterable list, one row per rule id (`ROUTE-001`, `PAGE-004`, ...), grouped by layer prefix
(Route / Page / Component / Workflow / Service / Domain / Slice / Module / Readability), each row
showing: id, one-line name (from `DEFAULT_RULES[id].name`, the same plain string the CLI already
prints), a severity chip (`error` / `warning` / `off`, colour plus text, never colour alone), and a
violation-count badge computed from the last `construct validate` run (`0` in a calm neutral chip,
`N` in a warn/danger chip matching severity). A "Preset" line above the list names the active preset
(`strict-nextjs`) with a "Change preset" action that opens a confirmation showing how many rules and
current severities would change (itself a diff, not a silent bulk apply). A search box filters by id
or name; a toggle "Errors and warnings only" hides `off` rules by default (progressive disclosure).

### 2.2 Center stage: rule detail

Selecting a rule shows: its id and name as a heading; the **"why"**, one to three sentences of plain
language pulled from the rule's own detection intent (e.g. PAGE-004: "A page component may not call
`fetch()` directly. Keeps data-fetching out of pages so a page stays swappable without touching how
data is loaded — call a service through a controller instead."); a **severity control**
(`Error / Warning / Off` segmented control, not a bare dropdown, so the current state and the choices
are both always visible); the **violation list**, one row per currently-violating file (path, line,
the rule's own message from `diagnostics.mjs`, and a link that opens the file in Source) with a link to
"View in Diagnostics" (reuses the bottom panel's existing Diagnostics tab rather than duplicating a
second violations view); and, below it, an **exceptions** section scoped to this rule (see 2.3).
Nothing here writes until Save (2.5).

### 2.3 Exceptions, nonLayer, frozen

- **Exceptions** are edited from two places that write the same underlying list: inline on a rule's
  detail (2.2, pre-scoped to that rule) and a dedicated "All exceptions" view (a right-panel tab) that
  lists every entry across all rules — needed because one exception can name multiple rules
  (`rules: [...]`) and a rule-scoped view alone would hide that. Each row: path glob, rule(s) as chips,
  an optional expiry date picker (calendar control, not free text, so an invalid date is impossible to
  enter — `isValidExpiry` in `exceptions.mjs` is the source of truth the server still re-checks), an
  optional reason field, and a live "matches N files today" count computed by re-running the glob
  against the tree (deterministic, no validate call needed for the match count itself). An expired
  exception is shown struck through with "Expired <date> — no longer suppresses `EXCEPTION-EXPIRED`"
  and a one-click "Remove" or "Extend."
- **nonLayer** and **frozen** are two more glob lists, each its own right-panel tab reachable from the
  Rules left-panel header ("Advanced" disclosure, closed by default — these are rarely touched):
  nonLayer explained as "files inside a feature folder that are not classified into any layer" (the
  `story.md` precedent from `ia-five-screens.md` 9 is shown as a worked example), frozen explained as
  "files Construct will refuse to write to — wrap them via a controller instead of forking" (the exact
  language `frozen.mjs`'s own error message uses, reused rather than re-worded, per principles.md #6).
  Each glob row shows a live "matches N files" count and, for frozen, which of those files are
  currently imported anywhere (so removing a freeze is never a surprise).

### 2.4 Features root and route adapters (project settings, same screen)

A small "Project" section at the top of the Rules tab (not buried in Settings, since it changes what
the rules below mean): **Features root** (`features.root`, a single path field, default `features`,
with a live count of how many existing feature folders would move under a change — shown as a warning,
since changing this is a structural move the composer does not perform, only flags: "Changing this
does not move files; update it only if the folder already matches") and **Route adapter**
(`project.framework`, a two-option picker `Next.js App Router | React SPA (single App.tsx)`, each
option showing the resulting `route` layer pattern read-only underneath it, e.g. `app/<route>/page.tsx`
vs `src/App.tsx`, so the consequence is visible before switching, not discovered afterward).

### 2.5 Change safety: every rules edit is a diff

No control in 2.2-2.4 writes `architecture.yml` immediately. Every change (severity, an exception
added/edited/removed, a nonLayer/frozen glob, features.root, the framework picker, a preset switch)
accumulates in a **pending changes** panel (right panel, "Diff" tab): a plain-language changelog line
per edit ("PAGE-004: Error -> Warning", "+ exception: `features/legacy/**` exempts COMPONENT-002 until
2026-12-01") plus the literal YAML diff underneath (progressive disclosure — plain language first, YAML
one click away, per principles.md #6-7). Above the diff, an **impact preview** line per changed rule:
"This makes 14 files newly violate PAGE-004" (new errors, computed by re-running validate against the
pending config in a buffer, never against disk) or "Clears 3 existing PAGE-004 violations" for a
loosened rule, in the same danger/warn/success chip language the rest of the Cockpit already uses.
**Save** runs `construct validate` against the pending config as a dry run, shows the same impact
numbers one more time next to the button, and only then writes `architecture.yml` as one commit-ready
diff through the existing per-artifact Approvals flow (bottom panel) — identical mechanics to every
other write in the Cockpit, not a special case. **Discard** clears the pending panel with no write.

## 3. Envelopes composer

Mock: `ia-envelopes.html`.

### 3.1 Left panel: Envelopes tab

A list of saved flows (name, e.g. "Add CRUD feature", step count, last-used date) plus "+ New flow."
Selecting a flow opens it in the center stage. Flows are stored as small JSON files (proposed:
`<stateDir>/flows/<projectKey>/<flowId>.json`, the exact `resolveStateDir()`/`projectKey()` pattern
`ia-five-screens.md` section 5 already established for Notes — outside the project, never walked by
validate, never committed, so a flow is a personal/team convenience, not a build artifact).

### 3.2 Center stage: the step list (compose and order)

An ordered, numbered list of steps (reusing the `.step`/`.nx` numbered-row pattern already used for
plan steps, `ia-pages-change.html`). Each row: a layer chip (domain/service/workflow/hook/page/
component/controller/route — the same `<span class="layer ...">` vocabulary used everywhere else),
the unit name field, and per-step args beyond `{layer, name}` shown inline once a step is added (kept
minimal in v1 — see 3.4). Steps are reordered with drag or with keyboard (`Alt+Up/Down` on a focused
step, per the keyboard-first principle — drag is never the only path). A "+ Add step" opens the
**step picker**: a searchable list of layers from the plan-flow catalogue (`packages/core/block-flows.
mjs`'s registered flow blocks, plus the plain create-a-layer-unit steps `construct pipeline` already
runs), each entry showing its layer, what it produces, and whether it is Mechanical (a real generator
exists) or needs a body filled by AI on create/import (the same Deterministic/Local model provenance
distinction as everywhere else, per principles.md #8 — the picker never hides that a step's file body
still needs an LLM call).

### 3.3 Right panel: envelope preview

Selecting a step shows the **envelope that step would receive** as input: the accumulated `layers` map
from every step before it in the flow, plus `unboundSlots`/`events` if a prior step declared them —
rendered as a labelled, read-only JSON-ish panel (reusing `.fm`'s "front matter block" styling already
used for `story.md`'s tool-owned block), not a Monaco editor, since this is inspection, not authoring.
A one-line caption states this is computed, not stored: "Preview only — the real envelope is produced
when the flow runs." A "Run this flow" action is disabled until every step has its required args filled
and turns into a Process in the bottom panel when pressed, identical to running a plan (`ia-five-screens.
md` section 1's Run/Processes wiring) — a flow is a saved plan shape, not a separate execution model.

### 3.4 Args, kept deliberately small in v1

`schemas/envelope.v1.json`'s `steps` shape is `{layer, name}` only; a flow step needs at minimum a
`feature` binding (which feature it runs against) at flow-run time, not compose time, so the composer
asks for feature only once, at "Run this flow," and applies it to every step (a flow is written against
a placeholder feature name shown as `<feature>` in the preview until run). No other per-step argument
exists in the schema today, so the composer does not invent a field it cannot pass through — a step
needing more (e.g. a specific prop list) is out of scope for v1 and flagged as a gap, not silently
guessed (open question 2).

### 3.5 Change safety: saving a flow

Saving a new or edited flow is itself a small diff shown before write (the ordered step list, plain
language: "3 steps: domain Total, service Total, hook useTotal"), confirmed once, then written to the
flow store — no per-artifact Approvals entry, since a flow file is the tool's own record of a composed
plan shape, not product code or model output (same reasoning `ia-five-screens.md` section 9.4 already
used for `story.md`'s auto-saved tool block). **Running** a flow is where product-code changes happen,
and that already goes through the full impact-preview/per-artifact-approval flow every plan run does.

## 4. Accessibility

Both composers reuse the existing shell's landmarks, `role=tablist/tab`, F6 pane cycling and `Ctrl K`
palette (no new keyboard model). Specific to these two surfaces: the severity control and framework
picker are real `radiogroup`s (not colour-coded buttons alone); every glob/exception row's "matches N
files" count is text, announced on change via a polite live region, not a colour-only badge; the step
list's drag reorder has an equivalent keyboard path (`Alt+Up/Down`); the envelope preview panel is
`aria-readonly` and never receives the Change form's focus order; impact-preview numbers use the same
danger/warn/success token pairing (colour + text + icon) as the rest of the Cockpit, per principles.md
#4 and #8.

## 5. States

Mock: `ia-rules-states.html`. Empty (`no architecture.yml` — offer "Create with defaults", the strict-
nextjs preset, as the first diff), loading (validate running, spinner text "Checking impact..." — never
a bare spinner per principles.md's reduced-motion rule), error (validate failed to run — show the raw
error and a Retry, never silently show "0 violations"), and narrow (<900px — Rules/Envelopes collapse
to the same Browse/Stage/Inspect/Run bottom-tab pattern every other screen uses at that width).

## 6. Suggested shippable slices (revises the epic's A-F)

| # | Slice | Size | Depends on | Keeps green |
|---|---|---|---|---|
| 1 | **Rules tab, read-only**: left list (id, name, severity, live violation count from `/api/validate`), center detail with "why" text and violation list, "View in Diagnostics" link | M | Features screen shell (#367 slice 5) | `plan-mode`, new `rules-tab.spec.js` |
| 2 | **Severity edit as a pending diff**: segmented control, pending-changes panel, plain-language changelog + YAML diff, dry-run impact preview, Save through Approvals, Discard | M | 1 | `processes-approval`; extends `rules-tab.spec.js` |
| 3 | **Exceptions editor**: rule-scoped inline + "All exceptions" right-panel tab, expiry date picker, live "matches N files," expired-entry state | M | 2 | new `rules-exceptions.spec.js` |
| 4 | **nonLayer + frozen editors**: Advanced disclosure, glob rows with live match counts, frozen's "currently imported by" check | S | 2 | new `rules-advanced.spec.js` |
| 5 | **Features root + route adapter (framework) picker**: project section, read-only pattern preview per framework, structural-move warning copy | S | 2 | `rules-tab.spec.js` |
| 6 | **Preset picker**: "Change preset" diff/confirm flow, count of rules that would change | S | 2 | `rules-tab.spec.js` |
| 7 | **Envelopes tab, list + compose**: left list of saved flows, center step list (add/reorder/remove), step picker grounded in real block-flows/pipeline layers, Mechanical/AI provenance per step | L | Features screen shell | new `envelopes-tab.spec.js` |
| 8 | **Envelope preview + save + run**: right-panel computed preview per selected step, save-a-flow diff/confirm, "Run this flow" wired to the existing Process/Approvals path | M | 7 | `processes-drawer`, `processes-approval` |
| 9 | **States + accessibility pass**: empty/loading/error/narrow for both tabs, axe scan, keyboard reorder | S | 1-8 | `a11y`, `narrow-layout` |

Order: 1 before 2-6 (2-6 can run in parallel once 1 lands); 7 is independent of 1-6 and can start in
parallel with 1; 8 follows 7; 9 last. This keeps A ("read-only rules view") as slice 1, splits the
epic's B/C/D into 2/3/4-5/6 for smaller reviewable diffs, and keeps E/F as 7/8 exactly as scoped.

## Open questions for the owner

1. **Flow storage and sharing.** Recommendation above is a personal/per-machine store like Notes
   (`<stateDir>/flows/<projectKey>/`). If flows should be shared across a team (checked into the repo,
   e.g. `.construct/flows/*.json`), that changes slice 7's storage layer and needs a decision on
   whether a checked-in flow is subject to `validate` at all (recommendation: no — it is tool
   configuration, like `story.md`'s tool block, not product code).
2. **Per-step arguments beyond `{layer, name}`.** `schemas/envelope.v1.json` has no slot for them
   today. If a real use case needs more (e.g. presetting a service's method list), that is a schema
   change (`envelope.v2.json` per the schema's own versioning note) and belongs in a separate ticket,
   not silently added here.
3. **Preset picker's rule set.** Only `strict-nextjs` exists as a named preset today (`example/
   architecture.yml`); if more presets are planned, slice 6 should confirm the list before building the
   picker's copy.
4. **Confirm the placement decision** (section 1): Rules/Envelopes as Features-screen tabs, not
   Settings. Recommendation: yes, for the reasons in section 1.
