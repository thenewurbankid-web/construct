import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldReiterate as coreShouldReiterate } from '../../../../../packages/core/debug-chain.mjs';
import { shouldReiterate } from './Verify.ts';

// LIN-137: the client mirror must never drift from packages/core/debug-chain.mjs's own shouldReiterate.
const INPUTS = [{ passed: false }, { passed: true }, undefined, {}];

test('the client mirror agrees with the core export on every input', () => {
  for (const input of INPUTS) assert.equal(shouldReiterate(input), coreShouldReiterate(input), JSON.stringify(input));
});
