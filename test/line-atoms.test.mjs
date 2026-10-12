// Logic atoms in Line (roadmap item 2): `atoms/` is a Line kind, validate --profile line reports hand-written copies
// of an atom (LINE-ATOM, a warning) with the typed fix "use atom X", a component importing an atom is told to use a
// usecase, and the drafter routes "add a paginated list" to the atom.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { validateLine } from '../packages/core/profiles/line/index.mjs';
import { LINE_RULES, ATOM_USERS } from '../packages/core/profiles/line/contract.mjs';
import { withFixes } from '../packages/engine/line/fixes.mjs';
import { toFinding } from '../packages/engine/line/model.mjs';
import { assertFix } from '../packages/engine/line/contract.mjs';
import { draft } from '../packages/engine/line/drafter/index.mjs';

function project(files) {
  const dir = makeTempDir('construct-line-atoms-');
  for (const [rel, content] of Object.entries({ 'architecture.yml': 'version: 1\npreset: line\n', 'library/README.md': '# Library\n', ...files })) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

const CATALOG = `export function visibleProducts(rows: { name: string; price: number }[], search: string) {
  const needle = search.toLowerCase();
  return rows.filter((p) => p.name.toLowerCase().includes(needle)).sort((a, b) => a.price - b.price);
}
`;

test('contract: LINE-ATOM is a warning, and atoms are used by usecases and services', () => {
  assert.equal(LINE_RULES['LINE-ATOM'].defaultSeverity, 'warning');
  assert.deepEqual([...ATOM_USERS], ['usecases', 'services']);
});

test('validate: a hand-written filter/sort in a usecase is a LINE-ATOM warning with the typed fix "use atom filter-sort"', () => {
  const dir = project({
    'features/shop/spec.md': '# shop\n',
    'features/shop/usecases/catalog.ts': CATALOG,
    'library/atoms/clamp.ts': 'export function clamp(n: number, lo: number, hi: number) {\n  return Math.min(hi, Math.max(lo, n));\n}\n',
  });
  const r = validateLine(dir);
  assert.equal(r.ok, true, 'a warning does not fail the build; atoms/ is a known kind');
  const hits = r.violations.filter((v) => v.rule === 'LINE-ATOM');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, 'features/shop/usecases/catalog.ts');
  assert.match(hits[0].message, /filter and sort atom/);
  assert.equal(r.violations.filter((v) => v.rule === 'LINE-LAYOUT').length, 0);
  const [f] = withFixes(dir, hits.map((v) => toFinding(v)));
  assert.equal(f.fixes.length, 1);
  assertFix(f.fixes[0]);
  assert.equal(f.fixes[0].id, 'LINE-ATOM/use-atom:filter-sort');
  assert.equal(f.fixes[0].import, '@line/atoms/filter-sort');
});

test('validate: a page importing an atom is told to call it from a usecase; a service importing it is fine', () => {
  const dir = project({
    'features/shop/spec.md': '# shop\n',
    'features/shop/services/orders.ts': "import { loadPage } from '@line/atoms/paginated-query';\nexport const load = loadPage;\n",
    'features/shop/components/Orders.tsx': "import { paginate } from '@line/atoms/client-pagination';\nexport function Orders() { return null; }\n",
  });
  const hits = validateLine(dir).violations.filter((v) => v.rule === 'LINE-ATOM');
  assert.deepEqual(hits.map((h) => h.file), ['features/shop/components/Orders.tsx']);
  assert.match(hits[0].message, /usecases and services/);
});

test('drafter: "add a paginated list" routes to the paginated-query atom', () => {
  const dir = project({ 'features/orders/spec.md': '# orders\n' });
  const d = draft(dir, 'add a paginated list', { verify: false, records: [] });
  assert.equal(d.atoms[0].id, 'paginated-query');
  assert.equal(d.atoms[0].import, '@line/atoms/paginated-query');
  assert.match(d.atoms[0].sentence, /^Use the paginated query atom/);
});
