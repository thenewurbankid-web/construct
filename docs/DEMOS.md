# Demo Style Guide

The single source of truth for how Construct's demos and user-facing
documentation are written and kept. It applies to the Demos module (#125),
every `[Demo]` epic and sub-issue, the in-product Help > Tutorials, and the
coming GitHub Pages guide. Upkeep is delegated to the `demo-curator` agent
(`.claude/agents/demo-curator.md`), which enforces this file.

A demo exists to show a real benefit to a real person. If a reader cannot
say afterwards "that saves me X" or "that removes the risk of Y", the demo
is not done.

## 1. Guide shape

Every demo topic is a **guide**: one parent ticket plus one real GitHub
sub-issue per capability. **User stories are internal.** A sub-issue may open
with "As a ... I want ... so that ..." to keep its intent clear for the team,
but the documentation site never renders it (owner decision, 2026-09-20, #290);
the site is written as problem, exact command or screen, exact result (section 9).

### The parent ("guide") ticket is a landing page

Title: `[Demo Guide] <what the reader can do>`. Body, in this order:

1. **Who it is for** - one line (for example "a team lead adopting Construct").
2. **The problem it solves** - two or three sentences, plain language.
3. **Hero screenshot** - exactly one, the most convincing single state.
4. **Contents** - a table linking every sub-issue: story title, one-line
   benefit, surface (CLI / UI / both).
5. **Why this matters** - exactly three lines.
6. **Verified on** - see section 5.

### Each capability is a sub-issue

- One capability per sub-issue, titled `[Demo] <what the reader can do>`; the
  "As a ... I want ..." form is still fine when it reads well.
- Body may open with the story: **As a** ... **I want** ... **so that** ...
- Link it as a real GitHub sub-issue, not just a mention:
  `POST /repos/{owner}/{repo}/issues/{parent}/sub_issues` with the child's
  numeric `id` (the `id` field, not the issue number). Linked sub-issues then
  show natively on the parent when opened on GitHub.
- Structure of the body:
  1. **The story**
  2. **CLI** section (see section 2)
  3. **UI** section (see section 2)
  4. **What you'll see** - the observable result, in a few sentences.
  5. **Benefit** block (section 6)
  6. **Verified on** line

Numbered steps are `1.`, `2.`, ... with the exact command or click on each,
so a reader can follow along with no other context.

## 2. Separate CLI, UI and Core sections

Each sub-issue has a clearly labeled **CLI** section and a clearly labeled
**UI** section, plus a **Core** (API) section where the capability has one. They are independent: neither relies on the other, and
neither is interleaved with the other. Each covers the full real breadth of
that surface (every command, flag, option that exists today), verified against
current code, not copied from an old ticket.

If a capability exists on only one surface, say so plainly in the other
section ("This capability is CLI-only today; the UI has no equivalent") - never
leave the section out silently and never pad it.

## 3. Plain language

Write for users and stakeholders. Say what it does and how to use it. Leave
out internals: parsers, function and module names, rule-engine mechanics,
unless a stakeholder would actually care. Product-demo tone, not
engineering-design-doc tone. Spell out acronyms once.

## 4. Real evidence only

- Terminal output is pasted from an actual run. Never invented, never edited
  to look tidier (trim with an explicit `...`, and say you trimmed).
- Screenshots come from an actual Playwright run under `ui/e2e/tests/demos/`.
- Keep screenshots frugal: only at meaningful state changes (a result
  appears, a form succeeds, a diagram renders). Not one per click.
- Screenshots for the site are curated by the demo-curator; they are NOT attached to tickets. Source PNGs may sit on the `ui-screenshots` branch under
  `ui/e2e/screenshots/demos/` and embedded with
  `https://raw.githubusercontent.com/thenewurbankid-web/construct/ui-screenshots/ui/e2e/screenshots/demos/<file>.png`.
- A CLI-only capability uses a real terminal transcript instead of screenshots.
- Timing: show Construct's own per-step timing output where it exists; do not
  add stopwatch numbers from elsewhere.

## 5. Freshness policy

A demo is **stale** when the feature or UI it shows has changed since it was
verified. Examples: the UI polish (#170) restyled every screen, so every
earlier screenshot is stale; the Cockpit shell (Browser / stage / Tools, top bar, drawer) replaced the sidebar and
nav bar, so every screenshot and "click the link in the sidebar" step taken before it is stale too; `--llm` on Create moved from CLI-only to an opt-in
checkbox in the UI (#109), so "the Create form has no LLM option" is stale.

To refresh: re-verify against current `main`, re-run the commands and paste the
new output, re-shoot the screenshots, update the copy. Every guide and every
sub-issue ends with:

> Verified on `<short commit>` (`<date>`) against `main`.

No "verified on" line, or one older than a change to the feature it shows,
means the demo is treated as stale. The Help > Tutorials screenshots
(`ui/client/public/tutorials/`) follow the same rule and have a Playwright
check that every image loads (`ui/e2e/tests/help-tutorials.spec.js`).

## 6. Benefit rule

A demo without a stated, evidenced benefit is not done. Each sub-issue has a
**Benefit** block with three parts:

- **Who benefits** - the role.
- **What problem it removes** - the concrete pain (rework, guesswork, risk).
- **Evidence** - something measurable from a real run: time per step from
  Construct's timing output, size of the diff, a determinism proof (same
  input, identical output on two runs), the number of manual steps replaced,
  a violation count before and after.

"It is convenient" is not a benefit. Where a claim cannot be measured, say
what was observed and be honest that it is qualitative.

## 7. Clutter policy

- **Superseded or duplicate** demo tickets are consolidated: close as
  "superseded by #N" with a link and a comment. Never delete an issue.
- **Stale claims** are corrected in place (for example "provider not reachable",
  or output from before per-step timing existed), with the fix noted in a comment.
- **Unreferenced screenshots** on `ui-screenshots` are removed only after
  verifying that no issue, PR, comment, doc, or tutorial references them;
  when unsure, keep. List every removal in the report.
- Snapshot an issue body to a scratch file before editing it, so every edit
  is reversible.
- No parallel copies of the same story. One guide per topic.

## 8. Checklist before closing any demo

- [ ] Capability is one real linked sub-issue (an internal story is optional and never published)
- [ ] CLI, UI (and Core) sections, separate; missing surface stated plainly
- [ ] Numbered steps, "what you'll see", plain language
- [ ] Real output and real screenshots only, frugal, on `ui-screenshots`
- [ ] Benefit block with evidence
- [ ] "Verified on" line matches current `main`
- [ ] No stale claims, no duplicate of another demo
- [ ] Closing comment has Setup/run, API, Exceptions, Future considerations (CLAUDE.md rule 12)

## 9. The documentation site

The GitHub Pages site (`site/`) is **authored, not generated from tickets**.
Its examples live in `site/content/user/examples/` and are built by
`node site/build.mjs --out site/dist --no-search`, which needs no network and
no token. Rules:

- **Shape of an example**: it opens with `**Problem.**`, then the exact
  command or screen, then the exact result, then a "What you can rely on"
  table, then `Checked against commit <sha> on <date>.` No user stories, no
  ticket numbers, no internal wording (the site test fails on these).
- **Three surfaces, never mixed**: `cli-*` pages hold only terminal
  transcripts, `cockpit-*` pages hold only screenshots and UI text, `core-*`
  pages hold only the exported functions (JSON in, JSON out). The page file
  name prefix and the page's `example:` surface must match
  (`site/test/site.test.mjs`).
- **Structured by product**: the user guide is grouped `Start`, `Construct`,
  `Cockpit`, `CLI` in `site/lib/structure.mjs` — Line is the whole package,
  Construct is the framework (its Core API is one of its surfaces), and the
  Cockpit and the command line are the two ways to drive it. Each of the four
  has a short page of its own (`user-guide/line|construct|cockpit|cli/`).
  Example pages live in their product's group: `cli-*` under CLI, `cockpit-*`
  under Cockpit, `core-*` under Construct; the Examples index still lists them
  by surface. Say plainly which parts are open source (see the Open core
  section of `README.md`); never name MCP on the site.
- **Pitch**: the home page names the problem first (an LLM re-deriving the
  same task with tokens each run, versus repeatable deterministic blocks; a
  cockpit, not an autopilot).
- **Small and current**: prune rather than accumulate. A new capability
  either updates an existing example or replaces one; a page describing
  something not on `main` is wrong. Screenshots come from real Playwright
  runs (reuse those on `ui-screenshots`) and live in `site/assets/img/` as
  webp; refresh them when the screen changes. The home backdrop
  (`cockpit-hero.*`, `cockpit-hero-light.*`) is re-shot from the current
  Cockpit whenever the top bar or modes change.
- **Freshness**: bump the "Checked against" line only after re-running the
  commands and re-reading the screenshots against current `main`.
