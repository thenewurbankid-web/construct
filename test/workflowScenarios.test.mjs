// Epic #185 / #187 -- scenarios + health findings (and the combined explain/render layer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractMachines } from '../packages/engine/workflowExtractor.mjs';
import { compileWorkflow } from '../packages/engine/workflowGenerator.mjs';
import { enumerateScenarios, findHealthIssues } from '../packages/engine/workflowScenarios.mjs';
import { explainSource, renderExplained } from '../packages/engine/workflowExplain.mjs';

const fx = (name) => new URL(`../fixtures/workflow-graphs/${name}`, import.meta.url);
const machineOf = (src) => extractMachines(src).machines[0];
const wrap = (states, initial = 'a') => `export const m = createMachine({ initial: '${initial}', states: ${states} });`;

function golden(name, actual) {
  const file = fx(`golden/${name}`);
  if (process.env.UPDATE_GOLDEN) fs.writeFileSync(file, actual);
  assert.equal(actual, fs.readFileSync(file, 'utf8'), `golden mismatch: ${name} (UPDATE_GOLDEN=1 to regenerate after an intentional change)`);
}

test('golden: full report (narrative + scenarios + health) for the refund request', () => {
  const [e] = explainSource(fs.readFileSync(fx('refund-request.ts'), 'utf8')).machines;
  golden('refund-request.report.txt', renderExplained(e, 'prose'));
  golden('refund-request.scenarios.txt', renderExplained(e, 'scenarios'));
  golden('refund-request.report.md', renderExplained(e, 'md'));
  assert.equal(e.scenarios[0].happy, true);
  assert.equal(e.scenarios[0].route, 'submitted → auto check → approved → refunded → closed');
  assert.equal(e.scenarios.filter((s) => s.happy).length, 1);
  assert.deepEqual(e.scenarios[0].events, ['REQUEST_REFUND', 'always', 'invoke.onDone', 'CLOSE']);
  assert.deepEqual(e.scenarios.map((s) => s.end.state).filter((v, i, a) => a.indexOf(v) === i), ['closed', 'rejected']);
});

test('golden: full report for the generated checkout fixture', () => {
  const { source } = compileWorkflow(JSON.parse(fs.readFileSync(fx('checkout.json'), 'utf8')), { name: 'Checkout' });
  const [e] = explainSource(source).machines;
  golden('checkout.report.txt', renderExplained(e, 'prose'));
  assert.equal(e.scenarios.length, 1);
  assert.deepEqual(e.scenarios[0].events, ['SUBMIT', 'SUCCESS']);
  assert.deepEqual(e.findings.map((f) => f.kind), ['no-fallback']);
});

test('golden: nested / mixed machine report (dead end + no-fallback findings)', () => {
  const [e] = explainSource(fs.readFileSync(fx('mixed-nested.ts'), 'utf8')).machines;
  golden('mixed-nested.report.txt', renderExplained(e, 'prose'));
  assert.ok(e.findings.some((f) => f.kind === 'dead-end' && f.state === 'other'));
});

test('loops are reported once, not walked forever', () => {
  const m = machineOf(wrap(`{ a: { on: { GO: 'b' } }, b: { on: { BACK: 'a', DONE: 'c' } }, c: { type: 'final' } }`));
  const r = enumerateScenarios(m);
  assert.equal(r.scenarios.length, 1);
  assert.deepEqual(r.scenarios[0].events, ['GO', 'DONE']);
  assert.deepEqual(r.loops.map((l) => [l.from, l.to, l.event]), [['b', 'a', 'BACK']]);
  assert.match(r.scenarios[0].text.at(-1), /this part can repeat/);
});

test('scenario cap: never more than max, flagged as truncated, deterministic', () => {
  // 6 layers of 2 parallel guarded branches = 64 routes.
  const layers = [];
  for (let i = 0; i < 6; i += 1) layers.push(`s${i}: { always: [{ target: 's${i + 1}', guard: 'g${i}a' }, { target: 's${i + 1}', guard: 'g${i}b' }] }`);
  const m = machineOf(wrap(`{ ${layers.join(', ')}, s6: { type: 'final' } }`, 's0'));
  const r = enumerateScenarios(m, { max: 10 });
  assert.equal(r.scenarios.length, 10);
  assert.equal(r.truncated, true);
  assert.deepEqual(enumerateScenarios(m, { max: 10 }), r);
  assert.equal(enumerateScenarios(m, { max: 100 }).scenarios.length, 64);
});

test('a stuck route is reported as stuck; machines without a start or with errors give no scenarios', () => {
  const r = enumerateScenarios(machineOf(wrap(`{ a: { on: { GO: 'b' } }, b: {} }`)));
  assert.equal(r.scenarios[0].end.outcome, 'stuck');
  assert.equal(r.scenarios[0].happy, false);
  assert.match(r.scenarios[0].text.at(-1), /gets stuck in \*b\*/);
  assert.deepEqual(enumerateScenarios({ error: 'x', states: [], transitions: [] }).scenarios, []);
});

