# Managed template expressions: a registry (list, if, ternary, switch, value)

Status: draft v3 (re-pointed to the demo page). Supersedes v2.1, which grounded this spec in `/studio`'s Page Map (`src/ui/pagemap.mjs`) and its Map/wires (`src/ui/canvas/map.mjs`, `parts.mjs`). **Owner correction, 2026-09-29: all of the owner's requests are for the demo page (`/`, `src/ui/demo.html` + `demo.mjs`) — the demo page is the product UI.** This revision keeps v2.1's registry model, detection rules and per-kind inputs (they are screen-agnostic data model), and replaces every UI/wiring section that pointed at `/studio` with the demo page's own equivalents. Needs a fresh Ad hoc Dev buildability pass and Design QA review before a new owner approval request — the previous approval interaction (`e6770cf2`) expired/was superseded by this correction, so this is not a resubmission of the same review.
Part of: [[LIN-85]] (the demo page as the Trace product UI).
Base: `src/ui/demo.mjs` (the ring, part list, Ask card), `src/ui/inspector/inspector.mjs` (the per-part detail panel — "Blocks" options, Suggest, Apply/Undo/Redo), `src/ui/canvas/trace.mjs` (the API rail and endpoint panel — this is where LIN-89's "API contract panel + wires" spec actually landed on the demo page; **`src/ui/canvas/map.mjs`/`parts.mjs`/`contract-panel.mjs` are `/studio`-only and are not this spec's base**), `src/ui/vocab.mjs` (the `value.*`/`list.*`/`action.*`/`row.*` id namespace parts already use), `src/pagemap/states.mjs` (server-side conditional detection — this one stays valid: it runs in the import pipeline before either UI, so it is reused unchanged regardless of which screen renders the result). Theme tokens: `TOKENS` in `src/tree/svg.mjs`, served as `/theme.css`.
Grounded in Ad hoc Dev's original feasibility notes on this issue (2026-09-29, still valid for the registry shape and detection rules) plus a fresh read of `demo.mjs`/`inspector.mjs`/`canvas/trace.mjs` for this revision.

## 0. What already exists on the demo page (don't rebuild)

- **Parts already have a namespace this registry can reuse, not replace.** Every part on the demo page carries an id in `value.*` / `list.*` / `action.*` / `row.*` / `form.*` (`demo.mjs:611`, `vocab.mjs:119` strips exactly this prefix set). `list.sort` already exists as a real id (`vocab.mjs:127`, `demo.mjs:754`). **v2.1's separate `expr.<name>` key space is dropped in this revision** — a registry entry's `key` is the part's own id (e.g. `list.orders`, `value.status`), and `kind` (`value`/`list`/`if`/`ternary`/`switch`) is metadata on that same part, not a parallel record. This is smaller than v2.1's model and matches how every other part-level fact (term, badge, edited-by-you) already attaches to the id.
- **The per-part detail panel already exists and already has an extensible "ways to build it" list.** `inspector.mjs`'s `optionsHtml()` (`inspector.mjs:161-171`) renders `d.options` as a radiogroup of `pi-opt` cards, each with a label, an optional "Rule default" badge (`o.ruleDefault`, deterministic-rules-first, exactly this ticket's AI-READY requirement), an optional "Suggest's pick" badge, a proof table against the design's own examples (`proofHtml`), and — when selected — a stub editor (`stubEditor`, `inspector.mjs:147-159`) for the fields/function/expression a stub option needs. **This is the one panel every kind's config (§4) plugs into as one more option kind, not a new panel.**
- **Apply/Undo/Redo already is the accept/reject/clear mechanism this ticket asks for.** `barHtml()` (`inspector.mjs:220-234`): selecting an option and pressing Apply commits it (with a live preview of what changes first, `previewHtml()`, `inspector.mjs:176-192`); "Undo" (`data-undo`) and "Redo" exist per-part and globally (`d.undo`/`d.redo`, the newest change on any part). **v2.1's separate `S.data.decisions` accept/reject/clear cycle does not exist on the demo page and is not needed — Apply/Undo already gives every kind reversibility and a recorded decision (the history entry) for free.**
- **Conditionals already exist, server-side, under a different name: "states"** (`src/pagemap/states.mjs`, unchanged from v2.1 — this file is import-pipeline logic, not `/studio` UI, so it is still the right reuse regardless of screen). `detectStates()` finds `cond && <X/>` (logical), `a ? <X/> : <Y/>` (ternary), and `.map()` empty branches. Today its output does not reach the demo page's part list at all — this is new wiring this spec adds (§2, §6), not a re-point of existing wiring.
- **The API rail and endpoint panel already exist on the demo page** (`canvas/trace.mjs`: `paintRail()` line 184, `endpointPanelHtml()` line 205) and already show, per endpoint, which parts fit/tie/wait against it (`ep.mjs` fields used, `trace.mjs:207-219`). **This is what a `list`/`if`/`ternary`/`switch` kind's "what does this bind to" needs to extend (§5), not the `/studio` Map's bipartite graph** — the demo page has no Map screen and this spec does not add one.
- **Repeated-structure detection** server-side into groups (`S.data.groups` in the `/studio` pagemap pipeline: `template`, `members`, `count`, `slots`, `mapped`) still exists and is still the right detector for the `list` kind (§2) — it is a classification-pipeline concern, same as `states.mjs`, independent of which screen consumes its output.
- Nothing in `packages/core/typed-contracts` (`defineExpression`) is reused — unrelated Construct code-composition contract (carried over from v2.1, still correct).

