# Trace product UI — screen map & design direction

Status: revision 3 — **owner correction 2026-09-29**: the demo page IS the product UI. Every screen below is a section/panel inside `/` (`trace/src/ui/demo.html` + `demo.mjs`), not a separate route. `/studio` (`index.html`) is source material to port code from, never a destination a user navigates to. This supersedes revision 2's "one app shell across six routes" direction and everything built or reviewed against it (LIN-95/LIN-103's shared-partial-across-six-pages spec no longer applies; re-scoped).
Base: the demo UI at `trace/src/ui/` (dev http://localhost:4200). Studio (`packages/studio`) is discontinued; this is the final UI, and `/studio` itself is not a product surface — its code is reused, not its route.

## 1. What the demo has today

Six standalone HTML entry points, each with its own tiny header, no shared nav shell:

| Screen | Route | Purpose | Reachable from |
|---|---|---|---|
| Front door | `/` (`demo.html`) | 3-step walkthrough: Drop in → The Fit → Handoffs | brand link only |
| Studio | `/studio` (`index.html`) | Full workbench: run steps, Ask queue, contract/API detail, tree, AI console, run-summary, issues, team board | `/`, `/quality` |
| About | `/about` | Changelog / build info | `/quality`, `/studio` |
| Import wizard | `/import-wizard.html` | Swagger/contract import + stubbed Subframe design import | `/studio` only |
| Page map | `/pagemap` | Structural review of a page's proposed edits/decisions | `/` only |
| Quality | `/quality` | Eval-harness dashboard (precision/recall/determinism) | `/about`, `/studio` |

`/pagemap` and the import wizard are orphaned — reachable only by direct URL, not linked from any other screen. There is no single nav bar; each page hand-rolls 1–3 outbound links.

**Core visual language to keep, unchanged in meaning:**
- The ring: five states — `fit` (green, connected), `wait`/Tie (amber, needs an answer), `gap` (red, missing), `stub` (placeholder), rendered identically across Studio's run view and the front door's "Fit" step.
- The Ask card: surfaces one decision at a time (kind `Tie` / `Waiting` / `Stub`), the mechanism for a human to resolve what the system couldn't.
- Handoff: per-team board + mail composer, where resolved work moves to the people who build it.
- Theme tokens generated at `/theme.css` (`src/tree/svg.mjs` `TOKENS`): surface/text/line tokens, meaning colors (`grn`=Fit, `amb`=Tie, `red`=Gap, `ph`=Stub), layer colors, both themes contrast-checked in `theme.test.mjs`. Typography/spacing are **not** tokenized today — every screen hardcodes its own font stack and pixel sizes. This is a real gap the product UI should close (see §4).

## 2. Product screen map (revised — everything is on `/`)

**One page, one persistent nav, sections instead of routes.** The product is `trace/src/ui/demo.html` + `demo.mjs`, served at `/`. There is no app shell spanning multiple HTML documents and no navigation away from `/` for these six areas — each becomes a section that mounts/unmounts inside the same page, switched by the same persistent nav bar without a full page reload for these transitions. `/studio`, `/pagemap`, `/quality`, `/about`, `/import-wizard.html` stop being destinations; their code is ported into `demo.mjs` (or modules it imports) section by section, and `src/server.mjs` keeps serving them only as long as a section's port is unfinished — each is retired once its section lands on `/`.

```
┌─ demo.html (`/`) — persistent nav + top bar ─────────────────────┐
│                                                                    │
│  Projects  →  Run  →  Page Map  →  Handoffs  →  Insights  →  ⚙   │
│  (all five sections mount/unmount inside this one document)       │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

| Section (in-page, not a route) | Ports code from | New vs. kept |
| --- | --- | --- |
| **Projects** | *(new — front door's scenario picker generalized)* | New: a list/grid of runs (past + in-progress), each showing its ring-state summary at a glance. Entry point to "New run" which reuses the front door's "Drop in" step (contract + design import) and the import wizard's Swagger/Subframe steps as its wizard body, ported into `demo.mjs`. |
| **Run** | Front door "The fit" + Studio's run view, merged into one in-page section | Kept UI, merged information architecture: the ring hero, contract rail, tree/page view toggle, and the Ask card queue all live in the Run section of `/`. Studio's extra panels (console, AI exchange log — currently `index.html` only) get ported in as a collapsible "Advanced" drawer within that same section rather than staying on a separate page. **Open product decision (Ad hoc Dev, confirmed in code):** Studio's Options menu (`index.html:364-373`) exposes `useSaved`/`askAll` checkboxes and "Auto-run every example" that the front door's `/api/run` call (`demo.mjs:319`) does not — it hardcodes `useSaved: true` with no manual controls. The per-screen Run spec must decide whether "Advanced" mode carries these controls forward or the product intentionally drops that granularity; not resolved by this direction. |
| **Page Map** | `/pagemap`, ported in as a section | Same structure/review/states-and-flows tabs, same wireframe/source/original-preview split, now mounted inside `/` instead of served as its own HTML document. |
| **Handoffs** | Front door step 3 + Studio's team board | Kept UI, elevated to its own in-page section with history (today it only shows the current run's handoffs and disappears once you navigate away). |
| **Insights** | `/quality`, ported in as a section | Kept dashboard, renamed to match a product audience rather than an internal eval-harness name. |
| **⚙ (Settings/About)** | `/about`, ported in as a section | Kept changelog/build info, merged with any account/theme settings. |

Not carried forward at all: the import wizard becomes a step inside "New run" rather than a page reachable only by direct URL; Studio's standalone run-summary popup becomes part of the Run section instead of a modal overlay; `/studio` itself is retired once the Run section covers its functionality.

## 3. Design direction

- **One page, not six.** Every section lives inside `demo.html`, using the same header pattern (project/run context on the left, theme + account on the right) and the same persistent nav. This is the single biggest gap between "demo" and "product": right now nothing tells you where you are or how to get anywhere else. **Buildability (re-scoped from Ad hoc Dev's original app-shell input, which assumed six separate HTML documents — no longer applies as stated):** section-switching happens client-side inside `demo.mjs` (show/hide or mount/unmount per section) so that in-flight `EventSource`/SSE connections (Studio's run stream, mail-chat) survive switching sections — this was the exact failure mode a multi-page shared partial would have caused, which is why the owner corrected the direction away from it. A fresh Ad hoc Dev buildability pass against this in-page-sections shape is needed before LIN-95's mocks are rebuilt (tracked on that issue).
- **The ring stays the spine.** Fit/Wait/Gap/Tie/Stub is the one piece of vocabulary a user needs to learn; it should appear at consistent size/position across Projects (as a compact summary per row), Run (as the hero), and Handoffs (as a per-item badge) — never re-skinned per section.
- **The Ask card is the primary call to action, everywhere.** Any section that has outstanding Asks surfaces a count in the nav (Run and, once handed off, Handoffs), the same way an inbox badge works — not just inline in the Run section's queue.
- **Progressive disclosure over separate pages.** Studio's console/AI-exchange/big-tree panels get folded into drawers on the Run section rather than kept as sibling destinations — reduces the nav from ~6 top-level pages users have to discover to fewer, plus in-section depth for power users.
- **Tokenize typography and spacing** (currently hardcoded per file) as part of building the shared nav/section shell, so it isn't reintroducing the same inconsistency at a new layer.

## 4. Buildability and review

1. **Buildability (Ad hoc Dev, revision 2):** confirmed the Studio/front-door Run merge risk (Options menu controls) — see §2's Run row; this still holds. The app-shell buildability input from revision 2 assumed a shared partial across six standalone HTML files and **no longer applies** — re-scoped in §3 to in-page section-switching inside `demo.mjs`. [LIN-95](/LIN/issues/LIN-95)'s revision-2 spec (`app-shell-nav.md`) found the in-page mechanism already exists (`demo.mjs`'s `go()`/`STEP_ORDER`, generalized from 3 steps to 6 sections) — smaller than a fresh buildability pass anticipated. A fresh Ad hoc Dev buildability comment against that spec is still needed before Design QA/owner review, per the spec's own request.
2. **Design QA review ([LIN-88](/LIN/issues/LIN-88)): pass**, on the ring/Ask/Handoff semantics and token references in this doc, which are unchanged by the revision-3 pivot (`demo.mjs:22` RING states, `issues.mjs` Ask mechanism, `TOKENS` in `src/tree/svg.mjs`, `theme.test.mjs` contrast checks). The pass did not cover the in-page-sections shape (new in revision 3) and doesn't need to — that's a routing/composition detail, not a semantics change.
3. Per-section mocks + state/accessibility specs are separate tasks (LIN-95, LIN-97–102), each re-scoped to target `/` per this revision before their own Design QA + owner approval.

## 5. Accessibility notes (direction-level)

- State meaning (Fit/Wait/Gap/Tie/Stub) must not depend on color alone in the new shell chrome (nav badges, Ask counts) — reuse the existing ring's shape/label convention rather than introducing color-only nav indicators.
- Existing token contrast checks (`theme.test.mjs`) cover the demo's meaning colors; the shell's new chrome (nav, top bar) needs the same 3:1 contrast check before it ships — extend `theme.test.mjs`'s existing `SEMANTIC`/`LARGE_OR_UI` pattern rather than inventing a new check (Design QA).
- Keyboard path through the shell (tab order: nav → header → screen content) is a requirement for the per-screen specs, and must include focus-visible styling for new interactive shell elements (nav items, the "Advanced" drawer toggle) — not just tab order (Design QA).
- New persistent nav must carry forward the demo's existing `aria-current="step"` pattern (`demo.mjs:93`) for nav items/landmarks, rather than reinventing current-page indication (Design QA).
- New shell chrome (nav transitions, Ask badge appearing) must gate on `prefers-reduced-motion`, matching the demo's existing gating of ring/ask animations (`demo.mjs:20,341,461`) — otherwise a user with that preference set gets an inconsistent experience between the old and new UI (Design QA).
