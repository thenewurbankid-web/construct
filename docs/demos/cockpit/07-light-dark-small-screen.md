<!-- Draft sub-issue. Title: "[Demo] As a developer I want to work in light or dark, and on a small screen". Parent: the Cockpit guide. -->

# [Demo] As a developer I want to work in light or dark, and on a small screen

**As a** developer (or reviewer on the move), **I want** the Cockpit to work in a light or dark
theme and to stay usable on a laptop split-screen or a phone, **so that** I can check a project
wherever I am, and see problems clearly in either theme.

## CLI

Not applicable: theme and layout belong to the UI. The command line has no themes; its output is
plain text.

## UI

1. **Theme.** The Cockpit opens in the dark theme. Click the moon/sun button at the right of the
   top bar (or run "Toggle dark" from the palette) to switch to light; the choice is remembered in your browser.
2. **Drawer.** Press `Ctrl J` (or click **Drawer** in the status bar) to open the bottom drawer.
   **Diagnostics** shows what `construct validate` found for the current project: each row has a
   severity, rule code, plain-language message and the file and line it points at, plus an error
   count and how long the check took. **Logs** shows recent output; **Processes** is reserved for
   running work and shows an empty state today.
3. **Small screens.** Below 900 pixels wide the three panes become one at a time. A bottom bar
   switches between **Browser**, **Stage** and **Tools**. Choosing something in the Browser
   returns you to the Stage.

![Light theme with the Diagnostics drawer open: 2 errors, 1 warning, 23 ms](https://raw.githubusercontent.com/thenewurbankid-web/construct/ui-screenshots/ui/e2e/screenshots/demos/cockpit-8-diagnostics-light.png)

![Phone width (390 px): the Browser pane alone, with the Browser / Stage / Tools bar](https://raw.githubusercontent.com/thenewurbankid-web/construct/ui-screenshots/ui/e2e/screenshots/demos/cockpit-9-phone-browser.png)

Light theme, full screen:
[cockpit-hero-light.png](https://raw.githubusercontent.com/thenewurbankid-web/construct/ui-screenshots/ui/e2e/screenshots/demos/cockpit-hero-light.png).

## What you'll see

Light theme with three readable diagnostics rows (`SLICE-001` twice as Error, `READ-003` as
Warning), and at 390 px a single Browser pane with the pane switcher along the bottom.

## Benefit

- **Who benefits:** anyone reviewing a project in bright light, on a small window or on a phone.
- **What problem it removes:** a tool that only works full-screen in one theme, with checks hidden
  in a terminal.
- **Evidence:** the validation results appear in the drawer in about a quarter of a second on the
  demo project (23 ms shown in the screenshot), and the phone layout has no horizontal scrolling
  (checked by the product's own test `narrow-layout.spec.js` at 390 px and 768 px). Demo run:
  `cockpit-palette-themes.spec.js` (7a, 7b) and `cockpit-browse-preview.spec.js` story 1 (light
  hero).

Verified on `9ed0948` (2026-09-19) against `main`.
