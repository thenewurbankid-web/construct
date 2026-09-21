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
| [popovers.md](popovers.md) | The one dismissable popover/menu primitive: disclosure vs menu, dismissal contract, placement, states (#297) |
| [ia-five-screens.md](ia-five-screens.md) | Information architecture: five primary screens (Features, Pages, Components, Git, Tests) x four slots, profile menu, capability map, durable Notes, migration slicing. Supersedes the modes (concept) |
| [cockpit-layout.md](cockpit-layout.md) | The 3-pane Cockpit shell, per-screen rationale, and the ordered implementation plan |
| [mocks/](mocks/) | Concept mocks as static HTML+CSS (`*.html`) and rendered PNGs (`png/`) |

Concept mocks (1440x900, each in `png/<name>--dark.png` and `--light.png`):
- **Cockpit shell** (`build.mjs`): `cockpit-shell`, `pages-editor-in-shell`,
  `workflows-in-shell`, `plan-mode`, `processes-drawer`, `command-palette`,
  `states-and-narrow`.
- **PR review** (`build-pr-review.mjs`, styles in `pr-review.css`):
  `pr-review-list`, `pr-review-open`, `pr-review-findings`, `pr-review-autofix`,
  `pr-review-indicators`, `pr-review-no-plan`, `pr-review-states`.
- **QA test authoring** (`build-qa-tests.mjs`, styles in `qa-tests.css`):
  `qa-tests-scenarios`, `qa-tests-clone`, `qa-tests-editor`,
  `qa-tests-changes-code`, `qa-tests-new`, `qa-tests-run-failure`,
  `qa-tests-states`, plus the click-and-record screens `qa-tests-record-start`,
  `qa-tests-record`, `qa-tests-record-check`, `qa-tests-record-selector`,
  `qa-tests-record-review`.

- **Flow tree and click to navigate** (`build-flow-nav.mjs`, styles in `flow-nav.css`;
  #328 and #321): `flow-nav-browser`, `flow-nav-selection`, `flow-nav-links`,
  `flow-nav-trail`, `flow-nav-states`. `render.mjs` takes an optional name
  prefix: `node docs/design/mocks/render.mjs flow-nav`.

- **Five-screen IA** (`build-ia.mjs`, styles in `ia.css`): `ia-features`, `ia-account-menu`,
  `ia-slot-matrix`, `ia-notes-states`, `ia-no-project`, `ia-git`, `ia-git-connect`, `ia-narrow`, and the POC-parity set `ia-pages`, `ia-pages-next`, `ia-pages-change`, `ia-components`, `ia-generate-states`, `ia-preview-states`, `ia-side-preview`, and the Story set `ia-story`, `ia-story-states`, `ia-story-modes`, `ia-story-indicators`, `ia-story-consent`, `ia-clip-bridge`, `ia-clipper`, and `ia-feature-structure` (a feature as a hierarchy). Spec: `ia-five-screens.md`.

`plan-mode` was `research-mode` until the owner renamed the middle mode in #243:
the modes are **Explore / Plan / Build** and the brand in the top bar is
**Cockpit**. The CLI's `construct research …` is deliberately unchanged — "Plan"
is what the mode button says, "research" is what happens inside it.

The `qa-tests-*` mocks were rendered before that rename and still show the old
chrome; re-running `node docs/design/mocks/build-qa-tests.mjs` picks it up, since
they share `parts.mjs`.

The shell chrome shared by every mock lives in `parts.mjs`; each initiative adds
its own `build-*.mjs` (and its own stylesheet, if it needs one) rather than
growing a single build script.

PR review in the Cockpit (#308, explores #285), built by
`node docs/design/mocks/build-pr-review.mjs` with its own stylesheet
(`pr-review.css`): `pr-review-list`, `pr-review-open`, `pr-review-indicators`,
`pr-review-findings`, `pr-review-no-plan`, `pr-review-autofix`,
`pr-review-states`.

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
   (Playwright from `ui/e2e`) and are published on the documentation website, not attached to tickets. Mocks are always
   bannered "Concept - not implemented" until the screen ships.
4. **Implementation tickets link back**: their body starts with
   `Design: #N (mock: <filename>)`. Ordinary CLAUDE.md rules apply (comment only
   with something to notify or a dev note, Playwright test for UI, rule-12
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