## 1. The registry model

One shape for every kind. Smaller than v2.1: `key` is the part's own id, no parallel `expr.*` namespace (§0).

```
{
  key:      "value.status" | "list.orders" | ...,   // the part's own id, same namespace demo.mjs/vocab.mjs already use
  kind:     "value" | "list" | "if" | "ternary" | "switch",
  origin:   "auto" | "manual",                       // detected by the pipeline, or set by the user via the inspector
  marker:   { attr: "data-expr", value: "<kind>", params: {...} },  // how a design/export durably records the kind
  inputs:   { ... kind-specific, §2 },
  option:   { ... the pi-opt entry this kind adds to d.options, §4 },
  codegen:  { template: "<jsx snippet>" },
  reversible: true                                    // via Undo/Redo (§0), not a bespoke unwind
}
```

- `marker` generalises `data-list="name"` / `data-dyn="name"`: a design (or a hand-written page Trace re-exports to) can carry `data-expr="if" data-expr-cond="..."` as an explicit, durable marker — `data-list`/`data-dyn` stay valid as accepted aliases for `kind:"list"`/`kind:"value"` so no existing fixture breaks.
- Every kind renders as one more entry in `d.options` (§0, §4) and is committed/reverted through the existing Apply/Undo cycle (§0) — the registry's whole point is that adding a kind later (`format`, `slot`) means one more row in §2's table and one more `option` renderer, not new plumbing.
- `list` is the one kind whose `inputs` also imply child nodes (the item template, one row per list item already shown via `groupItems`, `vocab.mjs:108-115`); every other kind's `inputs` describe branches of the *same* part — the one structural difference the UI accounts for (§4).

## 2. Detection per kind (deterministic, Babel AST, AI-READY: rules first)

