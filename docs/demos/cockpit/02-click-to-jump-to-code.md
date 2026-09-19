<!-- Draft sub-issue. Title: "[Demo] As a developer I want to click an element in my running app and jump to its code". Parent: the Cockpit guide. -->

# [Demo] As a developer I want to click an element in the live preview and jump to its code

**As a** developer, **I want** to click something in my running app and land on the exact element
in its source, **so that** I never have to search for which file draws it.

## CLI

This is UI-only today; the CLI has no equivalent. What the CLI does provide is the Vite plugin
that makes it possible: add `constructPreview()` (from `src/engine/previewVitePlugin.mjs`) to your
app's `vite.config`. It marks elements with their file and line while your dev server runs and
never touches your source files or your production build.

## UI

1. Start your app's dev server as usual, with the plugin above enabled.
2. In the Cockpit, open a page (see story 1) and find **Live app preview** on the stage.
3. Type your app's address (for example `http://localhost:5173`) and click **Load preview**. Only
   `http` and `https` addresses are accepted.
4. Click any element in the framed app. The matching node in the element tree is selected, the
   line under the preview reads `Selected features/people/pages/ProfilePage.tsx:11:7`, and the
   Tools panel shows that element's isolated code and props.
5. Clicking an element that belongs to a different file does not steal your selection; the status
   line names the other file instead.

![Clicking "Welcome back" in the framed app selects the matching tree node and shows its code](https://raw.githubusercontent.com/thenewurbankid-web/construct/ui-screenshots/ui/e2e/screenshots/demos/cockpit-2-click-to-source.png)

## What you'll see

The clicked paragraph outlined in the framed app, `<p>` highlighted in the tree, its snippet
`<p>Welcome back</p>` in the Tools panel, and the exact position `ProfilePage.tsx:11:7`.

## Benefit

- **Who benefits:** a developer or designer fixing text or layout in a running app.
- **What problem it removes:** searching the codebase for a piece of text or a component that
  appears on screen, often across many files.
- **Evidence:** one click resolved the paragraph to `ProfilePage.tsx:11:7`, the correct line (the
  demo asserts it). A click on a footer defined in another file was reported as
  `Footer.tsx` without changing the selection. The demo stands in for a real dev server with a
  small static page that carries the same markers the plugin produces, so this shows the Cockpit
  side of the feature, not a full app. Run: `cockpit-browse-preview.spec.js`, story 2.

Verified on `9ed0948` (2026-09-19) against `main`.
