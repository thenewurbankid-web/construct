import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYER_ORDER as coreLayerOrder } from '../../../packages/core/generators.mjs';
import { LAYER_ORDER } from './layerOrder.ts';

// LIN-150: the client mirror must never drift from packages/core/generators.mjs's own LAYER_ORDER.
test('the client mirror agrees with the core export, element for element and in the same order', () => {
  assert.deepEqual(LAYER_ORDER, coreLayerOrder);
});