| Kind | AST pattern | Source | Notes |
|---|---|---|---|
| **value** | Any `JSXExpressionContainer` not matched by a more specific rule below | Existing default / `data-dyn` | Trivial kind; no config beyond the part's existing name. |
| **list** | `JSXExpressionContainer` wrapping a `.map()` call with an arrow returning JSX, OR `data-list` marker, OR 3+ same-shape siblings (`collapse.mjs`) | Existing group detection (§0) + new `.map()` AST rule | Item rows already render via `groupItems` (`vocab.mjs:108`); this kind makes the grouping a first-class option instead of an implicit display behavior. |
| **if** | `LogicalExpression` (`&&`) inside a `JSXExpressionContainer` | `states.mjs`'s existing `cond && <X/>` matcher, reused not duplicated | Absorbs `states.mjs`'s `conditional`/`branch:"then"` case with no `else`. |
| **ternary** | `ConditionalExpression` in a `JSXExpressionContainer` where at least one branch is JSX or `null` | `states.mjs`'s existing ternary matcher, reused not duplicated | Both branches (`then`/`else`) merge into one entry, since that is how the panel edits it (§4b). |
| **switch** | `SwitchStatement` returning JSX per `case` (usually inside an IIFE), a lookup/dispatch object indexed by a variable, or a chained ternary (`a===x?A:a===y?B:C`) | **New** — no existing matcher | Chained ternaries: 3+ links in one chain classifies as `switch`, 2 links stays `ternary` — a fixed threshold, not a heuristic (open question, §10.4). |

Anything not matching a row above stays today's opaque, unclassified part — **never guessed**, per AI-READY. Detection runs in the existing import pipeline (still server-side, still pipeline logic independent of `/studio` vs. the demo page), alongside `suggest-markers.mjs`/`states.mjs`; its output needs a new step to actually reach `d.options` on the demo page's part data (§4), since nothing reads it there today (§0).

## 3. Per-kind inputs

| Kind | `inputs` | binds to |
|---|---|---|
| value | `{ name, example }` | one value field, exactly today's `data-dyn` |
| list | `{ sourceList, itemFields, templateNodeId }` | one list + N item-field mappings — the same fit/tie/gap vocabulary the part's own `term` already uses (`demo.mjs`'s `TERMS`) |
| if | `{ condition, thenBranch, elseBranch?: null }` | one boolean-ish field the condition reads, plus the branch's own nested part(s) |
| ternary | `{ condition, thenBranch, elseBranch }` | same as `if`, both branches required |
| switch | `{ discriminant, cases: [{match, branch}], default? }` | one field (the discriminant) + one binding per case value, same fit/tie/gap matching as list fields |

`condition`/`discriminant` bind the same way any part binds today: to a value field, an API field (from the rail, §5), or stays unbound (renders as a Gap, §8) — a condition is just another value binding, reusing the existing Fit/Wait/Gap/Tie vocabulary rather than inventing a truthy/falsy-specific one.

## 4. The UI panel: one more option kind, not a new panel

No new screen or panel. Opening a part (clicking its badge on the page overlay or its row in the part list — the existing `data-open-part` mechanism, `inspector.mjs:401`) already shows `d.options` as a radiogroup (§0). This spec adds: when the AST detects a kind (§2) for this part, its detected shape shows up as one more `pi-opt` card, labelled "Make it a list / conditional / ternary / switch," carrying the `Rule default` badge (§0, deterministic detection = a rule default, exactly like every other rule-picked option today) so it's pre-selected without being silently applied — the user still presses Apply.

**a) List** — the option's expanded body (shown when selected, same place `stubEditor()` renders today) is a source-list picker + item-field table: radios for candidate lists, a fit/tie/gap row per field, identical in shape to `optionsHtml()`'s existing proof table (`proofHtml`, `inspector.mjs:139-143`) so it reads as "one more kind of proof," not a new interaction.

**b) If / Ternary**

```
┌─ pi-opt: "Make it conditional" ─────────────── Rule default ─┐
│  Condition                                                     │
│   ( ) value.isPriority          — from the design               │
│   (•) GET /api/orders → priority — from the rail (§5)           │
│   ( ) Not sure yet                                                │
│  Then (condition true)      <div class="order-row">…</div>        │
│  Else (condition false)     [ + Add an else branch ]               │  ← ternary / if-with-else only
└──────────────────────────────────────────────────────────────┘
```

Prefilled from `states.mjs`'s own condition text, the same way a stub option is prefilled from the design's own fields (`stubEditor`, §0) — confirm or rebind, never retype from scratch.

**c) Switch**

