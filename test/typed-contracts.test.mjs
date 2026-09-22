// #501/#502 -- runtime behavior of the typed-contracts factories
// (packages/core/typed-contracts/). Type-level guarantees (Template's
// return-completeness, Forbid<>'s cross-layer boundary check) are `tsc`'s
// job and covered separately in test/typed-contracts-tsc.test.mjs; this
// file covers what only running the code can show: does defineX actually
// return a callable function, with the given name attached in a way
// tooling could introspect later.
//
// This runs the real `.ts` sources directly (Node's built-in type
// stripping) rather than a parallel hand-maintained JS reimplementation,
// so these tests exercise the exact code `tsc` also checks. Type stripping
// needs `--experimental-strip-types` (Node's own flag, not something this
// repo can enable from inside a .mjs file) -- since `engines` in
// package.json is `>=20` and this phase is additive-only, the shared root
// `npm test` script is NOT changed to add that flag (doing so would break
// the ENTIRE suite, not just these tests, on any Node version/invocation
// that lacks it). Instead: import dynamically, and skip (not fail) with a
// clear reason when the runtime can't load a `.ts` module, so plain `npm
// test` stays green everywhere and these run for real wherever the flag
// is set. Run for real with:
//   node --experimental-strip-types --test test/typed-contracts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

let typedContracts;
let loadError;
try {
  typedContracts = await import('../packages/core/typed-contracts/index.ts');
} catch (e) {
  loadError = e;
}

const skip = loadError
  ? `needs Node's TypeScript type-stripping -- run with 'node --experimental-strip-types --test test/typed-contracts.test.mjs' (${loadError.message})`
  : false;

test('defineDomain returns a callable function with the given name attached for introspection', { skip }, () => {
  const { defineDomain } = typedContracts;
  const calculateTotal = defineDomain('calculateTotal', (props) =>
    props.items.reduce((sum, item) => sum + item.price * item.quantity, 0),
  );
  assert.equal(typeof calculateTotal, 'function');
  assert.equal(calculateTotal.name, 'calculateTotal');
  assert.equal(calculateTotal.unitName, 'calculateTotal');
  assert.equal(calculateTotal.unitLayer, 'domain');
  assert.equal(calculateTotal({ items: [{ price: 10, quantity: 2 }] }), 20);
});

test('every defineX factory attaches unitName/unitLayer and stays callable', { skip }, () => {
  const { defineComponent, definePage, defineController, defineRoute, defineWorkflow, defineService, defineDomain } = typedContracts;
  const cases = [
    [defineComponent('Badge', (p) => ({ type: 'div', props: p })), 'Badge', 'component'],
    [definePage('CartPage', (p) => ({ type: 'div', props: p })), 'CartPage', 'page'],
    [defineController('CartController', (p) => ({ type: 'div', props: p })), 'CartController', 'controller'],
    [defineRoute('CartRoute', (p) => ({ type: 'div', props: p })), 'CartRoute', 'route'],
    [defineWorkflow('Checkout', () => ({ id: 'checkout', initial: 'idle', states: { idle: {} } })), 'Checkout', 'workflow'],
    [defineService('fetchCart', (p) => Promise.resolve(p)), 'fetchCart', 'service'],
    [defineDomain('total', (items) => items.length), 'total', 'domain'],
  ];
  for (const [unit, expectedName, expectedLayer] of cases) {
    assert.equal(typeof unit, 'function', `${expectedName} is callable`);
    assert.equal(unit.name, expectedName, `${expectedName}'s real function .name is set`);
    assert.equal(unit.unitName, expectedName, `${expectedName}'s unitName is set`);
    assert.equal(unit.unitLayer, expectedLayer, `${expectedName}'s unitLayer is set`);
  }
});

test('defineX names the unit from the required `name` argument, not the variable/export it is assigned to', { skip }, () => {
  const { defineDomain } = typedContracts;
  const totallyDifferentBindingName = defineDomain('RealUnitName', (x) => x);
  assert.equal(totallyDifferentBindingName.unitName, 'RealUnitName');
  assert.equal(totallyDifferentBindingName.name, 'RealUnitName');
});

test('a component unit actually runs its fn and returns its result', { skip }, () => {
  const { defineComponent } = typedContracts;
  const Greeting = defineComponent('Greeting', (props) => `hello ${props.name}`);
  assert.equal(Greeting({ name: 'world' }), 'hello world');
});

test('a workflow unit builds and returns its WorkflowConfig shape', { skip }, () => {
  const { defineWorkflow } = typedContracts;
  const Checkout = defineWorkflow('Checkout', () => ({
    id: 'checkout',
    initial: 'idle',
    states: { idle: {}, done: { type: 'final' } },
  }));
  const config = Checkout({});
  assert.equal(config.id, 'checkout');
  assert.equal(config.initial, 'idle');
  assert.deepEqual(Object.keys(config.states), ['idle', 'done']);
});

test('propRef() is a runtime identity function (the type-level distinction has no runtime cost)', { skip }, () => {
  const { defineComponent, propRef } = typedContracts;
  const Header = defineComponent('Header', (p) => p);
  const ref = propRef(Header);
  assert.equal(ref, Header);
  assert.equal(ref.unitName, 'Header');
});

// #510 -- defineProvider's ProviderComponent really computes fn(props) and threads it through as
// React Context's `value` prop (proven without needing a DOM renderer: React.createElement just
// builds a plain element descriptor -- inspecting element.props.value is real proof the value
// flowed through, not an assumption). useProvider() itself needs a live React render pass (a real
// useContext() call requires React's hook dispatcher to be active) which this repo has no
// react-dom/test-renderer dependency to drive from a plain node:test -- so it is proven at the type
// level instead, in examples/providers.ts / test/typed-contracts-tsc.test.mjs.
test('defineProvider: ProviderComponent computes fn(props) and threads it into the Context value, unitName/unitLayer are set', { skip }, () => {
  const { defineProvider } = typedContracts;
  const CartProvider = defineProvider('Cart', ({ total }) => ({ total: total * 2 }));
  assert.equal(CartProvider.unitName, 'Cart');
  assert.equal(CartProvider.unitLayer, 'hook');
  assert.equal(typeof CartProvider.ProviderComponent, 'function');
  assert.equal(typeof CartProvider.useProvider, 'function');

  const element = CartProvider.ProviderComponent({ total: 21, children: 'child-marker' });
  assert.deepEqual(element.props.value, { value: { total: 42 } });
  assert.equal(element.props.children, 'child-marker');
});

test('two units of different layers built from structurally identical functions stay runtime-distinguishable via unitLayer', { skip }, () => {
  // The brand itself has zero runtime footprint (by design -- see brand.ts);
  // `unitLayer` is what lets runtime tooling recover the same distinction
  // `tsc` enforces at compile time.
  const { defineDomain, defineService } = typedContracts;
  const identityFn = (x) => x;
  const asDomain = defineDomain('identity', identityFn);
  const asService = defineService('identity', identityFn);
  assert.notEqual(asDomain.unitLayer, asService.unitLayer);
  assert.equal(asDomain.unitLayer, 'domain');
  assert.equal(asService.unitLayer, 'service');
});
