# Design module (Module 9)

Charter: one place that decides how the Cockpit looks and behaves, so screens
built by different people (or agents) feel like one product, and so every
screen is drawn and reviewed before it is built. Owned by the `designer` agent
(`.claude/agents/designer.md`).

Scope: the Cockpit UI (`ui/`). It is proprietary-future (open-core boundary):
design docs live here, and no open-core package may depend on them.
Non-goals: MCP surfaces (future), marketing pages, product code.

## Contents

| File | What it is |
|---|---|
| [principles.md](principles.md) | The bar every screen is held to (calm, dense, keyboard-first, WCAG AA, dark+light, plain language, progressive disclosure) plus a review checklist |
| [tokens.md](tokens.md) | Audit of today's CSS variables and the proposed consolidated token set |
| [cockpit-layout.md](cockpit-layout.md) | The 3-pane Cockpit shell, per-screen rationale, and the ordered implementation plan |
| [mocks/](mocks/) | Concept mocks as static HTML+CSS (`*.html`) and rendered PNGs (`png/`) |

Concept mocks (1440x900, each in `png/<name>--dark.png` and `--light.png`):
`cockpit-shell`, `pages-editor-in-shell`, `workflows-in-shell`,
`research-mode`, `processes-drawer`, `command-palette`, `states-and-narrow`.

## How design tickets work

1. **Parent ticket per initiative**: `[Design] <initiative>` (Module: Design;
   Kind: Feature or Epic). Body: problem, who it is for, hero mock embedded,
   rationale (what changes versus today and why), open questions, contents table
   of sub-issues, "Part of #N" if under a roadmap epic.
2. **One sub-issue per screen or shippable slice**, linked with GitHub
   sub-issues. Each carries: the mock (filename + embedded PNG), an acceptance
   checklist, the accessibility checks that apply, and the existing e2e specs
   that must stay green.
3. **Mocks live in this repo** (`docs/design/mocks/`), are regenerated with
   `node docs/design/mocks/build.mjs && node docs/design/mocks/render.mjs`
   (Playwright from `ui/e2e`), and are embedded in tickets through raw links on
   the `ui-screenshots` branch, same mechanism as demos. Mocks are always
   bannered "Concept - not implemented" until the screen ships.
4. **Implementation tickets link back**: their body starts with
   `Design: #N (mock: <filename>)`. Ordinary CLAUDE.md rules apply (comment
   before/at decisions/on outcomes, Playwright test + screenshot for UI, rule-12
   closing comment).
5. **After build**: the designer compares the real screen to the mock and posts
   a short "intent vs result" comment; deliberate deviations update the mock so
   the mock never lies about the design.
6. **Freshness**: when a screen ships, its mock banner is removed or the mock is
   replaced by a real screenshot; superseded mocks are marked, not deleted.

## Board

Module: **Design** (new option; the field itself is set by the
project-manager/OG). Sub-modules proposed: Design system, Cockpit shell,
Screens, Accessibility & review, Other.
