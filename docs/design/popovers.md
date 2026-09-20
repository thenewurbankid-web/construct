# Popovers and menus (one dismissable primitive)

Status: proposal and concept mocks (#297, under #296; adopted by #298). Nothing
here changes `ui/client`. Mocks: `mocks/popover-panel.html`,
`popover-disclosure.html`, `popover-states.html`, `popover-placement.html`
(PNGs in `mocks/png/`, dark and light, all bannered "Concept - not implemented").
Source: `mocks/build-popover.mjs` + `mocks/popover.css` (tokens only).

## What it replaces

Two independently built top-bar popovers: the project switcher (`.sh-popover`,
`role="dialog"`, Escape closes, focus not returned, no outside click, z 50, sheet
under 900px) and the account chip (`.sh-user-menu`, now an honest disclosure
after #278: Escape closes and returns focus, no outside click, z 40, different
border and radius, no narrow treatment). One primitive, one contract, one surface.

## Which variant: disclosure or menu (answers #296 question 1)

| | **Disclosure** (default) | **Menu** |
|---|---|---|
| Use when | up to 4 actions, or arbitrary content (a folder picker, a form, a login line) | 5 or more actions, or commands on one object (process row: Pause, Resume, View log, Copy command, Cancel) |
| Trigger | `aria-haspopup="true"` (or `"dialog"` for a labelled panel), `aria-expanded`, `aria-controls` | `aria-haspopup="menu"`, `aria-expanded`, `aria-controls` |
| Surface | plain group, or `role="dialog"` + `aria-label` for a panel; no `role="menu"` | `role="menu"` with `aria-label`; children only `menuitem`, `menuitemcheckbox`, `menuitemradio`, `group`, `separator` |
| Keys inside | `Tab` / `Shift+Tab` through ordinary buttons and links | one tab stop; `ArrowUp/Down` move, `Home/End` jump, type-ahead, `Enter`/`Space` run |
| Ships when | now | only when the primitive implements roving focus, Home/End and type-ahead |

`role="menu"` is a keyboard promise. A surface that says "menu" and then does not
rove is worse for a screen-reader user than an honest disclosure. Decision: the
account chip and the project switcher are **disclosures** (a panel for the
switcher). The menu variant is specified now so the Processes row menu has a
contract, but it is not built until a menu is needed (YAGNI; one owner of roving
logic, not one per feature).

## Dismissal contract (both variants)

1. **Open**: `Enter`, `Space` or click on the trigger. `aria-expanded="true"`.
   Focus moves to the first enabled control inside (menu: first item; empty and
   error states: the primary action). Focus never stays on the trigger.
2. **Escape** closes and returns focus to the trigger. Consumed (`stopPropagation`)
   so it does not also close a drawer behind it.
3. **Outside click / tap** closes; focus stays where the click landed (do not
   steal it back).
4. **Focus-out** (Tab past the last control, Shift+Tab before the first) closes;
   focus continues to the next or previous page control naturally.
5. Choosing an action closes it and returns focus to the trigger unless the action
   navigates or opens something that takes focus.
6. Opening one popover closes any other.
7. `aria-expanded` and `aria-controls` are on the trigger at all times.

### What is NOT a focus trap

Popovers are **not modals**. Focus is never trapped or looped; there is no scrim,
no `aria-modal`, the page behind stays live and undimmed, and `Tab` can always
leave. Only modals (the command palette, a confirm dialog) trap focus. If a
popover ever needs to block the page it is the wrong component: make it a dialog.

## Surface (identical for both variants)

`--surface-2` fill, `1px --border-strong`, `--r-lg`, `--shadow`, padding
`--sp-3` (disclosure `--sp-2`), `z-index: var(--z-popover)`. Rows 28px high
(44px in the narrow sheet), radius `--r-sm`, hover/current `--surface-3`. Text
`--text`; secondary `--text-muted`; destructive `--danger`. Focus ring:
`2px solid --focus`, offset 2px, on the trigger and on the focused item (mocks
show both). Selected state never by colour alone (the trigger also gets
`--accent-soft` fill and border while open, plus `aria-expanded`).

Motion: open/close is a 120ms opacity plus 4px slide; under
`prefers-reduced-motion: reduce` it is instant (no transform, no fade).

## Placement and collision

- Opens **below** its trigger, 6px gap, never upward (top-bar triggers).
- Preferred alignment `start`; flips to `end` if it would cross the viewport edge.
  The account chip is always at the right edge, so it is `end`-aligned; the project
  switcher (520px) is `start`-aligned. At 1280px both fit with no flip needed.
- Width: content width up to its max, capped at `viewport - 16px`.
- Height: capped at `70vh` (sheet: `100dvh - bar - 8px`), scrolls inside; the page
  never scrolls to reveal it.
- **<= 899px**: both variants become the same full-width sheet: `left/right 8px`,
  `top = bar height + 4px`. (This matches the shipped switcher, which is top
  anchored; #296 said "bottom anchored", the shipped behaviour is kept because
  the trigger is at the top and a top sheet keeps it visible.) Still no scrim.
  Touch targets 44px. At 390px the account chip shows only its avatar (accessible
  name unchanged).

## States a panel needs (project switcher)

| State | Shows | ARIA / focus |
|---|---|---|
| Loading | surface opens immediately: "Looking for projects on this computer...", skeleton rows, primary action disabled | `aria-busy="true"`, hint is `role="status"`; focus on first enabled control |
| Empty | "No recent projects" and one primary action "Choose a folder..." | focus on that action |
| Error | inline banner: what failed and that nothing changed ("Cannot read this folder. Permission denied ... Nothing was changed."), actions "Try again" / "Choose another folder" | `role="alert"`; focus on "Try again"; never a stack trace or bare code |
| Populated | breadcrumb, folder rows, Cancel / Use this folder | focus on first row |

## The interface a feature fills (slot, not a hard-wired screen)

```
<Popover
  variant="panel" | "disclosure" | "menu"
  open, onOpenChange        // controlled: the feature owns the state
  trigger                   // render prop: gets {ref, id, aria props, onClick, onKeyDown}
  label                     // aria-label of the surface
  align="start" | "end"     // preferred; the primitive flips on collision
  children                  // content; menu: <Popover.Item> only
/>
```

Dismissal (Escape, outside, focus-out, focus return) lives in one shared hook
(`useDismissable`, answers #296 question 2): features stay independent of the shell
and of each other; the shell owns only the z-layer token. Menu roving lives in a
second, separate hook that only the menu variant uses.

## Review checklist run against the mocks (principles.md)

- Contrast: text, `--danger` and `--focus` tokens are all >= 4.8:1 on `--surface-1`
  in both themes per `tokens.md`; `--surface-2` is lighter (dark) / white (light),
  which raises ratios. Not re-measured with a tool for this mock (gap, below).
- Keyboard path complete (open, in, Tab order, Escape, back out); visual order
  equals tab order. Focus visible on trigger and item in every mock.
- Targets >= 24px (rows 28px, sheet 44px). No hover-only function.
- Status not by colour alone (icon + text in the error state; `aria-expanded`).
- Reduced motion specified. Empty, loading, error specified. 1280, 899 and 390 drawn.
- Tokens only; the mock CSS adds no new raw colours.
- Provenance is not relevant here (no model output in these surfaces).

## Implementation (#298)

Shared `useDismissable` hook in a shell-neutral location; both popovers adopt it;
`.sh-user-menu` deleted in favour of `.sh-popover`; literals replaced by `--z-*`.
Must stay green: `shell-topbar`, `shell-topbar-density`, `shell-layout`,
`narrow-layout`, `auth`, `a11y` specs. New Playwright: keyboard open, Escape,
focus returned, outside click, for both popovers.
