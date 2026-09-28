# Button — Usage

Every button is two decisions: the **variant** (what *kind* of action it is) and the **icon** (what happens to your *location*). Pick one from each.

> Items marked *(provisional)* are sensible defaults not yet ratified.

## Variants — what kind of action

The three high-emphasis variants are defined by category, not loudness: **commit · advance · delegate.**

| Variant | Intent | Use for | Examples |
|---|---|---|---|
| `primary` (dark) | **Commit** — finalize the current state | the main functional action on a screen | Save, Confirm, Publish |
| `brand` (yellow) | **Advance / Hero** — the one action you most want taken | the single hero action per view | Continue, Get started, Upgrade |
| `gradient` (violet) | **Delegate** — hand the task to AI | Max-powered / generative actions | Ask Max, Summarize, Generate |

**Hero rule (**`brand`**):** one per view, never two. If the most important action is destructive, a routine commit, or AI-driven, it is *not* yellow — use `error`, `primary`, or `gradient`. At a flow's **terminal step**, where advancing and committing merge (e.g. "Complete purchase"), the hero reading wins and it **is** yellow.

Supporting & destructive variants:

| Variant | Use for |
|---|---|
| `secondary` / `outline` | supporting actions beside a primary |
| `ghost` | low-emphasis, inline, toolbar |
| `brand-subtle` | brand-tinted low-emphasis action |
| `gradient-outline` | the secondary (lower-emphasis) AI action |
| `dashed` | add / create-new / empty-slot |
| `white` / `inverse` | the same actions on colored / dark surfaces |
| `error` → `error-subtle` → `error-ghost` / `error-outline` | destructive, descending emphasis |

## Icons — where it takes you

The glyph answers "where will I be after I tap this?" Icons are **lucide**. `icon` is the **leading** (left) slot; `iconRight` is the **trailing** (right) slot.

- **Leading (**`icon`**) — what the action *is*:** `Plus`, `Trash2`, the AI/`Sparkles` glyph, `Download`.
- **Trailing (**`iconRight`**) — where it *takes you*:** the wayfinding glyphs below.
- **Back-navigation leads left:** `ArrowLeft` / `ChevronLeft` sit on the left, because "back" is leftward.

Mnemonic: **caret = stay · arrow = go · panel = peek beside · maximize = peek on top.**

| Glyph | Means | Route changes? |
|---|---|---|
| `Chevron*` | in-place state change — expand, reveal, menu, **carousel, pagination, stepper, sort** | no |
| `ArrowRight` / `ArrowLeft` | navigate to another page | yes |
| `PanelRight` / `PanelLeft` | open a drawer (peek beside) | no |
| `Maximize2` *(provisional)* | open a modal (peek on top) | no |
| `ExternalLink` *(provisional)* | leave the app / new tab | leaves |
| `X` | dismiss this | no |

**Misuse traps:** `ChevronRight` ≠ `ArrowRight` (disclose/cycle vs navigate — a nav row that opens a page is an arrow). Carousels and pagination are chevrons, not arrows. Submenu flyout `ChevronRight` ≠ drawer `PanelRight` ≠ navigate `ArrowRight`.

## Sizes

`medium` (48px) · `small` (40px) · `xsmall` (32px). Corners scale with size (16 / 12 / 8).
**Touch caveat *(provisional)*:** `xsmall` is below the 44px touch-target guideline — fine for dense desktop UI, but shouldn't be the only target on touch.

## States

- `loading` — use when the action is *running*. The label hides, a spinner shows in place, width holds so layout doesn't jump, and re-submission is blocked.
- `disabled` — use only when the action *isn't available yet*, never to mean "working." *(provisional)* Avoid disabling silently with no explanation; prefer surfacing why, or validating on press.
- One in-flight primary action at a time.

## Content

- Verb-first ("Save changes", not "Changes").
- Sentence case *(provisional)*; ~1–3 words; no wrapping.
- **Icon-only?** Use the **Icon Button** component, and always give it an `aria-label`.

## Composition

- One `brand` (yellow) hero per view.
- Ideally one `primary` commit per group; step the rest down to `secondary`/`outline`/`ghost`.
- Group order *(provisional)*: primary action trailing (right); in destructive confirm dialogs, separate the destructive action clearly.

## Props quick reference

| Prop | Purpose |
|---|---|
| `variant` | the action category (see above) |
| `size` | `medium` / `small` / `xsmall` |
| `icon` | **leading** icon — what the action is |
| `iconRight` | **trailing** icon — where it takes you |
| `loading` | running state (see States) |
| `disabled` | unavailable state |
| `indicator` | attention dot — unread / state-present |
| `badge` / `badge2` | a count or status label tied to the action |
| `align` | `center` (default) or `left` |

## Open decisions

Accordion chevron convention; pagination-as-chevron; modal glyph (`Maximize2`); external glyph (`ExternalLink` vs `ArrowUpRight`); whether flow-advance uses an arrow; `xsmall` touch policy; case style; group ordering; RTL scope; whether a button may carry leading **and** trailing icons at once.