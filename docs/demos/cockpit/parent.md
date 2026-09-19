<!-- Draft guide landing page. Issue title: "[Demo Guide] The Cockpit: browse, preview, edit and understand your app". Sub-issues: 01-08 in this folder. -->

# The Cockpit: browse, preview, edit and understand your app

**Who it is for:** a developer or team lead who wants to see, change and understand a web app
without hunting through folders, and anyone (human or bot) who needs a fast, trustworthy answer to
"what is this part of the project and is it healthy?".

## The problem it solves

Understanding an unfamiliar app normally means opening many files, guessing which one draws the
thing you are looking at, and finding out afterwards what a teammate or an AI agent changed. The
Cockpit puts everything on one screen: a **Browser** on the left to find things, the **stage** in
the middle to see and click your app, and **Tools** on the right to inspect, edit and check what
you selected. Every edit is previewed and checked against your architecture rules before it is
written, and nothing needs an AI to work.

## Hero screenshot

![The Cockpit: Browser, live preview and Tools in one window](https://raw.githubusercontent.com/thenewurbankid-web/construct/ui-screenshots/ui/e2e/screenshots/demos/cockpit-1-hero-dark.png)

A page is open (its element tree on the left), the running app is framed in the middle, and the
Tools panel is ready to inspect whatever you click. The same screen in the light theme:
[cockpit-hero-light.png](https://raw.githubusercontent.com/thenewurbankid-web/construct/ui-screenshots/ui/e2e/screenshots/demos/cockpit-hero-light.png).

## Contents

| # | Story | One-line benefit | Surface |
|---|---|---|---|
| 1 | [Find and open a page](01-find-and-open-a-page.md) | Two clicks from "where is it?" to the page's structure | UI (CLI equivalent noted) |
| 2 | [Click an element to jump to its code](02-click-to-jump-to-code.md) | Go from what you see to the exact file and line, with no searching | UI |
| 3 | [See what an agent changed on disk](03-see-what-an-agent-changed.md) | A readable before/after of any outside edit, with a badge to tell you it happened | UI |
| 4 | [Understand how props flow](04-understand-how-props-flow.md) | Wiring mistakes (unused or missing props) are drawn and flagged, not discovered at runtime | UI |
| 5 | [Read and edit a workflow in plain English](05-workflow-in-plain-english.md) | A state machine explained as sentences and scenarios, kept in step with every edit | CLI and UI |
| 6 | [Find anything with the command palette](06-command-palette.md) | Every screen and action is one keystroke plus a few letters away | UI |
| 7 | [Work in light or dark, and on a small screen](07-light-dark-small-screen.md) | Same tool on a phone or in a bright room; problems visible in either theme | UI |
| 8 | [Get a plain-language summary of any part of the project](08-summarize-any-unit.md) | A cheap, repeatable answer for a bot or teammate, without reading source | CLI and REST |

## Why this matters

- You stop searching: what you can see on screen is one click from its source, and what changed on disk is one badge away from a readable diff.
- Every explanation (workflow English, prop links, summaries) is computed from the real files by fixed rules, so it is identical every run and never drifts from the code.
- Nothing is written without a preview and a rules check, and no AI is needed for any of it.

Verified on `9ed0948` (2026-09-19) against `main`.