```
┌─ pi-opt: "Make it a switch" ──────────────────────────────────┐
│  Discriminant: value.status   (from the rail, §5)                │
│  Cases                        maps to                            │
│   "pending"   ──────────────  <Badge variant=pending>             │
│   "shipped"   ──────────────  <Badge variant=shipped>             │
│   "cancelled" ──────────────  <Badge variant=cancelled>           │
│   default     ──────────────  (unmapped)  + Add mapping           │
└────────────────────────────────────────────────────────────────┘
```

Cases pre-populate from the AST's own `case`/lookup keys, each auto-matched against the discriminant's known values the same fit/tie/gap way list fields match. An unmapped case is a Gap, same as an unmapped list field — not blocking Apply.

**Save/Apply** for every kind: pressing Apply on the option commits it exactly like any other option today (`barHtml`, §0) — preview shows the same "this part: before → after" and "fit report" delta (`previewHtml`, `inspector.mjs:176-192`) it already shows for a stub choice, and the part's badge switches to a kind chip (`cls-if`, `cls-ternary`, `cls-switch`, alongside the existing per-term chip classes). **Undo** reverts it, same as any other Apply (§0) — no new "Cancel" affordance needed since nothing writes until Apply, same rule every option already follows.

**d) Value — no new option.** `value` is the part's existing default state when no other kind's AST pattern matches (§2); there is nothing to convert it into, so no `pi-opt` card for it. This is why §2/§3's table has a `value` row but this section has no `d) Value` card to match — intentional, not a gap (carried over from v2.1's reasoning, still correct).

## 5. Linking to the rail / endpoint panel

Extends `canvas/trace.mjs`'s existing rail and endpoint panel (§0) — **not** a Map/wires screen; the demo page has none and this spec doesn't add one.

- **List** — the rail's per-endpoint field list (`endpointPanelHtml`, `trace.mjs:217-219`, "Fields used by this run") gains one more grouped row: a list's item fields show together under the list's name with a small count badge (`×N`), instead of as N separate `ep-field-link` rows — same list, same links, just grouped.
- **If / Ternary** — the condition's binding renders as one ordinary `ep-field-link` row (like any `value.*` part today); the part's own row in the part list (`paintList`, `trace.mjs:195-199`) gains a small ⚡`if`/`?:` glyph next to its term swatch so it reads as conditional at a glance — glyph, not color-only, per accessibility (§9).
- **Switch** — same treatment as if/ternary but N case rows instead of two, discriminant listed first.
- No new tokens: reuses the rail/list's existing `TOKENS` swatches (`card`/`bg`, `src/tree/svg.mjs:115-133` — the `surface`/`surface-2` names v2.1 used do not exist in `TOKENS`; this revision cites the real token names directly, no separate correction needed since it's grounded fresh).

## 6. Auto-refactor: detection becomes a rule-default option, for every kind

- **Detection** runs the AST rules (§2) during import, same pipeline pass as today's group/state detection.
- **Every hit adds a `Rule default`-badged option** to that part's `d.options` (§0, §4) — nothing is silently applied; the badge and the requirement to press Apply *is* the "proposal" this ticket asks for, reusing the exact mechanism every other rule-picked option already uses, so there is no second proposal UI to build.
- **Accept** = pressing Apply, same as accepting any other option (§0); from that point the auto-detected and manually-chosen cases are indistinguishable, same rule this had in every prior revision.
- **Reject** = simply not applying it and picking a different option (or leaving the part as-is) — no separate reject action needed, since nothing was written yet.
- **Undo** = the existing per-part/global Undo (§0) — reverts to the pre-Apply state.
- **States that aren't also expressions stay states.** A disabled/loading/error-prop state with no rendered branch to bind isn't offered as a "Make conditional" option; only `states.mjs`'s `conditional` sub-kind (`cond && <X/>` / ternary rendering JSX) crosses over into `d.options`. A written Product/Design requirement (states' existing purpose) and a wired part option are different outputs of the same detector.
- Structural-similarity groups with no loop syntax (`mapped: false`) stay list-only and user-initiated (never rule-defaulted) — lower confidence than a parsed `.map()`/`switch`/`&&`, same AI-READY reasoning as every prior revision.

