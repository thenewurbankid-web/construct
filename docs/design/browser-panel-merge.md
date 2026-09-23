# Pages editor Browser pane: merge the two left menus into one collapsible group (#536)

Owner request (#536): "in cockpit, merge left two menus, the second menu should be under the
first" then "and make the two collapsable." Design-only ticket — mock(s) + spec, no `ui/client`
product code.

## 0. Confirm against the real, running Cockpit first

#536's own body names a hypothesis (`PagesBrowserTab.tsx` stacking `PagesBrowser` then
`TreePanel`) and flags a second real candidate (the all-pages `ListBrowser`) depending on view
state. Both were checked against a real, running Cockpit — not guessed from JSX — before any mock
was drawn.

**Method**: booted `ui/server` + `ui/client` (Next.js dev, real ports, no shared state with any
other session) against a real fixture project (`construct init`, a `billing` feature with
`HomePage.tsx` importing a `Counter` component with two props — mirrors the fixture
`ui/e2e/tests/pages-editor-editing.spec.js` already uses), opened `/pages`, selected the feature
and opened the page, then screenshotted `.pe-browser` directly (not the whole window) and dumped
its `outerHTML`.

**Result — hypothesis confirmed, with one correction.** With a feature selected and a page open,
`.pe-browser`'s real DOM is:

```html
<div class="pe-browser">
  <div class="flow-switch" role="radiogroup" aria-label="Browser view">...Files / Flow...</div>
  <div class="glass-panel pages-browser">...Feature select, pages/ file list...</div>
  <button type="button" class="pe-all-pages" data-testid="pages-all">All pages</button>
  <div class="glass-panel tree-panel">...JSX tree...</div>
</div>
```

`PagesBrowser` and `TreePanel` are exactly the "two menus" the owner means — each is its own
`GlassPanel` (its own floating card, border + blur + shadow), stacked with a visible gap. That
part of #536's hypothesis is correct.

**The correction**: there is a third, un-panelled element sandwiched between them today —
`.pe-all-pages` ("All pages", `PagesBrowserTab.tsx:41-43`), a bare `<button>` with no card of its
own. Any merge that only touches the two `GlassPanel`s and leaves this button floating between
them would still look like three stacked things, not the "one cohesive panel" #536 (and
`docs/design/README.md`'s own ticket-shape rule to reuse an established idiom) actually asks for.
This spec places it inside the first section instead (§2).

**The second candidate the issue named is also real**, confirmed by screenshotting the
no-feature-selected state: when no feature is chosen, section two is not `TreePanel` at all — it's
the all-pages `ListBrowser` (`data-testid="pages-list"`, a filter box + ARIA listbox), because
`roots` (the parsed page tree) doesn't exist yet. A third state exists too and isn't currently
designed for: feature chosen, no page open yet — `{roots && <TreePanel .../>}` means section two
renders **nothing at all** in that state (not an empty state, just absent). All three states are
covered in the mocks (§3) and the third one is called out explicitly as a small, deliberate,
in-scope addition (§4) — not a new feature, just what "two named, persistent sections" requires to
stay honest per `principles.md` #9 ("empty states are designed screens, not blank space").

No distinct layout/ordering bug was found: `PagesBrowserTab.tsx` renders `PagesBrowser` (or the
all-pages list) then `TreePanel` in a fixed, single order in both the Files and Flow branches, and
`.pe-browser`'s CSS (`display: flex; flex-direction: column`) has no `order` override. The
"second under first" ask is already true in source; #536's ask #2 is satisfied by not touching
this at all.

Screenshots taken (not committed — this repo commits mock PNGs, not screenshots of the shipped
app; see `CLAUDE.md` rule 11): `pages-editor-browser-pane-{dark,light}.png` +
`.html` DOM dumps, `pages-editor-full-{dark,light}.png`, `pages-editor-no-feature-{dark,light}.png`.

**Scope note**: the Flow view (`view === 'flow'`, #328) renders `PagesBrowser` (feature picker
only, `showPages={false}`) followed by the `FlowBrowserController` graph — a single picker plus one
already-distinct feature (a flow diagram, not a second "menu" of the same kind). It is out of
scope here and untouched by this spec; only the Files view's `PagesBrowser` + `TreePanel`/
`ListBrowser` pairing is being merged.

## 1. Real files this touches (for the implementation ticket)

