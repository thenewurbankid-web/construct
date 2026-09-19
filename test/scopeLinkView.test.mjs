// Unit tests for the Pages Editor client's pure scope-link view mapper (#223). The mapper is plain
// TypeScript with no imports, so it is transpiled here with the TypeScript compiler API and loaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { buildScopeLinks } from '../src/engine/scopeLinks.mjs';

const file = new URL('../ui/client/features/pages-editor/domain/ScopeLinkView.ts', import.meta.url);
const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { buildScopeView, scopeColor } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const PAGE = `export function Home({ title, count }) {
  const [open, setOpen] = useState(false);
  return <Card title={title} total={count + 1} label="hi" />;
}`;
const CARD = 'export function Card({ title, total, onClose, open }) { return null; }';

test('golden: view model for Card — colours, edges, statuses, flags', () => {
  const view = buildScopeView(buildScopeLinks(PAGE, 'n0', { childSource: CARD }));
  assert.deepEqual(view.sources.map((s) => [s.name, s.kind, s.color, s.linked]), [
    ['title', 'prop', scopeColor(0), true],
    ['count', 'prop', scopeColor(1), true],
    ['open', 'state', scopeColor(2), false],
    ['setOpen', 'setter', scopeColor(3), false],
  ]);
  assert.deepEqual(view.edges, [
    { from: 'title', to: 'title', color: scopeColor(0) },
    { from: 'count', to: 'total', color: scopeColor(1) },
  ]);
  assert.deepEqual(view.targets.map((t) => [t.prop, t.status, t.text]), [
    ['title', 'bound', 'title'],
    ['total', 'bound', 'count + 1'],
    ['label', 'undeclared', '"hi"'],
    ['onClose', 'unbound', ''],
    ['open', 'unbound', ''],
  ]);
  const warns = view.flags.filter((f) => f.level === 'warn').map((f) => f.text);
  assert.equal(warns.length, 3);
  assert.match(warns[0], /"label" is passed but the component does not declare/);
  assert.match(warns[1], /Unbound prop "onClose"/);
  assert.match(warns[2], /Unbound prop "open".*auto-map/);
  assert.ok(view.flags.some((f) => f.level === 'info' && /"setOpen" is declared but never passed/.test(f.text)));
});

test('unresolved child yields an info flag, no unbound rows; native element has none', () => {
  const unresolved = buildScopeView(buildScopeLinks(PAGE, 'n0'));
  assert.equal(unresolved.childPropsResolved, false);
  assert.ok(unresolved.flags.some((f) => f.level === 'info' && /could not be resolved/.test(f.text)));
  assert.equal(unresolved.targets.some((t) => t.status === 'unbound'), false);
  const native = buildScopeView(buildScopeLinks('export function A({ x }) { return <div id={x} />; }', 'n0'));
  assert.equal(native.flags.some((f) => /could not be resolved/.test(f.text)), false);
  assert.deepEqual(native.edges, [{ from: 'x', to: 'id', color: scopeColor(0) }]);
});
