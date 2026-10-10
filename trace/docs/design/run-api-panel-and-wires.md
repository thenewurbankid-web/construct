# Run screen — API contract panel, drag-to-attach wires, adapter creation

Status: draft, pending Ad hoc Dev buildability + Design QA review + owner approval (LIN-89).
Part of: [[LIN-85]] (Run screen), builds on `docs/design/screen-map.md` §2 "Run".
Base: the Map view in `src/ui/canvas/` (`map.mjs`, `render.mjs`, `parts.mjs`, `layout.mjs`), theme tokens in `TOKENS` (`src/tree/svg.mjs`).

## 1. Screen and today's behaviour

The Map (right-hand columns of `buildMap()`, `parts.mjs:79-108`) draws two node columns joined by edges:
- **Left**: one node per page part (`p.id`, `p.term` ∈ fit/wait/gap/tie/stub).
- **Right**: one **API card** per contract endpoint (`ep:GET /api/orders`, coloured by method), plus special nodes (`wait`, `gap`, `tie:*`, `stub`, `kept`).
- **Edges** ("wires") connect each part to where it resolved: fit → its endpoint/field, wait → the `wait` node, tie → `tie:<endpoint>` or `tie:none` (no endpoint decided), gap → `gap`.

Today the Map is **read-only**: `map.mjs` supports pan/zoom/hover/click-to-select only (`pickAt`, no drag). Clicking a node calls `onSelect`, which the Run screen currently uses to highlight the matching row in the parts list (`inspector/inspector.mjs`) — it does not open a panel.

This spec adds four things on top of that, in order of build size: (1) an API contract panel, (2) making a subset of wires draggable, (3) compatibility highlighting while dragging, (4) an adapter-creation flow when nothing matches.

## 2. What counts as an "unassigned wire"

Only **Tie** wires that resolved to `tie:none` are unassigned in the sense this ticket means: the design found two or more equally good fields, but the field pointer never named an endpoint (`buildMap`, `parts.mjs:96`: `tie:none` is added exactly when `parts.some(p => p.term==="tie" && !p.src.endpoint)`). These render amber (`pal.tie`, `--amb`/`--tie` tokens) and are visually the "yellow/amber wire" the ticket describes.

**Wait** wires (also amber, `pal.wait`) are excluded from dragging: `sourceOf()` (`parts.mjs:34-39`) already resolves a best-guess endpoint for a Waiting part when one exists (GET for value/list parts, POST for form parts) — a Waiting part with no candidate endpoint at all has nothing to drag onto (the API doesn't exist in the contract), so it stays fixed and its card offers "Upload a contract" (reuses `contract-panel.mjs`'s empty state) instead of drag-to-attach.

**Gap** wires stay fixed too: a Gap is a confirmed absence ("nothing behind it"), not an unresolved match — re-pointing a Gap is a contract edit (add the endpoint), which belongs in the contract panel's edit mode (§3), not a drag gesture.

This scoping keeps "draggable" == "the system found the field but couldn't pick the endpoint automatically," which is the one case where a human choosing among existing APIs is the whole fix — matching the ticket's "drag onto an API to attach it" framing.

Design QA note to confirm: if the owner's screenshot (not attached) shows a different wire as "the unassigned one," re-scope before build — flag this explicitly in review since the source screenshot was unavailable when this spec was written.

## 3. API contract panel

### Trigger and states

