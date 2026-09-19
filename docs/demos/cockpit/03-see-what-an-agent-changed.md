<!-- Draft sub-issue. Title: "[Demo] As a team lead I want to see what an agent or teammate changed on disk". Parent: the Cockpit guide. -->

# [Demo] As a team lead I want to see what an agent changed on disk

**As a** team lead (or the developer who has a page open), **I want** to be told when a file I
am looking at was changed outside the editor, and to see exactly what changed, **so that** an AI
agent's or teammate's edit never slips in unnoticed or gets overwritten by mistake.

## CLI

This is UI-only today. On the command line, use your normal version-control diff to review a
change; the Cockpit adds the live "this file just changed" notice while the page is open.

## UI

1. Open a page in the Pages Editor (story 1).
2. Meanwhile, something else edits the file: an agent, the CLI, or another editor.
3. Within a few seconds the **Diff** tab in the Tools panel shows a numbered badge, and a notice
   appears on the stage: "Changed on disk outside the editor. Review it in the Diff tab."
4. Open **Diff**. It names the file and the size of the change ("+1 / -1 lines") and shows a
   before/after with the removed line in red and the added line in green, with unchanged lines
   collapsed.
5. Choose **Reload from disk** to bring the editor up to date and clear the notice, or
   **Dismiss** to hide it.

![The Diff tab: the agent replaced one line and the before/after is shown](https://raw.githubusercontent.com/thenewurbankid-web/construct/ui-screenshots/ui/e2e/screenshots/demos/cockpit-3-agent-change-diff.png)

## What you'll see

`ProfilePage.tsx changed outside the editor (+1 / -1 lines)`, with
`<p>Welcome back</p>` shown as removed and `<p className="lede">Welcome back, Priya</p>` as added.

## Benefit

- **Who benefits:** a team lead or developer working alongside AI agents or teammates.
- **What problem it removes:** editing over a change you did not know about, or having to find
  out later by re-reading the whole file.
- **Evidence:** in the demo run the file was changed with one line replaced; the badge appeared
  and the diff showed exactly `+1 / -1 lines` (asserted by the test). The check is scoped to a
  feature's pages folder; a path that tries to escape it is refused with HTTP 400 (covered by
  the product's own test, `pages-editor-external-change.spec.js`). Demo run:
  `cockpit-browse-preview.spec.js`, story 3.

Verified on `9ed0948` (2026-09-19) against `main`.
