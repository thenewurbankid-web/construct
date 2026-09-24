// #643 -- the yardstick: `construct traces list|stats|replay` on a fixture trace file (50 person-made decisions, 30 with
// planValidated), with fake providers that BEAT, TIE and LOSE to the `rules` baseline. Deterministic, read-only, no network.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { FAKE_PROVIDERS, NOUN_CHOOSER, SHAPE_CHOOSER, writeFixtureTraces } from '../test-utils/decisionTraceFixture.mjs';
import { registerDecisionProvider, unregisterDecisionProvider } from '../packages/core/decision-provider.mjs';
import { readTraces, traceDir } from '../packages/core/decision-trace-store.mjs';
import { DEFAULT_MIN_TRACES, renderReplay, renderTraceList, renderTraceStats, replayTraces, traceStats } from '../packages/core/decision-trace-replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'packages', 'cli', 'construct.mjs');
const root = makeTempDir('og643-replay-root-');
const stateDir = makeTempDir('og643-replay-state-');
let decisions;

before(async () => {
  await writeFixtureTraces(root, { stateDir });
  decisions = readTraces(root, { stateDir }).decisions;
  for (const p of Object.values(FAKE_PROVIDERS)) registerDecisionProvider(p.name, p);
});
after(() => {
  for (const p of Object.values(FAKE_PROVIDERS)) unregisterDecisionProvider(p.name);
});