## 7. Reversibility

Unchanged in substance from v2.1, simplified by §0's discovery that Undo/Redo already exists: Applying a kind option is one more entry in the part's history (`d.history`, `inspector.mjs:221,227-230`); Undo reverts to the pre-Apply state (opaque/unclassified part if auto-detected, the part's prior state if manually chosen) — no code is rewritten by choosing or undoing an option (Trace never edits the source page from the inspector; only the generated-code path, `codeHtml()`, `inspector.mjs:210-218`, produces code, and it already regenerates from whatever the current option choices are, kind-agnostic). The `codegen.template` field (§1) is what that regeneration reads for every kind, same shape a stub option's generated code already takes.

## 8. Empty / error states

| State | Trigger | Treatment |
|---|---|---|
| No candidate list found for a selected group | 0 or 1 same-shape siblings, no `.map()` | "Make it a list" option is not offered — same "only offer what the AST actually found" rule as §4. |
| Condition/discriminant unbound ("Not sure yet") | if/ternary/switch applied with no binding | Renders as a Gap (existing `TERMS.gap` swatch/badge), same "nothing behind it" treatment as an unbound value part — not a blocking error, Apply still works. |
| Ternary/if with no else / no matching branch content | branch is `null` or absent in source | Panel shows the branch as "(nothing rendered)" rather than blank. |
| Switch case with no reachable value | discriminant is an open enum (e.g. free-text status) | `default` stays always visible as an explicit case row, never silently dropped. |
| Chained-ternary boundary case (2 links only) | AST rule in §2 classifies 2-link chains as `ternary`, 3+ as `switch` | No panel-visible ambiguity: the threshold is fixed, so only one option is ever offered for a given chain. |

## 9. Accessibility

- Every kind's option card follows `optionsHtml()`'s existing keyboard path (`role="radio"`, numeric `<kbd>` shortcuts, `inspector.mjs:163-171`) — nothing new to learn.
- Kind badges/glyphs (§4, §5) are never color-only: each carries a distinct glyph/label (`if`, `?:`, `switch`, `×N` for list) in addition to its accent color, consistent with this repo's 3:1-contrast + shape-or-word rule.
- The rail's grouped list row and if/ternary/switch glyphs (§5) sit in the same tab order the part list (`trace.mjs:195-199`) already defines — no new roving-focus pattern to add.

## 10. Open questions for review

1. **Single-list-per-page-style limits** — `/studio`'s `vm.lists[0]` limit (v2.1 §10.1) does not apply here (§0: the demo page has no such singular index, parts are already keyed by id), but confirm with Ad hoc Dev whether the *server-side* group/state detection pipeline (shared by both screens) has an equivalent single-list assumption that would still block a second `list` part end to end.
2. **Multi-select gesture** for choosing a group of siblings to mark as a list — still new UI, no prior art on the demo page either (carried over from v2.1 §10.2, unresolved).
3. **Non-JSX loop/conditional forms** (`v-for`, `*ngFor`, `{{#each}}`, `v-if`, `*ngIf`, `{{#if}}`) — still open, same parser-reach question as v2.1 §10.3.
4. **Switch/chained-ternary threshold** — the 2-vs-3-link arity rule is this spec's own proposal, not yet checked against real fixtures.
5. **`states.mjs` export surface** — confirm its `conditional` matcher can be called from the new classifier without duplicating the AST walk (exported and reused vs. needs a small refactor to separate the matcher from its "write a requirement" record-building).
6. **New for this revision: wiring the pipeline's detection output into `d.options` at all.** §0 notes nothing today carries group/state detection results into the demo page's part data — Ad hoc Dev to scope this as the one genuinely new piece of plumbing this revision needs (every other piece reuses an existing mechanism).
