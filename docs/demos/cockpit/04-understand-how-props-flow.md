<!-- Draft sub-issue. Title: "[Demo] As a developer I want to see how a page's values flow into a component". Parent: the Cockpit guide. -->

# [Demo] As a developer I want to see how a page's values flow into a component

**As a** developer reviewing or fixing a page, **I want** to see which of the page's values are
passed into a component, and which the component expects but never receives, **so that** wiring
mistakes show up on screen instead of as bugs at runtime.

## CLI

This is UI-only today. (The related command-line view of a component is
`construct summarize component:<path>`, which lists its props and who uses it, but it does not
draw links or check a specific usage.)

## UI

1. Open a page (story 1) and select a component in the element tree, for example `<Card>`.
2. Open the **Scope** tab in the Tools panel.
3. Read the picture: page values on the left, the component's props on the right, joined by
   coloured lines. Here `title` flows into `title`, and `count + 1` flows into `total`.
4. Read the flags underneath, each in plain words:
   - a value passed that the component does not declare (`label`);
   - a prop the component declares but nothing passes (`onClose`, and `open`, which is in scope
     and can be wired with auto-map);
   - page state that is declared but never passed on (`setOpen`).
5. Select another node, for example the compound child `<Foo.Bar>`, and the panel re-reads the
   component's props from its own file.

![Scope tab: title and count flow into Card; onClose and open are unbound; label is undeclared](https://raw.githubusercontent.com/thenewurbankid-web/construct/ui-screenshots/ui/e2e/screenshots/demos/cockpit-4-prop-flow.png)

## What you'll see

Two links (blue and green), dashed outlines for unbound props (`open`, `onClose`, `setOpen`),
and warnings such as `Unbound prop "open": the component declares it but nothing is passed --
"open" is in scope, wire it with auto-map`.

## Benefit

- **Who benefits:** developers and reviewers of any component-heavy page.
- **What problem it removes:** discovering a missing or misnamed prop only when the screen
  misbehaves.
- **Evidence:** on the demo page the panel found 3 problems (1 undeclared, 2 unbound) plus 2
  unused values in one view, checked in the test with the exact link `count -> total` and the
  `Unbound prop "open"` flag. The analysis is fixed rules over the source, so the same page always
  gives the same picture. Run: `cockpit-browse-preview.spec.js`, story 4.

Verified on `9ed0948` (2026-09-19) against `main`.
