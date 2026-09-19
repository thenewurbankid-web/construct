// Run: cd ui/client && npm test  (node --experimental-strip-types; the domain
// file has no runtime imports, so no bundler is needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticsToMarkers, summarizeDiagnostics, describeSummary } from './SourceMarkers.ts';

const d = (over = {}) => ({ source: 'typescript', code: 'TS2322', severity: 'error', message: 'm', line: 2, column: 3, endLine: 2, endColumn: 8, ...over });

test('maps a diagnostic to a marker with the same range and severity', () => {
  const [m] = diagnosticsToMarkers([d()], 'a\nbbbbbbbbbb\nc');
  assert.deepEqual(
    { s: m.severity, sl: m.startLine, sc: m.startColumn, el: m.endLine, ec: m.endColumn, code: m.code, src: m.source },
    { s: 'error', sl: 2, sc: 3, el: 2, ec: 8, code: 'TS2322', src: 'typescript' },
  );
});

test('clamps out-of-document ranges (file changed since the diagnostics ran)', () => {
  const [m] = diagnosticsToMarkers([d({ line: 99, endLine: 120 })], 'one\ntwo');
  assert.equal(m.startLine, 2);
  assert.equal(m.endLine, 2);
});

test('widens an empty range so it stays visible', () => {
  const [m] = diagnosticsToMarkers([d({ column: 4, endColumn: 4 })], 'a\nbbbbbb');
  assert.ok(m.endColumn > m.startColumn);
});

test('no diagnostics gives no markers', () => {
  assert.deepEqual(diagnosticsToMarkers([], ''), []);
});

test('summarizes and describes counts', () => {
  const s = summarizeDiagnostics([d(), d(), d({ severity: 'warning' }), d({ severity: 'info' })]);
  assert.deepEqual(s, { errors: 2, warnings: 1, infos: 1, total: 4 });
  assert.equal(describeSummary(s), '2 errors, 1 warning, 1 note');
  assert.equal(describeSummary({ errors: 0, warnings: 0, infos: 0, total: 0 }), 'No problems found');
  assert.equal(describeSummary({ errors: 1, warnings: 0, infos: 0, total: 1 }), '1 error');
});
