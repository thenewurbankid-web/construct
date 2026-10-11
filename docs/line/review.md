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
