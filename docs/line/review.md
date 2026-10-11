# Line build: tests to review and UAT how-tos

One section per step. For each: what the tests prove (plain English), known gaps, and how to
check it yourself. A step is done only after your UAT passes; until then it is "awaiting UAT".
Branch: `work/2026-09-23` in `~/Repositories/construct` (local only, not pushed).

## Pre-UAT walks: run these before every owner UAT

Each UAT how-to below has a scripted walk under `ui/e2e/uat/` (one spec per step: New project, ca1, Hours 1, 2, 3/3b,
4, 5-6, 7, cx1, cf1, cu6). A walk starts from a fresh copy of `examples/line-sample` in its own temp workspace, opens
it from the project picker, clicks and types as you would, and fails on any console error, React warning, 4xx/5xx
answer, Next.js error overlay, serious accessibility finding, or a screen that runs off the page at 1280px or 375px
(screenshots of both widths land in `ui/e2e/test-results-uat/`). Run all of them (about 2 minutes):

```bash
cd ui/e2e && E2E_CLIENT_PORT=3371 E2E_SERVER_PORT=4371 ../../packages/tools/dev/heavy.sh npx playwright test -c playwright.uat.config.js --workers=1
```

## New project form (fixed 11 Oct, ec00e35f; awaiting UAT)

Typing in the New project form used to freeze the page (React re-rendered forever). Walk: `ui/e2e/uat/new-project.uat.spec.js`.

UAT: open Cockpit with no project open (project switcher → Close project). Under "New project", type `my shop`:
every letter stays and the hint says "A project name has no spaces. Use "-" or "_" instead."; Create and open stays
off. Change it to `my-shop` → Create and open. Expect the project to open (the switcher reads "my-shop") with no
error on screen. Gap: "Starts as" offers Next.js or a React single-page app; there is no "Line project" choice yet.

## ca1: Construct enforces the Line architecture (merged, awaiting UAT)

Test file: `test/line-profile.test.mjs` (29 tests, all pass). Run it:

```bash
node --test test/line-profile.test.mjs
```

### What the tests prove
1. The six Line rules each have a one-sentence reason and a description of how they are checked.
2. Bad `line:` settings in architecture.yml give a plain-English usage error naming the bad field.
3. A complete small Line project (library + two features, plans, packages) passes with no findings.
4. One failing project per rule (LINE-BASE, LINE-OWNER, LINE-DIR, LINE-WRITER, LINE-SHARED, LINE-LAYOUT, six tests): only that rule fires, exactly at the planted lines, and every message is a full sentence.
5. LINE-BASE messages say what is wrong and what to do (missing base, two bases, wrong kind, base that does not exist).
6. spec.md, index files and test files inside a feature are not treated as feature items.
7. Severities and exceptions in architecture.yml change or silence a rule.
8. Construct's existing layer rules (pages, workflows, components) still run on Line items.
9. A run can be limited to some files or some rules.
10. Projects that keep code under `src/` are found without settings.
11. A project with no library or features folder gets one clear finding, not hundreds.
12. Import paths are resolved for relative, `@/`, `~/` and `src/` forms.
13. Every kind of import counts (type-only, re-export, dynamic import, require).
14. Page files are recognised (pages folders, app router `page.tsx`, `Name.page.tsx`).
15. Every way of reaching a file-writing function is caught, and nothing that only reads.
16. Each shared concern names the module that wins; the owning package and configured owners are allowed.
17. Without a profile the old default applies; `preset: line` or `--profile line` picks the Line rules; an unknown name is refused.
18. The CLI exits 0 when clean, 1 with findings, 2 on a bad profile name.

Added in review (bugs found and fixed while merging):

19. Importing another feature's folder itself (`../../orders`) is caught as a cross-feature import.
20. A base link with `..` cannot point outside the library.
21. `const { promises: { writeFile } } = require('fs')` is caught as a direct write.
22. Names like `toString` are not accepted as profile names.
23. `--profile` with no name is a usage error; JSON output larger than 64 KB arrives whole through a pipe (it used to be cut off).
24. The writer gate uses the Line rules on a `preset: line` project: a staged cross-feature import is refused and nothing is written. Before this, only `construct validate` used the Line rules; the writer, approval gate, MCP and Cockpit's validate still used the old rules.

### Known gaps
- Validating one file still reads the whole project first, then filters (slow on big repos).
- LINE-WRITER does not follow variable scopes, so a local function that happens to be named `writeFile` can be flagged.
- Construct's own repo is not a Line project, so `validate --profile line` on it reports 621 findings (mostly direct writes in Trace and tools). New work must not add to that count.
- Construct's full suite had about 67 failures before this step (being fixed in cm1).

### UAT (CLI; the Cockpit view of these errors comes with cu4/cu5)
1. In `~/Repositories/construct`, run the passing example:
   `node packages/cli/construct.mjs validate --profile line --dir packages/core/profiles/line/fixtures/passing`
   Expect: no findings, exit 0.
2. Run a failing example:
   `node packages/cli/construct.mjs validate --profile line --dir packages/core/profiles/line/fixtures/LINE-DIR`
   Expect: two LINE-DIR errors and exit 1, each a plain-English sentence: billing imports OrderButton from orders ("promote that item to library/ and import it from there"), and the library's Button imports from orders ("the library must not depend on any feature, so move what it needs into the library").
3. Try any other folder under `fixtures/` (LINE-BASE, LINE-OWNER, ...) and read the messages: each should tell you what is wrong and how to fix it without other docs.

## Contract for the parallel tasks (T0, done)

`packages/engine/line/contract.mjs` fixes the shapes; `mock.mjs` fakes them. `test/line-contract.test.mjs` (6 tests):
1. The project view lists library items with their level (atom, molecule, organism) and which features use them, and each feature item with its base link, status and findings.
2. "Base on" plans one new feature file that starts with its base link; planning writes nothing; applying it lands it and the library item shows one more user.
3. Refusals are one sentence and change nothing; a cross-feature import is refused with LINE-DIR and "Nothing was saved: ...".
4. Promote moves a feature item into the library and repoints its users, so the cross-feature finding disappears.
5. Setting a prop plans one edited page and lands it.
6. The shape checks reject what Cockpit must never show (no full stop, paths outside the project, a refused change that still wrote files).

Gap: these run on the mock; each real task repeats them on real files.

## T3: set one prop on a page (done; you see it in Hour 6)

`test/line-page-prop.test.mjs` (8 tests):
1. Replacing a text prop changes only that prop; planning writes nothing.
2. A new prop is added after the last one; the rest of the file is byte-identical.
3. Numbers, true/false, code expressions and text with quotes are written correctly, nothing else changes.
4. On a tag spread over several lines, the new prop gets its own line, indented like its neighbours.
5. Every refusal (missing page, path escape, unknown part, bad prop name, wrong value type, an expression that tries to sneak in another prop) gets the right code and one sentence.
6. The page tree the Pages screen shows has the same part ids as Cockpit's existing page editor.
7. For every part and several tricky values, the edit keeps every part id and changes no byte outside that tag.
8. (added in review) A Line project that keeps its code under `src/` works; before the fix every page there was refused.

Gaps: does not check the prop is one the component declares; library pages are not editable here (feature pages only).

## T2: base on a library item, promote, and save through the writer (done; you see it in Hours 4, 6 and 7)

`test/line-ops.test.mjs` (10 tests) and one new test in `test/transactionalWriter.test.mjs`:
1. "Base on" plans one new component that wraps the library one and passes its props through; planning writes nothing; saving lands it and `construct validate --profile line` stays clean.
2. "Base on" works for a page, a workflow and a test fixture too.
3. Every refusal (unknown item, unknown feature, bad name, name taken, sneaky `..` paths) is one sentence and leaves the project byte-identical.
4. A save that adds a cross-feature import is refused with LINE-DIR, and none of its files land, not even the harmless ones.
5. Promote fixes a real cross-feature import: the item moves to the library, the old file goes, both users are repointed, and validate is clean afterwards.
6. Promote repoints `@/features/...` imports to `@/library/...`.
7. Promote gives the same result through TypeScript's own rename when the project has a tsconfig.
8. Promote refuses a name the library already has; a promote that would make the library depend on a feature is refused and nothing changes.
9. Writing outside the project is impossible (`../`, absolute paths, links that lead outside, `.git`).
10. (added in review) A save is refused only for problems it adds: a page that already has a problem can still get an unrelated edit, and a second new problem is refused with just that problem as the reason.
11. The writer can now delete a file as part of a checked change (needed by promote), replayed only when the check passes.

Gaps: an importer that reaches the item through another feature's index file is not repointed (validate keeps reporting it); without a tsconfig, import rewriting is text-based and could touch a matching string in a comment.

## Hour 1: Cockpit shows a Line project's errors in plain English (awaiting UAT)

Sample project: `examples/line-sample/` (library: Button, Badge, Card, DataTable, ListPage, a checkout workflow, a user fixture; features orders and billing). Two planted errors: billing's InvoicesPage imports from the orders feature (LINE-DIR), and billing's InvoiceCard has no library base (LINE-BASE).

Tests: `ui/e2e/tests/line-errors.spec.js` (Playwright, run for real), plus the existing drawer spec updated.
1. Opening the sample shows "2 problems" in the status bar; clicking it opens Diagnostics with exactly two rows.
2. Each row shows the full plain-English sentence; the rule id is not in the row.
3. "Details" starts closed; opening it shows the rule id and the exact file and line.
4. No serious accessibility problems in the list (it caught a too-small Details target, now fixed).
5. Existing drawer test: a page row still opens the Pages editor; rule and file now checked inside Details.

Gaps: one older drawer test about the empty Processes tab fails; it covers tabs this change did not touch (to confirm against the old code). The errors live in the shared Diagnostics drawer, not on a Line screen yet.

### UAT
1. Copy the sample into Cockpit's workspace and start Cockpit (two terminals, in `~/Repositories/construct`):
   `cp -R examples/line-sample ~/workspace/line-sample`
   `cd ui/server && npm start`
   `cd ui/client && npm run dev`
   Open http://localhost:3000.
2. Open the project `line-sample` from the project picker. The status bar says "validate: 2 problems". Click it.
3. Diagnostics shows two rows, each a sentence: one says billing imports from orders and to promote that item to the library; the other says InvoiceCard has no library base. Click "Details" under each: LINE-DIR at features/billing/pages/InvoicesPage.tsx:4 and LINE-BASE at features/billing/components/InvoiceCard.tsx:1.

## Hour 2: Components, the Line library as cards (awaiting UAT)

Tests: `test/line-model.test.mjs` (9), `ui/server/src/lineApi.test.mjs` (5), `ui/client/features/line-library/domain/LibraryView.spec.mjs` (6), `ui/e2e/tests/line-components-library.spec.js` (2, Playwright, run for real).
1. The sample's library reads correctly: Badge and Button are atoms, Card a molecule, DataTable an organism; "used by" counts are right; exactly the two planted problems show.
2. A complete Line project reads with no problems and every feature item linked to its base; a non-Line project is not treated as one.
3. A broken base link keeps what was written and counts for no library item.
4. Level rule: no library imports = atom; only atoms = molecule; anything else (or an import loop) = organism; a written level wins.
5. The project route needs a signed-in session, answers with the real model, and every failure is one sentence.
6. Cards are grouped and ordered Atoms, Molecules, Organisms; pages are not cards; "Used by" and "Based on" read correctly.
7. In the browser: the sample shows the groups and each card's level and use count; billing's InvoiceCard shows its problem sentence, rule id only under Details; accessibility clean.
8. A non-Line project's Components screen is unchanged (and the old 20 Components tests still pass).

Gaps: no previews on cards yet (Hour 3), no search or filters; components written as a folder with index.tsx are not listed; a non-Line project's Components screen shows "Reading the project" for a moment first.

### UAT
1. Start Cockpit with the sample as in Hour 1 and open `line-sample`.
2. Click Components. Expect "Your component library": Atoms (Badge, not used yet; Button, used by 1), Molecules (Card, used by 1), Organisms (DataTable, not used yet).
3. Under "Feature components": billing's InvoiceCard says "No library base yet" with its sentence (Details shows LINE-BASE); orders shows OrderButton "Based on Button" and OrderCard "Based on Card". Open any non-Line project: its Components screen is as before.

## Before the Hours 3-7 UAT: start from a fresh sample
`rm -rf ~/workspace/line-sample && cp -R ~/Repositories/construct/examples/line-sample ~/workspace/`, then start Cockpit (`cd ui/server && npm start`, `cd ui/client && npm run dev`) and open `line-sample`.

## Hour 3: see a library component rendered with its props (awaiting UAT)

Tests: `ui/server/src/lineRenderApi.test.mjs` (7), `ui/client/features/line-render/domain/LineRender.spec.mjs` (3), `ui/e2e/tests/line-component-preview.spec.js` (2, Playwright).
1. Sample prop values: text for text props (its own name), 1 for numbers, false for yes/no, the first choice of a list; a library fixture's values win.
2. Button renders as a real button; the project is byte-identical afterwards; the scratch folder is outside the project and removed.
3. Changing a prop renders the new text; a component built from other library components (DataTable) draws them too.
4. With the Morpheus link down: one sentence saying why there is no picture, the props still listed.
5. Paths outside the library's components, missing files, odd props and links that lead outside are refused with one sentence before anything renders.
6. The real Morpheus renderer draws Button (ran for real).
7. In the browser: the button shows in a locked-down frame, typing a new label redraws it; a feature file is refused with a sentence.

Gaps: the picture is not yet inside the library cards (being added now); rendering runs the component's code inside Cockpit's server process; accessibility checks cannot look inside the picture frame.

