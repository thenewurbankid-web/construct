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

// #528 -- widen ScopeDeclKind/buildScopeLinks with 'provider' (a reachable Provider's exposed
// fields) and 'unit-output' (an already-called tracked-state hook's destructured output). Strictly
// additive: every test above this point is unchanged and still passes, proving the original
// prop/state/setter behavior is untouched.

// A real Provider hook file, shaped exactly like provider.ts's own documented example
// (features/cart/hooks/useCartProvider.ts): `const XProvider = defineProvider<Props, Value>(...)`
// then `export const use<Name>Provider = XProvider.useProvider`.
const CART_PROVIDER_HOOK = `interface CartProviderProps { total: number }
interface CartValue { total: number; label: string }
const CartProvider = defineProvider<CartProviderProps, CartValue>('Cart', ({ total }) => ({ total, label: 'x' }));
export const useCartProvider = CartProvider.useProvider;
`;

const CARD_WITH_AMOUNT = `export function Card({ title, amount, label }) { return null; }`;

const PAGE_WITH_PROVIDER = `import { Card } from '../components/Card';
import { useCartProvider } from '../hooks/useCartProvider';

export function Home({ title }) {
  return (
    <div>
      <Card title={title} amount={total} label={label} />
    </div>
  );
}
`;

// Same element/attributes, but no Provider import at all -- (b)'s counterpart.
const PAGE_WITHOUT_PROVIDER = `import { Card } from '../components/Card';

export function Home({ title }) {
  return (
    <div>
      <Card title={title} amount={total} label={label} />
    </div>
  );
}
`;

test('(a) provider: a page that imports a reachable Provider hook sees its exposed fields as \'provider\' scope sources', () => {
  const g = buildScopeLinks(PAGE_WITH_PROVIDER, 'n1', {
    childSource: CARD_WITH_AMOUNT,
    providerSources: { '../hooks/useCartProvider': CART_PROVIDER_HOOK },
  });
  assert.deepEqual(g.scope, [
    { name: 'title', kind: 'prop' },
    { name: 'total', kind: 'provider' },
    { name: 'label', kind: 'provider' },
  ]);
  assert.deepEqual(g.links, [
    { prop: 'title', valueKind: 'identifier', text: 'title', from: [{ name: 'title', kind: 'prop' }] },
    { prop: 'amount', valueKind: 'identifier', text: 'total', from: [{ name: 'total', kind: 'provider' }] },
    { prop: 'label', valueKind: 'identifier', text: 'label', from: [{ name: 'label', kind: 'provider' }] },
  ]);
});

test('(b) provider: a page that does NOT import the Provider hook does not see its fields, even when providerSources is supplied', () => {
  const g = buildScopeLinks(PAGE_WITHOUT_PROVIDER, 'n1', {
    childSource: CARD_WITH_AMOUNT,
    providerSources: { '../hooks/useCartProvider': CART_PROVIDER_HOOK },
  });
  assert.deepEqual(g.scope, [{ name: 'title', kind: 'prop' }]);
  assert.deepEqual(g.links[1].from, []); // 'amount' references 'total', which is not in scope here
  assert.deepEqual(g.links[2].from, []); // 'label' likewise
});

test('provider: reachable import without a supplied providerSources entry adds no scope (same "unresolved -> null" contract as childSource)', () => {
  const g = buildScopeLinks(PAGE_WITH_PROVIDER, 'n1', { childSource: CARD_WITH_AMOUNT });
  assert.deepEqual(g.scope, [{ name: 'title', kind: 'prop' }]);
});

test('provider: an open (index-signature) Value type is not enumerable, mirroring child-prop resolution', () => {
  const openHook = `interface CartProviderProps { total: number }
interface CartValue { [k: string]: unknown }
const CartProvider = defineProvider<CartProviderProps, CartValue>('Cart', ({ total }) => ({ total }));
export const useCartProvider = CartProvider.useProvider;
`;
  const g = buildScopeLinks(PAGE_WITH_PROVIDER, 'n1', {
    childSource: CARD_WITH_AMOUNT,
    providerSources: { '../hooks/useCartProvider': openHook },
  });
  assert.deepEqual(g.scope, [{ name: 'title', kind: 'prop' }]);
});

test('provider: an untyped defineProvider call (no type arguments) resolves no Value type, so adds no scope', () => {
  const untypedHook = `const CartProvider = defineProvider('Cart', () => ({ total: 1 }));
export const useCartProvider = CartProvider.useProvider;
`;
  const g = buildScopeLinks(PAGE_WITH_PROVIDER, 'n1', {
    childSource: CARD_WITH_AMOUNT,
    providerSources: { '../hooks/useCartProvider': untypedHook },
  });
  assert.deepEqual(g.scope, [{ name: 'title', kind: 'prop' }]);
});

