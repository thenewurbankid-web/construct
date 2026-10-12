// Line Import v2: a move keeps the characterization tests valid. Found on max-ai-ui /opportunity (2026-10-12): moving
// opportunityAdapter into the library left its `@/libs/adapters/opportunityAdapter` importers pointing at a file that
// was gone (the import folder `src` has no tsconfig.json of its own, so the regex move engine ran and it did not read
// the tsconfig's `paths` one folder up), and four suites of locked tests could not run. Moving a MOCKED module had a
// second gap: `jest.mock('<old path>')` in the generated tests was left behind, so the mock no longer applied.
// Both move engines (tsFileMove.mjs for a root with a tsconfig, ops.mjs's regex engine otherwise) now re-point alias
// importers and jest's module calls, as part of the same staged change (one plan step, written through the writer).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { jestHome, NO_JEST_HOME } from '../test-utils/jestHome.mjs';
import { planMoveFile, applyChange } from '../packages/engine/line/ops.mjs';
import { planImportStep, applyImport } from '../packages/engine/line/import.mjs';
import { readPathAliases, movedSpecifier, clearMoveCache } from '../packages/engine/tsFileMove.mjs';
import { characterize, runJest, CHAR_DIR } from '../packages/engine/line/characterize.mjs';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/line-char-app');

function write(root, rel, text) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

/** An app whose tsconfig (with `@/*` -> `./src/*`) sits above the import folder `src`, plus a test that mocks a module. */
function aliasApp() {
  const app = makeTempDir('construct-char-move-');
  write(app, 'tsconfig.json', '{\n  // comments are fine\n  "compilerOptions": { "baseUrl": ".", "jsx": "react-jsx", "paths": { "@/*": ["./src/*"], "@/public/*": ["./public/*"] } }\n}\n');
  write(app, 'src/libs/api.ts', "export function useThing() { return 1; }\n");
  write(app, 'src/libs/other.ts', "export const other = 2;\n");
  write(app, 'src/pages/Page.tsx', "import { useThing } from '@/libs/api';\nimport { other } from '@/libs/other';\nexport default function Page() { return useThing() + other; }\n");
  write(app, `src/pages/${CHAR_DIR}/Page.char.test.tsx`, [
    "jest.mock(\"../../libs/api\", () => require(\"./rt.js\").mock(jest.requireActual(\"../../libs/api\")));",
    "jest.mock('@/libs/other');",
    "const spy = [() => require(\"../../libs/api\"), 'useThing'];",
    "import * as LineSubject from \"../Page\";",
    '',
  ].join('\n'));
  return app;
}

test('readPathAliases: the nearest tsconfig at or above the folder, as folders relative to it; aliases outside it are left out', () => {
  const app = aliasApp();
  assert.deepEqual(readPathAliases(path.join(app, 'src')), [{ prefix: '@/', dir: '' }]);
  assert.deepEqual(readPathAliases(app), [{ prefix: '@/public/', dir: 'public' }, { prefix: '@/', dir: 'src' }]);
  const file = path.join(app, 'src/pages/Page.tsx');
  const [oldAbs, newAbs] = [path.join(app, 'src/libs/api.ts'), path.join(app, 'src/library/services/api.ts')];
  assert.equal(movedSpecifier(path.join(app, 'src'), [{ prefix: '@/', dir: '' }], file, '@/libs/api', oldAbs, newAbs), '@/library/services/api');
  assert.equal(movedSpecifier(path.join(app, 'src'), [{ prefix: '@/', dir: '' }], file, '../libs/api', oldAbs, newAbs), '../library/services/api');
  assert.equal(movedSpecifier(path.join(app, 'src'), [{ prefix: '@/', dir: '' }], file, '@/libs/other', oldAbs, newAbs), null, 'another module');
  assert.equal(movedSpecifier(path.join(app, 'src'), [{ prefix: '@/', dir: '' }], file, 'react', oldAbs, newAbs), null, 'a package');
  // A move out of the alias's folder turns the alias into a relative specifier (never `@/../x`).
  assert.equal(movedSpecifier(app, [{ prefix: '@/', dir: 'src' }], file, '@/libs/api', oldAbs, path.join(app, 'shared/api.ts')), '../../shared/api');
});

