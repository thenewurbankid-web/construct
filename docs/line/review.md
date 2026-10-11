# Line build: tests to review and UAT how-tos

One section per step. For each: what the tests prove (plain English), known gaps, and how to
check it yourself. A step is done only after your UAT passes; until then it is "awaiting UAT".
Branch: `work/2026-09-23` in `~/Repositories/construct` (local only, not pushed).

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
   Expect: two LINE-DIR errors, each a plain-English sentence saying which feature imports which and to promote the item to the library.
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

UAT: Components → Button card → "Preview Button" → change label to "Buy now". Expect the picture to update.

## ca2: every Line problem carries a fix you (or an agent) can apply (engine done; screen next)

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

Gaps (advice only, you fix by hand): direct file writes, own copies of shared modules, a route claimed by two features, framework `app/**/page.tsx` routes, broken JSON, stray folders, a file loose in features/, importing a whole feature folder, promoting a name the library already has. Not yet on screen: an "Apply fix" button (next step, running). Also found: `construct validate <path>` ignores the path; use `--dir`.

UAT: after the "Apply fix" screen lands (two clicks: open the problem, Apply).

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

Gaps: choosing the folder is not yet a plan step; the page reloads after choosing; the Base on form still offers features outside the folder (the save refuses them); with the folder at features/orders, Promote is refused because it writes into the library.

UAT (fresh sample):
1. Project switcher → "Change workspace folder" → features/ → Use on orders. Header shows "/ features/orders"; Badge and InvoiceCard show "Read-only".
2. Badge → Base on this → orders → Create: saves.
3. Same with billing: "Nothing was saved: … it stays read-only." and no new file under features/billing.

## cm1: no single point of failure (merged; 5 Trace failures wait for your decision)

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

Gaps: empty folders made before a disk error are left behind; LINE-MODULE does not yet check `ui/` reaching into `packages/`; memory, plan-store and registry fallbacks are not done. On this repo LINE-MODULE reports 216 errors (each package lacks a typed contract; engine and core reach into other packages 205 times).

No UAT (nothing visible).
