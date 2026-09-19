import test from 'node:test';
import assert from 'node:assert/strict';
import { pageTarget, severityCounts, sortViolations } from './Violations.ts';
import { headline, statusText, tabBadge } from './DiagnosticsSummary.ts';
import { buildDiagnosticsView, severityLabel } from './DiagnosticsView.ts';
import { buildLogRows } from './LogView.ts';
import { mergeEntries, lastId } from './LogEntries.ts';
import { diagnosticsReducer, initialDiagnostics } from '../workflows/Diagnostics.ts';

const v = (severity, file = 'features/a/x.ts', line = 1) => ({ rule: 'R', module: 'm', severity, file, line, message: 'msg' });

test('severityCounts counts by severity and total', () => {
  assert.deepEqual(severityCounts([v('error'), v('warning'), v('warning'), v('info')]), { error: 1, warning: 2, info: 1, total: 4 });
  assert.deepEqual(severityCounts([]), { error: 0, warning: 0, info: 0, total: 0 });
});

test('sortViolations: errors first, then file, then line; does not mutate', () => {
  const input = [v('warning', 'b.ts', 1), v('error', 'z.ts', 9), v('error', 'a.ts', 5), v('error', 'a.ts', 2), v('info', 'a.ts', 1)];
  const out = sortViolations(input);
  assert.deepEqual(out.map((x) => `${x.severity}:${x.file}:${x.line}`), ['error:a.ts:2', 'error:a.ts:5', 'error:z.ts:9', 'warning:b.ts:1', 'info:a.ts:1']);
  assert.equal(input[0].severity, 'warning');
});

test('pageTarget recognises page files only', () => {
  assert.deepEqual(pageTarget('features/dashboard/pages/DashboardPage.tsx'), { feature: 'dashboard', file: 'DashboardPage.tsx' });
  assert.deepEqual(pageTarget('ui/client/features/a/pages/sub/P.jsx'), { feature: 'a', file: 'sub/P.jsx' });
  assert.deepEqual(pageTarget('features\\a\\pages\\P.tsx'), { feature: 'a', file: 'P.tsx' });
  assert.equal(pageTarget('features/a/components/C.tsx'), null);
  assert.equal(pageTarget('features/a/pages/readme.md'), null);
  assert.equal(pageTarget('src/pages/X.tsx'), null);
});

test('headline and labels are plain language', () => {
  assert.equal(headline({ error: 0, warning: 0, info: 0, total: 0 }), 'No problems found');
  assert.equal(headline({ error: 1, warning: 2, info: 0, total: 3 }), '1 error, 2 warnings');
  assert.equal(headline({ error: 0, warning: 0, info: 1, total: 1 }), '1 note');
  assert.equal(severityLabel('info'), 'Note');
});

test('badge and status text follow the run state', () => {
  assert.equal(tabBadge(initialDiagnostics), undefined);
  const ready = diagnosticsReducer(initialDiagnostics, { type: 'RESULT', violations: [v('error')], total: 1, truncated: false, durationMs: 5 });
  assert.equal(tabBadge(ready), 1);
  assert.equal(statusText(ready), 'validate: 1 problem');
  assert.equal(statusText({ ...ready, total: 0 }), 'validate: no problems');
  assert.equal(statusText(diagnosticsReducer(ready, { type: 'RUN' })), 'validate: running');
  assert.equal(statusText(diagnosticsReducer(ready, { type: 'FAIL', error: 'x' })), 'validate: could not run');
});

test('reducer keeps the previous result while running and after a failure', () => {
  const ready = diagnosticsReducer(initialDiagnostics, { type: 'RESULT', violations: [v('error')], total: 1, truncated: false, durationMs: 5 });
  const running = diagnosticsReducer(ready, { type: 'RUN' });
  assert.equal(running.violations.length, 1);
  assert.equal(running.status, 'running');
  const failed = diagnosticsReducer(running, { type: 'FAIL', error: 'boom' });
  assert.equal(failed.error, 'boom');
  assert.equal(failed.violations.length, 1);
  assert.equal(diagnosticsReducer(failed, { type: 'RUN' }).error, null);
});

