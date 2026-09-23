# Prop-to-scope binding: the Scope tab, made interactive (#523)

Status: concept (nothing here is implemented). Part of #500 (typed contracts, `PropRef<T>`), follows
and pairs with #518's block palette. Mocks: `mocks/ia-scope.html`, `mocks/ia-scope-link.html`,
`mocks/ia-scope-bound.html`, `mocks/ia-scope-states.html` (`build-ia.mjs`, styles added to `ia.css`);
PNGs in `mocks/png/ia-scope*--{dark,light}.png`.

Owner's brief (#523, 2026-09-23), verbatim: "since all data for any piece is scoped to its feature, in
UI show all the available scope options, and make them pluggable into correct controls using
drag-drop or click mechanisms. maybe holding ctrl plus related fields() — this interaction is just an
idea, but UX is needed."

## 0. This is not a green field — read the real code first

Before drawing anything, the real screen this ticket extends was found and read, not assumed:

- **`ScopePanel`/`ScopeLinkGraph`** (`ui/client/features/pages-editor/components/{ScopePanel,
  ScopeLinkGraph}.tsx`, #223) already renders a two-column view of the selected element — the page's
  in-scope declarations on one side, the element's own props on the other, colour-coded — computed by
  `packages/engine/scopeLinks.mjs`'s `buildScopeLinks()`. **It is entirely read-only**: every row is a
  plain `<span>`, the connecting `<svg>` is `aria-hidden="true"`, there is no click, focus or drag
  handler anywhere in it.
- **`AutoMapPanel`** (`ui/client/features/pages-editor/components/AutoMapPanel.tsx`, #54) already
  offers a checkbox multi-select ("Wire N prop(s)") for **same-named** candidates only — it is the
  existing, real precedent for "select several related fields and bind them at once", closer to the
  owner's "Ctrl + related fields" idea than anything in the concept mocks.
- **`ScopeDeclKind`** (`ui/client/features/pages-editor/types.ts`) is `'prop' | 'state' | 'setter'`
  only. `buildScopeLinks()` walks a single file's own destructured props and `useState` pairs — it has
  no concept of a Provider's exposed value or another unit's output at all. This is the real, current
  boundary of "scope" in the shipped product, and it is narrower than the owner's brief.

**The actual gap, precisely**, is three separate things, only one of which is pure UI:

1. The existing rows aren't interactive (no click, no focus, no keyboard, no drag) — a UI/accessibility
   fix regardless of anything else in this ticket.
2. There is no way to pick a *specific*, possibly differently-named candidate for one prop — only
   "accept the same-name guess, in bulk" (AutoMap) exists today.
3. The scope shown is *too narrow* — Providers and other units' outputs are real, reachable sources
   (per `PropRef<T>`, `provider.ts`) that the current server-side graph never enumerates. This needs a
   small `packages/engine/scopeLinks.mjs` extension (new `ScopeDeclKind` members), not just a new
   screen. Flagged in section 6 as a real, separate backlog item — out of scope for this design ticket
   to build, but the design assumes it exists (the mocks show a plausible resulting shape).

This grounding is why the mocks extend `ScopePanel`'s existing two-column shape and keep `AutoMapPanel`
visible alongside it (`ia-scope-bound.html`), rather than replacing either with a new competing layout.

## 1. What this is, grounded in `PropRef<T>`

`PropRef<T>` (`packages/core/typed-contracts/propRef.ts`) means "pick an already-in-scope value of
type `T`", as opposed to a prop typed plainly `T` ("type a literal in"). The three source categories
match the ticket's own wording and the real reachability rules:

| Group | Real source | Grounded in |
|---|---|---|
| **This file's own props** | The currently-open unit's own destructured `Props` (today's real `'prop'`/`'state'`/`'setter'` `ScopeDeclKind`) | `buildScopeLinks()`, unchanged |
| **Providers this feature can use** | A `ProviderUnit`'s `useProvider()` return, same reachability #518's Palette already computes for Providers (`provider.ts`, `HOOK-002`) | New `ScopeDeclKind: 'provider'` (not built) |
| **Other units' outputs already used here** | A hook (e.g. a `HOOK-001` tracked-state hook) already called in this file, whose return is a local const in scope | New `ScopeDeclKind: 'unit-output'` (not built) |

Each candidate carries its real type (`string`, `boolean`, `() => void`, …), read from the same
`describeComponent`/prop-type introspection #518's Palette already uses for its one-line descriptions.
A prop typed `PropRef<T>` is exactly the slot this UI targets; a plain `T`-typed prop stays a literal
field with no Bind affordance (the type distinction *is* the mechanism, not a UI guess).

**Type-fit is necessary, not sufficient.** `customer.email` and `customer.name` are both `string`, so
both show as candidates when binding a `string` prop — the mocks show this honestly (`customer.id` is
also `string` and also shown, clearly a wrong pick a human would reject on sight, its one-line context
label doing the work the compiler can't). This mirrors Palette's own "shape-fit, not semantic-fit"
precedent (`ShowForRole` stays visible-but-dimmed against a loop selection, never silently hidden) —
narrow by type, let the person's judgement (aided by the name and one-line provenance) do the rest.

## 2. Interaction pattern comparison, and what was chosen

The owner named three ideas, explicitly not requirements. Compared against what `docs/design/` already
establishes:

| Pattern | Existing Cockpit precedent | Fit for this ticket |
|---|---|---|
| **Click-to-select-then-click-to-target** (a target is "armed" for linking, then a candidate commits it) | Exactly Pick/selection (`⊕ Pick`, Alt+Click) and Palette's own "Wrap with…" flow (select → suggest → confirm, `block-palette.md` §3) | **Chosen as primary.** Same vocabulary as Palette (a `callout.info` names what's active, `.suggest`/`.unfit` mark fit), fully keyboard-native for free (see §3), no new gesture to learn |
| **Drag-and-drop** | Only named informally today ("Drag from a handle to rewire an event" on the workflow canvas, `build.mjs`'s `workflows-in-shell`) — never a *committed, accessible* pattern elsewhere | **Chosen as a secondary, additive accelerator**, not the primary path — see §3 for why |
| **Ctrl + click multiple related fields, bind as a group** | `AutoMapPanel`'s existing checkbox multi-select (§0) is the closest real precedent, but only for same-named matches | **Deferred**, see §5 |

**Click-to-link is primary** because it is the only one of the three that is a keyboard/screen-reader
path *by construction*, not a path that needs a bolted-on alternative — the existing "select an
element, then act" idiom this Cockpit already teaches everywhere (Pick, Palette's Wrap-with, Change
tab's verb-then-argument flow). Introducing a *second* selection vocabulary (drag-first) for one
screen only, when Pages already has a rich one, would be the "inventing a competing vocabulary" the
brief explicitly warned against.

**Drag-and-drop is offered, additively, because it's genuinely useful for a pointer user working
through several rows quickly** (drag a `customer.email` chip straight onto `value`) — but it is
designed as a pure alternative *route to the same action* the click path already performs, never a
capability the click path lacks. This is also a WCAG 2.5.7 (Dragging Movements) requirement, not just
a nicety: if dragging is offered, a single-pointer, non-dragging way to reach the same result must
exist unless dragging is essential, and it plainly isn't essential here.

## 3. The flow (mocks 1–3) and its keyboard/screen-reader-equivalent path

1. **Read** (`ia-scope.html`, Slice 1): select an element (`EmailField`, child of `LoginForm`, the
   same LoginForm/EmailField scenario used across every other Pages mock). Its Props-and-bindings
   list shows `value` as an unbound literal (`""`) with a small **Bind…** icon-button, and `label` as
   an ordinary literal. Below, the Scope tab lists the three groups from §1, read-only, each candidate
   showing its name and real type. Nothing is clickable in the source list yet in this slice — the
   question this answers is "what's here", same "zero execution risk" first cut as Palette's Slice 1.
2. **Link** (`ia-scope-link.html`, Slice 2): pressing **Bind…** arms `value` for linking. A
   `callout.info` at the top of the Scope tab states the target and its type ("Linking: value (string)
   on EmailField"), exactly Palette's own selection-callout idiom. Every candidate whose type doesn't
   match (`onSubmit: () => void`, `disabled: boolean`, `isPending: boolean`) becomes a disabled, dashed
   `.unfit` chip labelled by its own type, not hidden — the same "never hide what the architecture/type
   system would refuse, say why instead" rule Palette already applies. Matching candidates
   (`email`, `customer.email`, `customer.name`, `customer.id` — all `string`) get a `.suggest`
   highlight identical to Palette's; §1 already covers why type-fit alone still leaves `customer.id`
   as a visible-but-probably-wrong pick.
   - **Pointer path**: click a highlighted candidate to commit it, or drag it onto the `value` field
     (valid-drop target gets a solid green outline; a mismatched drop target gets a red
     "not-allowed" outline and refuses — `ia-scope-states.html`'s drag section).
   - **Keyboard path**: pressing **Bind…** (a real, focusable `<button>`) moves focus into the
     candidate list, landing on the first *enabled* candidate — never a disabled one, and never
     leaving focus stranded on nothing. <kbd>Tab</kbd>/<kbd>Shift+Tab</kbd> or <kbd>↑</kbd>/<kbd>↓</kbd>
     move between candidates (disabled ones are still announced, per "shown but dimmed", but are
     naturally skipped by native `disabled` semantics for activation); <kbd>Enter</kbd>/<kbd>Space</kbd>
     commits the focused candidate; <kbd>Escape</kbd>, or pressing the now-toggled **Bind…** button
     again, cancels and returns focus to the `value` row. No custom widget, no `role="listbox"`
     reinvention — every candidate is a real `<button>`, so this is the browser's own focus/activation
     model, not a bespoke one.
3. **Bound** (`ia-scope-bound.html`): `value`'s field now reads `email`, with a `linked` chip and a
   `via LoginForm's own prop` provenance tag (reusing the existing `.via` idiom already in `ia.css`,
   not a new colour). Below, the exact idiom every other Change/Wrap-with flow already uses: an `.ask`
   line naming the action, one mechanical step (**not a new block** — `pages-editor-propflow-rename`/
   `-values` already cover literal↔variable rewriting per `ia-five-screens.md` §8.4's own capability
   table; this is that same rewrite pointed at a different source name), a per-file approval, nothing
   written until Approve. A "Scope links on this file" recap (`email → EmailField.value`) reuses the
   `.link` row already established in `cockpit-shell.html`/`pages-editor-in-shell.html`'s "Scope links
   touched" section. `AutoMapPanel`'s existing checkbox action is shown unchanged directly below it,
   so the mock is honest that two real entry points to the same underlying rewrite coexist (§0).

## 4. Where this lives relative to #518's Palette tab

**A distinct tab in the same right-panel tab host** (`Inspector | Scope | Source | Palette | Diff`),
not a mode of Palette and not a new pane — this is also not a new decision: `Scope` is already a
named, if unbuilt-on, tab in the current shipped shell (`InspectorPanel`'s `withScope` flag; the older
concept mocks already reserved the slot). The two tabs answer different verbs on the same page:

- **Palette (#518)**: "what can I **add** to this page" — new units/imports, JSX composition.
- **Scope (#523)**: "what data can I **wire** into what's already on the page" — props/bindings on an
  element already placed.

Both consume the same underlying reachability (`canImport` graph + typed-contracts factories) but for
different verbs: Palette's Provider entry action is *insert* (call the hook, wrap the tree); Scope's
Provider entry is *pick a specific exposed field* onto an existing prop. Keeping them separate tabs
avoids overloading one surface with two unrelated primary actions, and matches how Inspector/Source/
Diff are already separate verbs rather than sub-modes of one tab.

## 5. MVP scope cut

Four independently shippable slices, same discipline as #518:

| Slice | What ships | Depends on | Why this boundary |
|---|---|---|---|
| **1 — Read-only Scope tab** (`ia-scope.html`) | Three groups, real types, no action yet | Only a read extension: `ScopeDeclKind` gains `'provider'`/`'unit-output'`, `buildScopeLinks()` walks Provider/hook reachability the same way Palette's read model already does | Answers "what's available" truthfully, zero execution risk, ships regardless of the interactive slices |
| **2 — Click-to-bind, single field** (`ia-scope-link.html` → `ia-scope-bound.html`) | Bind… button, linking-mode candidate list, commit via the existing snippet-rewire block | Slice 1's data; **no new mechanical block** — reuses `pages-editor-propflow-rename`/`-values` | This is the ticket's actual ask ("pluggable"); recommend shipping with Slice 1 as the MVP definition, since a read-only Scope tab alone doesn't solve "make them pluggable" |
| **3 — Drag-and-drop accelerator** | Same rewire call, reached by dropping a candidate chip on a field instead of clicking it | Slice 2's mechanism unchanged | Pure interaction sugar layered on an already-complete, already-accessible action — never gates on this shipping |
| **4 — Multi-field linking ("Ctrl + related fields")** | Selecting several sub-fields of one source (e.g. `customer.street` + `customer.city`) and wiring them to several sibling props in one step | A new, destructure-aware mechanical block AutoMap doesn't have today | See §6 below — real idea, not scoped here |

**Recommended MVP: Slices 1+2 together.** Unlike Palette (where a read-only first cut was independently
valuable because Providers/Components already had insert actions elsewhere), a Scope tab that only
*shows* candidates without letting a person *pick* one leaves the owner's actual request — "make them
pluggable" — undone. Slice 3 (drag) and Slice 4 (multi-field) are real, valuable, explicitly deferred.

## 6. Why multi-field linking ("Ctrl + related fields") is not MVP

`AutoMapPanel` already proves the *shape* of this idea works (a checkbox list, "Wire N prop(s)"), but
only for same-named matches within one file's own scope. Extending it to cross-source (Provider/
unit-output) and cross-type-but-related fields (e.g. wiring `customer.street`/`customer.city`/
`customer.zip` onto three sibling props at once, or a single object prop) needs:

- A **destructure-aware mechanical block** — today's snippet-rewire only ever writes one attribute at
  a time; a real "wire this whole shape" block would need to reason about several attributes together
  and possibly introduce a destructuring pattern, which is materially more mechanism than this
  ticket's other slices.
- A **selection model for "related" fields** the owner's brief itself flags as unsettled ("maybe
  holding ctrl") — Ctrl+click a set of source chips is a reasonable guess, but nothing here should be
  built against a guess when Slices 1–3 already deliver the real, requested capability.

Recommendation: land Slices 1–3 first, observe real usage (does a person reach for AutoMap's existing
same-name bulk action for this today, or hand-write it?), then design the multi-field block as its own
follow-up ticket with real evidence instead of speculation.

## 7. Accessibility / consistency review (`principles.md` checklist)

- **Contrast**: no new colour token. `.sc-src`/`.sc-tgt` chips reuse `--border-strong`/`--surface-2`/
  `--text`; `.suggest` reuses the exact `--accent-soft` outline Palette's own `.pal-item.suggest`
  uses; `.unfit` reuses Palette's `opacity: .55` + dashed border, never colour alone (the chip's own
  type label is always present as text); `.sc-tgt.unbound` reuses the already-reviewed `--danger`/
  `--danger-soft` pair (`tokens.md`, "errors"); the bound state's `linked` chip reuses the already-
  reviewed `--accent`/`--accent-soft` pair (same as today's `.bind.var`). Only new pairing is `.via`
  (already an existing, unused-until-now class in `ia.css`) — text-only, `--text-faint` on
  `--surface-2` border, metadata-weight per principle 2, not decision-bearing content.
- **Keyboard path**: fully designed in §3 — every candidate and every target is a real `<button>`
  (fixing the shipped `ScopeLinkGraph`'s current `<span>`-only, `aria-hidden` SVG, which today has *no*
  keyboard path at all — this ticket's implementation is also the accessibility fix for that existing
  gap, not a separate audit item). Bind→list→commit is native focus/activation, no custom widget.
- **Drag is additive, never load-bearing** (WCAG 2.5.7): every drag outcome is reachable by the click
  path in §3; the mocks show both explicitly (`ia-scope-states.html`'s drag section notes this in its
  own caption).
- **Target size**: `.sc-src`/`.sc-tgt` chips are 24px tall (existing `.btn sm`/`.linkbtn` height), the
  `Bind…` icon button is the existing 22–24px `.linkbtn`/`.icon-btn` size class already audited
  elsewhere.
- **Status not by colour alone**: "Not this type" is a disabled state *plus* the candidate's own type
  label, never a bare colour swap; "Linking…" is a text chip; bound/unbound both carry text
  (`linked`/`literal`) alongside their border colour, matching the existing `.bind.var`/`.bind.lit`
  pattern and the `ia-five-screens.md` §8.4 note that scope links "must also use text or shape, not
  colour alone".
- **Reduced motion**: no animation introduced; drag feedback is a static outline/cursor change, not a
  transition.
- **Empty/loading/error/no-selection/no-fit/narrow states**: all designed explicitly in
  `ia-scope-states.html`, including the honest "nothing type-matches, offered anyway with a reason"
  state and the deferred multi-field idea shown as a real, named future item rather than silently
  dropped.
- **Widths tested**: hero mocks at 1440×900 (rw 420–440px, within the existing right-panel range);
  narrow (390px) shown as the Scope tab inside the existing bottom "Inspect" tab bar, reusing the
  shared `phone()` helper, matching Palette's own narrow treatment.
- **Token consistency**: only `docs/design/tokens.md` tokens used; every new CSS class added to
  `ia.css` is documented in its own comment block citing what it extends and why.

No open-core boundary crossed (concept mocks only, `docs/design/mocks/`, no `ui/client` edits) and no
existing shipped token changed.

## 8. Implementation plan (ordered, for the linking ticket)

| # | Sub-issue | Size | Keeps green |
|---|---|---|---|
| 1 | **Widen scope itself**: extend `packages/engine/scopeLinks.mjs`'s `ScopeDeclKind` with `'provider'`/`'unit-output'`, walking Provider reachability (reuse #518's read model) and already-called tracked-state hooks in the open file | M | new unit tests alongside `scopeLinks.mjs`'s existing coverage |
| 2 | **Make `ScopeLinkGraph` rows real interactive elements** (buttons, not spans; keep the SVG purely decorative/`aria-hidden`, never load-bearing for meaning) — no new behaviour yet, just real semantics | S | existing `ScopePanel`/`ScopeLinkGraph` tests plus a new a11y check (axe, already a devDependency per README) |
| 3 | **Click-to-bind (Slice 2)**: Bind… affordance, linking-mode candidate list with type-fit filtering, commit via the existing snippet-rewire block | M | new `pages-editor-scope-bind.spec.js` (rule 11) |
| 4 | **Drag-and-drop accelerator (Slice 3)**: same commit path, reached by drop instead of click | S | extends the Slice-2 spec with a drag-emulated Playwright test |
| 5 | **Multi-field linking (Slice 4, later)**: destructure-aware mechanical block, Ctrl+click source selection | L | new spec once designed; not scheduled here |

Order rationale: 1 is the only piece that touches `packages/engine` (open-core) and everything else
depends on its real data; 2 is a pure accessibility fix that should land regardless of 3's timeline; 3
is the ticket's actual ask; 4 layers on 3 with no new mechanism; 5 is deliberately last and unscoped.
