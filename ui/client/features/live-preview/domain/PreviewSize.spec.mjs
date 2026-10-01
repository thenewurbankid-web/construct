// Run: cd ui/client && npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_SIZES, previewSizeOption, sanitizePreviewSize } from './PreviewSize.ts';
import { previewFrameStyle, previewSizeReadout } from './PreviewFrameStyle.ts';

test('the picker offers Fit, three device widths and Fluid', () => {
  assert.deepEqual(
    PREVIEW_SIZES.map((s) => s.id),
    ['fit', 'w390', 'w768', 'w1280', 'fluid'],
  );
  assert.deepEqual(
    PREVIEW_SIZES.filter((s) => s.width !== null).map((s) => s.width),
    [390, 768, 1280],
  );
});

test('anything unrecognised in storage falls back to Fit', () => {
  assert.equal(sanitizePreviewSize('w768'), 'w768');
  assert.equal(sanitizePreviewSize('w9999'), 'fit');
  assert.equal(sanitizePreviewSize(null), 'fit');
  assert.equal(sanitizePreviewSize(undefined), 'fit');
  assert.equal(previewSizeOption('nonsense').id, 'fit');
});

test('a device size is a real pixel width that still cannot overflow the stage', () => {
  assert.deepEqual(previewFrameStyle(previewSizeOption('w390')), { width: '390px', maxWidth: '100%' });
  assert.deepEqual(previewFrameStyle(previewSizeOption('w1280')), { width: '1280px', maxWidth: '100%' });
});

test('Fit fills the stage up to a maximum; Fluid has none', () => {
  assert.deepEqual(previewFrameStyle(previewSizeOption('fit')), { width: '100%', maxWidth: 'min(100%, 1440px)' });
  assert.deepEqual(previewFrameStyle(previewSizeOption('fluid')), { width: '100%', maxWidth: '100%' });
});

test('the readout shows the measured size, and nothing before there is one', () => {
  assert.equal(previewSizeReadout({ width: 1279.6, height: 720.2 }), '1280 × 720 px');
  assert.equal(previewSizeReadout(null), '');
  assert.equal(previewSizeReadout({ width: 0, height: 0 }), '');
});
