// #933 x #935: the seed's cart usecase imports its fixture the feature-module way: a based fixture's rows sit under
// "value", and another feature's fixture comes through that feature's public index, never from its file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartUsecase } from '../packages/engine/line/seed/blocks.mjs';

const base = { file: 'features/cart/usecases/cart.ts', serviceFile: 'features/cart/services/cartStore.ts', rule: null };
const keys = { idKey: 'id', nameKey: 'name', amountKey: 'price' };

test('a bare fixture is imported from its file and read as rows', () => {
  const src = cartUsecase({ ...base, fixture: { rel: 'library/fixtures/products.json', ...keys } });
  assert.match(src, /import rows from '\.\.\/\.\.\/\.\.\/library\/fixtures\/products\.json';/);
  assert.match(src, /\(rows as Row\[\]\)\.find/);
});

test('a wrapped fixture is read through .value', () => {
  const src = cartUsecase({ ...base, fixture: { rel: 'features/cart/fixtures/products.json', wrapped: true, ...keys } });
  assert.match(src, /\(\(rows as unknown as \{ value: Row\[\] \}\)\.value\)\.find/);
});

test("another feature's fixture is imported from that feature's index", () => {
  const src = cartUsecase({ ...base, fixture: { rel: 'features/products/fixtures/products.json', via: { feature: 'products', name: 'products' }, ...keys } });
  assert.match(src, /import \{ products as rows \} from '\.\.\/\.\.\/products\/index';/);
  assert.doesNotMatch(src, /from '[^']*fixtures\/products/);
});