UAT: open http://localhost:3000/components/preview?file=library/components/Button.tsx. Expect a button reading "Label" with a `label` row under it; type "Buy now" and the button changes within a moment.

## Hour 4: Base on this (awaiting UAT)

Tests: `ui/client/features/line-library/domain/LineChange.spec.mjs` (4) and `ui/e2e/tests/line-base-on.spec.js` (2, Playwright).
1. The form goes open, edit, save, then either closes on success or stays open with the refusal sentence; nothing else starts while saving.
2. Names are suggested from the feature and the item (orders + Badge = OrdersBadge).
3. In the browser: basing StatusBadge in orders on Badge shows "Saved. Creates StatusBadge in feature orders, based on the library Badge.", writes the file with its base link first, the Badge card says "Used by 1 feature component", and the new row says "Based on Badge".
4. A taken name (OrderButton) gives one sentence, writes nothing, keeps the count; Cancel closes.

Gaps: no name check while typing (the server's sentence is the check); only components get this action.

UAT: Components → Badge card → Base on this → Feature "orders", Name "StatusBadge" → Create. Expect the green sentence, "Used by 1 feature component" on Badge and StatusBadge "Based on Badge" under orders. Then try Button with orders / OrderButton: one refusal sentence, nothing changes.

## Hour 7: Promote to library (awaiting UAT)

Test: `ui/e2e/tests/line-promote.spec.js` (Playwright), plus the promote cases in T2.
1. The sample starts with "2 problems".
2. Promote shows a confirm sentence first; Cancel writes nothing.
3. Promote shows "Saved. Moves OrderButton from feature orders into the library...", OrderButton becomes a Molecules card and leaves orders.
4. On disk the library file exists, the feature file is gone, and InvoicesPage no longer imports from orders.
5. Validate re-runs by itself: "1 problem", only the missing-base one (LINE-BASE) is left.

Gaps: no undo except git; an item used through another feature's index file is not repointed.

UAT (fresh sample): Components → under orders, OrderButton → Promote to library → read the sentence → Promote. Expect the green sentence, an OrderButton card under Molecules, and the status bar at "1 problem" with only the InvoiceCard sentence left.

## Hours 5 and 6: Pages inside a feature, and setting one prop (awaiting UAT)

Tests: `ui/e2e/tests/line-pages.spec.js` (6, Playwright, real server on a copy of the sample), `ui/client/features/line-pages` specs (24 with the other client line specs), plus T3's engine tests.
1. Pages asks which feature first; orders shows OrdersPage "Based on ListPage", "Fine".
2. billing's InvoicesPage shows "Needs attention" with the cross-feature sentence; rule and file:line only under Details; accessibility clean.
3. Saving a new OrdersPage title shows "Saved. Sets title to "All orders" ..." and on disk only that prop changed.
4. A title edit on InvoicesPage succeeds although the page has an old problem; the old problem is still shown.
5. A save that would add a cross-feature import is refused with that reason and nothing is written (sent straight to the server: the screen cannot type code values).
6. One check still runs the screen on the built-in mock.

Gaps: only text, number and yes/no props are editable (no code values); no "View/edit code" or "Fill with AI" yet; Trace's API wiring view is not on this screen yet.

### UAT (fresh sample, see "Before the Hours 3-7 UAT")
1. Pages → pick orders → OrdersPage "Based on ListPage", "Fine".
2. Open OrdersPage, set the title to "All orders", Save. Expect "Saved. ..." and the new value.
3. Pick billing → InvoicesPage shows "Needs attention" with its sentence; change its title and Save: it saves, and still shows the old problem.

## Hour 3b: preview inside each library card (awaiting UAT)

Tests: `ui/e2e/tests/line-components-library.spec.js` (Playwright, real server).
1. Nothing renders before you open a card's "Preview <Name>" (each render bundles the component on the server).
2. Opening Button's Preview shows its one prop (label, text) and the rendered button "Label".
3. Typing "Buy now" re-renders the button as "Buy now".
4. Accessibility check clean; closing the Preview removes it.
Also: the shared client copy of the Line API (`ui/client/lib/lineContract.ts`, `lineHttp.ts`) replaced three per-screen copies; the existing Components and Pages tests still pass (behaviour unchanged).

Gaps: without Morpheus linked, only the one-sentence "no picture" note and the props are shown.

UAT: Components → Button card → "Preview Button" → change label to "Buy now". Expect the blue button to read "Buy now" within a moment. (The sample Button carries its own inline style: Morpheus does not build Tailwind utility classes, so a class-only button showed as plain text.)

## ca2 screen: Apply a fix where Cockpit shows the problem (awaiting UAT)

Tests: `ui/e2e/tests/line-fix.spec.js` (3, real server, clicks counted), `features/line-fix/domain/LineFix.spec.mjs` (4), `lib/lineMockOps.spec.mjs` (2), one new Diagnostics view test, one new `/api/validate` server test.
1. Components: InvoiceCard's problem shows "Base InvoiceCard.tsx on the library component Card, which it already uses." with Apply; one click saves it ("Saved."), the problem leaves the row, the status bar drops to 1 problem, the file gains its base line. Accessibility clean.
2. Pages: InvoicesPage's cross-feature import shows "Move OrderButton.tsx from feature orders into the library…" with Apply; one click saves, the page reads "Fine", the status bar says no problems, OrderButton is in the library.
3. Diagnostics: on a fresh sample, open the drawer and Apply on the LINE-BASE row (two clicks); "Saved." shows above the list and only the LINE-DIR row is left.
4. Panel states (unit): recommended first, others under "Other ways to fix"; advice-only shows the sentence with "Do this by hand", no button; every answer reads "Saved. …" or "Nothing was saved: …"; a double click sends one request; a refusal stays next to the fixes.
5. Mock mode (`?line=mock`): Apply works on the tab's one in-memory project, shared with the Pages screen.

Gaps: no screen offers "Other ways to fix" on the sample (each planted problem has one fix; covered by the unit test). A fix applied from Diagnostics does not re-read a Line screen already open behind the drawer (reopen it). The Components screen has no mock mode.

UAT: open the sample, Components → InvoiceCard → Apply (expect "Saved." and 1 problem); Pages → billing → InvoicesPage → Apply (expect "Fine", no problems).

## ca2: every Line problem carries a fix you (or an agent) can apply (engine done; screen above)

Tests: `test/line-fixes.test.mjs` (each on a fresh copy of the sample with one planted problem), plus contract and server tests.
1. Missing base: exactly one fix ("Base InvoiceCard on the library Card, which it already uses"); applying it writes the base line, the problem goes away, nothing new appears.
2. Other base cases: two base links (keep one), a JSON fixture with no base (sets it); broken JSON gets advice only.
3. Cross-feature import: one fix, promote the imported item; applying it re-points the import and clears the problem.
4. Page outside every feature: top fix moves it into the library's pages (imports re-pointed); moving into a feature is offered too.
5. Page in the wrong folder of a feature: moved into that feature's pages/ with a base; clears both problems.
6. Layout: no library folder (creates it); a loose library file (moved into the right kind folder).
7. Direct file writes and own copies of a shared module: one advice sentence each; asking to apply it is refused as "advice only".
8. Applying by key works; an unknown problem or an unknown fix is one refusal sentence.
9. `construct validate --profile line --format json` carries each problem's key and fixes, so any agent can correct itself.
10. The Cockpit project view carries the fixes too.

Gaps (advice only, you fix by hand): direct file writes, own copies of shared modules, a route claimed by two features, framework `app/**/page.tsx` routes, broken JSON, stray folders, a file loose in features/, importing a whole feature folder, promoting a name the library already has. Also found: `construct validate <path>` ignores the path; use `--dir`.

UAT: see "ca2 screen" above.

## cx1: edit one piece of code in place (awaiting UAT)

Tests: `test/line-fragments.test.mjs` (10), contract and server tests, `SaveFragmentFlow.spec.mjs` (3), `ui/e2e/tests/line-fragments.spec.js` (5, real server).
1. A page lists its handler with a plain label ("What happens when Orders asks for more"), the exact code and position.
2. A component shows all four kinds: style, prop value, condition, handler.
3. For every piece, the saved file differs from the original only inside that piece; planning writes nothing.
4. A save goes through the writer ("Saved. …") and the list shows the new code.
5. A condition that would read differently next to its neighbours is wrapped in brackets, so it stays the same condition.
6. A file changed since you opened it is refused ("reload it and try again").
7. Code that is not one expression, or tries to break out of its place, is refused in one sentence, with the parser message under Details; empty or unchanged code is refused too.
8. Only code files in the library or features can be opened; paths outside the project are refused.
9. A handler that imports another feature is refused by the Line rules and the file stays as it was.
10. With a tsconfig, a type error is refused (TS2322 under Details); a fitting edit passes (about 1 s).
Browser: "Edit code" shows only that piece and no other code; bad code, a cross-feature import and a type error are each refused with Details collapsed; a good edit changes only that handler on disk; accessibility clean.

Sample change: `library/pages/ListPage.tsx` gained an optional `onMore` ("Show more" button) and OrdersPage passes a handler, so there is code to edit.

Gaps: a plain text box (types checked on Save, not while typing); the sample has no tsconfig, so no type check runs there; a type check slower than 3 s turns into a warning after saving (untested); only code inside JSX (no `if` statements or hooks); the screen lists pieces on pages only, not on components.

UAT (fresh sample):
1. Pages → orders → OrdersPage → on ListPage click "Edit code". Expect only "What happens when Orders asks for more" with `() => console.log('Show more orders')`.
2. Change the text to 'All orders' → Save. Expect "Saved. Changes the code for …"; only that handler changed in the file.
3. Edit again and type `() => {` → Save. Expect "This code is not a single valid expression, so nothing was saved." with Details.

## cf1: Features, a feature with everything it owns (awaiting UAT)

Tests: `test/line-feature.test.mjs` (5), contract, server (+2) and client (3) tests, `ui/e2e/tests/line-features.spec.js` (6, real server).
1. orders lists its items by kind (pages, components, workflows), each "Based on …", with the exact Auto summary sentences.
2. The spec (`features/orders/spec.md`, 1 story, 2 acceptance points): point 1 is covered by OrdersPage, point 2 shows "Not covered yet".
3. billing shows both planted problems on its items and in the summary ("InvoicesPage uses OrderButton from feature orders…", "InvoiceCard has no library base yet.").
4. A test title inside the feature covers the point it names; no spec.md means no spec section.
5. An unknown feature, or a project that is not a Line project, is one refusal sentence.
Browser: the list ("Needs attention" / "All fine") replaces the old list for Line projects only; rule and file:line only under Details; accessibility clean; a page name opens Pages on that page, a component name opens Components; mock mode works.

Gaps: coverage is name and test-title matching only (something covered by behaviour but never named shows "Not covered yet"); a component link opens Components, not that card; Line projects lose the old Browser tab inside Features (it opens on Notes); 4 new complexity warnings (no errors) from list loops, the same as the other Line screens.

UAT (fresh sample):
1. Features (`/`) → "Your features": billing "Needs attention", orders "All fine".
2. Click orders → items with "Based on …", the Auto summary, "1 of 2 acceptance points are covered."
3. Click billing → open Details on InvoicesPage's problem (LINE-DIR, `InvoicesPage.tsx:4`); click a page name → Pages opens on it.

## cu6: one project switcher, one workspace folder (awaiting UAT)

Tests: `test/line-workspace.test.mjs` (10, real writer on a copy of the sample), contract, server and client (3) tests, `ui/e2e/tests/line-workspace.spec.js` (2, real server).
1. No workspace set means the whole project: nothing changes for existing projects.
2. Setting the folder saves `line/workspace.json`; it reads back the same; setting it empty returns to the whole project.
3. A change inside the folder saves; a change outside is refused ("Nothing was saved: <file> is outside your workspace folder <folder>; it stays read-only.") and the project is byte-for-byte unchanged.
4. One outside file refuses the whole change; `features/orders-old` does not count as inside `features/orders`.
5. Folders with `..`, absolute paths, `.git`, missing folders, files, and links leading out of the project are refused.
6. A hand-edited workspace file pointing outside makes Line refuse every change.
7. Typed fixes and code edits obey the folder too.
Browser: the header shows "Whole project", then "/ features/orders" after choosing it; Badge and InvoiceCard show "Read-only", OrderCard does not; Base on into orders saves, into billing is refused with the sentence and no file; accessibility clean.

Gaps: choosing the folder is not yet a plan step; the page reloads after choosing; the Base on form offers only features inside the folder (pre-UAT fix; the server still refuses anything outside); with the folder at features/orders, Promote is refused because it writes into the library.

UAT (fresh sample):
1. Project switcher (top left, "line-sample / Whole project") → "Change workspace folder" → features/ → "Use" beside orders/. Header shows "/ features/orders"; Badge and InvoiceCard show "Read-only".
2. Badge → Base on this → orders → Create: saves.
3. Badge → Base on this again: the Feature list offers only orders (billing is read-only); Cancel. Then under billing, InvoiceCard → Promote to library → Promote: "Nothing was saved: … is outside your workspace folder features/orders; it stays read-only." and nothing changes on disk.

## cm1: no single point of failure (merged; LINE-MODULE now 0 on this repo; 5 Trace tests quarantined)

Full suite (each file in its own process group): before 5,479 pass / 21 fail; after 5,511 pass / 5 fail (all Trace, see below).
Real bugs fixed: a wrong-case import (works on macOS, breaks on Linux) is now repaired; `ps` reporting 0 KB for an exiting process no longer fails the benchmark.
Stale tests updated: Node 24's test output format, benchmark minimums, a git worktree counts as the same repo, generator "golden" outputs no longer run as tests.
Skipped with a plain reason (this Mac lacks the tool): flock and /proc/meminfo (heavy.sh), ffmpeg subtitles, studio packaging in the monorepo.
New tests:
1. LINE-MODULE (every package has a contract, a mock and tests; no reaching inside another package): only LINE-MODULE fires on its failing fixture, at exactly the 8 planted spots; each message says what is missing and where; adding it clears every finding.
2. The Line validator skips gitignored files inside a git checkout, and checks every file without git.
3. Local model down or slow: the rules answer, with one sentence saying so; a slow model is given up after 0.2 s and not waited for again.
4. Writer refusals: a disk error puts back the files already changed; a frozen file and a disk refusal are one sentence each, and nothing lands.
5. Cockpit down (no server, network blocked): `validate --profile line` and `create feature` still work from the command line.
Plan: `docs/line/server-split.md`.

Gaps: empty folders made before a disk error are left behind; LINE-MODULE does not yet check `ui/` reaching into `packages/`; memory, plan-store and registry fallbacks are not done. On this repo LINE-MODULE reported 216 errors (each package lacks a typed contract; engine and core reach into other packages 205 times); fixed below.

No UAT (nothing visible).

### LINE-MODULE fix-all (merged d6c80f91, 1f4a324b)
Every package (ast, core, engine, mcp, cli, studio) now has a typed contract, a mock and its own tests, and no package reaches inside another: 227 deep imports now go through named `exports` entries. LINE-MODULE on this repo: 233 → 0; every other Line rule has exactly the findings it had before (WRITER 532, OWNER 80, SHARED 24, LAYOUT 1). Two tools keep it that way: `packages/tools/line-module/fix-imports.mjs` (adds the export and rewrites the import; `--dry-run` previews) and `contracts.mjs --check` (a generated contract out of step with `exports`).
Tests, in plain words:
1. A generated contract that no longer matches the package's `exports`, or an `exports` entry pointing at a missing file, fails the build (`test/line-module-contracts.test.mjs`).
2. Each new mock has the same names and result shapes as the real package (ast, cli, mcp, studio mock tests).
3. A package missing its contract, mock and tests now shows all three problems, not just the first: the validator used to merge them because they shared one spot (`test/line-profile.test.mjs`).
4. Worktrees now use their own copy of every workspace package; before, `@construct/ast` silently ran main's code.
Known gaps: engine and core import each other and core imports ast without listing them as dependencies; engine's published file list leaves out `line/`. Both were there before; left alone to keep the lockfile unchanged.

### UAT (CLI, 1 minute)
1. In the repo, run `node packages/cli/construct.mjs validate --dir . --profile line`.
2. Expect no LINE-MODULE lines in the output (the other rules still list their known findings).
3. Run `node packages/cli/construct.mjs validate --dir examples/line-sample --profile line`: exactly the 2 planted findings.

## ci1: Import one folder of an existing app (partial migration, awaiting UAT)

Tests: `test/line-import.test.mjs` (8), import cases in `test/line-contract.test.mjs`, `ui/server/src/lineImportApi.test.mjs` (3), `ui/client/features/line-import/domain/ImportView.spec.mjs` (3), `ui/e2e/tests/line-import.spec.js` (3, real server, axe).
1. On `examples/import-sample`, folder `src/alerts`: the scan finds 2 pages, 3 components and a fixture, reads the routes `/alerts` and `/alerts/:id` from `App.tsx`, and leaves the hook and the types file as they are, each with a sentence.
2. SeverityBadge goes to the library (both pages use it), AlertRow to feature `alerts` (one page), the pages to feature `alerts`.
3. Exactly one question: Table (a general UI name, but only one page uses it); the recommended answer is first and the plan follows the answer.
4. The plan is plan-ready steps (`line.import.mark`, `line.import.toLibrary`, `line.import.toFeature`, each tool + args + sentence); planning writes nothing.
5. Apply lands every step through the writer with the folder as its root; every file outside the folder is byte-for-byte the same.
6. `construct validate --profile line --dir src/alerts` shows no new errors after the import.
7. A folder outside the project, a step reaching outside the folder, and a second apply are each refused in one sentence.
8. The mock (`?line=mock`) says exactly what the engine says (a test keeps them equal).
Browser: pick the folder, read the proposals (paths under Details), one-click answer, plan, Apply; a bad folder is one sentence; accessibility clean.

How it decides: a feature item is based on the library item it renders when there is one; otherwise its full code goes to the library and the feature gets a thin item based on it (Line's library/feature pattern). A file that code outside the folder imports keeps a one-line re-export at its old path, so the app runs unchanged. Layer findings the imported code already has (a page calling a hook) are recorded as named exceptions in the folder's `architecture.yml`, the to-do list for bringing it to the pattern; LINE-* rules are never excepted.

Gaps: full migration into a new Line app, and importing a single item (next priority); React hooks stay in place (a Line workflow has no React); two items with the same name are refused at the second step; the re-export files at old page paths keep their "orphan page" finding until the app's routes point at the feature pages (that edit is outside the folder); an app needs an `architecture.yml` at its root before Cockpit can open it (max-ai-ui has none).

UAT (cu7, max-ai-ui on a copy): open the copy in Cockpit (add `version: 1` as `architecture.yml` first), go to `/import`, folder `src/subframe-pages/Inbox`, Read folder, Show the plan, Apply. Expect InboxPage in feature `inbox` served at `/:locale/inbox`, and `src/app/...` unchanged.
No UAT (nothing visible).

## cl1: Claude and Line, part 1: the spec, session traces, picked context, drafted framework issues (awaiting UAT)

What it does: Line now describes itself from its own code, and every plan session leaves a record Line can learn from.
- `construct line spec` prints a versioned spec generated from the code: every rule (including LINE-*), every command and `line.*` plan tool with a JSON Schema of its arguments, the plan protocol, the library and feature model, and each module's header and exports. Agents read it over MCP with `line_spec`, one topic at a time.
- Every plan session (each Cockpit server run, each MCP session) writes `line/traces/<id>.jsonl` in the project: each step, each refusal with the typed fixes Construct offered, which fix was picked, and whether it passed. It is written through a new Line-state path in Construct's writer (only inside `line/`, atomic).
- `construct line context` hands over, for the latest refusal, exactly the related files (the refused file, what the refused code imports, its base, what imports it, fixtures) with a one-sentence summary each, plus the rule ids and plan steps. Static; when candidates tie, a picker (jev) can choose among exactly those.
- `construct line misses` finds refusals that recur with no working typed fix; `--draft` writes each as a markdown issue in `line/issues/` with one minimal case cut from a real trace, the spec slice, the picked context and the test the case becomes. Nothing is filed.

Tests: `test/line-spec.test.mjs` (7), `test/line-trace.test.mjs` (11), `ui/server/src/lineCl1Uat.test.mjs` (the UAT walk below), `packages/mcp/test/tools.test.mjs` (`line_spec`).
1. The spec fits its contract and the same code gives the same version.
2. Adding a rule changes the version and the rules topic, and nothing else; taking it out gives the old version back.
3. A new command or a changed tool schema changes the version.
4. Every `line.*` tool in the spec is the registry's tool, and its JSON Schema accepts and refuses exactly what the registry does (missing field, unknown field).
5. The modules topic is read from the source: a new export changes it.
6. One topic keeps the spec version, an id narrows it, every topic fits one MCP call, an unknown topic is one sentence; the CLI prints the slice and exits 2 on a bad topic.
7. The Line-state path writes only inside `line/`, appends atomically and leaves no temp files.
8. A real refused change (orders' page made to use billing) and its recommended fix are traced in order: step, refusal (rule LINE-DIR, the fixes offered, the recommended one marked), outcome; then the fix step, which fix was picked, its refusal and its outcome (0 of 2 checks).
9. A landed step is step then outcome ok; a plan-protocol refusal (unknown tool) is marked as the plan's, not Construct's; long code is cut.
10. A trace that cannot be written never stops the plan and says why in one sentence.
11. A broken trace line is skipped and counted.
12. The context for the real miss: OrdersPage, then InvoicesPage (the refused code imports it), then ListPage (its base), each with a static summary; the rule and both plan steps.
13. When candidates tie at the cut jev is offered exactly those; jev down keeps the static order; another summarizer (cs1) plugs in.
14. Once is not a pattern; twice with no working fix is a framework issue; a fix that passed is not; refusals with no typed fix at all are named as such; plan-protocol refusals never count.
15. Property: over 200 random traces, a group is a framework issue exactly when it recurs and no fix or retry for it passed, and the case is always the smallest refusal.
16. Two real sessions with the same miss draft one issue per kind of refusal under `line/issues/`; nothing outside `line/` changes.
17. UAT walk: spec, two Cockpit sessions through the Plan panel's routes, `misses`, `misses --draft`, `context`; every printed line is a full sentence; validate finds nothing new because of the traces or drafts.

Found by the walk: the fix Construct recommends for this refusal (promote InvoicesPage) is refused too, because InvoicesPage itself uses a feature component. That is exactly what the detector drafts as a framework issue.

Gaps:
- The context picker's summaries are the plain static ones; cs1's summarizer plugs in through the same interface when it lands.
- jev is not wired to the picker yet (the hook is there and tested with a stand-in).
- No Claude calls yet: Claude fixing a drafted issue through Line's plans, validate and the eval gate is the next part.
- A fix step (args.fixOf) that passes does not mark the refused step as resolved in the plan (cp1 behaviour), so Cockpit still shows it as needing you; the detector counts the fix correctly.
- The MCP tool list in the spec is not included (the engine does not depend on the MCP package).
- No Cockpit screen for traces or drafts.

UAT (about 5 minutes; a copy of the sample so the repo stays clean):
1. `node packages/cli/construct.mjs line spec --topic plan`. Expect JSON with a `version` like `sha256:...` and the plan rules in plain English (for example "Only a person approves a write step, in Cockpit; an agent cannot approve.").
2. `cp -R examples/line-sample /tmp/line-uat`, then make a miss no typed fix can mend: `cp /tmp/line-uat/library/components/Button.tsx /tmp/line-uat/library/components/OrderButton.tsx` (the library already has an OrderButton, so neither orders' OrderButton nor billing's InvoicesPage can be promoted; without this, the experiment fixes' chained fix lands and there is no miss). Open `/tmp/line-uat` in Cockpit (`cd ui/server && npm start`, `cd ui/client && npm run dev`, http://localhost:3000). On Pages, open OrdersPage and set the "More" click handler to `() => import('../../billing/pages/InvoicesPage')`, save, then Approve it in the Plan panel. It shows "Needs you": Construct refused the change and none of its fixes would be accepted either; there is no fix button.
3. `node packages/cli/construct.mjs line misses --dir /tmp/line-uat --threshold 1 --draft`. Expect "Read 1 session trace: ...", a "Framework issue: Editing a code fragment (line.setFragment) was refused once (LINE-DIR). Construct refused this once and never offered a typed fix that can run as a step." line, and "Drafted (not filed): line/issues/....md". Open the drafted file: a story, the minimal case, the context and a test. Then `node packages/cli/construct.mjs line context --dir /tmp/line-uat` lists the files Line would hand Claude, each with one sentence.

## Experiment fixes: refused-change fixes that land, stray source files, Qwen's reply length (awaiting UAT)

Found by the reasoning experiment (`experiments/nucleoid-loop`, its `planAmended` workaround) and cl1. Tests: `test/line-amend.test.mjs` (5), `test/line-stray.test.mjs` (6), `test/line-plan.test.mjs` (cl1, 2 new/changed), `test/line-reason-tokens.test.mjs` (4 + 1 opt-in live), `ui/e2e/tests/line-amend.spec.js` (2, real server; it is the UAT below, re-runnable).
1. A fix that names a file only the refused change creates (move OrderButton to `library/OrderButton.tsx`; the fix "move it into library/components/" names a file that is not on disk) is offered as one step that carries the change and the fix together; one approval (in Cockpit, the "Apply recommended fix" click) lands both, the finding is gone, and the refused step shows "Saved together with its fix in step 2."
2. Only a fix that would land is recommended: each fix is tried through Construct's writer on a scratch copy first. cl1's case (OrdersPage imports billing's InvoicesPage): "promote InvoicesPage" alone would be refused (it uses orders' OrderButton), so the recommended fix is the chain "First move OrderButton into the library, because InvoicesPage uses it; then move InvoicesPage.tsx … together with the change Construct refused, in one step." One approval; only the planted LINE-BASE is left.
3. When no fix would land (the library already has an OrderButton), the step is "Needs you", says "Construct refused the change, and none of its fixes would be accepted either, so Line cannot fix it on its own." and offers no fix button; each fix says why Construct would refuse it.
4. Moving OrderButton to a root `components/` folder is now refused: "The source file "components/OrderButton.tsx" is outside library/ and features/, so Line cannot check or reuse it; move it into the library or into the feature that uses it." Recommended fix: into billing's components/ (the only feature that uses it), else the library.
5. Files that are fine stay quiet: root config, `app/` routes, `scripts/`, tests, `types/`, `.d.ts`, `line/`, `packages/`, `src/` entry files, and any folder added under `line.appFolders` in architecture.yml. A project with no library/ or features/ is still reported once, not file by file. The sample shows only its 2 planted findings; `validate --dir . --profile line` on this repo: 882 findings before and after (it is not laid out as Line, so the new check does not run there).
6. Qwen's reply cap: @mx/reason hardcodes 200 tokens with no option. Construct now passes its proposer a fetch that sets `max_tokens` (default 800; per step by pair id, `replyTokens` on the profile, the adapter option, or `CONSTRUCT_REASON_MAX_TOKENS`). Checked against the real linked @mx/reason: the request reaches the server with 800 and a five-plan reply parses. The linked source is not edited.

Gaps: on ui/client (not laid out as Line), `--profile line` now also lists its `lib/` and `components/ui/` files as stray (22 more LINE-LAYOUT); the default validate of ui/client is unchanged. The live Qwen check (`CONSTRUCT_LIVE_QWEN=1`) was inconclusive here: qwen2.5-coder:1.5b answered a five-plan request in 183 tokens, under the old cap, so the test skips with that reason. A chain only follows LINE-DIR promotes, three dependencies at most. Upstream, the clean fix is `maxTokens?: number` on `QwenOptions` in `packages/reason/models.ts` (`engines(o, host, o.maxTokens ?? 200)` and `maxTokens: o.maxTokens ?? 200` in `ask`); Construct's fetch override can then go.

UAT (fresh sample for each part):
1. Ask an agent to move OrderButton to `components/` (or `curl -X POST localhost:4000/api/line/plan/step -H 'Content-Type: application/json' -d '{"tool":"line.moveFile","args":{"from":"features/orders/components/OrderButton.tsx","to":"components/OrderButton.tsx"}}'`). On Components, in the Plan panel, Approve step 1: it shows "Needs a fix" with the "outside library/ and features/" sentence and "Move OrderButton.tsx into feature billing's components/ folder … in one step."
2. Click "Apply recommended fix" (that click is your approval; it adds the fix as step 2 and runs it). Both steps are Done; step 1 says "Saved together with its fix in step 2."; OrderButton is in features/billing/components/.
3. Fresh sample: Pages → orders → OrdersPage → Edit code on ListPage, type `() => import('../../billing/pages/InvoicesPage')`, Save, Approve. "Needs a fix" offers "First move OrderButton into the library …"; click Apply recommended fix. Both steps are Done; OrdersPage now imports library/pages/InvoicesPage.
## cw1: feature workflows, state machines between pages (awaiting UAT)

What it is: the library holds four complete workflows (xstate machines in `examples/line-sample/library/workflows`): wizard (step by step), listDetail (list then detail), createConfirm (create then confirm), signInGate (sign-in gate). Each names its roles: the states a page fills. A feature workflow is a copy of one library workflow with a `@line-base` link to it, a `pages` object saying which of the feature's pages fills each role, and only the transitions the feature adds. Every change is a plan step you approve in the Plan panel; the file is written only by Construct's writer.

Tests: `test/line-workflows.test.mjs` (10: the same story on the contract mock and on a copy of the sample), contract and server tests (+1 each), client (4), `ui/e2e/tests/line-workflows.spec.js` (7, real server), UAT walk `ui/e2e/uat/cw1.spec.js`.
1. The library offers 4 workflows, each with its roles and When → Do sentences ("When the list page sends OPEN. Go to the detail page."); checkout (plain functions) is listed as one Cockpit cannot draw, with the reason.
2. Base on listDetail creates `features/orders/workflows/<name>.ts` with `// @line-base workflows/listDetail`, a copy of the machine and every role "not chosen yet"; the library item then says orders uses it.
3. Choosing OrdersPage for the list role changes only that value; the states and cards then say "OrdersPage" instead of "the list page".
4. Adding "when the detail page sends CANCEL, call cancelOrder, then go to the list" writes an xstate transition with a `callService` action; it is marked "Added for orders" and can be removed; the library's transitions cannot.
5. The generated file passes `validate --profile line`, and xstate actually runs it (OPEN goes to detail, CANCEL calls the service and goes back).
6. Move to the library is the usual Promote: the workflow leaves the feature and is offered from the library, its pages becoming roles.
7. Refusals are one sentence with a code, and nothing is planned: an unknown page ("There is no page InvoicesPage in orders; pick one of its pages (OrdersPage)."), unknown role or state, an event already handled, a library workflow edited directly, a library transition removed, a bad name, a name taken.
8. The four plan tools (line.baseWorkflowOn, line.setWorkflowRole, line.addWorkflowTransition, line.removeWorkflowTransition) are in the contract and the one registry, so agents drive them through the plan API too.
Browser: Features → orders → Workflows tab; each change shows "Waiting for your approval: … Approve it in the Plan panel."; Approve writes it and the diagram, cards and summary update; a refused When → Do shows its sentence with the code under Details and adds no step; accessibility clean.

Gaps: the state diagram and When → Do cards are this tab's own (Behaviour and Events, which they should share, do not exist yet); a feature workflow is a copy, so a later change to the library workflow does not flow into it (the summary says when the feature lost a library transition, not when the library gained one); only plain `on` transitions are shown as cards (guarded or delayed ones are not); the trigger is any event name, not yet picked from the page's own events; promoting keeps the first feature's page names in the library copy's `pages` object.

UAT (fresh sample):
1. Features (`/`) → click orders → Workflows tab: "orders has no workflows yet", four library workflows below.
2. On listDetail click "Use in orders", then Approve in the Plan panel: ordersListDetail appears with its state diagram and two "From the library" cards.
3. Under Pages pick OrdersPage for "list", then Approve: the diagram and the first card now say OrdersPage. Optional: add When detail sends CANCEL, go to the list, service cancelOrder → Add to plan → Approve: a card "Added for orders" appears.
## cs1: plain English first, made by one summarizer on Smith (awaiting UAT)

Smith (`~/Desktop/smith`, commit f70eecf) and atomic-codemod (`~/Desktop/atomic-codemod`, commit 885b32e) were already git repos; they are linked like cu1's packages (`packages/line-links/smith.json`, `atomic-codemod.json`: pinned commit, no copy). `node packages/line-links/link.mjs --load` now lists them too.
The summarizer is `packages/summarize`: `summarize(input)` gives plain sentences plus the technical part as details, with no model. `checkSentence` holds the rules: a full sentence, no raw ids (step, session or rule ids, hashes, tool names), slot names as words (libraryId → "library item"). Item and feature names stay as written.
Now routed through it: plan step sentences (with the tool call, step id, checks, files and options as details), finding sentences, the feature summary. In Cockpit, the Plan panel's steps use the shared `<PlainFirst>` (`ui/client/lib/PlainFirst.tsx`).
One visible change: a finished step now reads "Saved: Creates StatusBadge …" instead of "Saved. Creates …", because "Saved." alone is not a full sentence.

Tests: `packages/summarize/test/contract.test.mjs` (7), `packages/summarize/test/summarize.test.mjs` (9), a client row test, `ui/e2e/tests/line-plain-first.spec.js` (2, real server), the UAT walk `ui/e2e/uat/cs1.spec.js`.
1. Good sentences pass the rules; a lower-case start, a one-word fragment, a raw id or a slot name each fail, and the reason is said in plain English.
2. Each kind (plan step, finding, feature, status, a message from Oracle, Trace, GateLM or the reasoning log, code) gives sentences that pass the rules, with the technical part (options with confidence, the reasoning, code) as details.
3. With Smith linked, a Smith chain (`order.is().paid()`, `order.will().ship()`) reads "If order is paid, order will ship." through to-english. Smith's connector words match the summarizer's list.
4. With Smith or atomic-codemod missing: one sentence each, and everything else keeps working.
5. Browser: the step sentence comes first and passes the rules; the tool call and step id appear only after opening Details; after Approve, the checks and the file written are under Details.

Gaps: the Features and Pages screens still use their own sentence-plus-Details markup (same look, not yet `<PlainFirst>`); Oracle, Trace, GateLM and the reasoning log are supported by the summarizer but not yet routed through it (they live on other branches); there is no chat screen on this branch yet; file paths are allowed in sentences. GateLM's model input is untouched (nothing here feeds a model).

UAT (fresh sample):
1. Components → Badge → Base on this → feature orders, name StatusBadge → Create. The Plan panel says "Waiting for your approval: Creates StatusBadge in feature orders, based on the library Badge." Nothing technical is shown.
2. Open Details under the step: the tool call and the step id are there. Click Approve: the step says "Saved: Creates StatusBadge …"; Details now lists the checks and the file written.
3. Features → orders: the summary reads as full sentences.

## cs2 (scaffold): the static rule factory's miss collector (no UAT)

`packages/rule-factory`. The contract defines a miss record: who decided (static code, a person, an agent or a model), whether static code missed, what it chose and what was finally chosen, and an empty label for jev to fill later. A collector reads the project's plans (`line/plans/*.json`) and validate's findings into miss records. `node packages/rule-factory/static-share.mjs --dir <project>` prints the share of decisions static code made, per step. No Claude or model calls.

Tests: `packages/rule-factory/test/contract.test.mjs` (3), `packages/rule-factory/test/collect.test.mjs` (4).
1. A step that passed its checks counts for static code. A step that needed the person, failed, or was added by jev or Qwen counts as a miss. A fix the person picked counts for static code only if static code ranked it first.
2. A finding with a typed fix ranked first counts for static code; one without a typed fix is a miss.
3. The share comes per step and for all steps, as a count, a percentage and a sentence.
4. On a copy of the sample, one approved Base on step plus the two planted findings give "line.baseOn: Static code decided 1 of 1 (100%)". A broken plan file is skipped, and findings can also come from a saved JSON file.

Gaps (scaffold): decision traces and the reason ledger are in the contract but have no collector; jev labelling, rule proposals and the held-out accuracy gate are not built.
## cu3: one tool registry (awaiting UAT)

Every capability is one typed tool call in `packages/engine/line/toolRegistry.mjs` (contract: `ToolEntry` in `contract.mjs`: id, read or write, what a write changes, input and output shape, one sentence, optional `controlId` for cg1/ct1). Cockpit's `/api/line` routes, construct-mcp's 11 tools, the plan runner's tools (line.* and construct.*), GateLM's 8 tools (`@mx/plan` gatelmTools) and Studio's dispatcher (`studio/src/dispatch.ts`, now linked as `@mx/studio-dispatch`) all resolve from it. `GET /api/line/tools` lists it.
Rule: a read runs at once. A change to project files only ever becomes a plan step that waits for your approval (an agent's too). A change to Line's own state (the plan, the workspace folder, GateLM drafts) runs at once, is written by its own store and is logged to `line/log/tools.jsonl`. Only a person approves.

Tests: `test/line-tool-registry.test.mjs` (8), `ui/server/src/lineToolGate.test.mjs` (2), `ui/e2e/tests/line-tools.spec.js` (1, real server), UAT walk `ui/e2e/uat/cu3.spec.js` (2, browser only).
1. Every entry is typed and has one sentence; ids are unique; a write must say what it changes; a GET route only reads; an agent tool never writes project files.
2. Every `/api/line` route the server declares maps to exactly one entry, and every route in the registry exists.
3. Every construct-mcp tool maps to exactly one entry; it is read-only exactly when the entry reads; none writes project files; none approves.
4. Every tool the plan runner can call (line.* and every construct.* command) is one entry of the same kind.
5. GateLM's real tool list equals the registry's gatelm.* entries, kind for kind; a GateLM answer runs at once and is logged; a mismatched GateLM tool is refused. With GateLM not bound, a gatelm call is one sentence and the rest works.
6. Studio's own dispatcher runs registry handlers: Base on from a chip becomes a waiting step and nothing is written; an agent's approve is refused.
7. No write without approval: Base on by an agent or a person only waits; running it before approval is refused; an agent's approve is refused; after a person approves, an agent may run it and it lands.
8. Setting the workspace (real writer) is saved at once, logged, and adds no plan step.
9. Real server: POST /base-on answers "Waiting for your approval: ..." and writes nothing; the Plan panel shows the waiting step; an unknown /api/line route is a 404 sentence.

Open for you: `construct validate --profile line` flags the registry with LINE-SHARED ("use the shared module @mx/plan registry"), while cu3 asks for one registry module in Construct; say which wins (move the catalog into @mx/plan, or exempt it as the surfaces catalog that feeds @mx/plan). `ui/e2e/tests/line-workspace.spec.js` test 2 still expects Base on to save at once (written before cp1 made it a plan step); it needs an Approve click.

Gaps: the old direct write routes still exist, but now only add a plan step (the integrator removes them); Studio's own code is unchanged (it can take `studioHandlers(registry)`, wiring it in Studio is Studio's step); construct-mcp's blocks run in construct-mcp only (`dispatch` of a blocks.* tool elsewhere says so); GateLM drafts count as Line's own state (no approval), say if they should wait for approval instead; plain-words and chat dispatch arrive with their own steps.

UAT (fresh sample):
1. Components → Badge → Base on this → orders, name StatusBadge → Create. The Plan panel shows "Waiting for your approval: Creates StatusBadge in feature orders, based on the library Badge."; no file yet.
2. Approve step 1: "Saved. ..." and StatusBadge appears under orders.
3. Project switcher → Change workspace folder → features/ → Use features/orders: the header shows the folder at once, and the Plan panel gets no new step.
## cu2: one AI layer, @mx/reason as Cockpit's decision provider (awaiting UAT)

One set of per-step profiles (`packages/core/ai-profiles.json`, 13 steps): Cockpit's fills, Trace's 8 tasks and Construct's chooser and fix picker, each `{step, model (qwen2.5-coder:1.5b), maxTokens (800 for plan steps), fallback: static, ladder}`. One `decide(step, options, context) → {choice, via: static|jev|model, reasons, attribution}` (`packages/core/line-decide.mjs`), and `decideUntilAccepted`: a refused change is retried with Construct's refusal sentence and typed fixes as the options, and stops with one question when a round does not improve.
Tests: `test/line-decide.test.mjs` (17), `test/line-decide-integration.test.mjs` (3, real @mx/reason, mock jev), `ui/server/src/lineAiApi.test.mjs` (4), `trace/src/ai/decide.test.mjs` (5), client (3), `ui/e2e/tests/line-ai-steps.spec.js` (2) and the UAT walk `ui/e2e/uat/cu2.spec.js`, both on the real server.
1. Every profile passes the contract; every local step uses the 1.5B; plan analysis stays on a hosted model; Trace's `ai.config.json` can still override a task, and the profile says so.
2. One option left by the checks is decided by static, with no model asked.
3. With jev up, jev picks among the checked options by their plain labels; the result records jev, the model and the version.
4. Qwen suggests and jev agrees: Qwen's reason is kept. They disagree: low confidence, and Trace leaves the question to you.
5. Reason not linked, jev's model not running, or reason throwing: Qwen's checked pick stands, else static's order, with one sentence saying why.
6. A refusal's typed fixes become the options, Construct's recommended fix first; a refused change retried with them lands; a round that does not improve stops with "… Which fix should Line try?" and the fixes.
7. A project with `decision: provider: reason` gets these suggestions with no plugin file; on a machine without local models jev stays off and the line says so.
8. Cockpit's import and create fills use the 1.5B when Settings names no model (they used the 7B).
Browser: Settings → "AI steps" lists every step, Cockpit first: what it does, "Model: qwen2.5-coder:1.5b (Line's default)", how it decides and falls back; the step id, reply cap and ladder sit under Details; read-only; accessibility clean.

Gaps: the default decision provider is still `rules` (a project opts in with `decision: provider: reason`) because the Requirement screen's 40+ tested reasons come from rules; say if reason should become the default. Trace's choose accuracy with jev on has not been re-measured on the eval set (its ladder says "measured: not yet"). Trace's own reply caps are still in its code, not read from `maxTokens`. Nothing calls `decideUntilAccepted` from a screen yet (ca2's Apply-fix screen is the first user). One new list-loop warning (no errors) in the AI steps panel, as on the other Line screens.

UAT (no project needed):
1. Open http://localhost:3000, click your profile (top right), click Settings.
2. Scroll to "AI steps": every step says what it does, "Model: qwen2.5-coder:1.5b (Line's default)" (plan analysis: "The hosted model you choose") and how it falls back to static.
3. Open Details on "Suggests the next step…": "Step id: construct.chooser", "Reply cap: 800 tokens" and its ladder.
## cg1: Trace lights up the controls for what you ask (awaiting UAT)

One control registry (`packages/engine/line/controls.mjs`): each Cockpit control is registered with the tool it triggers, its screen and its label, and carries `data-line-control` (plus `data-line-target` for the item it acts on). cu3's optional `controlId` on each tool is mocked in `MOCK_TOOLS` until the one tool registry lands. `POST /api/line/trace` maps the request (static words, names resolved against the project) and the plan's open steps to tools, then to controls. When several tools fit, jev picks with a cloze through @mx/reason; if either is down, the static order stands and Details says "Decided by: static".
Tests: `test/line-trace.test.mjs` (21), `ui/server/src/lineTraceApi.test.mjs` (2), `ui/client/features/line-trace/domain/LineTrace.spec.mjs` (10), Playwright `ui/e2e/tests/line-highlight.spec.js` (5), owner walk `ui/e2e/uat/cg1.spec.js`.
1. The registry is one list with unique ids. Every control names a known tool and screen and has a short label. The mock tool list is cp1's plan tools plus Approve and Try again, and each tool's control triggers that tool.
2. Eleven common requests light the expected controls in order (base on, create from, promote, change a title, set a label, edit code, fix, approve, show features, leave as is, try again).
3. Names in the request fill the steps ("Badge", "orders", "StatusBadge", "OrdersPage", "title", "My orders"). If a name is missing, Trace says in one sentence what it still needs.
4. A waiting step lights its Approve, a step that needs you lights its choices, and a done step lights nothing.
5. Several tools fit: without jev the static order picks one, and with jev (mocked) jev picks and `via` records "jev". If jev is unreachable or @mx/reason is missing or broken, the static pick stays.
6. Every registered control is on a real control in the Cockpit source, and every `data-line-control` in the source is registered.
7. Browser: Badge's "Base on this" lights up (not Button's), and the Feature, Name and Create fields light up when the form opens. Approve on a waiting step lights up, and turning Trace off clears everything. A page change asked on Components shows "Go to Pages: …", and there the orders card, OrdersPage, the title field and Save light up. On Features, the feature cards and the billing findings light up. A tie is explained in one sentence, and an unknown request says which words work. Accessibility is clean.

Gaps: the static request rules are English keyword rules (12 tools), not embeddings. Fix steps light "What needs attention" and the Plan panel, not ca2's Apply-fix screen (not merged here). The Plan panel is reached from Features by a link to Components. jev runs with random weights unless trained, so with jev running the pick in a tie is noise.

UAT (fresh sample):
1. Open Components and click **Trace**. Type `Base a new StatusBadge on Badge in orders`: Badge's "Base on this" gets an outline.
2. Click it: Feature, Name and Create get an outline too.
3. Type `Change the title of OrdersPage to My orders`, then click "Go to Pages: …". The orders card has an outline; click it, and OrdersPage has an outline.

## ct1: Auto and Trace, Line's two modes (awaiting UAT)

Trace alone lights the controls and you act. Auto plus Trace: a simulated cursor goes to each control, then clicks or types, with one caption per move. You can pause, take one step, go on, stop or change the speed, and replay a run from "Earlier runs". Auto alone makes the same moves with no cursor. Auto works the real controls, so the change is a plan step: Auto stops at Approve and waits for you, unless you tick "Let Auto approve in this session" (off by default, and it ends when the tab closes). The server's rule that only a person approves is unchanged.
Tests: client spec (Auto's run states, captions, speed, history, settings), Playwright `ui/e2e/tests/line-trace-mode.spec.js` (5), owner walk `ui/e2e/uat/ct1.spec.js`.
1. Trace alone: the controls light up and there is no Auto button.
2. Auto plus Trace: the cursor shows and the captions follow the moves ("Type the name ShowBadge."). Auto stops at "Waiting for you: click Approve…" and nothing is written. You click Approve, the file is written, and the caption says the plan runner ran it.
3. Pause, then One step moves once and stays paused. Stop ends the run. Replay plays the moves again with "Replay: …", ends with "Replay finished; nothing was changed." and adds no plan step.
4. Auto alone with "Let Auto approve in this session" ticked: no cursor, the step runs and is saved, and the plan file records the approval as given.
5. A page change asked on Components goes to Pages, picks the feature and the page, types the new title, clicks Save and waits at Approve. The page file is unchanged until you approve.

Gaps: Auto plays the request's first tool only, with scripts for base on, promote, set a prop, approve and open a feature. Edit code and fixes are Trace-only (the caption says so). Replay skips controls that are no longer on screen. The cursor follows the page layout and does not move if a control is hidden in a closed panel.

UAT (fresh sample):
1. Open Components and click **Trace** and **Auto**. Type `Base a new StatusBadge on Badge in orders`.
2. Click **Show me and do it**. The cursor opens Badge's form, chooses orders, types the name and clicks Create, with a caption for each move. It stops at "Waiting for you: click Approve…".
3. Click **Approve** in the Plan panel: "You approved it…", and StatusBadge.tsx exists. To try Auto alone, turn Trace off, tick "Let Auto approve in this session", type `Base a new PaidBadge on Badge in orders` and click **Do it**.
## ci2: the Import agent (a fixed process you review and approve; browser run pending at merge)

Tests: `test/line-import-agent.test.mjs` (11), `ui/server/src/lineImportAgentApi.test.mjs` (3), `packages/mcp/test/importAgent.test.mjs` (1), `ui/client/features/line-import-agent/domain/AgentScreen.spec.mjs` (5), import-agent cases in `test/line-contract.test.mjs` and `test/line-plan.test.mjs`; browser: `ui/e2e/tests/line-import-agent.spec.js` (4), UAT walk `ui/e2e/uat/ci2.spec.js`.
1. The process is a fixed xstate machine: Read the folder, Sort the items, Write the plan, Review, Make the changes, Check everything, Done; no other order is possible.
2. Its whole state is `<folder>/line/import-plan.json`, written through Construct's writer; pause, close Cockpit, resume later (or from another agent) and it carries on where it stopped.
3. The one open question (Table) is decided by @mx/reason when linked (jev picks; tested with the mock jev), else by the recommended option; every decision is recorded with who decided.
4. In the review you (or your coding agent over MCP) can change, skip, reorder or approve steps; each change is recorded ("You skipped ...", "Your agent changed ..."); a bad change is one sentence and changes nothing.
5. It writes only by adding plan steps (`line.import.*` are now in the one plan registry) that a person approves: your "Approve the plan" carries to the steps you approved; your agent's approval never approves a write (each one waits in the Plan panel).
6. When a step is refused, its typed fixes go back into the decision (top fix first), the fix waits for your approval, then the step is tried again; when a try does not pass more checks than the one before, it stops and asks you one question (a fix, or leave it as it is).
7. Check everything: Line rules on the folder (no NEW problems against the folder before the import; old ones are listed), types (tsc, errors inside the folder), tests in the folder; a check that cannot run says why.
8. On a copy of max-ai-ui (`src/subframe-pages/Inbox`) the agent runs to Done; the original is untouched.
Browser (pending): start, skip one step, Approve the plan, Done with checks; a reload shows the same import; a bad folder is one sentence; mock mode shows the fix loop with one "Approve and run" click.

Gaps: the fix loop against real Construct refusals is tested on the mock only (no fixture step produces a refusal with a typed fix yet); there is no jev picker in Construct, so on a real server decisions use the static order unless one is passed in; types and tests checks are skipped on a copy without `npm install`; one cp1 plan step blocked by an unrelated step stops the import with a question.

To try it in Cockpit (sample: a copy of `examples/import-sample` with `version: 1` as `architecture.yml`, opened in Cockpit):
1. Go to `/import`, click "Or let the Import agent plan it ...", type `src/alerts`, click Start the import. Expect "Review the plan: approve its 10 steps ...".
2. Click Skip on step 5 (Table), then Approve the plan. Expect "Done: 9 steps landed." and Checks: Line rules Passed.
3. Open "Every change": you see your skip and approval and the agent's steps; reload the page: the same import is shown.
## cd1: Cockpit in Trace's style, first screen: Features as a chat (awaiting UAT: please judge the look)

What changed: Trace's demo style (warm paper light theme, warm charcoal dark, Inter type, 8px spacing, rounded cards,
Fit / Wait / Gap colours) is now a set of Cockpit design tokens (`ui/client/lib/line-style.css`, every token `--ln-*`) and
a small set of shared pieces in `ui/client/lib`: the chat entry (`ChatEntry.tsx`, contract `lineChat.ts`), message
bubbles, option chips, status pills and a collapsed Details. Only Features uses them; every other screen is unchanged.
Cockpit's frame (top bar, navigation, panes, theme switch) is unchanged.
Features (Line projects only) opens as a full-screen chat with five options: Open a feature, What is missing?, Create
something, Import an app, Explain. Picking a feature opens its page (items, Auto summary, spec coverage) and the chat
moves to a side panel with that feature's options: What is missing?, Explain, Add from the library, Fix what is wrong,
All features. Read options answer from the read routes; Add and Fix add a plan step, which waits for your Approve in the
Plan panel under the chat. Nothing is written before Approve.

Tests: client `lib/lineChat.spec.mjs` (2), `lib/lineStyle.spec.mjs` (5), `features/line-features/domain/FeatureChat.spec.mjs` (7);
`ui/e2e/tests/line-chat-entry.spec.js` (8, real server); `ui/e2e/tests/line-features.spec.js` (6, updated for the chat);
UAT walk `ui/e2e/uat/cd1.spec.js` (run with `-c playwright.uat.config.js`).
1. Every option has a stable id (`features.open`, `feature.add`, ...), a label and a full sentence; a disabled option says why.
2. The style tokens reach 4.5:1 for text and 3:1 for status colours and control borders on every surface, light and dark (computed from the shipped CSS).
3. The chat's sentences: what is missing (problems, features with no spec, uncovered spec points), explain, the suggested name (OrdersButton), a fix becomes `line.fix`; a refusal keeps its sentence with the code under Details.
4. Browser: Features opens full-screen with the five options and both features (billing "Needs attention", orders "All fine"); the old Features stage is gone for Line projects; accessibility clean in light and in dark, full-screen and side panel.
5. What is missing / Explain / Import answer in plain English; rule and file:line only under Details; Import links to `/import`.
6. Picking orders opens its page with "Ask about orders" beside it; Fix is disabled with "Nothing here has a fix Construct can apply."; All features goes back.
7. Add from the library takes two clicks (Add, then the library item); it waits in the Plan; the file is not on disk until Approve, and then the new item shows on the page.
8. A taken name is refused in one sentence (NAME_TAKEN under Details) and only then does the chat ask for another name.
9. Fix what is wrong on billing adds the recommended fix as a `line.fix` step waiting for approval.
10. Create something from the full-screen chat picks a feature, opens it and asks what to base the new item on.
11. Mock mode (`?line=mock`) still reads; a change says "Changes are not saved in mock mode; ..." instead of writing.

Gaps: making a brand-new feature folder is not a plan step yet (Create adds an item to an existing feature and says so);
Import links to `/import`, which arrives with ci1 (not merged here); there is no free-text box (options only); the Plan
panel under the chat keeps its own layout, only recoloured; Trace mode (highlighting the controls of each step) is not
wired to the option ids yet. Two of Trace's tokens were darkened to pass contrast: the control border (light #877d67,
dark #7d7764; Trace's own #c9c0ad reaches only 1.6:1 on paper) and the light "tie" colour (#9a6008).

UAT (fresh sample; start `cd ui/server && npm start`, `cd ui/client && npm run dev`, open http://localhost:3000 with `examples/line-sample` open):
1. Features opens as a chat. Click **What is missing?**, then **billing**: its page opens with the chat beside it.
2. Click **Fix what is wrong**, then **Recommended fix**, then **Approve** in the Plan. Click **All features**, **orders**, **Add from the library**, **Badge**, then **Approve**: OrdersBadge appears on the page.
3. Judge the look: press Ctrl+K, type "theme", Enter, to see the other theme. Does this style (colours, type, spacing, chat bubbles, option chips) look right for every screen? Say what to change before the rest are restyled.
2. `cp -R examples/line-sample /tmp/line-uat`, open `/tmp/line-uat` in Cockpit (`cd ui/server && npm start`, `cd ui/client && npm run dev`, http://localhost:3000). On Pages, open OrdersPage and set the "More" click handler to `() => import('../../billing/pages/InvoicesPage')`, save, then Approve it in the Plan panel. It needs a fix; click "Apply recommended fix" and Approve. It is refused again.
3. `node packages/cli/construct.mjs line misses --dir /tmp/line-uat --threshold 1 --draft`. Expect "Read 1 session trace: ...", a "Framework issue: Editing a code fragment (line.setFragment) was refused once (LINE-DIR). ..." line, and "Drafted (not filed): line/issues/....md". Open the drafted file: a story, the minimal case, the context and a test. Then `node packages/cli/construct.mjs line context --dir /tmp/line-uat` lists the files Line would hand Claude, each with one sentence.

## Expressions (System 1 groundwork): expected output as checkable expressions (awaiting UAT)

What it does: a step's expected output is now a small JSON expression over a fixed-size facts snapshot of the project, never code. Each check of a plan step carries one (`expr`); each `line.*` tool (`baseOn`, `promote`, `setPageProp`, `setFragment`, `fix`) declares a `pre` (must hold before it runs; when it does not, the step is refused in one sentence and nothing runs) and a `post` (part of its checks). Every finished change step leaves one training record under `line/records/plans.jsonl`, with logic only: every project name is a typed slot.

- Language and evaluator: `packages/engine/line/contract.mjs` (LineExpr, `exprProblem`/`assertExpr`, `EXPR_JSON_SCHEMA`, LineFacts, PlanRecord), `packages/engine/line/expr.mjs` (`evaluate(facts, expr)` -> `{ok, failed: [{path, sentence}]}`). Operators: literals, `path`, `item`, `eq ne lt le gt ge`, `and or not`, `exists`, `count`, `every some`, `in`.
- Facts: `packages/engine/line/facts.mjs` (`{files, library, features, findings, findingsNew, plan, structure, truncated}`, read lazily, capped at 2000 files and 500 findings); mock in `mockFacts.mjs`.
- Structure hashes: `packages/engine/line/structure.mjs`. Delexicalized `sha256:` hashes per project, library, feature and layer (kinds, component levels, base links, import edges to library items; no names), and the structural delta of a step as slotted lines.
- Pre and post: `packages/engine/line/conditions.mjs`. cp1's two default checks are `DEFAULT_CHECK_EXPRS`.
- Records: `packages/engine/line/records.mjs`, appended through `writeLineState` (cl1's atomic Line-state path).
- CLI: `construct line check --dir <project> '<expr JSON>'`, `construct line facts --dir <project>`, `construct line records --dir <project>`.

Decisions to review:
- The post rides on the `files` check (its expression is `and(files expression, post)`), so a step still has the same two checks and cp1's counts ("0 of 2 checks passed") stay as they were. When the post fails but the files are there, the check fails with the post's sentence. Making the post its own third check is a small change, but it would change the counts in cp1's tests and spec.
- The pre is evaluated after the planner when a step is added, so a request the planner refuses keeps the planner's own sentence. When a step runs, the pre comes first (a retry skips it). In practice the pre adds a refusal mostly at run time, when the project changed after the step was added.
- The structure hash is now the drafter's graph hash (merged 11 Oct, see "System 1 reconcile"): roles, import edges and layers ui/workflow/data. Flow states and transitions are not read yet.

Tests: `test/line-expr.test.mjs` (11) and `test/line-expr-plan.test.mjs` (9), all pass, plus the Playwright walk `ui/e2e/tests/uat/expressions.spec.js` (2, real server). Run:

```bash
node --test test/line-expr.test.mjs test/line-expr-plan.test.mjs
```

1. The mock facts fit the LineFacts contract, and the JSON Schema lists every operator.
2. Literals are themselves, a path reads the facts, a missing path is missing, and a list position is a whole number.
3. Comparisons work on numbers and texts. Mixed types never order, and `eq` compares JSON deeply.
4. `and`, `or`, `not`, `exists` and `count` work on lists, texts and objects; a missing value counts 0.
5. `every`, `some` and `in` work over lists with item paths; `in` also works for texts and object fields; a missing list proves nothing.
6. Bad expressions are refused in one sentence (unknown operator, wrong arity, two operators, a bare list, `item` outside every/some, bad paths, a function, a Date, too long, too deep). `evaluate` answers with that sentence instead of throwing.
7. No code runs: a code string is just text, a path cannot reach `constructor` or `__proto__`, `in` sees only own fields, and a function inside a literal is refused.
8. Sentences: each failed part is one plain-English sentence that says what is actually so, for example "features/orders/components/StatusBadge.tsx does not exist yet.". `and` lists every failing part, `or` says none holds, and `every` names the first item that fails.
9. Facts come from the real sample, within their caps, and are hashed; the same project hashes the same. Renaming every feature and item keeps every structure hash; adding an item changes its feature's hash and the project's, and other layers keep theirs.
10. Facts are lazy: a check on the plan alone does not read the project, and the project is read once.
11. Property test: 3000 random expressions over random facts (seeded; set `LINE_EXPR_SEED` to replay one run). `evaluate` never throws on a valid expression, always answers within the contract, and `not` flips the answer.
12. cp1's two default checks carry expressions, and every outcome and sentence is exactly what it was without them. Four cases: a change that lands, a change the planner refuses, a change validate refuses, and a change that is already there.
13. All five tools declare a valid pre and post. The pre holds for a good request and refuses a bad one in one sentence. The spec describes `expr` on a check.
14. After a step runs, its post holds, and the step's `files` check carries it (still two checks).
15. Post as a check: a planner that writes the wrong file passes cp1's file check but fails the post, with the post's sentence. Without the post it would have passed.
16. Pre refusal: a request whose pre fails is refused (`PRE_FAILED`) in one sentence and never joins the plan. If the project changes after a step is added, the pre refuses it when it runs, nothing is written, and the registry itself refuses the same way.
17. Records: each finished step appends one readable record. A record holds the structure hashes before and after (they differ, and one record's "after" is the next record's "before"), the slotted delta, the steps, the checks with their expressions, the pre, the approval and whether the step repaired an earlier one.
18. Records hold logic only: no name from the project's facts appears in the JSONL, nor any word of one, nor the code or the content hash. The live plan keeps the real names.
19. Slots: the same name gets the same slot within a record, an item id and its name share one, and an intent loses each word of a project name.
20. CLI: `line check` prints each failed part as a sentence and exits 1, or prints "Holds."; a bad expression gets one sentence; `line records` summarises without names.
21. Playwright walk (real server, clicks only): Base on, then Approve. The step is done, and its record has two checks with expressions and none of the project's names.
22. Playwright walk: a step whose library item is removed before Approve shows "... cannot run as the project stands: library item components/Card does not exist yet." in the Plan panel and writes nothing. "Leave as it is" clears it, and there are no console errors or 4xx/5xx responses (except Cockpit's known review-branches 400 on a project that is not a repository).

Gaps:
- Only five tools declare pre and post; `setBase`, `moveFile` and `createLayout` do not yet.
- The Plan panel shows a failed check's sentence, but not the expression itself (no Details row for `expr` yet).
- The api-coverage ratchet still counts undocumented exports. They are inherited from the cp1 and cl1 branches (planTools, trace, missDetector, spec, planFallback, workspace, mcp plan); the new modules are fully documented.

Next steps (not built now):
- Wire expressions into Qwen and jev: filter candidate steps by `pre`, verify by `post`, and send only the failed parts (their sentences) back to Qwen.
- The template-based System 1 drafter: request -> plan steps plus expected-output expressions, checked and repaired against these records.
- Train a small model on `line/records/plans.jsonl` (slotted, logic only).
- Add flow states and transitions to the structure hash (the drafter's hash is now `structureOf`).

UAT (about 3 minutes):
1. `node packages/cli/construct.mjs line check --dir examples/line-sample '{"exists": {"path": ["files", "features/orders/components/StatusBadge.tsx"]}}'`. Expect one line, "features/orders/components/StatusBadge.tsx does not exist yet.". Then try `'{"foo": 1}'` and expect one sentence saying "foo" is not an operator.
2. Copy the sample (`cp -R examples/line-sample /tmp/line-expr`), open `/tmp/line-expr` in Cockpit (`cd ui/server && npm start`, `cd ui/client && npm run dev`, http://localhost:3000). On Components, Base on Badge as StatusBadge in orders, then Approve. Then Base on Card as ExprCard, delete `/tmp/line-expr/library/components/Card.tsx`, reload, and Approve. The Plan panel shows the step needs you: "... cannot run as the project stands: library item components/Card does not exist yet.", and no ExprCard file appears.
3. `node packages/cli/construct.mjs line records --dir /tmp/line-expr`. Expect "2 plan records in line/records/plans.jsonl: 1 passed every check, ..." (the refused step is a record too, with its failed checks). Open that file: names appear only as slots like `<feature:F1>` and `<item:I1 kind=components>`.
## System 1 drafter (awaiting UAT; flag `LINE_DRAFTER=1`, default off)

For every request, Line drafts its own structured form, never code or files: every route that can satisfy it, each as plan steps (registry tool calls) plus the expected-output expressions that define done. Construct then tries each route on a scratch copy of the project (through `applyChange`, so its writer and rules decide), evaluates the expressions, and checks the result's structure against what the route predicted. The person picks a route; its steps join the plan and still wait for approval. Code: `packages/engine/line/drafter/` (contract, mock, domain map, lexicon, classifier, templates, verify, structure hashes, records, grammar, eval); server `ui/server/src/lineDraftApi.mjs`; Cockpit `ui/client/features/line-draft` (the "Describe a change" box beside the Plan panel).

How a request flows:
1. **Domain map** (per project, static, kept in `line/domain-map.json`, never shared): every project word (feature, item, library, prop and variable names, UI labels, route paths, spec text) becomes a typed slot, so "use OrderButton in billing" reaches the classifier as `use <component:C1> in <feature:F1>`. An unknown word is one closed question ("Did you mean the orders feature by "ordrs"?"); the answer is stored as a synonym. Order: project map, then the shared lexicon (`lexicon.json`, 154 curated business words, only suggests), then an optional local model (`propose` hook), then the question. A noun after "a"/"new" next to a kind word under add/create becomes a NEW-name slot.
2. **Classifier** (static rules now, same input and output for a small trained one later): closed labels only. Intent from the generated catalog (11 verbs x 17 structural objects, stable ids like `update.feature-flow`, each entry naming the templates that satisfy it), the target slot, and candidate layers with confidence, tuned for recall.
3. **Route enumerator**: templates (base on, via the library, promote, set base, set a prop, set a fragment, apply a fix, fix all, start a feature, create layout, combined layers) produce every sensible route with slot-form steps, expressions, a structural delta, cost and a risk sentence. Layers Line cannot change yet (API/service) are dropped with a sentence; ambiguous words give a route per candidate.
4. **Construct verification** in a scratch copy: refused routes keep Construct's sentence and typed fix; expressions are evaluated; the structure hash after the change must equal the predicted one (a mismatch is a recorded miss, "held back").
5. **Rank**: static (checked first, then confidence, then cost); jev plugs in as `ranker` and only orders. Defer: a question when a word is unknown or the intent is not in the catalog; "qwen" when the best route needs code or a value the request does not give.

Structure hashes (`structure.mjs`): project, feature and layer hashes over kinds, roles (atom/molecule/organism, page, flow, data, "on:<base role>"), base links and import edges, with names left out. Renaming changes nothing; adding a page changes the feature and project hash. Records (`line/drafter/transitions.jsonl`, written through the writer when a person adds a route) store the transition: normalized request, slot shapes, intent, hashes before, steps, expressions, delta, hashes after; never a project name. Retrieval finds the nearest approved transition by intent, feature/layer hash and wording.

Expressions: the drafter writes Line's one expression language (its named checks, `packages/engine/line/expr.mjs`) and evaluates it over `facts.mjs buildFacts`; its mirror is gone (see "System 1 reconcile").

### Eval (`node packages/engine/line/drafter/eval.mjs`)
The harness takes any delexicalized corpus of {project dir, request, gold route set, preferred route, gold labels}; the requests and fills hold slots and structural selectors only, so a generated corpus of imaginary projects plugs in unchanged. Ground truth was written before the harness first ran: 43 cases on `examples/line-sample` (dev) and 12 on `examples/line-heldout-clinic`, a whole project the templates were not designed on; 17 cases are paraphrases held out from template design.

| group | n | normalized | labels (intent / layers / target) | route recall | precision | preferred | checks pass, no repair | defer right | deferred when wrong | hash misses |
|---|---|---|---|---|---|---|---|---|---|---|
| all | 55 | 91% | 86% (86% / 98% / 96%) | 86% | 96% | 86% | 75% | 84% | 88% | 0 |
| dev project | 43 | 88% | 84% | 84% | 95% | 84% | 72% | 81% | 86% | 0 |
| held-out project | 12 | 100% | 92% | 92% | 100% | 92% | 83% | 92% | 100% | 0 |
| held-out paraphrases | 17 | 77% | 53% | 53% | 88% | 53% | 47% | 47% | 88% | 0 |
| base-on | 16 | 94% | 75% | 75% | 100% | 75% | 75% | 75% | 100% | 0 |
| via-library | 5 | 100% | 60% | 60% | 80% | 60% | 80% | 80% | 50% | 0 |
| promote | 6 | 100% | 83% | 83% | 83% | 83% | 83% | 83% | 100% | 0 |
| set-prop | 6 | 100% | 100% | 83% | 100% | 83% | 83% | 83% | 100% | 0 |
| set-fragment | 5 | 80% | 100% | 100% | 100% | 100% | 100% | 80% | - | 0 |
| fix | 7 | 86% | 100% | 100% | 100% | 100% | 100% | 86% | - | 0 |
| set-base | 3 | 100% | 67% | 100% | 100% | 100% | 100% | 100% | - | 0 |
| feature-flow | 3 | 100% | 100% | 100% | 91% | 100% | 0% (needs code by design) | 100% | - | 0 |
| new-feature | 2 | 100% | 100% | 100% | 100% | 100% | 0% (refused by design) | 100% | - | 0 |
| unknown | 2 | 0% | 100% | 100% | 100% | 100% | - | 100% | - | 0 |

Reading it: "checks pass, no repair" is the share of drafts whose recommended route passed Construct's checks and the structure-hash check with no repair. Every miss in labels and recall is a held-out paraphrase with a verb the rules do not know ("I want", "give", "needs", "should also show", "share with", "make reusable", "should say"); "deferred when wrong" says the drafter handed over (question or model) in 88% of the cases where its recommendation was wrong. No verified route ever missed its predicted structure. Floors are pinned in `test/line-drafter-eval.test.mjs` (raise only).

Constrained decoding: the grammar (`grammar/route.schema.json`, `grammar/route.gbnf`, generated from the registry and the expression ops) was run once on the already-installed `qwen2.5-coder:1.5b` through llama.cpp (`eval/constrained-demo.mjs`, no download). After bounding lists, kind prefixes and slot ids, the output parses, validates against the schema, names only real tools and holds only slots; the untrained model picked the wrong intent and repeated a step, which is what fine-tuning is for. (Ollama's own `format` path stopped with "token repeat limit reached" on the first, unbounded grammar.)

### What the tests prove
`test/line-drafter-contract.test.mjs` (3), `test/line-drafter.test.mjs` (12), `test/line-drafter-eval.test.mjs` (3), `ui/server/src/lineDraftApi.test.mjs` (4), `ui/client/features/line-draft/domain/RouteCards.spec.mjs` (2), `ui/e2e/tests/line-drafter.spec.js` (3), `ui/e2e/uat/s1-drafter.spec.js` (1).
1. The intent catalog is every verb x object, generated from the registry; a template whose tool is missing disappears; the mock draft passes the shape checks; bad labels, duplicate routes and unknown expression ops are refused.
2. A stored draft or record holds slots, never a project name; the check catches one that does.
3. Renaming a feature, an item and a library item leaves every structure hash unchanged; adding a page changes the feature, project and ui-layer hash and not the workflow layer.
4. The same request normalizes identically twice (training and use); after renaming a feature, the model's input (normalized text, slot shapes, labels) is unchanged and only the bindings differ.
5. No word outside Line's function vocabulary reaches the classifier; NEW names, values and code become slots ("a refund page" -> RefundPage).
6. An unknown word is one closed question with how it was suggested (map, lexicon, model, ask); the answer is saved in the project's map through the writer and used next time.
7. The shared lexicon is well formed (154 words, closed roles, no synonym that is another word) and only suggests.
8. "Add a badge to the orders feature" gives one checked route whose predicted hash equals the real one, bound to the project's names, and drafting writes nothing.
9. "use OrderButton in billing" lists both routes (via the library, recommended; or a new item on the same base).
10. "update checkout flow" lists the ui, workflow and combined routes, each needing code, and drops the API layer with a sentence.
11. A refused route keeps Construct's own sentence; a request outside the catalog defers to a question.
12. A route whose delta does not match what Construct wrote is marked wrong-shape.
13. A recorded transition is found again by retrieval for a similar request.
14. The committed grammar files are current; every drafted route validates against the schema; an unknown tool or a project word in an argument is rejected; the GBNF names every write tool.
15. The corpus holds no project names; selectors, lexicalizing and wildcard step matching work; the corpus scores at or above its floors with no hash miss.
16. Server: off by default (404 with one sentence); on, a draft lists checked routes, Add puts a waiting step in the plan, Approve writes it, and the record has no names; a two-step route adds what can be planned now and says when to add the rest; a refused route is a 400 sentence; an answered question is remembered.
17. Cockpit: route cards (recommended, refused with its fix, needs input), Details hold the tool calls; answering a question re-drafts.
18. Browser (real server): the recommended route is first, Details are collapsed, Add to plan makes a waiting step, Approve writes the file (axe clean); a refused route has no Add button; one click answers a question.
19. Pre-UAT walk: type, Enter, Add to plan, Approve (two clicks), no console error and no 4xx/5xx, every sentence plain English.

### Known gaps
- Line has no tool that creates a feature folder, so "start a feature" routes are always refused by Construct (shown with its sentence).
- Workflow files have no editable fragments yet, so workflow routes always need code from a model or the person; flow states and transitions are not in the structure hash yet (cw1).
- Rule-based verbs miss everyday phrasing (see held-out paraphrases); the misses defer instead of guessing.
- A two-step route (via the library) adds its second step only after the first ran ("Add the rest").
- The pre-UAT walk ignores the shell's `/api/review/branches` 400 on a project that is not a git repository (not this step's; reported).
- The api-coverage ratchet still reports doc gaps in cp1's `planTools.mjs`, `planService.mjs`, `planFallback.mjs` and `packages/mcp/src/plan.mjs` (not changed here).

### UAT (Cockpit, 3 steps)
1. Start the server with the drafter on: `cd ui/server && LINE_DRAFTER=1 npm start`; then `cd ui/client && npm run dev`; open http://localhost:3000 and open a copy of `examples/line-sample` (`cp -R examples/line-sample ~/workspace/`).
2. Go to Components. In "Describe a change", type `add a badge to the orders feature` and press Enter: the first card reads "Recommended · Checked: Add a new component OrdersBadge to orders, based on the library Badge." Try `use OrderButton in billing` (two ways, via the library first) and `put a badge on the ordrs screen` (one "Did you mean the orders feature?" click).
3. Click Add to plan on the recommended card, then Approve in the Plan panel: `features/orders/components/OrdersBadge.tsx` appears; `line/drafter/transitions.jsonl` has one line with slots and hashes but no project names.

### Next steps (not built)
- Fine-tune a small local Qwen on (normalized request + slot shapes + structure hashes) -> one route (steps + expressions) under the grammar, once there are hundreds of real approved transitions per tool family; also a small classifier for the closed labels. Train on deltas and labels, never whole-project hashes.
- Misses feed back as training cases: every wrong-shape, refused-after-pick or deferred request becomes an imaginary-project case (im1-im3 generator), labelled with catalog ids.
- Local models only, never pulled by Line; jev ranks routes once its accuracy beats the static order on this eval; the model is only asked to fill a hole (a name, a value, code) or to label an unknown request.
- (Done 11 Oct: the expression mirror is gone; records stay in two files, see "System 1 reconcile".)
## System 1 reconcile: one expression language, one drafter, one intent catalog (11 Oct, branch `line-s1-reconcile`; awaiting UAT)

The three System 1 pieces (Expressions, the System 1 drafter, Train Line) were built in parallel against mirrors of each other. They are now one set of modules, one per concern:

| concern | the one module | what went away |
|---|---|---|
| expression language | `packages/engine/line/expr.mjs` (+ `contract.mjs` `EXPR_OPS`, `EXPR_CHECKS`) | `drafter/expr.mjs` evaluate, the drafter's `EXPR_OPS` mirror, `train/exprMirror.mjs` |
| facts | `packages/engine/line/facts.mjs` (`buildFacts`, `factsSummary`) | `drafter/facts.mjs`; `train/facts.mjs` is now a world view over it |
| structure hashes | `packages/engine/line/structure.mjs` (the drafter's graph hash, `applyDelta`, `structureDelta`) | `drafter/structure.mjs`; the expressions branch's simpler hash |
| intent catalog and route contract | `packages/engine/line/drafter/contract.mjs` (`buildIntentCatalog`, `intentPhrase`, `GoldRoute`, `assertGoldRoute`) | Train's `INTENTS` mirror, `train/drafterMirror.mjs` |
| domain map | `packages/engine/line/drafter/domainMap.mjs` | the mirror in `train/slots.mjs` (Train's adapter: `train/draft.mjs`) |
| slot words and the leak guard | `packages/engine/line/slots.mjs` (`splitWords`, `projectWordIn`) | three copies (records, drafter, Train) |

What changed for each piece:
- Expressions gained what the other two needed: nine named checks (`hasItem`, `hasLibrary`, `basedOn`, `fileExists`, `fileContains`, `propIs`, `noNewFindings`, `noFinding`, `refused`), each one operator with its own sentence and `describe()`, in the JSON Schema and the drafter's grammar; the facts gained lazy `contents` and `parts` views (never summarized or stored) and `plan.refusal`.
- The structure hash is the drafter's (roles from the graph, import edges, layers ui/workflow/data); facts, plan records and the drafter's predictions use the same function.
- The drafter: templates write named checks; verification evaluates them on `buildFacts`; a refused route carries Construct's code and rule. Its domain map takes synonyms kept outside the project, keeps each token's words, reads a PascalCase word that names nothing as a new name kept as typed, and "make <new name>" is an add. Its own eval is unchanged (table below).
- Train Line drafts with the real drafter (`train/draft.mjs`): a request is normalized with the drafter's map of the world, drafted in a scratch copy of the world (Construct verifies every route there), and rewritten with Train's slots. A name slot can now start with a feature's name ("OrdersBadge" = orders + Badge), as the drafter names things.
- Records stay in two files, on purpose: a plan record (`line/records/plans.jsonl`) is written after a step ran, with its checks' outcomes, approval and repair; a transition (`line/drafter/transitions.jsonl`) is written when a person picks a drafted route, with the request, slot shapes, intent, slot-form steps, DELTA_OPS and predicted hashes. Neither has the other's fields. They share the structure hashes, the word splitter, the leak guard (plan records now run it too) and Construct's writer.

Intent ids (Train's first 12 onto the drafter's catalog; `TRAIN_INTENT_MAP`, and old stores are read through it). No intent had to be added to the catalog: a refusal or a question is a route outcome, so those cases keep the intent of what was asked.

| Train (before) | drafter catalog | cases |
|---|---|---|
| add.component | add.component | 48 |
| add.page | add.page | 44 |
| add.flow | add.workflow | 42 |
| add.sample-data | add.fixture | 42 |
| share.item | promote.component | 41 |
| move.item-to-library | promote.component | 41 |
| update.page-text | update.prop | 41 |
| update.variable | update.prop | 41 |
| update.feature-flow | update.handler | 41 |
| fix.problem | fix.problem | 82 |
| refuse.not-possible | add.component | 45 |
| ask.missing-detail | add.component | 44 |

The seed: all 552 cases remapped and every gold route re-verified in a scratch copy through the Train store (`node packages/tools/line-train/reverify.mjs`, one logged action): 552 kept, 0 dropped. Train offers the 30 catalog intents its five tools can satisfy (`TRAIN_INTENTS`).

Eval before -> after:
- Drafter (`node packages/engine/line/drafter/eval.mjs`): unchanged, 86% recall, 96% precision, 86% preferred, 86% labels, 0 hash misses.
- Train (held-out worlds w30-w39, 130 cases): mirror 95% recall / 95% precision / 93% preferred -> real drafter 38% / 39% / 40%. The mirror retrieved near-identical cases from the train split; the real drafter's retrieval reads approved transitions, which Train's cases are not yet, so it drafts from its rules and templates alone. The misses are real: everyday verbs the rules do not know ("clear", "titled", "lives in", "show N at a time"), the drafter making up a name where Train's gold asks for it, asking about an unknown feature where the gold refuses, and handler changes with a logged text the drafter cannot turn into code. The test floors (`test/line-train.test.mjs` FLOORS) are these real numbers; raise them, never lower them.

Tests (all pass): `node --test test/line-*.test.mjs ui/server/src/line*.test.mjs packages/mcp/test/*.test.mjs`.
1. Named checks are operators of the one language: each holds or fails with its own sentence, `not` flips it, bad arguments are refused in one sentence, and 1000 random named checks over random facts never throw (`test/line-expr.test.mjs`).
2. File text and page parts are lazy views of the real facts, never summarized or enumerated.
3. Adding a component changes its feature's ui layer hash and not the data or workflow layers; renaming changes nothing (`test/line-expr.test.mjs`, `test/line-drafter.test.mjs`).
4. Train's checks are named checks of the one language (`test/line-train-contract.test.mjs`); Train's intents are catalog ids, each with a phrase and a tool family.
5. The seed: every case in the contract shape, catalog intents only, refusal and question routes still there, no project word in any case.
6. The drafter's map normalizes for Train: names become Train slots, "My orders" becomes {of: the feature, role: my}, a missing library item becomes `<missing:M1>`, a near miss is a closed "Did you mean" (`test/line-train.test.mjs`).
7. A typed request is drafted by the real drafter, corrected with one closed choice, tried, and saved without project words.
8. Eval scores the real drafter at or above its floors per family and intent.
9. One word splitter and one leak guard for plan records, transitions and Train cases (`test/line-drafter-contract.test.mjs`).

UAT (5 minutes):
1. `node packages/engine/line/drafter/eval.mjs`: the first row reads 86% route recall, 96% precision, 0 hash misses.
2. Open Cockpit, profile menu -> Train Line. Under "Teach a new request" type `Make StatusBadge in orders, based on Badge.` and press Draft: the kind of request reads "Add a component" and the first route "Make StatusBadge in orders, based on the library Badge.".
3. Press Run eval: the sentence reads about 38% of the valid routes found and 40% picked the preferred one (the real drafter, not the mirror).
4. `node packages/cli/construct.mjs line check --dir examples/line-sample '{"hasItem": "orders/components/OrderButton"}'` prints "Holds."; `'{"hasLibrary": "components/Tag"}'` prints one sentence saying the library has no component Tag.

Next steps (not built):
- (Done 11 Oct, "System 1 accuracy": Train's train-split cases feed the drafter's retrieval; the everyday verbs are in the shared lexicon; floors raised.)

## System 1 accuracy: rules, retrieval and templates raise the drafter on Train's held-out eval (11 Oct, branch `line-s1-accuracy`; awaiting UAT)

No model was trained: every gain is a rule, a template, a lexicon entry or retrieval, and the classifier still sees only slots. Fixes were chosen from TRAIN-split failures only (a leave-one-world-out run over the 422 train cases); the held-out score was read once, at the end.

Eval before -> after:

| Train held-out (130 cases, worlds w30-w39) | recall | precision | preferred |
|---|---|---|---|
| all | 38% -> 96% | 39% -> 91% | 40% -> 100% |
| Make from the library (`line.baseOn`) | | -> 100% | 61% -> 100% |
| Move into the library (`line.promote`) | | -> 100% | 45% -> 100% |
| Set a page value (`line.setPageProp`) | | -> 100% | 40% -> 100% |
| Edit a piece of code (`line.setFragment`) | | -> 100% | 0% -> 100% |
| Fix a problem (`line.fix`) | -> 75% | -> 75% | 38% -> 100% |
| Refuse or ask (`none`) | -> 100% | -> 69% | 0% -> 100% |

Drafter's own eval (`node packages/engine/line/drafter/eval.mjs`, 55 cases): recall 86% -> 93%, precision 96% -> 96%, preferred 86% -> 93%, labels 86% -> 93%, checks pass with no repair 75% -> 82%, deferred when wrong 88% -> 100%, hash misses 0. "Defer right" fell 84% -> 64% on purpose: see "Ask vs invent" below.

What each fix contributed (train split, leave-one-world-out, preferred picked): before 37%; the rules and templates (fixes 2-5) 94%; with retrieval (fix 1) 99%.
1. **Retrieval from Train** (`train/records.mjs`, `drafter/retrieval.mjs` `precedent`): each eligible Train case is normalized by the drafter's own domain map of its world and its gold routes are rewritten to the drafter's slot refs (`<F1>`, `<C1.base>`, `<F1>/components/<N1>`), the same slotted transition index the drafter already read. A strong precedent (an approved request with the same slots and at least 75% of the same words) sets the intent and ranks its preferred route first; a precedent refused as asked is the answer; a precedent that asked asks. Promote 66% -> 98% ("Let <F2> show <I1>, which lives in <F1>", "<F2> should use <I1> from <F1> too": Train's convention is the promote, which no rule would guess). Only train-split cases on train worlds that Construct verified and nobody disputed feed it; Train Line reads the committed index `line/train/retrieval-index.json` (`node packages/tools/line-train/retrieval-index.mjs`, `--check`) and builds only cases it does not hold. The seed's cases are Claude's verified drafts (no owner agreement yet); an agreed case wins a tie, a disputed one never feeds.
2. **Everyday verbs and phrases** (`lexicon.json` `everyday`, static and curated): grammar words that never become a question ("built", "starting", "lives", "reported", "own"), phrases for a library prop or handler ("per page"/"at a time" -> size, "titled"/"heading" -> title, "asks for more"/"show-more action" -> onMore), everyday verbs ("needs", "want", "give" -> add, "clear" -> remove; clearing a problem is a fix; "fix it" anywhere is a fix). Set a page value 32% -> 98%; Fix 50% -> 100%; Make from the library 54% -> 99% (with the two combined templates: base-on then promote for "reusable"/"other features will want it", and a page plus the component it shows).
3. **Ask vs invent**: a base-on route that must make up the name (or guess the library item) now asks one closed question ("What should the new Badge in orders be called? Line suggests OrdersBadge."; "Which library item should the new component of billing be based on?"). The choices are the checked routes, so one click (Add to plan) accepts the suggestion. The drafter's own corpus was written when inventing was right (its base-on golds say "no question"), so its "defer right" column drops; its route, preferred and label scores do not.
4. **Ask vs refuse** (the rule, `domainMap.mjs` `missingRole`): an unknown word in a target place ("in archive", "to archive", "based on Tooltip", "from Tooltip", "a Carousel called ...") that neither the project map nor the shared lexicon resolves (no near miss, no lexicon suggestion) names a MISSING feature or library item (`<missing:M1>`). It is drafted as asked, Construct refuses it with its own sentence and code (UNKNOWN_FEATURE, UNKNOWN_ITEM; "another <item>" keeps the item's name, NAME_TAKEN), nothing is recommended, and the draft says "Construct refuses this as asked: ...". A near miss ("ordrs") is still one "Did you mean" question, and an unknown word anywhere else still asks. Refuse or ask 1% -> 99%.
5. **Handler templates** (`templates.mjs` `handlerCode`): log a text (`() => console.log("...")`), navigate to a page's route or a quoted path, call a function of the same file, set a state of the same file. Anything else stays "needs code" (a model or the person writes it); nothing is faked. Edit a piece of code 0% -> 100%.

Speed: Line's checks no longer start a `git ls-files` process in a folder outside any git work tree (every scratch copy), which was 80% of a draft's time: 30 Train drafts 21.7s -> 4.0s, so Run eval over the 130 held-out cases fits the scoreboard's minute again (`packages/core/profiles/line/checks.mjs`).

Tests (all pass: `node --test test/line-*.test.mjs ui/server/src/line*.test.mjs packages/mcp/test/*.test.mjs`, 440 tests; tsc ratchet 594; api-coverage green; `fix-imports --dry-run` 0 findings; Playwright `playwright.line-drafter.config.js` on ports 3383/4383: 4 passed. `playwright.line-train.config.js`: before the speed fix 3 passed and the scoreboard spec timed out at its 60s Run eval (the UAT walk after it then met a busy server); the rerun after the speed fix is still owed, blocked by another session's stuck heavy-job lock):
1. Everyday verbs and phrases: "orders needs a Badge" adds; "Clear the reported problem on InvoicesPage." is a fix with no question; "should be titled" sets the title; "has no base; fix it" is a fix; the everyday lexicon is well formed (`test/line-drafter.test.mjs`).
2. No name given: one closed question whose choice is the checked route; no library item: which one; a name given: nothing to ask.
3. Refuse vs ask: a missing feature (UNKNOWN_FEATURE), a missing library item (UNKNOWN_ITEM) and a taken name (NAME_TAKEN) are refused by Construct and nothing is recommended; "ordrs" is a question, never a refusal.
4. Handler: "the show-more action should log ..." writes `() => console.log("...")` and passes Construct; "email the boss" gets no made-up code.
5. A strong precedent sets the intent and its route comes first; an unapproved record is never a precedent.
6. **Leakage** (`test/line-train.test.mjs`): every record comes from a train case on a train world; the records are identical with or without the held-out cases; a held-out world's case that claims the train split and the owner's agreement, a disputed case and a held-out case are all refused; no record holds a word of its world (the shared leak guard also drops one, e.g. a feature called "parts" that reads as grammar); the committed index is current and holds no held-out case; a poisoned index entry for a held-out case is never read.
7. Floors raised to the new real numbers: Train held-out 96/91/100 plus 100% preferred per family; drafter eval dev recall 0.9, held-out project recall 1, precision 0.958, preferred and labels 0.927, deferred when wrong 1.

Gaps:
- Fix-family recall and precision 75%: Train's gold also lists the raw promote of the cross-feature item, which the request does not name (no slot to retrieve it by), and the drafter shows every typed fix.
- Refuse or ask precision 69%: when Line asks, it still shows the checked routes (they are the question's choices); Train's gold has only the question.
- The Cockpit drafter on a real project does not read Train's records yet (only Train Line and its eval do); wiring it means choosing whether imaginary-world precedents may rank routes on a user's project.
- Cockpit shows the closed name or library question as a note above the route cards, not as buttons of its own.
- Retrieved routes skip the structure-hash prediction (they carry no delta); Construct's write and the checks still run.
- The drafter's own corpus still expects invented names without a question (see 3); the owner decides whether its golds follow Train's.
- "Share <item> with <feature>" is now marked unsure (defers to a model) because the two corpora disagree on its preferred route.

### UAT (5 minutes)
1. `node packages/engine/line/drafter/eval.mjs`: the first row reads 93% route recall, 96% precision, 93% preferred, 0 hash misses.
2. Open Cockpit, profile menu -> Train Line, press Run eval: the sentence reads about 96% of the valid routes found and 100% picked the preferred one.
3. Under "Teach a new request" on the Line sample, type `Let billing show OrderButton, which lives in orders.` and press Draft: the kind of request reads "Move a component into the library" (set by a precedent from Train's cases) and the first route is "Move OrderButton from orders into the library.", the second "Make OrderButton in billing, based on the library Button.". Then `Make StatusBadge in archive, based on Badge.`: the one route reads "Changes nothing: Construct refuses it." (there is no archive feature).
4. With the drafter on (`LINE_DRAFTER=1`), in Components -> "Describe a change": `add a badge to the orders feature` shows the note "What should the new Badge in orders be called? Line suggests OrdersBadge." above the checked route; `On OrdersPage, the show-more action should log "More orders".` gives a checked route whose Details show `() => console.log("More orders")`.

## Train Line: the owner and Claude train Line's drafter (awaiting UAT)

One screen, `/train` (profile menu → Train Line), where you and Claude teach Line's System 1 drafter to turn a request into routes (plan steps plus checks), using only the five tested tools: Make from the library (`line.baseOn`), Move into the library (`line.promote`), Set a page value (`line.setPageProp`), Edit a piece of code (`line.setFragment`), Fix a problem (`line.fix`). Nothing here touches your project: every case lives on an imaginary project (40 generated ones: shop, clinic, school, CRM and more, each passing `validate --profile line`) or the Line sample, and every check runs in a scratch copy through Construct's writer.

What is stored (`line/train/cases.jsonl`, through the writer; `line/train/log.jsonl` says who changed what): no project or domain words, only slots ("Make <name:N1> in <feature:F1>, based on <library:L1>."), the intent, the routes and their checks. The screen fills the names back. The seed: 552 cases Claude generated and Construct verified (every gold route applied in a scratch copy and its checks passed; refusals refused with their typed fix), covering Train's 12 first intent ids (now 8 ids of the drafter's catalog, see "System 1 reconcile"), 168 with several valid routes; 130 cases on 10 whole projects are held out for eval; 96 are in your random review sample.

The mirrors are gone (11 Oct, "System 1 reconcile"): Train drafts with the real System 1 drafter, its domain map and its intent catalog, and checks with Line's one expression language. The mirror drafter scored 95% of valid routes found and 93% preferred picked; the real drafter scores 38% and 40% on the same held-out cases (why: below).

Tests, in plain words:
1. Every imaginary clean project passes the line profile; each problem variant plants exactly one problem with a fix that runs; the CLI agrees.
2. The seed: a few hundred cases, every intent covered, several routes where a request has them, every route verified, and no saved case contains a name or domain word of its project.
3. Whole projects are held out (w30-w39 only in eval, never learned from).
4. Try it: a right route passes in a scratch copy, a wrong check fails with a sentence, a refusal is refused, a question really cannot run without its detail; the sample folder is byte-identical afterwards.
5. A near-miss word ("ordrs") offers "Did you mean orders?"; the answer becomes a synonym of that project.
6. Only you agree or disagree (Claude cannot, over MCP or the API); a disagreement keeps your note; every change is logged as owner or claude.
7. A typed request is drafted, one feature corrected with a closed choice, saved without project words; a route that fails is refused before saving.
8. Eval drafts every held-out case from the train split only and scores valid routes found, drafted routes valid, preferred picked, per tool family and per intent; over MCP it saves nothing.
9. MCP: `train_propose_case` (Claude's draft, verified and delexicalized), `train_list_cases`, `train_run_eval`; no review or approve tool.
10. Browser (`ui/e2e/tests/line-train.spec.js`, real server): review, teach, Did you mean, Run eval; accessibility clean; no console error or failed request. The owner's walk below is `ui/e2e/uat/line-train.spec.js`.

Gaps: Train's cases do not reach the real drafter's retrieval yet (it reads approved transitions, not Train cases); Line's kinds have no API or service layer, so "UI only / API only" routes cannot exist yet (routes span pages, components, flows, sample data and the library); a new name typed by you is kept as a role word; missing-feature refusals are drafted poorly (70% on refusals); "Add a route" offers one step per route; the sample world cannot share billing's InvoiceCard (it has no base), so that case is not in the seed.

### UAT (5 minutes)
1. Open Cockpit, profile menu → Train Line.
2. Review 5 of Claude's cases: read each request and its routes (side by side, the preferred one starred); Agree with the ones you would do that way, Disagree with one and say why.
3. Under "Teach a new request", click a suggested request (or type one, e.g. "Make StatusBadge in orders, based on Badge.").
4. Correct the draft: change the feature in its list (two clicks), press Try it on a route (it says "It works in a scratch copy"), then Save as a training case.
5. Press Run eval and read the scoreboard: per tool family, the share of valid routes found, preferred picked, and your agreement on Claude's cases.