test('health findings: unreachable, dead end, no end state, ambiguous, unresolved target, no fallback', () => {
  const kinds = (src) => findHealthIssues(machineOf(src)).map((f) => f.kind);
  assert.deepEqual(kinds(wrap(`{ a: { on: { GO: 'b' } }, b: { type: 'final' }, orphan: { on: { X: 'b' } } }`)), ['unreachable']);
  assert.deepEqual(kinds(wrap(`{ a: { on: { GO: 'b' } }, b: {} }`)), ['no-end-state', 'dead-end']);
  assert.deepEqual(kinds(wrap(`{ a: { on: { GO: 'b', GO2: 'nowhere' } }, b: { type: 'final' } }`)), ['unresolved-target']);
  assert.deepEqual(kinds(wrap(`{ a: { on: { GO: ['b', 'c'] } }, b: { type: 'final' }, c: { type: 'final' } }`)), ['ambiguous']);
  assert.deepEqual(kinds(wrap(`{ a: { always: [{ target: 'b', guard: 'ok' }] }, b: { type: 'final' } }`)), ['no-fallback']);
  const f = findHealthIssues(machineOf(wrap(`{ a: { on: { GO: 'b' } }, b: {} }`)));
  assert.match(f[1].message, /\*b\* is a dead end: it is not an end state/);
  assert.equal(f[1].severity, 'warning');
});

test('a clean machine has no findings; nested states with onDone are reachable', () => {
  const src = `export const m = createMachine({ initial: 'a', states: {
    a: { initial: 'a1', states: { a1: { on: { N: 'a2' } }, a2: { type: 'final' } }, onDone: 'done' },
    done: { type: 'final' } } });`;
  assert.deepEqual(findHealthIssues(machineOf(src)), []);
  const r = enumerateScenarios(machineOf(src));
  assert.deepEqual(r.scenarios.map((s) => s.end.state), ['done']);
});

test('unsupported machine: graceful everywhere, deterministic output', () => {
  const src = `export const m = createMachine({ ...base, initial: 'a', states: { a: {} } });`;
  const [e] = explainSource(src).machines;
  assert.deepEqual([e.scenarios, e.findings], [[], []]);
  assert.match(renderExplained(e, 'prose'), /cannot be explained in plain English/);
  assert.match(renderExplained(e, 'md'), /cannot be explained/);
  assert.match(renderExplained(e, 'scenarios'), /cannot be explained/);
  const good = fs.readFileSync(fx('refund-request.ts'), 'utf8');
  assert.deepEqual(explainSource(good), explainSource(good));
  assert.equal(explainSource('export const x = ').error.startsWith('Could not parse'), true);
});

// #307 -- a scenario is named after what distinguishes it, and says which branch it took.
test('#307: scenario titles are distinguishing, unique, and carry the branch (no "Path N")', () => {
  const [e] = explainSource(fs.readFileSync(fx('refund-request.ts'), 'utf8')).machines;
  const titles = e.scenarios.map((s) => s.title);
  assert.equal(new Set(titles).size, titles.length, 'no two rows read the same');
  assert.ok(titles.every((t) => !/^Path \d+$/.test(t)));
  assert.equal(titles[0], 'Happy path', 'the happy path keeps its name');
  assert.deepEqual(e.scenarios.map((s) => s.branch), [
    'is low value · the service succeeds',
    'is suspicious · approve · the service succeeds',
    'is suspicious · reject',
    'is suspicious · after 2 d · approve · the service succeeds',
    'is suspicious · after 2 d · reject',
    'otherwise · approve · the service succeeds',
    'otherwise · reject',
    'otherwise · after 2 d · approve · the service succeeds',
    'otherwise · after 2 d · reject',
  ]);
  // The four pairs that share route and events are told apart by the branch, exactly as the issue asks.
  for (const [a, b] of [[1, 5], [2, 6], [3, 7], [4, 8]]) {
    assert.equal(e.scenarios[a].route, e.scenarios[b].route);
    assert.deepEqual(e.scenarios[a].events, e.scenarios[b].events);
    assert.notEqual(e.scenarios[a].branch, e.scenarios[b].branch);
    assert.notEqual(e.scenarios[a].title, e.scenarios[b].title);
  }
  assert.equal(e.scenarios[2].title, 'Is suspicious, then reject (ends in rejected)');
  assert.equal(e.scenarios[6].title, 'Otherwise, then reject (ends in rejected)');
});

test('#307: a machine with one route says "the only path"; a stuck route says where it is stuck; titles never collide', () => {
  const one = enumerateScenarios(machineOf(wrap(`{ a: { on: { GO: 'b' } }, b: { type: 'final' } }`))).scenarios;
  assert.equal(one[0].title, 'Happy path');
  assert.equal(one[0].branch, 'the only path');
  const stuck = enumerateScenarios(machineOf(wrap(`{ a: { on: { GO: 'b' } }, b: {} }`))).scenarios;
  assert.equal(stuck[0].title, 'The only path (gets stuck in b)');
  const twins = enumerateScenarios(machineOf(wrap(`{ a: { on: { GO: [{ target: 'b', guard: 'isX' }, { target: 'b', guard: 'isX' }] } }, b: {} }`))).scenarios;
  assert.equal(new Set(twins.map((s) => s.title)).size, twins.length);
});
