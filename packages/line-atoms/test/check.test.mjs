// LINE-ATOM's check: hand-written copies of atoms are found in the innermost function, once per atom, with the typed
// fix "use atom X"; a file that imports the atom is left alone; a component importing an atom is told to use a usecase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseToAst } from '@construct/ast';
import { findAtomCopies, atomSignals, functionsOf, atomImportsIn, useAtomFix, explainAtomFinding, RULE } from '../check.mjs';
import { getAtom } from '../index.mjs';

const find = (source, kind = 'usecases', file = 'features/shop/usecases/catalog.ts') => findAtomCopies({ file, source, ast: parseToAst(source), kind });

const CATALOG = `import { products } from '../../../library/fixtures/products';
export function visibleProducts(category: string, search: string, sortBy: string) {
  const needle = search.toLowerCase();
  return products
    .filter((p) => (category === 'all' || p.category === category) && p.name.toLowerCase().includes(needle))
    .sort((a, b) => (sortBy === 'price' ? a.price - b.price : a.name.localeCompare(b.name)));
}
export function pageOf<T>(rows: T[], page: number, pageSize: number) {
  const pages = Math.ceil(rows.length / pageSize);
  return { pages, items: rows.slice(page * pageSize, (page + 1) * pageSize) };
}
export const label = (n: number) => \`\${n} items\`;
`;

test('hand-written filter/sort and pagination are found, each with its "use atom" fix', () => {
  const hits = find(CATALOG);
  assert.deepEqual(hits.map((h) => [h.atom, h.fn, h.line]), [['filter-sort', 'visibleProducts', 2], ['client-pagination', 'pageOf', 8]]);
  for (const h of hits) {
    assert.equal(h.rule, RULE);
    assert.match(h.message, /^[A-Za-z].*\.$/);
    assert.equal(h.fixes.length, 1);
    assert.equal(h.fixes[0].rank, 1);
    assert.equal(h.fixes[0].step, null);
    assert.equal(h.fixes[0].import, `@line/atoms/${h.atom}`);
    assert.match(h.fixes[0].id, new RegExp(`^LINE-ATOM/use-atom:${h.atom}$`));
  }
  assert.match(hits[0].message, /filter and sort atom/);
  assert.match(hits[0].message, /@line\/atoms\/filter-sort/);
});

test('the innermost function is reported, once per atom', () => {
  const src = `export function useCart() {
  function load() {
    setLoading(true);
    return fetchCart().then(setCart).catch((e) => { setError(e); }).finally(() => setLoading(false));
  }
  return { load };
}`;
  const hits = find(src);
  assert.deepEqual(hits.map((h) => [h.atom, h.fn]), [['async-status', 'load']]);
});

test('a file that already imports the atom is not told to use it', () => {
  const src = `import { applyView } from '@line/atoms/filter-sort';\n${CATALOG}`;
  assert.deepEqual(find(src).map((h) => h.atom), ['client-pagination']);
  assert.deepEqual(atomImportsIn(parseToAst(src)), [{ id: 'filter-sort', line: 1 }]);
});

test('atoms are for usecases and services: a component importing one is told to use a usecase', () => {
  const src = `import { paginate } from '@line/atoms/client-pagination';\nexport function List() { return null; }\n`;
  const hits = find(src, 'components', 'features/shop/components/List.tsx');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].signal, 'atom-user');
  assert.match(hits[0].fixes[0].id, /^LINE-ATOM\/move-to-usecase:client-pagination$/);
  assert.deepEqual(find(src, 'services'), [], 'a service may import an atom');
  assert.deepEqual(find(CATALOG, 'atoms'), [], 'an atom of the project library is not a copy of itself');
});

test('code with no atom job is clean; helpers name functions and signals', () => {
  assert.deepEqual(find('export const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);'), []);
  assert.deepEqual(functionsOf(parseToAst('const f = () => 1; class A { m() { return 2; } }'), 'const f = () => 1; class A { m() { return 2; } }').map((f) => f.name), ['f', 'm']);
  assert.deepEqual(atomSignals('const t = setTimeout(go, 300); clearTimeout(t);').map((s) => s.atom), ['debounced-search']);
  assert.match(useAtomFix(getAtom('csv-export'), 'download').sentence, /^Replace the hand-written logic in download with the csv export atom/);
});

test('every atom with signals is found by at least one of its own signals on a sample', () => {
  const samples = {
    'validated-submit': 'function onSubmit(e) { e.preventDefault(); const r = schema.safeParse(values); if (!r.success) setErrors(r.error); }',
    'async-status': 'async function load() { setLoading(true); try { setData(await get()); } catch (e) { setError(e); } }',
    'paginated-query': 'async function loadPage(page) { const r = await fetch(`/api?page=${page}&pageSize=20`); const { items, total } = await r.json(); return { items, total }; }',
    'infinite-list': 'function onEnd() { if (hasMore) fetchMore().then((next) => setItems((prev) => [...prev, ...next])); }',
    'optimistic-update': 'async function toggle() { const previous = liked; setLiked(!liked); try { await save(); } catch { setLiked(previous); } }',
    'debounced-search': 'function onType(v) { clearTimeout(timer); timer = setTimeout(() => search(v), 300); }',
    'filter-sort': 'function view(rows) { return rows.filter((r) => r.ok).sort((a, b) => a.name.localeCompare(b.name)); }',
    'client-pagination': 'function pageRows(rows, page) { return rows.slice(page * pageSize, page * pageSize + pageSize); }',
    'multi-step-flow': 'function next() { setStep(step + 1); }',
    'permission-check': 'function canEdit(user) { return user.roles.includes("admin"); }',
    'date-range': 'function inRange(d, start, end) { return d.getTime() >= start.getTime() && d.getTime() <= end.getTime(); }',
    'csv-export': 'function csv(rows) { return rows.map((r) => r.join(",")).join("\\n"); }',
    polling: 'function watch() { const id = setInterval(refresh, 5000); return () => clearInterval(id); }',
    'undo-history': 'function undo() { const prev = past[past.length - 1]; setPast(past.slice(0, -1)); setFuture([present, ...future]); }',
  };
  for (const [atom, code] of Object.entries(samples)) {
    assert.ok(atomSignals(code).some((s) => s.atom === atom), `${atom} is found in: ${code}`);
  }
});

test('explainAtomFinding puts the flagged function into words (to-english when atomic-codemod is linked)', async () => {
  const [hit] = find(CATALOG).filter((h) => h.atom === 'client-pagination');
  const s = await explainAtomFinding(hit, CATALOG);
  assert.equal(s.via, 'static');
  assert.match(s.sentences[0], /^The pagination atom does this already: split the list into pages/);
  assert.ok(s.sentences.length >= 2);
});
