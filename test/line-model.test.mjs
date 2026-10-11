// Line Cockpit model (T1, packages/engine/line/model.mjs): readLineProject returns exactly the contract's
// LineProject on real projects, groups library components by the static level rule, and counts base links.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { assertLineProject } from '../packages/engine/line/contract.mjs';
import { readLineProject, componentLevels, itemName, toFinding } from '../packages/engine/line/model.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(REPO, 'examples/line-sample');
const PASSING = path.join(REPO, 'packages/core/profiles/line/fixtures/passing');

const levelsOf = (p) => Object.fromEntries(p.library.filter((l) => l.kind === 'components').map((l) => [l.name, l.level]));
const usedByCount = (p) => Object.fromEntries(p.library.map((l) => [l.id, l.usedBy.length]));

function project(files) {
  const dir = makeTempDir('construct-line-model-');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

test('model: the Line sample passes the contract, with levels, base counts and its two planted findings', () => {
  const p = readLineProject(SAMPLE);
  assertLineProject(p);
  assert.equal(p.isLine, true);
  assert.deepEqual(levelsOf(p), { Badge: 'atom', Button: 'atom', Card: 'molecule', DataTable: 'organism' });
  assert.deepEqual(usedByCount(p), { 'components/Badge': 0, 'components/Button': 1, 'components/Card': 1, 'components/DataTable': 0, 'fixtures/user': 0, 'pages/ListPage': 2, 'workflows/checkout': 1, 'workflows/createConfirm': 0, 'workflows/listDetail': 0, 'workflows/signInGate': 0, 'workflows/wizard': 0 });
  assert.deepEqual(p.library.find((l) => l.id === 'components/Button').usedBy, [{ feature: 'orders', file: 'features/orders/components/OrderButton.tsx' }]);
  assert.deepEqual(p.findings.map((f) => `${f.rule} ${f.file}:${f.line}`).sort(), ['LINE-BASE features/billing/components/InvoiceCard.tsx:1', 'LINE-DIR features/billing/pages/InvoicesPage.tsx:4']);
  const billing = p.features.find((f) => f.name === 'billing');
  assert.equal(billing.spec, 'features/billing/spec.md');
  const card = billing.items.find((i) => i.name === 'InvoiceCard');
  assert.deepEqual(card.base, { value: null, libraryId: null });
  assert.equal(card.status, 'problem');
  const orderCard = p.features.find((f) => f.name === 'orders').items.find((i) => i.name === 'OrderCard');
  assert.deepEqual([orderCard.base, orderCard.status], [{ value: 'components/Card', libraryId: 'components/Card' }, 'ok']);
});

test('model: the passing Line fixture passes the contract with no findings and every item linked', () => {
  const p = readLineProject(PASSING);
  assertLineProject(p);
  assert.deepEqual(p.findings, []);
  for (const f of p.features) for (const i of f.items) assert.ok(i.base.libraryId, `${i.id} resolves its base`);
  assert.deepEqual(usedByCount(p), { 'components/Button': 1, 'fixtures/user': 1, 'pages/ListPage': 2, 'workflows/checkout': 1 });
});

test('model: a project without preset line is not a Line project and is not scanned', () => {
  const dir = project({ 'architecture.yml': 'version: 1\n', 'library/components/Button.tsx': 'export function Button() { return null; }\n' });
  const p = readLineProject(dir);
  assertLineProject(p);
  assert.deepEqual([p.isLine, p.library, p.features, p.findings], [false, [], [], []]);
});

test('model: a broken base link (missing library item) has value but no libraryId and counts for nobody', () => {
  const dir = project({
    'architecture.yml': 'version: 1\npreset: line\n',
    'library/components/Button.tsx': 'export function Button() { return null; }\n',
    'features/shop/spec.md': '# Shop\n',
    'features/shop/components/Buy.tsx': '// @line-base components/Nope\nexport function Buy() { return null; }\n',
  });
  const p = readLineProject(dir);
  assertLineProject(p);
  const buy = p.features[0].items[0];
  assert.deepEqual(buy.base, { value: 'components/Nope', libraryId: null });
  assert.equal(buy.status, 'problem');
  assert.equal(buy.findings[0].rule, 'LINE-BASE');
  assert.equal(p.library[0].usedBy.length, 0);
});

test('level rule: no library imports = atom, atoms only = molecule, anything else = organism', () => {
  const imports = new Map([
    ['a', []], ['b', []], ['m', ['a', 'b']], ['o1', ['m']], ['o2', ['a', 'library/workflows/w.ts']], ['o3', ['a', 'm']],
  ]);
  assert.deepEqual(Object.fromEntries(componentLevels(imports, new Map())), { a: 'atom', b: 'atom', m: 'molecule', o1: 'organism', o2: 'organism', o3: 'organism' });
});

test('level rule: an @line-level comment wins, and an importer follows the overridden level', () => {
  const imports = new Map([['a', []], ['m', ['a']], ['top', ['m']]]);
  const levels = componentLevels(imports, new Map([['m', 'atom'], ['a', 'organism']]));
  assert.deepEqual(Object.fromEntries(levels), { a: 'organism', m: 'atom', top: 'molecule' });
});

test('level rule: an import cycle never ends in a simpler level', () => {
  const levels = componentLevels(new Map([['x', ['y']], ['y', ['x']]]), new Map());
  assert.equal(levels.get('x'), 'organism');
  assert.equal(levels.get('y'), 'organism');
});

test('level rule on files: the @line-level comment is read from the component source', () => {
  const dir = project({
    'architecture.yml': 'version: 1\npreset: line\n',
    'library/components/Icon.tsx': 'export function Icon() { return null; }\n',
    'library/components/Toolbar.tsx': "// @line-level organism\nimport { Icon } from './Icon';\nexport function Toolbar() { return <Icon />; }\n",
    'library/components/IconButton.tsx': "import { Icon } from '@/library/components/Icon';\nexport function IconButton() { return <Icon />; }\n",
  });
  const p = readLineProject(dir);
  assertLineProject(p);
  assert.deepEqual(levelsOf(p), { Icon: 'atom', IconButton: 'molecule', Toolbar: 'organism' });
});

test('helpers: item names and findings keep the contract shape', () => {
  assert.equal(itemName('library/components/Button.tsx'), 'Button');
  assert.equal(itemName('library/components/IconButton/index.tsx'), 'IconButton');
  assert.deepEqual(toFinding({ message: 'No full stop', rule: 'X', severity: 'warning', file: 'a.ts', line: 0 }), { sentence: 'No full stop.', rule: 'X', severity: 'warning', file: 'a.ts', line: 1 });
});
