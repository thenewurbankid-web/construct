<!-- Draft sub-issue. Title: "[Demo] As a developer I want to find and open a page in the Cockpit". Parent: the Cockpit guide (parent.md). -->

# [Demo] As a developer I want to find and open a page

**As a** developer joining a project, **I want** to browse the project's features and open any
page from one list, **so that** I can see its structure without knowing the folder layout.

## CLI

The Cockpit itself is a UI. The nearest command-line equivalent is asking Construct what a feature
or layer contains:

```
construct summarize --list --kind feature        # every feature in the project
construct summarize layer:people/page            # what the "page" layer of one feature holds
```

Real output of the first command on the demo project used throughout this guide (a small project
with three features):

```
{ "schemaVersion": 1, "ok": true, "kind": "feature", "count": 3,
  "units": [ { "ref": "feature:core" }, { "ref": "feature:people" }, { "ref": "feature:shop" } ] }
```

(Trimmed to the `ref` of each unit.) The CLI cannot draw the element tree; that is UI-only.

## UI

1. Start the backend and the client (see the UI README), open the Cockpit and choose
   **Explore** in the top bar.
2. In the **Browser** pane on the left, open the **Pages** tab. (A screen's own tabs come first;
   **Screens** is the list of every screen: Dashboard, Import Wizard, Pages Editor, Workflows,
   Local Model, Settings, Help.)
3. Pick a **Feature** (for example `people`). Its pages appear as a list.
4. Click a page (for example `ProfilePage.tsx`). Its structure appears as a tree of elements
   under it, and the page's tools open on the right.
5. Open the **Tools** panel from the top bar (or press `Ctrl Alt B`) to see the Inspector, Scope,
   Source, Diff and Project tabs.

![A page opened from the Browser, with the live preview framed in the middle](https://raw.githubusercontent.com/thenewurbankid-web/construct/ui-screenshots/ui/e2e/screenshots/demos/cockpit-1-hero-dark.png)

## What you'll see

The page's element tree (`main`, `h1`, `p`, `Card` with 3 props, `Foo.Bar` with 1 prop) beside the
page list, and the framed app in the middle if you enter its address in the preview box.

## Benefit

- **Who benefits:** a developer new to a project, or a reviewer checking a feature.
- **What problem it removes:** finding the right file by folder-hopping and guessing which one
  draws a given screen.
- **Evidence:** opening a page takes two selections (feature, then file). The demo run is
  `ui/e2e/tests/demos/cockpit-browse-preview.spec.js`, story 1; it opens `ProfilePage.tsx` and
  asserts the element tree and Tools panel appear. Qualitative beyond that: on this small project
  there was no measured time saving, only fewer steps.

Verified on `9ed0948` (2026-09-19) against `main`.