const e = (id) => ({ id, at: 0, source: 's', level: 'info', text: `t${id}` });

test('mergeEntries appends only newer entries and caps', () => {
  const a = mergeEntries([], [e(1), e(2)]);
  assert.deepEqual(a.map((x) => x.id), [1, 2]);
  assert.equal(mergeEntries(a, [e(2)]), a); // nothing new: same reference
  assert.deepEqual(mergeEntries(a, [e(2), e(3)]).map((x) => x.id), [1, 2, 3]);
  assert.deepEqual(mergeEntries(a, [e(3), e(4), e(5)], 3).map((x) => x.id), [3, 4, 5]);
  assert.equal(lastId([]), 0);
  assert.equal(lastId(a), 2);
});

test('buildDiagnosticsView: rows sorted and in display form, page rows carry a target', () => {
  const ready = diagnosticsReducer(initialDiagnostics, {
    type: 'RESULT',
    violations: [v('warning', 'features/a/components/C.tsx', 9), { ...v('error', 'features/a/pages/P.tsx', 3), rule: 'PAGE-006', why: 'w', suggestedFix: 'f' }],
    total: 2, truncated: false, durationMs: 12,
  });
  const view = buildDiagnosticsView(ready);
  assert.equal(view.mode, 'list');
  assert.equal(view.summary, '1 error, 1 warning');
  assert.equal(view.duration, '12 ms');
  assert.deepEqual(view.rows.map((r) => r.severityLabel), ['Error', 'Warning']);
  assert.deepEqual(view.rows[0].target, { feature: 'a', file: 'P.tsx' });
  assert.equal(view.rows[0].location, 'features/a/pages/P.tsx:3');
  assert.match(view.rows[0].ariaLabel, /Opens in the Pages editor/);
  assert.equal(view.rows[1].target, null);
  assert.equal(view.rows[0].fix, 'f');
});

test('buildDiagnosticsView: idle, running, clean, error and truncated states', () => {
  assert.equal(buildDiagnosticsView(initialDiagnostics).summary, 'Not run yet');
  const running = diagnosticsReducer(initialDiagnostics, { type: 'RUN' });
  assert.equal(buildDiagnosticsView(running).summary, 'Checking the project...');
  assert.equal(buildDiagnosticsView(running).running, true);
  const clean = diagnosticsReducer(initialDiagnostics, { type: 'RESULT', violations: [], total: 0, truncated: false, durationMs: 1 });
  assert.equal(buildDiagnosticsView(clean).mode, 'clean');
  assert.equal(buildDiagnosticsView(clean).summary, 'No problems found');
  const failed = diagnosticsReducer(initialDiagnostics, { type: 'FAIL', error: 'nope' });
  assert.equal(buildDiagnosticsView(failed).mode, 'error');
  assert.equal(buildDiagnosticsView(failed).error, 'nope');
  const trunc = diagnosticsReducer(initialDiagnostics, { type: 'RESULT', violations: [v('error')], total: 900, truncated: true, durationMs: 1 });
  assert.match(buildDiagnosticsView(trunc).summary, /first 1 of 900 shown/);
  // a failed re-run keeps the previous rows and shows the error as a banner
  const rerun = diagnosticsReducer(trunc, { type: 'FAIL', error: 'again' });
  assert.equal(buildDiagnosticsView(rerun).mode, 'list');
  assert.equal(buildDiagnosticsView(rerun).error, 'again');
});

test('buildLogRows formats the time as HH:MM:SS', () => {
  const at = new Date(2026, 0, 2, 3, 4, 5).getTime();
  const [row] = buildLogRows([{ id: 7, at, source: 'validate', level: 'warn', text: 't' }]);
  assert.deepEqual(row, { id: 7, time: '03:04:05', source: 'validate', level: 'warn', text: 't' });
});
