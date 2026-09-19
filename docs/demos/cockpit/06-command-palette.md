<!-- Draft sub-issue. Title: "[Demo] As a keyboard-first developer I want to find anything with the command palette". Parent: the Cockpit guide. -->

# [Demo] As a keyboard-first developer I want to find anything with the command palette

**As a** keyboard-first developer, **I want** one search box that reaches every screen and action,
**so that** I never have to remember where something lives or reach for the mouse.

## CLI

This is UI-only today; the CLI equivalent is `construct` itself (`construct help`, or
`construct repl` for an interactive shell with built-in help).

## UI

1. Press `Ctrl K` (`Cmd K` on a Mac) anywhere, or click the search box in the top bar. The palette
   opens and focus is in its search field.
2. Start typing. The list narrows as you type: "go to" lists the seven screens (Dashboard, Import
   Wizard, Pages Editor, Workflows, Local Model, Settings, Help); other groups cover the
   Explore / Research / Build modes, showing or hiding the Browser, Tools and drawer, running a
   validate, and switching theme.
3. Use Up and Down to move, `Enter` to run, `Esc` to close. The keyboard hints are shown in the
   footer of the palette. With no match it says so.
4. Try "go to settings" then `Enter`: you land on Settings. The palette closes and focus returns
   to where you were.

Other shortcuts shown in the status bar: `Ctrl B` (Browser pane), `Ctrl Alt B` (Tools panel),
`Ctrl J` (drawer), `F6` (move to the next pane).

![The command palette filtered to "go to": every screen, one keystroke away](https://raw.githubusercontent.com/thenewurbankid-web/construct/ui-screenshots/ui/e2e/screenshots/demos/cockpit-7-command-palette.png)

## What you'll see

A centred dialog over the dimmed Cockpit listing seven "Go to ..." commands, with the first
highlighted and the key hints (Up/Down, Enter, Esc) beneath.

## Benefit

- **Who benefits:** anyone who uses the Cockpit daily, and anyone using a screen reader or
  keyboard only.
- **What problem it removes:** hunting through menus and panes to find a screen or run a
  command.
- **Evidence:** reaching Settings took 3 inputs (`Ctrl K`, type "go to settings", `Enter`), asserted
  in the demo by the resulting URL. The palette is fully keyboard-operable (focus is trapped,
  `Esc` restores focus), covered by the product's own test `shell-drawer-palette.spec.js`. Demo
  run: `cockpit-palette-themes.spec.js`, story 6.

Verified on `9ed0948` (2026-09-19) against `main`.
