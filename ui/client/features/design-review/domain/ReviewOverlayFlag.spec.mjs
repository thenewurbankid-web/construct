import test from 'node:test';
import assert from 'node:assert/strict';
import { isReviewOverlayEnabled } from './ReviewOverlayFlag.ts';

test('only the exact string "1" turns the overlay on', () => {
  assert.equal(isReviewOverlayEnabled('1'), true);
  for (const v of [undefined, '', 'true', 'yes', '0', '01', ' 1', '1 ']) {
    assert.equal(isReviewOverlayEnabled(v), false);
  }
});
