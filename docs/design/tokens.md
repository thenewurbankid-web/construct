# Design tokens: audit and proposal

Status: proposal. `ui/client/app/globals.css` is NOT changed by this document.
The concept mocks (`mocks/mock.css`) use the proposed set so it is proven on real
screens before anyone touches product CSS.

## 1. Audit of today (`ui/client/app/globals.css`, 1515 lines)

Measured on main:

- **14 custom properties**, all in one `:root`, dark only (no `data-theme`, no
  `prefers-color-scheme`; there is no light theme).
  - Surface/neutral: `--bg`, `--bg-glow-1`, `--bg-glow-2`, `--panel-glass`,
    `--panel-glass-strong`, `--panel-blur`
  - Lines/text: `--border`, `--border-strong`, `--text`, `--muted`
  - Meaning: `--accent` (#5b8cff), `--tool` (#3fae5a, deterministic), `--llm`
    (#d98c2b, model), `--error` (#e05a5a)
- **Usage counts** (`var(--x)` across `app/` and `features/`): `--border` 29,
  `--accent` 20, `--muted` 19, `--text` 17, `--tool` 8, `--error` 8, `--llm` 7,
  `--panel-blur` 5, `--border-strong` 5, `--panel-glass` 3, `--panel-glass-strong` 2,
  glow/`--bg` 1 each. Good: the small set is genuinely reused.
- **Raw values that bypass tokens**: ~47 hex literals and ~35 `rgba()` in the
  stylesheet (e.g. `#fff` x6, `#0b0d11` x6, `#d98c2b` x5 duplicating `--llm`,
  `#e05a5a` x3 duplicating `--error`, `#3fae5a` x2 duplicating `--tool`, plus
  one-offs like `#e0668c`, `#d9a441`, `#119`, `#162`).
- **No scales**: 9 distinct `border-radius` values (6px x19, 8px x5, 4px x3,
  14px, 11px, 3px, 2px, 0, 50%); font sizes mix `rem` (0.78 to 0.9) and `px`
  (10 to 12); spacing is ad hoc px.
- **No focus token**, no state tokens (hover/selected), no soft status
  backgrounds, no diff colours (add/remove), no shadow token.
- **Contrast findings**: the active nav item is white on `--accent`
  (`#fff` on `#5b8cff`) = **3.2:1**, below the 4.5:1 AA minimum for normal text.
  `--muted` on `--bg` is 7.7:1 (fine). `--error` on `--bg` is 5.5:1 (fine).
- **Glassmorphism** (`.glass-panel`: translucent panels + `backdrop-filter:
  blur(20px)` + heavy shadow) is decorative, costs GPU on large panes, and
  makes contrast depend on what is behind the panel. Fine for the old
  dashboard cards, wrong for a dense three-pane workspace.

## 2. Proposed consolidated set

Two layers: **semantic tokens** used by components (this list), mapped onto
raw palette values inside each theme block. Components never reference raw
values. Theme switch = `data-theme="dark" | "light"` on `<html>`, defaulting to
`prefers-color-scheme`.

| Token | Dark | Light | Replaces / role |
|---|---|---|---|
| `--surface-0` | #0b0d11 | #eef0f4 | app background (`--bg`) |
| `--surface-1` | #12151b | #f8f9fb | panes (`--panel-glass`) |
| `--surface-2` | #181c24 | #ffffff | raised: inputs, cards, popovers (`--panel-glass-strong`) |
| `--surface-3` | #202632 | #e8ebf1 | hover / selected fill |
| `--canvas` | #0f1218 | #dfe3ea | preview/diagram stage backdrop |
| `--border-subtle` | #232936 | #dde1e9 | dividers (`--border`) |
| `--border-strong` | #343c4d | #c3c9d5 | control outlines (`--border-strong`) |
| `--text` | #e9ecf2 | #171b24 | primary text (15.4 / 16.4 : 1) |
| `--text-muted` | #9ca4b3 | #4b5567 | secondary (7.3 / 7.1 : 1) (`--muted`) |
| `--text-faint` | #7b8494 | #5f6a7d | metadata only (4.8 / 5.2 : 1) |
| `--accent` / `--accent-soft` / `--accent-fg` | #6c97ff / 16% / #0b0d11 | #1f56d6 / 10% / #fff | selection, primary action (fg on accent 7.0 / 6.2 : 1, fixes the 3.2:1 nav) |
| `--success` (+ `-soft`) | #4cc07a | #17803f | OK, and "Deterministic" (`--tool`) |
| `--warn` (+ `-soft`) | #e0a23a | #9a5c00 | attention, external change |
| `--danger` (+ `-soft`) | #ef6b6b | #c5312f | errors (`--error`) |
| `--llm` (+ `-soft`) | #d98c2b | #9a5c00 | "Local model" provenance |
| `--focus` | #9dbbff | #1f56d6 | 2px focus ring on every control |
| `--add-bg` / `--del-bg` | green/red 14% | green/red 12/10% | diff lines |
| `--shadow` | 0 12px 40px / .5 | 0 12px 40px / .18 | popovers, palette only |

Contrast was computed (WCAG relative luminance) against `--surface-1`; all text
tokens meet 4.5:1, status colours meet 4.8:1 or better in both themes.

Scales (new, replacing the ad hoc values):

- Radius: `--r-sm` 4px, `--r-md` 8px, `--r-lg` 12px (14px glass panels retire).
- Spacing: 4px base (`--sp-1`..`--sp-8` = 4, 8, 12, 16, 20, 24, 32, 40).
- Type: `--fs-xs` 11px (labels), `--fs-sm` 12px (code/meta), `--fs-md` 13px (base),
  `--fs-lg` 15px (panel titles), `--fs-xl` 20px (page titles). Families
  `--font` (system UI) and `--mono` (system mono).
- Row/control heights: 24px small, 28px default, 36px bars.

## 3. Migration (no big bang)

1. Add the new tokens beside the old ones; alias old names to new
   (`--bg: var(--surface-0)`, `--muted: var(--text-muted)`, `--error: var(--danger)`,
   `--tool: var(--success)`), so nothing visibly changes. (Ticket: tokens step.)
2. Add the light theme block and the theme switch; no screen edits.
3. Replace raw hex/rgba with tokens screen by screen as each screen is touched
   by the shell migration; add a lint (stylelint `color-no-hex` outside the
   token file) once the count is near zero.
4. Retire `.glass-panel` from shell surfaces; keep it only on the legacy pages
   until they migrate.

Dogfooding note: tokens are plain CSS variables (no runtime dependency), so
they are replaceable and testable (a Playwright test can assert computed
colours and run an axe contrast scan per theme).

## 4. Proposed stacking scale (`--z-*`), from #297

Today the shell uses eight hand-picked literals (2, 5, 20, 25, 30, 40, 50, 100
across `shell.css`, `navigation.css`, `cockpit-drawer.css`). Proposal: five named
layers, theme-independent, so a new surface picks a layer instead of a number.

| Token | Value | Replaces | Used by |
|---|---|---|---|
| `--z-raised` | 5 | 2, 5 | sticky tab lists, pane resizers |
| `--z-drawer` | 20 | 20 | bottom drawer |
| `--z-topbar` | 30 | 25, 30 | top bar, status bar, narrow tab bar |
| `--z-popover` | 50 | 20 (flow-nav list), 30 (flow-nav card), 40, 50 | every popover, menu and sheet (see `popovers.md`) |
| `--z-modal` | 100 | 100 | command palette scrim and dialog |

Rule: popovers open inside the top bar's stacking context, so they beat the
drawer (20) but a modal always beats a popover. Proposal only: `globals.css` is
not changed by this document; the implementation slice is #298.