const cli = (...args) => spawnSync(process.execPath, [CLI, 'traces', ...args, '--dir', root], { encoding: 'utf8', env: { ...process.env, CONSTRUCT_STATE_DIR: stateDir } });
const json = (...args) => {
  const r = cli(...args, '--json');
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test('the fixture: 50 decisions by a person, each with the rules suggestion, and the first 30 with planValidated', () => {
  assert.equal(decisions.length, 50);
  assert.ok(decisions.every((d) => d.by === 'person' && d.provider.name === 'rules' && d.suggestion));
  assert.equal(decisions.filter((d) => d.outcome.planValidated).length, 30);
  assert.equal(readTraces(root, { stateDir }).skipped, 0);
});

test('stats: counts per chooser, the acceptance rate of suggestions overall and per provider, the outcome labels', () => {
  const s = traceStats(decisions);
  assert.equal(s.total, 50);
  assert.deepEqual(Object.keys(s.byChooser), [NOUN_CHOOSER, SHAPE_CHOOSER]);
  assert.deepEqual([s.byChooser[NOUN_CHOOSER].traces, s.byChooser[SHAPE_CHOOSER].traces], [40, 10]);
  assert.equal(s.byChooser[NOUN_CHOOSER].by.person, 40);
  assert.deepEqual([s.suggestions.asked, s.suggestions.accepted, s.suggestions.overridden, s.suggestions.acceptanceRate], [50, 20, 30, 0.4]);
  assert.deepEqual(s.byProvider, { 'rules@1': { asked: 50, accepted: 20, overridden: 30, acceptanceRate: 0.4 } });
  assert.deepEqual([s.byChooser[NOUN_CHOOSER].suggestions.accepted, s.byChooser[SHAPE_CHOOSER].suggestions.accepted], [12, 8]);
  assert.deepEqual(s.outcomes, { planValidated: 30, testsPassed: 0, reverted: 0, accepted: 20, good: 38 });
  assert.equal(traceStats([]).suggestions.acceptanceRate, null);
  assert.match(renderTraceStats(s), /50 decision\(s\)[\s\S]*acceptance 40%[\s\S]*rules@1/);
  assert.equal(renderTraceStats(traceStats([])), 'No decision traces recorded.');
});

test('replay of the rules baseline against itself: it ties, agreement is exactly what the rules got right', async () => {
  const r = await replayTraces(decisions, { provider: 'rules' });
  assert.equal(r.ok, true);
  assert.deepEqual([r.provider, r.baseline, r.minTraces], ['rules', 'rules', DEFAULT_MIN_TRACES]);
  assert.deepEqual([r.overall.hits, r.overall.persons, r.overall.agreement, r.overall.coverage], [20, 50, 0.4, 1]);
  assert.equal(r.overall.verdict, 'ties');
  assert.equal(r.overall.promotable, false);
  assert.deepEqual([r.overall.outcomeTraces, r.overall.outcomeHits], [38, 20]);
});

test('a provider that BEATS the baseline: better agreement, the outcome agreement, coverage below 100% for its abstentions, promotable on 30+ traces', async () => {
  const r = await replayTraces(decisions, { provider: 'beater' });
  const o = r.overall;
  assert.deepEqual([o.hits, o.agreement, o.answered, o.abstained, o.coverage], [46, 0.92, 48, 2, 0.96]);
  assert.equal(o.agreementWhenAnswered, 46 / 48);
  assert.deepEqual([o.outcomeTraces, o.outcomeHits, o.outcomeAgreement], [38, 30 + 8, 1]);
  assert.deepEqual([o.baseline.hits, o.baseline.agreement], [20, 0.4]);
  assert.deepEqual([o.verdict, o.promotable], ['beats', true]);
  assert.match(o.reason, /beats the baseline on 50 person-made traces \(needs 30\)/);
  assert.deepEqual(r.byChooser[NOUN_CHOOSER].verdict, 'beats');
  assert.equal(r.byChooser[NOUN_CHOOSER].hits, 38);
  assert.equal(r.byChooser[SHAPE_CHOOSER].verdict, 'ties', 'per chooser: on the shape offer it says list like rules');
});

test('beating the baseline is not enough: it must be on at least N person-made traces (a flag, default 30)', async () => {
  const few = await replayTraces(decisions, { provider: 'beater', minTraces: 60 });
  assert.deepEqual([few.overall.verdict, few.overall.promotable], ['beats', false]);
  assert.match(few.overall.reason, /only 50 person-made traces \(needs 60\)/);
  const noun = await replayTraces(decisions, { provider: 'beater', chooser: SHAPE_CHOOSER });
  assert.deepEqual([noun.overall.persons, noun.overall.verdict, noun.overall.promotable], [10, 'ties', false]);
  const onlyNouns = await replayTraces(decisions, { provider: 'beater', chooser: NOUN_CHOOSER, minTraces: 40 });
  assert.deepEqual([onlyNouns.overall.persons, onlyNouns.overall.promotable], [40, true]);
  assert.deepEqual(Object.keys(onlyNouns.byChooser), [NOUN_CHOOSER]);
});

test('a provider that TIES the baseline and one that LOSES', async () => {
  const tie = await replayTraces(decisions, { provider: 'tier' });
  assert.deepEqual([tie.overall.hits, tie.overall.verdict, tie.overall.promotable], [20, 'ties', false]);
  const lose = await replayTraces(decisions, { provider: 'loser' });
  assert.deepEqual([lose.overall.hits, lose.overall.verdict, lose.overall.promotable], [2, 'loses', false]);
  assert.match(lose.overall.reason, /does not beat the baseline \(loses\)/);
  const off = await replayTraces(decisions, { provider: 'off' });
  assert.deepEqual([off.overall.coverage, off.overall.abstained, off.overall.hits, off.overall.agreement, off.overall.agreementWhenAnswered, off.overall.verdict], [0, 50, 0, 0, null, 'loses']);
});

test('a chosen baseline; an unregistered provider is a named error, not a crash; a throwing or hanging provider only abstains', async () => {
  const vs = await replayTraces(decisions, { provider: 'rules', baseline: 'beater' });
  assert.equal(vs.overall.verdict, 'loses');
  const missing = await replayTraces(decisions, { provider: 'nope' });
  assert.deepEqual([missing.ok, /No decision provider named "nope".*rules, off/.test(missing.error)], [false, true]);
  assert.equal((await replayTraces(decisions, { provider: 'rules', baseline: 'nope' })).ok, false);
  registerDecisionProvider('boom', { suggest: () => { throw new Error('kaboom'); } });
  registerDecisionProvider('hang', { suggest: () => new Promise(() => {}) });
  try {
    assert.equal((await replayTraces(decisions, { provider: 'boom' })).overall.coverage, 0);
    const slow = await replayTraces(decisions.slice(0, 2), { provider: 'hang', timeoutMs: 20 });
    assert.equal(slow.overall.abstained, 2);
  } finally {
    unregisterDecisionProvider('boom');
    unregisterDecisionProvider('hang');
  }
});

test('replay is deterministic and read-only: the same numbers twice, and the trace file is not touched', async () => {
  const file = path.join(traceDir(root, { stateDir }), 'decisions.jsonl');
  const before1 = fs.readFileSync(file);
  const a = JSON.stringify(await replayTraces(decisions, { provider: 'beater' }));
  const b = JSON.stringify(await replayTraces(readTraces(root, { stateDir }).decisions, { provider: 'beater' }));
  assert.equal(a, b);
  assert.deepEqual(fs.readFileSync(file), before1);
  const frozen = structuredClone(decisions);
  await replayTraces(decisions, { provider: 'tier' });
  assert.deepEqual(decisions, frozen, 'the traces are not changed');
});

test('the plain-text renderers say the verdict and the numbers', async () => {
  const text = renderReplay(await replayTraces(decisions, { provider: 'beater' }));
  assert.match(text, /Replay of "beater" against "rules"/);
  assert.match(text, /overall\s+traces 50\s+persons 50\s+agreement 92%/);
  assert.match(text, /verdict: beats; beats the baseline on 50 person-made traces/);
  const list = renderTraceList(decisions, { limit: 2 });
  assert.match(list, /^2 of 50 decision trace\(s\):/);
  assert.match(list, /requirement\.placement\.shape\s+chose scaffold\s+by person\s+suggested list \(overridden\)\s+accepted=false/);
  assert.equal(renderTraceList([]), 'No decision traces recorded.');
});

// ------------------------------------------------------------------------------------------------------------------ the CLI

test('construct traces list: the recorded decisions, filtered by chooser, limited', () => {
  const all = json('list');
  assert.deepEqual([all.ok, all.enabled, all.total, all.decisions.length], [true, true, 50, 50]);
  const shape = json('list', '--chooser', SHAPE_CHOOSER);
  assert.equal(shape.total, 10);
  assert.ok(shape.decisions.every((d) => d.chooser.id === SHAPE_CHOOSER));
  assert.equal(json('list', '--limit', '3').decisions.length, 3);
  assert.equal(JSON.stringify(all).includes(stateDir), false, 'the JSON carries no local path');
  const text = cli('list', '--limit', '2');
  assert.equal(text.status, 0);
  assert.match(text.stdout, /2 of 50 decision trace\(s\)/);
  assert.match(text.stdout, new RegExp(traceDir(root, { stateDir }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the text says where the file is');
});

test('construct traces stats --json', () => {
  const s = json('stats');
  assert.deepEqual([s.total, s.suggestions.acceptanceRate, Object.keys(s.byProvider)], [50, 0.4, ['rules@1']]);
  assert.equal(json('stats', '--chooser', NOUN_CHOOSER).total, 40);
});

test('construct traces replay: the built-in providers, no plugin needed', () => {
  const rules = json('replay', '--provider', 'rules');
  assert.deepEqual([rules.overall.verdict, rules.overall.agreement], ['ties', 0.4]);
  const off = json('replay', '--provider', 'off');
  assert.deepEqual([off.overall.verdict, off.overall.coverage], ['loses', 0]);
  const text = cli('replay', '--provider', 'rules');
  assert.equal(text.status, 0);
  assert.match(text.stdout, /Replay of "rules" against "rules"/);
  assert.match(text.stdout, /verdict: ties/);
});

test('construct traces replay --plugin: a provider from a file you name beats the baseline and is promotable; --min-traces moves the bar', () => {
  const plugin = path.join(makeTempDir('og643-plugin-'), 'jev.mjs');
  fs.writeFileSync(plugin, `export default { name: 'jev', version: '0.1', suggest(summary) {
  const word = /"([^"]+)"/.exec(summary.question)?.[1] ?? '';
  const n = Number(/(\\d+)$/.exec(word)?.[1] ?? 0);
  if (summary.options.some((o) => o.id === 'list')) return { option: 'list', reason: 'plural list', runnerUp: null };
  return { option: n <= 12 ? 'entity' : n <= 20 ? 'state' : 'ui-part', reason: 'word number', runnerUp: null };
} };
`);
  const r = json('replay', '--provider', 'jev', '--plugin', plugin);
  assert.deepEqual([r.overall.verdict, r.overall.promotable, r.overall.hits, r.overall.coverage], ['beats', true, 48, 1]);
  const bar = json('replay', '--provider', 'jev', '--plugin', plugin, '--min-traces', '51');
  assert.deepEqual([bar.overall.verdict, bar.overall.promotable, bar.minTraces], ['beats', false, 51]);
  const only = json('replay', '--provider', 'jev', '--plugin', plugin, '--chooser', NOUN_CHOOSER);
  assert.deepEqual(Object.keys(only.byChooser), [NOUN_CHOOSER]);
});

test('the CLI refuses what it cannot do with exit code 2: no subcommand, an unknown one, no provider, an unregistered one, a bad number, a missing plugin', () => {
  for (const args of [[], ['frobnicate'], ['replay'], ['replay', '--provider', 'nope'], ['list', '--limit', 'ten'], ['replay', '--provider', 'rules', '--min-traces', '-3'], ['replay', '--provider', 'x', '--plugin', '/no/such/plugin.mjs']]) {
    const r = cli(...args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, /Usage: construct traces/);
  }
  assert.match(cli('replay', '--provider', 'nope').stderr, /No decision provider named "nope"/);
});

test('with recording off the traces stay readable and the CLI says so; an empty project says none', () => {
  const off = makeTempDir('og643-off-');
  fs.writeFileSync(path.join(off, 'architecture.yml'), 'traces: off\n');
  const r = spawnSync(process.execPath, [CLI, 'traces', 'list', '--dir', off], { encoding: 'utf8', env: { ...process.env, CONSTRUCT_STATE_DIR: stateDir } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /No decision traces recorded\./);
  assert.match(r.stdout, /Recording is off for this project \(traces: off/);
  const stats = spawnSync(process.execPath, [CLI, 'traces', 'stats', '--json', '--dir', off], { encoding: 'utf8', env: { ...process.env, CONSTRUCT_STATE_DIR: stateDir } });
  assert.deepEqual([JSON.parse(stats.stdout).enabled, JSON.parse(stats.stdout).total], [false, 0]);
});