for (const engine of ['regex', 'typescript']) {
  test(`a move (${engine} engine) re-points alias importers and the tests' jest.mock / requireActual / require specifiers, in the same change`, () => {
    clearMoveCache();
    const app = aliasApp();
    // the regex engine runs on an import folder without its own tsconfig (src, as in max-ai-ui); TypeScript on the app root
    const root = engine === 'regex' ? path.join(app, 'src') : app;
    const pre = engine === 'regex' ? '' : 'src/';
    const change = planMoveFile(root, { from: `${pre}libs/api.ts`, to: `${pre}library/services/api.ts` });
    const byPath = Object.fromEntries(change.files.map((f) => [f.path, f.content]));
    assert.equal(byPath[`${pre}libs/api.ts`], null, 'the old file is removed');
    assert.match(byPath[`${pre}pages/Page.tsx`], /from '@\/library\/services\/api'/, 'the alias importer keeps its alias and names the new place');
    assert.match(byPath[`${pre}pages/Page.tsx`], /from '@\/libs\/other'/, 'an import of another module stays');
    const t = byPath[`${pre}pages/${CHAR_DIR}/Page.char.test.tsx`];
    assert.ok(t, 'the characterization test is part of the change');
    assert.match(t, /jest\.mock\("\.\.\/\.\.\/library\/services\/api", /);
    assert.match(t, /jest\.requireActual\("\.\.\/\.\.\/library\/services\/api"\)/);
    assert.match(t, /\(\) => require\("\.\.\/\.\.\/library\/services\/api"\)/, 'a spy target (require in a .tsx file) follows too');
    assert.match(t, /require\("\.\/rt\.js"\)/, 'the runtime require is untouched');
    assert.match(t, /jest\.mock\('@\/libs\/other'\)/, 'a mock of another module is untouched');
    assert.doesNotMatch(t, /libs\/api/, 'nothing still names the old place');
  });
}

test('applyImport of folder src (tsconfig one folder up, carried into its scratch copy): every `@/` importer of a moved file names its new place', () => {
  const app = makeTempDir('construct-char-move-import-');
  write(app, 'tsconfig.json', '{ "compilerOptions": { "baseUrl": ".", "jsx": "react-jsx", "paths": { "@/*": ["./src/*"] } } }\n');
  write(app, 'architecture.yml', 'version: 1\n');
  write(app, 'src/fixtures/items.json', '[{"id":"a"}]\n');
  write(app, 'src/lib/format.ts', "export function format(n: number) { return n > 1 ? 'many' : 'one'; }\n");
  write(app, 'src/components/Badge.tsx', "import { format } from '@/lib/format';\nexport function Badge({ n }: { n: number }) { return <span>{format(n)}</span>; }\n");
  write(app, 'src/pages/Home.tsx', "import { Badge } from '@/components/Badge';\nimport items from '@/fixtures/items.json';\nexport default function Home() { return <Badge n={items.length} />; }\n");
  const r = applyImport(app, 'src');
  assert.ok(r.ok, r.sentence);
  assert.ok(!fs.existsSync(path.join(app, 'src/lib/format.ts')), 'format moved');
  const badge = fs.readFileSync(path.join(app, 'src/library/components/Badge.tsx'), 'utf8');
  assert.match(badge, /from '@\/library\/workflows\/format'/, '`@/lib/format` (an alias outside the library) follows the move');
  assert.match(fs.readFileSync(path.join(app, 'src/library/pages/Home.tsx'), 'utf8'), /from '@\/library\/components\/Badge'/);
});

test('an import step on folder src (tsconfig one folder up) re-points alias importers and the characterization tests\' mocks', () => {
  const app = aliasApp();
  fs.writeFileSync(path.join(app, 'architecture.yml'), 'version: 1\n');
  const root = path.join(app, 'src');
  const mark = planImportStep(root, { id: 'import-1-mark', tool: 'line.import.mark', args: { folder: 'src', features: [], appFolders: ['libs', 'pages'] } });
  assert.ok(applyChange(root, mark).ok);
  const step = planImportStep(root, { id: 'import-2-lib-api', tool: 'line.import.toLibrary', args: { folder: 'src', from: 'libs/api.ts', kind: 'services', name: 'api', keepShim: false } });
  const page = step.files.find((f) => f.path === 'pages/Page.tsx');
  assert.ok(page, 'the importer is part of the step');
  assert.match(page.content, /'@\/library\/services\/api'/);
  const r = applyChange(root, step);
  assert.ok(r.ok, r.sentence);
  assert.ok(fs.readFileSync(path.join(root, `pages/${CHAR_DIR}/Page.char.test.tsx`), 'utf8').includes('jest.mock("../../library/services/api"'));
});

// ---- for real, in jest: characterize the small app, move its mocked data-hook module, run the locked tests --------------

const home = jestHome();
const FILES = ['src/app/shop/page.tsx', 'src/app/shop/Shop.tsx', 'src/lib/price.ts', 'src/lib/api.ts', 'src/lib/toast.ts'];

function copyApp(from) {
  const dir = makeTempDir('construct-char-move-app-');
  fs.cpSync(from, dir, { recursive: true, filter: (p) => path.basename(p) !== 'node_modules' });
  fs.symlinkSync(home, path.join(dir, 'node_modules'), 'dir');
  return dir;
}

function outcome(root, files, tag) {
  const r = runJest(root, files, { workDir: makeTempDir('construct-char-move-run-'), tag });
  const failed = (r.results?.testResults ?? []).flatMap((f) => (f.assertionResults ?? []).filter((a) => a.status !== 'passed').map((a) => a.title));
  return { passed: r.results?.numPassedTests ?? 0, failed: r.results?.numFailedTests ?? 0, suitesFailed: r.results?.numFailedTestSuites ?? 0, failedTitles: failed };
}

test('characterization tests still pass after their mocked module moves (both engines), and still fail when a branch changes', { skip: home ? false : NO_JEST_HOME, timeout: 900_000 }, async () => {
  const base = copyApp(FIXTURE);
  const r = await characterize(base, { files: FILES, routes: [{ entry: FILES[0] }] }, { units: [] }, { budgetMs: 2500, componentBudgetMs: 6000, maxIdle: 400, workDir: makeTempDir('construct-char-move-work-') });
  assert.equal(r.failed, 0);
  const locked = r.files.filter((f) => f.endsWith('.char.test.tsx'));
  const shopTest = `src/app/shop/${CHAR_DIR}/Shop.default.char.test.tsx`;
  assert.ok(locked.includes(shopTest));
  assert.match(fs.readFileSync(path.join(base, shopTest), 'utf8'), /jest\.mock\("\.\.\/\.\.\/\.\.\/lib\/api"/, 'the data hooks are mocked by path');

  for (const engine of ['regex', 'typescript']) {
    clearMoveCache();
    const app = copyApp(base);
    fs.writeFileSync(path.join(app, 'architecture.yml'), 'version: 1\n');
    const root = engine === 'regex' ? path.join(app, 'src') : app;
    const pre = engine === 'regex' ? '' : 'src/';
    const moved = applyChange(root, planMoveFile(root, { from: `${pre}lib/api.ts`, to: `${pre}library/services/api.ts` }));
    assert.ok(moved.ok, moved.sentence);
    assert.ok(!fs.existsSync(path.join(app, 'src/lib/api.ts')));
    assert.match(fs.readFileSync(path.join(app, shopTest), 'utf8'), /jest\.mock\("\.\.\/\.\.\/\.\.\/library\/services\/api"/, `${engine}: the mock follows the move`);
    const after = outcome(app, locked, `moved-${engine}`);
    assert.deepEqual({ passed: after.passed, failed: after.failed, suitesFailed: after.suitesFailed }, { passed: r.passed, failed: 0, suitesFailed: 0 }, `${engine}: ${after.failedTitles.join(' | ')}`);

    // still locked: a real behaviour change in the moved tree fails them
    const shop = path.join(app, 'src/app/shop/Shop.tsx');
    fs.writeFileSync(shop, fs.readFileSync(shop, 'utf8').replace('<p>No items</p>', '<p>Nothing here</p>'));
    const price = path.join(app, 'src/lib/price.ts');
    fs.writeFileSync(price, fs.readFileSync(price, 'utf8').replace("return 'invalid';", "return 'negative';"));
    const broken = outcome(app, locked, `mutated-${engine}`);
    assert.ok(broken.failedTitles.some((t) => /renders/.test(t)), `${engine}: a render test catches the changed text`);
    assert.ok(broken.failedTitles.some((t) => t.includes('priceLabel(')), `${engine}: a priceLabel test catches the changed branch`);
  }
});
