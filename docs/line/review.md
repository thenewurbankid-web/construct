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