test('provider: a providerSources entry keyed by the hook\'s imported name (instead of the import path) also resolves', () => {
  const g = buildScopeLinks(PAGE_WITH_PROVIDER, 'n1', {
    childSource: CARD_WITH_AMOUNT,
    providerSources: { useCartProvider: CART_PROVIDER_HOOK },
  });
  assert.deepEqual(g.scope, [
    { name: 'title', kind: 'prop' },
    { name: 'total', kind: 'provider' },
    { name: 'label', kind: 'provider' },
  ]);
});

const PAGE_WITH_TRACKED_STATE = `import { Card } from '../components/Card';
import { useCartState } from '../hooks/useCartState';

export function Home({ title }) {
  const { total, setTotal } = useCartState();
  return (
    <div>
      <Card title={title} amount={total} />
    </div>
  );
}
`;

test('(a\') unit-output: an already-called, reachable tracked-state hook\'s destructured output is a \'unit-output\' scope source', () => {
  const g = buildScopeLinks(PAGE_WITH_TRACKED_STATE, 'n1', { childSource: CARD_WITH_AMOUNT });
  assert.deepEqual(g.scope, [
    { name: 'title', kind: 'prop' },
    { name: 'total', kind: 'unit-output' },
    { name: 'setTotal', kind: 'unit-output' },
  ]);
  assert.deepEqual(g.links[1], { prop: 'amount', valueKind: 'identifier', text: 'total', from: [{ name: 'total', kind: 'unit-output' }] });
});

test('(b\') unit-output: a same-shaped call NOT imported from a hooks path is not treated as a tracked-state source', () => {
  const page = `import { Card } from '../components/Card';
import { useCartState } from '../utils/useCartState';

export function Home({ title }) {
  const { total, setTotal } = useCartState();
  return (
    <div>
      <Card title={title} amount={total} />
    </div>
  );
}
`;
  const g = buildScopeLinks(page, 'n1', { childSource: CARD_WITH_AMOUNT });
  assert.deepEqual(g.scope, [{ name: 'title', kind: 'prop' }]);
});

// #534 -- scopeTypes/childPropTypes are new SIBLING fields on the returned graph (never folded into
// `scope`/`childProps`' own item shape -- every `assert.deepEqual(g.scope, ...)`/`assert.deepEqual(g.childProps, ...)`
// assertion above this point is untouched and still passes byte-for-byte).
test('scopeTypes/childPropTypes: a provider field\'s real type and the child\'s own declared prop types both surface', () => {
  const g = buildScopeLinks(PAGE_WITH_PROVIDER, 'n1', {
    childSource: CARD_WITH_AMOUNT,
    providerSources: { '../hooks/useCartProvider': CART_PROVIDER_HOOK },
  });
  assert.deepEqual(g.scopeTypes, { total: 'number', label: 'string' });
  assert.equal(g.childPropTypes.title, undefined); // CARD_WITH_AMOUNT's props have no type annotation
});

test('scopeTypes: a useState setter always gets the one type every setter really has, regardless of the state\'s own type', () => {
  const g = buildScopeLinks(PAGE, 'n1', { childSource: CARD });
  assert.equal(g.scopeTypes.setOpen, '(value) => void');
  assert.equal(g.scopeTypes.setDraft, '(value) => void');
  assert.equal(g.scopeTypes.title, undefined); // no annotation on PAGE's own destructured param
});

test('childPropTypes: a child\'s declared prop types resolve from its own typed object-pattern parameter', () => {
  const childSource = 'export function Card({ title, amount, label }: { title: string; amount: number; label: string }) { return null; }';
  const g = buildScopeLinks(PAGE_WITH_PROVIDER, 'n1', {
    childSource,
    providerSources: { '../hooks/useCartProvider': CART_PROVIDER_HOOK },
  });
  assert.deepEqual(g.childPropTypes, { title: 'string', amount: 'number', label: 'string' });
});

test('unit-output: a hook import whose name does not match the use<Name>State convention is not treated as a tracked-state source', () => {
  const page = `import { Card } from '../components/Card';
import { useCartTotal } from '../hooks/useCartTotal';

export function Home({ title }) {
  const { total, setTotal } = useCartTotal();
  return (
    <div>
      <Card title={title} amount={total} />
    </div>
  );
}
`;
  const g = buildScopeLinks(page, 'n1', { childSource: CARD_WITH_AMOUNT });
  assert.deepEqual(g.scope, [{ name: 'title', kind: 'prop' }]);
});
