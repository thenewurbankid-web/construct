import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScopeLinks, importOfTag } from '../packages/engine/scopeLinks.mjs';
import { collectScopeDeclarations, parseJsx } from '../packages/ast/index.mjs';

const PAGE = `import { Card } from '../components/Card';
import Panel from '../components/Panel';
import { Foo } from '../components/Foo';

export function Home({ title, count }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  return (
    <div>
      <Card title={title} total={count + 1} open={open} label="hi" {...rest} />
      <Panel heading={title} />
      <Foo.Bar size={count} />
      <span className="x">{draft}</span>
    </div>
  );
}
`;

const CARD = `export function Card({ title, total, open, onClose, count }) { return null; }`;
const PANEL = `export default function Panel({ heading, extra }) { return null; }`;
const FOO = `export function Foo() { return null; }\nexport function Bar({ size, tone }) { return null; }`;

// ids in document order: n0 div, n1 Card, n2 Panel, n3 Foo.Bar, n4 span
test('scope declarations keep kinds: prop / state / setter', () => {
  const decls = collectScopeDeclarations(parseJsx(PAGE));
  assert.deepEqual(decls, [
    { name: 'title', kind: 'prop' }, { name: 'count', kind: 'prop' },
    { name: 'open', kind: 'state' }, { name: 'setOpen', kind: 'setter' },
    { name: 'draft', kind: 'state' }, { name: 'setDraft', kind: 'setter' },
  ]);
});

test('golden: Card links, unbound and undeclared props, spread coverage', () => {
  const g = buildScopeLinks(PAGE, 'n1', { childSource: CARD });
  assert.deepEqual(g.links, [
    { prop: 'title', valueKind: 'identifier', text: 'title', from: [{ name: 'title', kind: 'prop' }] },
    { prop: 'total', valueKind: 'expression', text: 'count + 1', from: [{ name: 'count', kind: 'prop' }] },
    { prop: 'open', valueKind: 'identifier', text: 'open', from: [{ name: 'open', kind: 'state' }] },
    { prop: 'label', valueKind: 'literal', text: 'hi', from: [] },
  ]);
  assert.deepEqual(g.spreads, [{ text: 'rest', from: [] }]);
  assert.equal(g.childPropsResolved, true);
  // a spread might cover the rest, so missing props are 'spread' not 'unbound'
  assert.deepEqual(g.childProps, [
    { name: 'title', status: 'bound' }, { name: 'total', status: 'bound' }, { name: 'open', status: 'bound' },
    { name: 'onClose', status: 'spread' }, { name: 'count', status: 'spread' },
  ]);
  assert.deepEqual(g.undeclared, ['label']);
  assert.deepEqual(g.suggestions, []);
});

test('golden: default-imported Panel flags unbound props and suggests in-scope names', () => {
  const g = buildScopeLinks(PAGE, 'n2', { childSource: `export default function Panel({ heading, title, extra }) { return null; }` });
  assert.deepEqual(g.childProps, [
    { name: 'heading', status: 'bound' }, { name: 'title', status: 'unbound' }, { name: 'extra', status: 'unbound' },
  ]);
  assert.deepEqual(g.suggestions, ['title']);
  assert.deepEqual(g.undeclared, []);
});

test('compound child Foo.Bar resolves the sub-component in the imported file', () => {
  const g = buildScopeLinks(PAGE, 'n3', { childSource: FOO });
  assert.equal(g.tag, 'Foo.Bar');
  assert.deepEqual(g.childProps, [{ name: 'size', status: 'bound' }, { name: 'tone', status: 'unbound' }]);
  assert.deepEqual(g.links[0].from, [{ name: 'count', kind: 'prop' }]);
});

test('without child source: links still computed, childProps null', () => {
  const g = buildScopeLinks(PAGE, 'n1');
  assert.equal(g.childProps, null);
  assert.equal(g.childPropsResolved, false);
  assert.equal(g.links.length, 4);
});

test('unusedScope flags names no element attribute references (children text does not count)', () => {
  const g = buildScopeLinks(PAGE, 'n4');
  assert.deepEqual(g.unusedScope, ['setOpen', 'draft', 'setDraft']);
  assert.equal(g.isCustomComponent, false);
  assert.equal(g.childProps, null);
});

test('open (index-signature) child type is not enumerable', () => {
  const src = `interface P { [k: string]: unknown }\nexport function Card(props: P) { return null; }`;
  assert.equal(buildScopeLinks(PAGE, 'n1', { childSource: src }).childPropsResolved, false);
});

test('unknown node id throws NO_SUCH_NODE; deterministic output', () => {
  assert.throws(() => buildScopeLinks(PAGE, 'n99'), { code: 'NO_SUCH_NODE' });
  assert.deepEqual(buildScopeLinks(PAGE, 'n1', { childSource: CARD }), buildScopeLinks(PAGE, 'n1', { childSource: CARD }));
});

test('importOfTag reads the import of a compound tag root', () => {
  assert.deepEqual(importOfTag(PAGE, 'Foo.Bar'), { source: '../components/Foo', isDefault: false });
  assert.deepEqual(importOfTag(PAGE, 'Panel'), { source: '../components/Panel', isDefault: true });
  assert.equal(importOfTag(PAGE, 'div'), null);
});
