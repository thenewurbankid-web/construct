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
- The structure hash follows the shape the drafter's canonical hash describes, but the drafter's own function is not here yet. Flow states and transitions are not read yet, and edges are typed by the kind and level of their target. When the canonical hash lands, swap `structureOf` for it.

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
- Swap `structureOf` for the drafter's canonical structure hash, and add flow states and transitions.

UAT (about 3 minutes):
1. `node packages/cli/construct.mjs line check --dir examples/line-sample '{"exists": {"path": ["files", "features/orders/components/StatusBadge.tsx"]}}'`. Expect one line, "features/orders/components/StatusBadge.tsx does not exist yet.". Then try `'{"foo": 1}'` and expect one sentence saying "foo" is not an operator.
2. Copy the sample (`cp -R examples/line-sample /tmp/line-expr`), open `/tmp/line-expr` in Cockpit (`cd ui/server && npm start`, `cd ui/client && npm run dev`, http://localhost:3000). On Components, Base on Badge as StatusBadge in orders, then Approve. Then Base on Card as ExprCard, delete `/tmp/line-expr/library/components/Card.tsx`, reload, and Approve. The Plan panel shows the step needs you: "... cannot run as the project stands: library item components/Card does not exist yet.", and no ExprCard file appears.
3. `node packages/cli/construct.mjs line records --dir /tmp/line-expr`. Expect "2 plan records in line/records/plans.jsonl: 1 passed every check, ..." (the refused step is a record too, with its failed checks). Open that file: names appear only as slots like `<feature:F1>` and `<item:I1 kind=components>`.