Clicking an **API card** (an `ep:*` node, or the compact endpoint row in the contract rail already drawn by `contract-panel.mjs`'s `contractLoaded()`) opens a right-side drawer, reusing the existing drawer pattern from the Ask card / inspector chrome (`inspector/inspector.mjs`) rather than a new modal system.

```
┌─ Run ──────────────────────────────────────────────────┬─ API contract ──────────────┐
│  [ring]  8 of 29 fit · 3 waiting · 2 gaps · 1 tie       │  GET /api/orders        ✕   │
│                                                          │  ────────────────────────── │
│   ┌ parts ┐        wires        ┌ APIs ┐                │  Request                    │
│   │ Total ●───────────────────●│GET /api/orders│         │   (none)                    │
│   │ Status●╌╌╌╌(tie, amber)╌╌╌●│ tie: which field? │     │  Response  {view|edit}      │
│   │ Notes ●┄┄┄(gap, red)┄┄┄●│  gap  │                    │   { id, total, status,      │
│   └───────┘                    └──────┘                 │     placedAt, customer }    │
│                                                          │                             │
│                                                          │  Fields used by this run    │
│                                                          │   total     → Total (fit)   │
│                                                          │   status    → (tie, 2 parts)│
│                                                          │                             │
│                                                          │  2 gaps in the contract      │
│                                                          │   • customer.email missing  │
│                                                          │                             │
│                                                          │  [Edit contract] [Re-upload] │
└──────────────────────────────────────────────────────────┴─────────────────────────────┘
```

Panel content, states:
- **Loaded, has a body** (`contractLoaded()` data): method + path header, request/response body (view mode: pretty-printed JSON/schema from the endpoint's example, matching `endpointList()`'s existing request/response badges; edit mode: textarea over the raw example, save re-validates against the same parser the upload path uses — no new validation logic, reuse `contract-panel.mjs`'s error surface `ct-err`). "Fields used by this run" lists every part this endpoint accounts for (from `fieldsByEp`/`tiesByEp` in `buildMap`), each linking back to the part's row in the inspector list (click → `onSelect` on that left node, existing behaviour).
- **Loaded, no example** (`endpoint.request/response === "no-example"`): body section shows the existing amber "no example" badge plus a one-line explainer ("the contract names this field but has no sample value — a run can't confirm the type") instead of a body preview.
- **Empty / no contract** (`contractEmpty()`): the whole right column becomes the existing upload dropzone; no per-endpoint body applies since there is no endpoint yet. Reached when the card being clicked is a special node (`wait`, `gap`) rather than a real `ep:*` node.
- **Error** (`c.error` set — malformed contract): existing `ct-err` banner, panel offers "Re-upload" only, no edit mode (can't edit what didn't parse).
- **Loading**: while the panel's own data is being fetched (should be instant — everything is already in `idx`/`parts` client-side — but if `useSaved`/re-fetch introduces a round trip per the screen-map's open Run-screen question, show a skeleton row matching the header + 3 placeholder lines, no spinner, per the demo's existing no-spinner convention in `wire-delay.mjs`).

Closing: `✕`, `Escape`, or click-away (standard drawer dismiss, matches inspector drawer today).

## 4. Drag-to-attach

### Idle → grabbable

An eligible wire (§2: a `tie:none` edge) gets a **grab affordance** on hover: cursor becomes `grab`, the wire thickens by 1px and gains a subtle pulse (reuse `drawMarks()`'s existing "pause" mark style — open ring + dot — already used for Waiting terminators, so the vocabulary of "this thing is unsettled and interactive" stays consistent with what a Waiting node already looks like). A small drag-handle dot sits at the wire's `tie:none` end.

### Dragging

Pointer-down on the handle detaches the wire's endpoint from `tie:none` and follows the pointer (canvas redraw each frame, same `raf` loop `map.mjs` already uses — no new render loop). While dragging:

```
   Total  ●──────────────────●  GET /api/orders          (full colour: compatible)
   Status ●╌╌╌╌╌╌╌╌╌╌╌╲                                    
          (following the      ╲   POST /api/orders        (dimmed: incompatible)
           pointer, amber,      ╲
           dashed)               ●·(cursor)
                                  
                                 GET /api/customers        (full colour: compatible)
                                 
                                 [+ Create adapter]         (appears only if nothing matches, see §5)
```

- **Compatible** API cards (§4.1) render at full opacity/contrast, with a thin highlight ring in `--acc` (the existing accent token, not a new colour — keeps "this is a valid drop target" distinct from the state colours which already mean fit/wait/gap/tie).
- **Incompatible** API cards dim to the existing `svg.dim` treatment already defined in `TREE_CSS` (`opacity:.18`) — no new dim rule, reuse the tree view's established "de-emphasize" pattern.
- The dragged wire itself stays amber/dashed (it is still a Tie until dropped), so its identity doesn't change mid-drag.

### Drop

- **On a compatible card**: wire snaps to that endpoint, tie is resolved — this is a decision, so it goes through the same `answered` path the Ask card uses today (`EVENT_TERM.answered → ledger`), attributed to the user, not silently mutating `idx`. The panel briefly confirms ("Attached to GET /api/orders — recorded as your answer") reusing the Ask card's existing confirmation toast pattern.
- **On an incompatible card**: rejected — wire snaps back to `tie:none` with a short shake (`prefers-reduced-motion`: no shake, just an amber flash on the target card's border instead, per the demo's existing reduced-motion gate for ring/ask animations, `demo.mjs:20,341,461`).
- **Off any card** (dropped on empty canvas): same snap-back as incompatible.
- **On the "Create adapter" affordance** (only present when zero compatible cards exist, §5): opens the adapter flow instead of resolving directly.

### Compatible = matches by data type (deterministic, AI-READY)

"Pluggable" is computed the same way `buildMap`/`breakdownByEndpoint` already reason about fields — by static comparison, no model call:
- The dragged part's expected type comes from its tree node (`leaf` cell metadata — the same source `partName`/`sourceOf` already read).
- Each candidate endpoint's field types come from its parsed contract example (the same JSON the contract panel renders in §3).
- A candidate is compatible iff at least one of its fields' inferred type (string/number/boolean/array/object, from the example JSON's runtime `typeof`, same inference the contract upload path already needs to build `endpointList()`'s per-field badges) matches the part's expected type.
- This is a pure function over data already loaded client-side — no network round trip while dragging, so the highlight can update at pointer speed.
- Per the ticket's AI-READY line: this matching is 100% rule-based. Nothing here is a suggestion needing a verifier — it's the same kind of closed-option computation the contract panel's gap list already does. If a future pass adds an AI-suggested "best of the compatible matches," that suggestion must render as a proposal (e.g. a soft outline on one of the already-compatible cards, "AI suggests this one — still your choice"), never as an auto-drop, matching the AI-READY policy in `CLAUDE.md`.

## 5. No match → Create adapter

When a drag has **zero compatible cards** at pointer-down time (computed once, not per frame — the set of endpoints doesn't change mid-drag), the drop targets area shows one additional affordance instead of nothing:

```
   No endpoint's fields match this part's type.
   ┌─────────────────────────────┐
   │  + Create adapter…           │
   └─────────────────────────────┘
```

Dropping there (or dropping directly on any API card while zero are compatible — the incompatible-card drop still offers this instead of a plain reject, since the user's intent to attach is clear) opens the **adapter flow** as a step inside the API contract panel (§3), not a new page:

```
┌─ API contract — adapter for GET /api/orders ────────────┐
│  Status (needs: string enum) doesn't match any field.    │
│  Map it through an adapter:                              │
│                                                            │
│   Status  wants   string enum{open,closed,…}              │
│                                                            │
│   from field:  [ status_code ▾]   (number)                │
│   transform:   [ map: 1→open, 2→closed, … ▾ ]              │
│                                                            │
│   preview: status_code=1  →  "open"          ✓ valid       │
│                                                            │
│   [Cancel]                      [Save adapter & attach]    │
└────────────────────────────────────────────────────────────┘
```

- Field picker lists every field on the target endpoint regardless of type (the adapter's whole job is to bridge the type gap) — this is the one place types don't gate the choice, since the point of an adapter is to reconcile a mismatch.
- Transform choices are a closed set determined by the two types involved (number→enum offers a value map; string→string offers passthrough or a regex/substring picker; nothing free-text or code-eval — stays inside "small deterministic blocks," not an escape hatch into arbitrary logic).
- A live preview evaluates the transform against the endpoint's actual example value (already loaded) so the mapping is checked before saving, not after — same "closed options, reviewable diff" principle as everywhere else in Construct.
- Saving an adapter is a decision too (recorded like §4's direct attach): it creates the mapping AND resolves the tie in one action, attributed to the user. It never auto-picks a transform — the picker starts empty/unselected, forcing an explicit choice (no "AI already filled" default, matching AI-READY's "no unverified pick").
- **Buildability flag for Ad hoc Dev**: this is the heaviest single piece of this ticket — it needs a persisted adapter/mapping concept that doesn't exist in the current contract model (`contract-panel.mjs`, `parts.mjs` have no notion of a field transform). Confirm before implementation whether adapters are runtime-only (applied when replaying this run) or need to persist into the contract file itself for future runs.

## 6. Empty / error states

| State | Trigger | Treatment |
|---|---|---|
| No contract at all | `contractEmpty()` | Right column collapses to the upload dropzone (§3); no API cards, no draggable wires exist yet — dragging is disabled entirely until a contract loads. |
| Contract fails to parse | `c.error` set | Existing `ct-err` banner in the panel; canvas still shows whatever endpoints parsed before the error, if any; no adapter flow (nothing to map to yet). |
| Drag started, then contract reloads mid-drag (re-upload race) | user re-uploads via the panel while a drag is active | Cancel the drag immediately, snap the wire back, toast "Contract changed — try again." Rare edge case, cheap guard (one flag check in the drop handler), worth stating explicitly since two async things (contract upload + a canvas gesture) can otherwise race. |
| Adapter preview fails (transform doesn't cover the actual example value) | user picks an invalid mapping | Inline error under preview ("this value isn't covered by the map"), Save disabled — same disabled-until-valid pattern as the rest of the app, no new pattern. |

## 7. Accessibility

- **Color is never the only signal.** Compatible/incompatible during drag adds a shape cue, not just opacity: compatible cards additionally gain the `--acc` ring (a stroke, not a fill change) and a small ✓-shaped mark rendered at the card's corner; incompatible cards additionally show a ⌀ (not-allowed) glyph at 40% opacity in the corner, matching the "shape or word besides colour" bar `docs/design/screen-map.md` §5 already sets for this project. Contrast of the new `--acc` ring against `--card`/`--bg` in both themes must pass 3:1 — add to `theme.test.mjs`'s existing `SEMANTIC` contrast table rather than a new check (same instruction Design QA gave on the screen-map doc). (`--surface`/`--surface-2` do not exist in `TOKENS`, `src/tree/svg.mjs:115-133`; corrected per Design QA's review on LIN-91.)
- **Keyboard path (no pointer required):**
  1. Tab reaches an eligible wire same as any other focusable node (the Map's nodes need `tabindex`/roving focus — today `map.mjs` has no keyboard handling at all for node selection; this ticket is the first thing that needs it, so it's new work, not a reuse).
  2. `Enter` or `Space` on a focused eligible wire enters "attach mode" (announced via `aria-live`: "Attaching Status. 2 compatible APIs. Use arrow keys to choose, Enter to attach, Escape to cancel.") — functionally identical to a drag but driven by arrow keys cycling only through compatible cards (incompatible ones are skipped, not just visually dimmed, so keyboard users never land on an invalid target).
  3. `Enter` attaches (same as a valid drop); `Escape` cancels (same as snap-back).
  4. If zero compatible cards, the announcement includes "No matching API. Press A to create an adapter," and `A` opens the adapter flow (§5) with focus landing on the field picker.
  5. The adapter dialog itself is a standard modal focus trap (matches existing inspector drawer focus handling) — Tab cycles field picker → transform picker → preview (read-only, not tabbable) → Cancel/Save, `Escape` cancels.
- **`prefers-reduced-motion`**: drag-follow itself is pointer-driven (not an animation) so it's unaffected, but the snap-back, shake, pulse-on-hover, and toast entrances must all gate on the media query, per the same rule `screen-map.md` §5 sets for shell chrome — listed per-effect in §4 above so it isn't missed at build time.
- **API cards and wires need accessible names** for screen readers even outside drag mode: an `ep:*` node's name is already `GET /api/orders` (usable as-is); a `tie:none` wire needs a name today it doesn't have in the canvas (canvas nodes are pixels, not DOM) — recommend an offscreen/SR-only list mirroring the inspector's existing "one plain sentence per part" text (`describe()` in `parts.mjs` already produces exactly this sentence: "Status: Tie, two or more fields fit equally, so someone has to choose" — reuse verbatim as the accessible name, don't write a second copy).

## 8. Open questions for review

1. **Owner's screenshot wasn't attached to this ticket.** §2's scoping (unassigned = `tie:none` only) is my best reading of "unassigned link" against the current code; if the screenshot shows Gaps or Waiting-with-no-candidate as the draggable case too, the scoping section and the drag-eligibility rule change but the panel/adapter/accessibility sections should still hold.
2. **Adapter persistence** (§5, buildability flag) — runtime-only vs. saved into the contract — needs an Ad hoc Dev answer before implementation sizing is final.
3. This spec assumes the Map view described in `screen-map.md` is the "Trace screen with API cards and wires" the ticket means (the only screen with that literal shape today). Flag on this task if a different screen was intended.