| File | Role today | Change |
|---|---|---|
| `ui/client/features/pages-editor/components/PagesBrowserTab.tsx` | Stacks the switcher, `PagesBrowser`, the "All pages" button or `ListBrowser`, and `TreePanel` | Wrap the Files-view sequence in one shared `GlassPanel`; move `.pe-all-pages` inside the first section; always render a second section (with an empty state when there's nothing to show yet) |
| `ui/client/features/pages-editor/components/PagesBrowser.tsx` | Its own `GlassPanel` (`className="pages-browser"`) | Stop rendering its own `GlassPanel`/card chrome in the Files-view call site — becomes the *content* of the first `<details>` (its Flow-view call site, `showPages={false}`, keeps rendering standalone, unchanged) |
| `ui/client/features/pages-editor/components/TreePanel.tsx` | Its own `GlassPanel` (`className="tree-panel"`) | Same: stop owning its own card; becomes the content of the second `<details>` |
| `ui/client/features/list-browser/components/ListBrowser.tsx` | Already presentation-only, no card of its own (`<div className="lb">`) | Unchanged — already fits directly inside a `<details>` |
| `ui/client/app/globals.css` (`.pages-browser`, `.tree-panel`, `.pe-browser`, `.pe-all-pages` rules, ~L680-730 and ~L1806-1817) | `.pages-browser`/`.tree-panel` currently *are* glass-panel cards | Restyle as `.pal-group`-style bordered rows (border-subtle, `--r-md`, `surface-1`) inside one new wrapper class (see §2); add the disclosure marker rules (copy `.pal-group`'s, ~L2047-2075) |

**Every existing Playwright selector these components carry stays byte-identical**: `.pages-browser`
(and `.pages-browser select`), `.tree-panel` (and `.tree-panel .tree-node.selected`), the
`pages-all` and `pages-list`/`pages-list-count` testids. ~30 spec files across `ui/e2e/tests/`
locate these two panels by exactly these class names (`grep -rn ".pages-browser\|.tree-panel"
ui/e2e/tests/*.spec.js` — commit-on-save, flow-browser, pages-editor-editing,
pages-editor-automap-crossfile, pages-editor-autoscroll, pages-editor-click-navigate,
pages-editor-flow-{structure,toggle,canvas,rewire}, pages-editor-layout, pages-editor-scope-{bind,
links}, pages-editor-{shell,external-change,propflow-values,palette,propflow-rename,live-preview,
source-view,snippet-diff,spread-props,fullscreen-preview}, pages-screen, walkthrough, a11y — this
is the concrete reason §2 keeps these two class names exactly where they are (now on `<details>`
elements) instead of renaming/restructuring them). Confirmed no spec asserts on `.pages-browser` or
`.tree-panel` being (or not being) a direct child of a `GlassPanel`, or on `.glass-panel` at all —
only on the class name and its content — so removing the double-glass nesting is selector-safe.

## 2. The merge: one grouped panel, two native `<details>` sections

Reuse the exact disclosure idiom this codebase already ships (not a new widget): native
`<details>/<summary>`, same as `PalettePanel.tsx`'s `.pal-group` (block-palette.md, #527) and
`HelpPage.tsx`/`CliTopic.tsx`'s `.help-section`/`.help-topic`. Concretely:

```html
<div class="pe-browser">
  <div class="flow-switch">...Files / Flow...</div>          <!-- unchanged -->
  <div class="glass-panel pe-browser-group">                  <!-- ONE outer card, new -->
    <details class="pages-browser" open>                      <!-- section 1, same class as today -->
      <summary>Files <span class="pe-count">1</span></summary>
      <label class="field">...Feature select...</label>
      <div><h4>pages/ in "billing"</h4><ul class="pages-file-list">...</ul></div>
      <button type="button" class="pe-all-pages" data-testid="pages-all">All pages</button>
    </details>
    <details class="tree-panel" open>                         <!-- section 2, same class as today -->
      <summary>JSX tree</summary>
      <ul class="tree-root">...</ul>
    </details>
  </div>
</div>
```

- **One outer card, not two.** `GlassPanel` (React component, already supports an `as` prop) wraps
  both sections once; `.pages-browser`/`.tree-panel` stop being `GlassPanel`s themselves and become
  plain `<details>` rows inside it — border-bottom between them, no border/shadow/blur of their
  own (mirrors `.pal-group`'s look exactly, not a new visual language). `GlassPanel` already
  supports rendering as a different tag (`<GlassPanel as="details" className="pages-browser"
  open>`), so this is a small, mechanical change to two existing call sites, not a rewrite.
- **"All pages" moves inside the first section**, right after the file list — it is an action
  about "which file", so it belongs with the file picker, not floating between the two named
  groups. Still the same `<button>`, same class, same testid; `pages-screen.spec.js`'s
  `getByTestId('pages-all')` doesn't assert on its position, only its visibility/click, so this is
  selector-safe.
- **Independent collapse**: two separate `<details>`, each with its own `open` state (defaults to
  `open`, same as `.pal-group` defaults open) — collapsing one is completely independent of the
  other, since that's just how two sibling `<details>` elements behave; no bespoke state needed.
- **Second section's label and content are dynamic, matching the state already in the data**
  (§0's three states): "Files" always heads section one; section two reads "JSX tree" (a page is
  open), "All pages" (no feature chosen — the `ListBrowser` renders here instead), or "JSX tree"
  with an empty-state paragraph (feature chosen, no page open yet — see §4). This is a label/content
  swap already implied by the existing conditional in `PagesBrowserTab.tsx`; nothing new to compute.

## 3. Mocks (`docs/design/mocks/`, own build script + stylesheet per README convention)

Built by `node docs/design/mocks/build-browser-merge.mjs`, styled by `browser-merge.css`
(deliberately reuses the *real* `ui/client` class names — `pe-browser`, `pages-browser`,
`tree-panel`, `pages-file-list`, `pe-all-pages`, `tree-root`/`tree-node`, `lb`/`lb-*` — so this
reads as a literal before/after of the shipped screen, not an abstract concept; new classes are
prefixed `pbm-`). Rendered to `docs/design/mocks/png/browser-merge-*--{dark,light}.png` via
`node docs/design/mocks/render.mjs browser-merge`, viewed in both themes, iterated twice (label
alignment/`.field` collision with `mock.css`'s generic rule; a selected-`<Counter>`-node contrast
gap that turned out to be a *mock* omission, not a real bug — see §5).

| File | What it shows |
|---|---|
| `browser-merge-before.html` | Today, literally: two floating `.glass-panel` cards (`pages-browser`, `tree-panel`) with a bare `.pe-all-pages` button between them |
| `browser-merge-after.html` | Merged: one `.pbm-glass` card, two open `<details>` (`Files 1`, `JSX tree`), "All pages" now inside Files |
| `browser-merge-states.html` | Six state cards: Files collapsed/tree open, both collapsed, keyboard focus (visible ring on `<summary>`), no-feature-selected (section 2 = All-pages `ListBrowser`), feature-picked-no-page-yet (section 2 = new empty state), all-pages list error (reuses `ListBrowser`'s existing `ErrorState`) |
| `browser-merge-narrow.html` | 390px width — no special narrow-only behaviour needed; the group just stacks and scrolls like any other pane content |

## 4. The one small, deliberate scope addition: section 2's empty state

Today, "feature picked, no page open yet" renders **no second element at all** (`{roots &&
<TreePanel/>}` short-circuits to nothing) — fine when the two things were independent floating
cards that could each appear or vanish on their own, because there was no shared "these are a pair"
visual claim being made. Once they're presented as one named, persistent group (`Files` / `JSX
tree`), a second section that sometimes just isn't there reads as broken, not as "empty" —
`principles.md` #9 requires a designed empty state, not blank space, for exactly this reason. The
fix is a single line of copy inside the always-rendered second `<details>`: "Open a page above to
see its structure." (see `browser-merge-states.html`'s "Feature picked, no page open yet" card).
This is still squarely inside #536 — it's a direct, necessary consequence of merging two
independently-optional things into one persistent group, not a separate feature.

## 5. What was checked and corrected while iterating (real evidence, not fabricated)

- `.field`'s generic rule in `mock.css` (a chip-style horizontal control used for Inspector props)
  collided with the Feature `<label class="field">`, centering it — fixed by giving
  `.pages-browser .field` its own `flex-direction: column` + `align-items: stretch` instead of
  relying on the generic class.
- First render of `.tree-node.selected` on a `.component` node (`<Counter>`) showed amber text on
  the accent-blue selection background in the mock — investigated against the real
  `ui/client/app/globals.css` and found the real product already has the fix
  (`.tree-node.selected .tree-node-tag { color: inherit; }`, line ~758): the mock's stylesheet had
  simply omitted that override. Added it so the mock doesn't claim a bug that isn't real. No issue
  filed — nothing to fix in the product.

## 6. Accessibility review (`principles.md` checklist)

- **Contrast**: no new colours — `.pbm-group`/border/`summary` reuse `--border-subtle`,
  `--text`/`--text-muted` pairs already audited in `tokens.md` (7.1-7.3:1). The disclosure triangle
  uses `--text-faint` (4.8-5.2:1, meets AA for the small glyph it is, same as `.pal-group`'s already-
  shipped marker).
- **Keyboard path**: native `<summary>` is a real, focusable, `Enter`/`Space`-toggleable control —
  no bespoke JS, no new tab stop ordering to get wrong. Two sections means two tab stops instead of
  zero (today's `<h4>`s inside each `GlassPanel` are not focusable at all) — a small net keyboard
  improvement, not a regression.
- **Focus visible**: `summary:focus-visible` gets the shared `--focus` 2px ring (same token every
  other control uses), shown concretely in `browser-merge-states.html`'s "Keyboard focus" card.
- **Target size**: `<summary>` row is full-width, ~28px tall — exceeds the 24px minimum.
- **Status not by colour alone**: collapsed/expanded is conveyed by the ▸/▾ glyph *and* the
  `aria-expanded`-equivalent semantics `<details>` exposes natively to assistive tech (its `open`
  attribute is reflected as part of the platform's disclosure-widget role) — not colour.
- **Reduced motion**: the only animation is the 0.15s marker rotation on open/close, identical to
  `.pal-group`'s already-shipped transition; add it to the existing `prefers-reduced-motion: reduce`
  block alongside that one when implemented (not yet scoped for `.pal-group` either — flag for the
  same follow-up, not a new gap this ticket introduces).
- **Empty/error states**: covered in §3/§4 (empty: no page open yet; error: all-pages list load
  failure, reusing `ListBrowser`'s existing, already-accessible `ErrorState`/`onRetry`).
- **Narrow**: works unchanged at 390px (§3) — two stacked, scrollable `<details>` need no
  narrow-specific behaviour.
- **Theme parity**: both mocks rendered and viewed in dark and light (`--dark.png`/`--light.png`
  for every file above); no theme-only issue found.

No violation found that would block implementation.

## 7. Implementation plan (single slice — this is a small, one-piece change per README's own rule
that a flat issue is fine for small work; no epic/sub-issues needed)

1. `ui/client/features/pages-editor/components/PagesBrowser.tsx` / `TreePanel.tsx`: in the
   Files-view call sites only, stop rendering their own `GlassPanel`; `PagesBrowserTab.tsx` wraps
   both in one `GlassPanel` + renders each as a `<details>` (via `GlassPanel`'s existing `as` prop,
   or a plain `<details className="pages-browser">` if simpler — implementer's call, no behaviour
   difference). Flow-view's standalone `PagesBrowser` call (`showPages={false}`) is untouched.
2. Move `.pe-all-pages` inside the first `<details>`, after the file list.
3. Add the always-present second section + its "Open a page above..." empty state (§4).
4. CSS: retire `.pages-browser`/`.tree-panel`'s own glass-panel-card styling for the Files-view
   nesting, add `.pe-browser-group` (or similar) + the `.pal-group`-style disclosure rules (copy
   `.pal-group`'s pattern, ~globals.css:2047-2075).
5. New/updated Playwright spec (`ui/e2e/tests/`, rule 11): assert both sections are independently
   collapsible (`toBeVisible()`/`not.toBeVisible()` on each `<details>`'s content after clicking its
   `<summary>`, collapsing one leaves the other's `open` state untouched), and that "All pages" and
   the Feature select are still reachable via keyboard (`Tab` to `<summary>`, `Enter` to expand).
6. Full existing suite must stay green unmodified: every spec in §1's table (no selector or
   DOM-nesting assertion in any of them breaks per this design — the class names and testids are
   preserved exactly).

Design: this ticket, spec `docs/design/browser-panel-merge.md`, mocks `docs/design/mocks/
browser-merge-{before,after,states,narrow}.html`.
