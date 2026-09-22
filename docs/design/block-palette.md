# Pages editor: the block palette, and "Wrap with…" (#518)

Status: concept (nothing here is implemented). Part of #500 phase 3 ("live diagnostics" / Cockpit UI),
alongside #499's Expression-layer design and #517 (the mechanical extraction block this screen
triggers, tracked and built separately). Mocks: `mocks/ia-palette.html`, `mocks/ia-palette-suggest.html`,
`mocks/ia-palette-confirm.html`, `mocks/ia-palette-states.html` (`build-ia.mjs`, styles added to
`ia.css`); PNGs in `mocks/png/ia-palette*--{dark,light}.png`.

Owner brief (#518, 2026-09-22): "display of groups of allowed [things] like[,] provider, expressions,
etc... in [P]age ui. we need mvp and usable." — scoped explicitly to a small, shippable first slice,
not a redesign.

## 1. What this is, grounded in the real model

The palette is a browsing/insertion surface in the Pages editor that shows **only what the currently
open page could actually import**, computed from the real mechanism — not a hand-maintained list:

- **The import graph**: `DEFAULT_LAYERS.page.canImport = ['component', 'types']`
  (`packages/core/config.mjs`) is the base rule: a page may only reference component units.
- **The two sanctioned exceptions**, both enforced by naming convention + a real factory check
  (`architecture-enforcer.mjs`'s `PAGE-006`/`HOOK-002`, `packages/core/typed-contracts/provider.ts`):
  a page may also import a **Provider hook** (`use<Name>Provider`, built through `defineProvider`) and a
  **tracked-state hook** (`use<Name>State`, built through `useTrackedState`). Nothing else in `hooks/`
  is importable by a page.
- **Expressions** (`features/*/expressions/**`, the new branded `expression` layer from #500/#503) are
  not banned by any `PAGE-*` rule — `PAGE-008` exists precisely so a page's inline conditional/loop
  logic becomes a named `@expression` unit instead, which the page then imports and renders as JSX like
  any other capitalized element.
- **Workflows, services and domain are never reachable from a page** (`PAGE-002/003/005`) — not shown,
  not even collapsed, per the brief's "never show something the architecture wouldn't allow."

This gives exactly three pickable groups, in this order (most page-relevant first):

| Group | Real layer | What it shows | Chip |
|---|---|---|---|
| **Providers this feature can use** | `hook` (Provider naming convention, `provider.ts`) | Every `ProviderUnit` reachable: this feature's own (`defineProvider` call in its `hooks/`) plus any other feature's Provider re-exported through its public `index.ts` (`SLICE-002`) | Plain grey `.layer` chip, labelled "provider" — deliberately **not** a new colour, because a Provider is not its own branded `LayerName` (`units.ts`'s `LayerName` union has no `'provider'` entry), only a convention over `hook` |
| **Expressions this feature can wrap with** | `expression` (real branded layer, #503) | Every `ExpressionUnit` in scope, same reachability rule as components below | New `.layer.expression` chip (`--warn`/amber) — this *is* a real, distinct branded layer, so it earns a real colour, unlike Provider |
| **Components this feature can compose** | `component` | Every `ComponentUnit` in scope: this feature's own `components/`, plus any other feature's component re-exported through its public index | Existing `.layer.component` chip (green), unchanged from every other screen |

Each entry's one-line description is meant to be pulled from the same `describeComponent`/react-docgen
introspection already built for the Components screen (`ia-five-screens.md` section 8.2) — the mock's
copy (e.g. CartProvider's "Shares `{ total, itemCount }`…") is illustrative of that real metadata shape,
not placeholder filler.

A closing line always explains the boundary in plain language instead of listing forbidden items:
*"Not shown here: workflows, services and domain logic. A page composes components, expressions and
providers only — it can't reach a workflow, service or domain unit directly (rules
PAGE-002/003/005). Ask a controller to wire one of those in instead."* This is the "stakeholders read
the UI too" principle applied to a boundary, not just a capability.

## 2. Placement in the existing 3-pane layout

**A new tab, "Palette", in the Pages editor's existing right-panel tab host** — not a new pane, not a
new pane on the left. Sits alongside the tabs already specified for Pages in `ia-five-screens.md`
(Inspector, Scope, Source, Change, Diff): `Inspector | Scope | Source | Palette | Diff`. This is exactly
the "tabs are a slot list (id, title, badge, render)" contract the right panel already uses
(`cockpit-layout.md`, `ia-five-screens.md` section 1) — Palette is one more registered tab, filled by
the Pages feature, nothing structural changes.

Why the right panel and not the left Browse tree: the left panel answers "what is on this page"
(structure, already-used elements); the palette answers "what *could* I add" — an inspect/act
concern, the right panel's stated role. It is also naturally contextual to the **page's owning
feature** (recomputed when the open file/feature changes), not to whatever tree node happens to be
selected — Providers/Expressions/Components don't change just because you clicked a different existing
element on the same page.

The badge count on the "Palette" tab mirrors "1 suggested" the moment a JSX selection has a fitting or
creatable Expression (`ia-palette-suggest.html`), the same badge idiom already used by other tabs
(Findings, Diff).

## 3. The "Wrap with…" interaction (pairs with #517)

1. **Select** a JSX range in the preview or the tree (an existing selection mechanism — Alt+Click /
   Pick, already specified in `ia-five-screens.md`). A `callout.info` at the top of the Palette tab
   states what was selected and why it is flagged (e.g. "3 elements from a `.map()` over `cartItems`
   … flagged PAGE-008").
2. **Suggest**: the Expressions group re-sorts so applicable entries lead, each still shown with its
   real one-line description. An entry that structurally cannot wrap the selection (e.g. `ShowForRole`
   wraps one child behind a role check, offered here against a loop selection) stays visible but
   dimmed with an explicit `Not a fit` chip and the reason as its description — this is the same
   "never show something the architecture wouldn't allow" rule applied at the shape level, not just
   the layer level: it would be worse to hide it silently (a developer would wonder where it went) than
   to show it and say why it doesn't apply.
3. Where nothing existing fits, the top suggestion is **`+ New Expression`** with a name field
   pre-filled from #517's own naming rule ("derive a sensible name from context… never a generic
   placeholder") and editable before confirming.
4. **Confirm** ("Wrap with…") opens the same idiom `ia-pages-change.html` already established for
   every other verb (Move/Rename/Extract/Wrap in…/Delete): an `.ask` card naming the action, the
   mechanical steps (`nextRow` + the inline Generate control, Mechanical by default), a per-file
   approval checklist, nothing written until "Approve" — landing in the bottom Approvals tab exactly
   like any other artifact. "Wrap with…" is that same `Wrap in…` verb, just reached from the palette
   picker instead of a blank Change-tab form.
5. **Honesty about sequencing**: #517 (the actual `construct refactor extract-expression` block) does
   not exist yet. Until it ships, step 1's Generate control must read **"AI only, no block yet"**
   (the existing contract from `ia-generate-states.md`/section 8.6's guardrail 4 — logged as a request
   for a mechanical block, never a silent model fallback dressed up as deterministic). `ia-palette-states.html`
   shows both states side by side ("Today, before #517 ships" vs. "Once #517 ships") so an
   implementer can ship the palette now without overclaiming a block that isn't built.

## 4. MVP scope cut (owner: usable soon, not a redesign)

Three independently shippable slices, each a real, complete increment — not a placeholder:

| Slice | What ships | Depends on | Why this boundary |
|---|---|---|---|
| **1 — Read-only palette** (`ia-palette.html`) | The three groups, real data, real descriptions, the boundary note. No actions on any item yet (or a disabled "coming soon" affordance). | Only a read API over the existing `canImport` graph + `describeComponent` introspection — no new mechanical block. | Solves "what can I even use here" (real friction today: nothing shows this) with zero new execution risk. Ships regardless of #517's timeline. |
| **2 — Insert (Component/Provider only)** | Clicking a Component or Provider item inserts its import + a JSX/hook call at the cursor — a small, self-contained mechanical edit, not an LLM step. | A minimal insert-import-and-usage block (new, small — not yet filed; see Open questions). | Components/Providers don't need a JSX *selection* to use, just a cursor position — this is strictly simpler than "Wrap with…" and delivers value before selection UI exists. |
| **3 — "Wrap with…" (interactive, selection-based)** | Full flow in section 3: select → suggest → confirm → approval. | #517 (or ships with the honest "no block yet" interim state from section 3.5 if #517 lags). | The most complex slice: needs selection UI, shape-fit suggestion logic, and the mechanical extraction itself. Locking this to a real mechanical block (not a bare LLM call) is the entire point of #517 — shipping this slice before #517 exists would either block on it or quietly become the "LLM reinventing the task" anti-pattern the Vision explicitly warns against. |

**Recommended first cut for "usable soon": Slice 1 only**, and within it, all three groups (not just
Expressions) — a developer's real question is "what's available", and Providers/Components already
have real data sources (the import graph, existing `describeComponent`) with no new block required, so
cutting them out would save little build cost while leaving the palette half-answering its own
question. If a narrower cut is still wanted, **Expressions-group-only** is the next-smallest slice
(it's the newest, least-discoverable layer, and ties most directly to #499/#500's headline work), with
Providers and Components following as the same read-only list once the pattern is proven.

## 5. Accessibility / consistency review (`principles.md` checklist)

- **Contrast**: reuses existing token pairs only — `text` on `surface-1/2`, `text-muted` for
  descriptions (7.3:1 dark / 7.1:1 light, meets AA for 12px body text — `text-faint` was deliberately
  avoided for description copy, reserved for metadata per principle 2), `warn`/`warn-soft` for the new
  Expression chip (already reviewed as 4.8:1+ in `tokens.md`). No new raw colours.
- **Keyboard path**: each palette row is a real interactive element sized for both mouse and keyboard;
  group headers are native `<details><summary>` (native disclosure semantics, keyboard-toggleable,
  consistent with the Inspector tab's existing collapsed-sections pattern) rather than a bespoke
  widget. The "Wrap with…" and "Generate" actions reuse the existing `.btn`/`.gen` controls, already
  audited for focus/contrast in `ia-generate-states.html`.
- **Target size**: action buttons are the existing 24-28px `.btn`/`.gen` controls, already ≥24px.
- **Status not by colour alone**: "Not a fit" and "no block yet" are always a text chip, never a bare
  colour change; the layer chips always carry their text label.
- **Reduced motion / no flashing**: static content, no new animation introduced.
- **Empty/loading/error/no-selection/narrow states**: all five designed explicitly in
  `ia-palette-states.html`, not left blank — including the interim "no block yet" state, which a
  strict happy-path design would have skipped.
- **Widths tested**: hero mocks at 1440x900 (rw 420-440px, within the existing right-panel range);
  narrow (390px) shown as the Palette tab inside the existing bottom "Inspect" tab bar, reusing the
  shared `phone()` narrow-shell helper.
- **Token consistency**: only `docs/design/tokens.md` tokens used; the one new visual decision (the
  Expression chip's colour) is documented above with its rationale, not invented ad hoc.

No open-core boundary crossed (concept mocks only, `docs/design/mocks/`, no `ui/client` edits) and no
existing shipped token was changed — `ia.css`/`mock.css` are mock-only stylesheets, not
`ui/client/app/globals.css`.

## 6. Open questions for the owner / implementer

1. **Slice 2's insert block** (Component/Provider "insert import + usage at cursor") is not yet filed
   as its own ticket — small enough to fold into the Slice-1 or Slice-2 implementation issue rather
   than a separate epic sub-issue; naming it here so it isn't lost.
2. **Cross-feature reachability precision**: the mock treats "importable via another feature's public
   index" as sufficient for Providers/Components; whether the real implementation also needs to walk
   `SLICE-002`/`SLICE-003` (public API sync) to avoid suggesting a re-export that's stale is an
   implementation-time detail, not a design one.
3. **Where "Wrap with…" lands when confirmed**: this spec keeps it inline in the Palette tab (matching
   the selection context); an alternative is switching focus to the existing Change tab reusing its
   verb strip (`Wrap in…`) with the palette only supplying the *target* Expression. Recommendation:
   keep it inline (fewer tab switches, selection context stays visible) — flagging in case the owner
   prefers reusing Change tab's verb strip literally.

## 7. Implementation plan (ordered, for the linking ticket)

| # | Sub-issue | Size | Keeps green |
|---|---|---|---|
| 1 | **Palette read model**: a server endpoint/deterministic block that, given a page file, returns its feature's reachable Providers/Expressions/Components from the real `canImport` graph + typed-contracts factories (no UI yet) | S | new `palette-read.test.mjs`-style unit test |
| 2 | **Palette tab (Slice 1, read-only)**: register the tab in the Pages right-panel tab host, render the three groups + boundary note from #1's data | M | `pages-editor-layout`, new `pages-editor-palette.spec.js` (rule 11) |
| 3 | **Insert action (Slice 2)**: Component/Provider "Insert"/"Use" wired to a small mechanical insert-import block | S | new spec extending `pages-editor-palette.spec.js` |
| 4 | **Selection + suggestion (Slice 3a)**: JSX selection surfaces in the Palette tab, Expressions re-sorted/fit-checked, `+ New Expression` naming | M | new spec; needs the existing selection/pick mechanism |
| 5 | **Wrap confirm + approval (Slice 3b)**: wires to #517 once it ships; ships earlier with the honest "no block yet" interim state otherwise | M (S if #517 already landed) | reuses `pages-editor-change`-style spec plus Approvals |

Order rationale: 1-2 are the smallest complete, valuable slice and have no dependency on #517; 3 is a
small independent addition; 4-5 are the full interactive flow and are the only pieces that need #517
(or its honest interim state) to be fully truthful.
