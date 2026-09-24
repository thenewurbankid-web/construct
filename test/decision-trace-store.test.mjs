// #643 -- where traces live and how they are written: append-only JSONL in the state directory (never in the project),
// deduplicated by id, rotated at a cap, outcomes as separate records, switched off per project by `traces: off`, and FAILURE-SAFE
// (a full disk or a bad state directory never throws into the chain). Plus the adapters that turn a card, a placement and a
// compiled chain into recordable choices.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { loadConfig, normalizeTraces } from '../packages/core/config.mjs';
import { compileChain, defineChooser } from '../packages/core/chooser.mjs';
import { parseRequirement } from '../packages/core/requirement-card.mjs';
import { placeCard, planFromBlocks } from '../packages/core/placement.mjs';
import { registerDecisionProvider, unregisterDecisionProvider } from '../packages/core/decision-provider.mjs';
import { buildTrace, serializeTrace } from '../packages/core/decision-trace.mjs';
import { TRACE_FILE, TRACE_STORE_LIMITS, readTraces, recordChoices, recordDecisions, recordOutcome, recordOutcomes, traceDir, tracesEnabled } from '../packages/core/decision-trace-store.mjs';
import { choiceFromCardQuestion, choicesFromChain, choicesFromPlacement, choicesFromWiring, placementChooserId, wiringChooserId } from '../packages/core/decision-trace-adapters.mjs';

const opt = (id) => ({ id, label: id, enabled: true, why: `Because ${id}.` });
const summary = (n = 1, over = {}) => ({ id: `o${n}`, question: `What does "word${n}" mean here?`, options: [opt('entity'), opt('state'), opt('ui-part')], chosen: null, ...over });
const choice = (n = 1, chosen = 'state', extra = {}) => ({ summary: summary(n), chosen, by: 'person', ...extra });
const clock = () => { let m = 0; return () => new Date(Date.UTC(2026, 8, 24, 10, m++, 0)).toISOString(); };

function setup(yml) {
  const root = makeTempDir('og643-root-');
  const stateDir = makeTempDir('og643-state-');
  if (yml !== undefined) fs.writeFileSync(path.join(root, 'architecture.yml'), yml);
  return { root, stateDir, opts: { stateDir, now: clock() } };
}
const lines = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);

test('records are appended to the state directory, never inside the project, and read back with the same content', () => {
  const { root, stateDir, opts } = setup();
  const r = recordDecisions(root, [choice(1), choice(2, 'entity')], opts);
  assert.deepEqual([r.ok, r.enabled, r.recorded, r.duplicates, r.refused], [true, true, 2, 0, []]);
  const dir = traceDir(root, { stateDir });
  assert.ok(dir.startsWith(path.join(stateDir, 'traces') + path.sep), 'under <state>/traces/<project key>');
  assert.match(path.basename(dir), /^og643-root-.*-[0-9a-f]{12}$/);
  assert.equal(dir.startsWith(root), false);
  assert.deepEqual(fs.readdirSync(root), [], 'nothing was written into the project');
  const file = path.join(dir, TRACE_FILE);
  assert.equal(lines(file).length, 2);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'private file');
  const read = readTraces(root, { stateDir });
  assert.equal(read.decisions.length, 2);
  assert.deepEqual(read.decisions.map((d) => d.chosen), ['state', 'entity']);
  assert.deepEqual([read.skipped, read.orphanOutcomes, read.enabled], [0, 0, true]);
  assert.equal(lines(file)[0], serializeTrace(read.decisions[0]), 'a line is the deterministic serialisation of the record');
});

test('the same decision is one record: recording it again (a stateless caller replaying its answers) adds nothing', () => {
  const { root, stateDir, opts } = setup();
  recordDecisions(root, [choice(1)], opts);
  const again = recordDecisions(root, [choice(1), choice(1), choice(2)], opts);
  assert.deepEqual([again.recorded, again.duplicates, again.ids.length], [1, 2, 3]);
  assert.equal(readTraces(root, { stateDir }).decisions.length, 2);
});

test('the file bytes are deterministic: the same decisions and the same clock write the same file', () => {
  const a = setup();
  const b = setup();
  for (const s of [a, b]) recordDecisions(s.root, [choice(1), choice(2)], { stateDir: s.stateDir, now: () => '2026-09-24T10:00:00.000Z' });
  const read = (s) => fs.readFileSync(path.join(traceDir(s.root, { stateDir: s.stateDir }), TRACE_FILE), 'utf8');
  // the project key differs (two temp roots) but the content does not
  assert.equal(read(a), read(b));
});

test('rotation: the active file rotates at the cap, older files are kept up to maxFiles, the oldest are dropped, reads go oldest first', () => {
  const { root, stateDir } = setup();
  const one = `${serializeTrace(buildTrace(choice(1), { at: '2026-09-24T10:00:00.000Z' }).trace)}\n`.length;
  const opts = { stateDir, maxBytes: one * 2 + 10, maxFiles: 3, now: clock() };
  for (let n = 1; n <= 9; n += 1) assert.equal(recordDecisions(root, [choice(n)], opts).recorded, 1);
  const dir = traceDir(root, { stateDir });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['decisions.1.jsonl', 'decisions.2.jsonl', 'decisions.jsonl']);
  for (const f of fs.readdirSync(dir)) assert.ok(fs.statSync(path.join(dir, f)).size <= one * 2 + 10, `${f} is within the cap`);
  const got = readTraces(root, { stateDir, maxFiles: 3 }).decisions.map((d) => d.summary.id);
  assert.deepEqual(got, ['o5', 'o6', 'o7', 'o8', 'o9'].slice(-got.length), 'the newest survive, in order');
  assert.ok(got.length >= 4 && got.length <= 6);
  assert.deepEqual(TRACE_STORE_LIMITS, { maxBytes: 2 * 1024 * 1024, maxFiles: 5 });
});

test('recordOutcome is a SEPARATE record that references the id; the decision line is never rewritten', () => {
  const { root, stateDir, opts } = setup();
  const [id] = recordDecisions(root, [choice(1)], opts).ids;
  const file = path.join(traceDir(root, { stateDir }), TRACE_FILE);
  const before = lines(file);
  const r = recordOutcome(root, id, { planValidated: true }, opts);
  assert.deepEqual([r.ok, r.recorded], [true, 1]);
  const after = lines(file);
  assert.equal(after.length, 2);
  assert.equal(after[0], before[0], 'byte-identical decision line');
  assert.deepEqual(JSON.parse(after[1]), { at: '2026-09-24T10:01:00.000Z', kind: 'outcome', of: id, outcome: { planValidated: true }, version: 'decision-trace.v1' });
  assert.equal(recordOutcome(root, id, { planValidated: true }, opts).recorded, 0, 'the same label and value again adds nothing');
  assert.equal(recordOutcome(root, id, { planValidated: true, testsPassed: false }, opts).recorded, 1);
  assert.equal(recordOutcome(root, id, { planValidated: false }, opts).recorded, 1, 'a changed value is a new record (history, not overwrite)');
  const read = readTraces(root, { stateDir });
  assert.deepEqual(read.decisions[0].outcome, { planValidated: false, testsPassed: false });
  assert.equal(read.outcomes.length, 3);
  assert.equal(recordOutcomes(root, [{ id: 'nope', outcome: { planValidated: true } }, { id, outcome: {} }], opts).refused.length, 2);
  recordOutcome(root, `dt-${'a'.repeat(24)}`, { reverted: true }, opts);
  assert.equal(readTraces(root, { stateDir }).orphanOutcomes, 1, 'an outcome whose decision is not there is counted, not dropped');
});

test('the per-project switch: `traces: off` writes nothing and asks nothing; on, or absent, records; a bad value is a usage error and records nothing', async () => {
  let asked = 0;
  registerDecisionProvider('counting', { suggest: () => { asked += 1; return null; } });
  try {
    for (const [yml, enabled] of [[undefined, true], ['features:\n  root: features\n', true], ['traces: on\n', true], ['traces: off\n', false], ['traces: false\n', false], ['traces: true\n', true]]) {
      const { root, stateDir, opts } = setup(yml);
      assert.equal(tracesEnabled(root), enabled, String(yml));
      const r = await recordChoices(root, [choice(1)], { ...opts, suggestWith: 'counting', outcome: { planValidated: true } });
      assert.equal(r.enabled, enabled);
      assert.equal(r.recorded, enabled ? 1 : 0);
      assert.equal(fs.existsSync(traceDir(root, { stateDir })), enabled, 'off creates no directory at all');
      assert.equal(recordDecisions(root, [choice(2)], opts).recorded, enabled ? 1 : 0);
      assert.equal(recordOutcome(root, `dt-${'b'.repeat(24)}`, { reverted: true }, opts).recorded, enabled ? 1 : 0);
    }
    assert.equal(asked, 4, 'the provider was asked only for projects with recording on');
    const bad = setup('traces: maybe\n');
    assert.equal(tracesEnabled(bad.root), false, 'a switch that cannot be read counts as off');
    assert.equal(recordDecisions(bad.root, [choice(1)], bad.opts).recorded, 0);
    assert.throws(() => loadConfig(bad.root), /Unknown traces 'maybe'.*on, off/);
  } finally {
    unregisterDecisionProvider('counting');
  }
  assert.equal(loadConfig(setup().root).traces, 'on', 'default on');
  assert.equal(normalizeTraces(undefined), 'on');
  assert.equal(normalizeTraces(null), 'on');
  assert.equal(normalizeTraces('off'), 'off');
  assert.throws(() => normalizeTraces(3), /expected one of: on, off/);
});

test('switching recording off keeps what was recorded readable', () => {
  const { root, stateDir, opts } = setup();
  recordDecisions(root, [choice(1)], opts);
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'traces: off\n');
  const read = readTraces(root, { stateDir });
  assert.deepEqual([read.enabled, read.decisions.length], [false, 1]);
});

test('failure safety: a state directory that is a file, a read-only directory or a full disk returns { ok: false } and never throws', async () => {
  const { root } = setup();
  const notADir = path.join(makeTempDir('og643-file-'), 'state');
  fs.writeFileSync(notADir, 'i am a file');
  const bad = recordDecisions(root, [choice(1)], { stateDir: notADir });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /ENOTDIR|EEXIST/);
  assert.equal(recordOutcome(root, `dt-${'c'.repeat(24)}`, { reverted: true }, { stateDir: notADir }).ok, false);
  assert.equal((await recordChoices(root, [choice(1)], { stateDir: notADir, outcome: { planValidated: true } })).ok, false);
  assert.deepEqual(readTraces(root, { stateDir: notADir }).decisions, [], 'reading a bad directory is empty, not a throw');

  const full = { ...fs, appendFileSync() { const e = new Error('no space left on device'); e.code = 'ENOSPC'; throw e; } };
  const s = setup();
  const r = recordDecisions(s.root, [choice(1)], { ...s.opts, fsImpl: full });
  assert.deepEqual([r.ok, r.recorded], [false, 0]);
  assert.match(r.error, /ENOSPC/);
  assert.equal((await recordChoices(s.root, [choice(1)], { ...s.opts, fsImpl: full })).ok, false);
  assert.equal(recordDecisions(s.root, [choice(1)], s.opts).recorded, 1, 'and the next write, on a disk with room, works');

  const unreadable = { ...fs, readFileSync() { throw new Error('EIO: boom'); } };
  assert.equal(readTraces(s.root, { stateDir: s.stateDir, fsImpl: unreadable }).error?.includes('EIO'), true);
  assert.equal((await recordChoices(s.root, null, s.opts)).ok, true, 'junk input is tolerated');
  assert.equal(recordDecisions(s.root, 'nope', s.opts).recorded, 0);
});

test('a torn last line (a killed process) is skipped by readers and repaired by the next append', () => {
  const { root, stateDir, opts } = setup();
  recordDecisions(root, [choice(1)], opts);
  const file = path.join(traceDir(root, { stateDir }), TRACE_FILE);
  fs.appendFileSync(file, '{"version":"decision-trace.v1","id":"dt-half');
  assert.equal(readTraces(root, { stateDir }).skipped, 1);
  assert.equal(recordDecisions(root, [choice(2)], opts).recorded, 1);
  const read = readTraces(root, { stateDir });
  assert.deepEqual([read.decisions.length, read.skipped], [2, 1], 'the new record is whole on its own line');
});

test('a record with a path or a secret in it is refused, the rest are written, and nothing about the refusal reaches the file', () => {
  const { root, stateDir, opts } = setup();
  const r = recordDecisions(root, [choice(1), { summary: summary(2, { question: 'Open /etc/passwd now?' }), chosen: 'state' }, choice(3)], opts);
  assert.deepEqual([r.recorded, r.refused.length, r.refused[0].index, r.refused[0].errors[0].code], [2, 1, 1, 'TRACE_REDACTION_PATH']);
  const text = fs.readFileSync(path.join(traceDir(root, { stateDir }), TRACE_FILE), 'utf8');
  assert.equal(text.includes('passwd'), false);
  const s = recordDecisions(root, [{ summary: summary(4, { question: 'Use ghp_abcdefghijklmnopqrstuvwxyz0123456789?' }), chosen: 'state' }], opts);
  assert.equal(s.refused[0].errors[0].code, 'TRACE_REDACTION_SECRET');
});

test('recordChoices asks the rules provider what it would suggest and records whether the person took it', async () => {
  const { root, stateDir, opts } = setup();
  const r = await recordChoices(root, [choice(1, 'entity'), choice(2, 'state'), choice(3, 'state', { by: 'llm', provider: 'jev' })], { ...opts, outcome: { planValidated: true } });
  assert.deepEqual([r.ok, r.recorded, r.ids.length], [true, 3, 3]);
  const [a, b, c] = readTraces(root, { stateDir }).decisions;
  assert.deepEqual(a.suggestion, { option: 'entity', reason: 'first available step' });
  assert.deepEqual(a.provider, { name: 'rules', version: '1' });
  assert.deepEqual(a.outcome, { accepted: true, planValidated: true });
  assert.deepEqual(b.suggestion, { option: 'entity', reason: 'first available step' });
  assert.deepEqual(b.outcome, { accepted: false, planValidated: true }, 'overridden: accepted false');
  assert.equal(c.by, 'llm');
  assert.deepEqual(c.provider, { name: 'jev', version: 'unversioned' }, 'a provider given by name is versioned from the registry');
  assert.equal('suggestion' in c, false, 'a choice made by a model is not compared with rules');
  assert.equal((await recordChoices(root, [choice(4)], { ...opts, suggestWith: null })).recorded, 1);
  assert.equal('suggestion' in readTraces(root, { stateDir }).decisions.at(-1), false);
  assert.equal((await recordChoices(root, [choice(1, 'entity')], { ...opts, outcome: { planValidated: true } })).recorded, 0, 'replaying the same answers records nothing new, outcomes included');
  assert.equal(readTraces(root, { stateDir }).outcomes.length, 3);
});

// ------------------------------------------------------------------------------------------------------------------ adapters

test('a requirement card question becomes a choice: the question as it stood before the answer, the option, the person', () => {
  const { card } = parseRequirement('A customer wants to frobnicate the invoice list.');
  const c = choiceFromCardQuestion(card, card.open[0], 'interact');
  assert.equal(c.chooser.id, 'requirement.card.verb');
  assert.equal(c.chosen, 'interact');
  assert.equal(c.by, 'person');
  assert.equal(c.summary.chosen, null);
  assert.deepEqual(c.summary.options.map((o) => o.id), ['read', 'write', 'interact', 'navigate', 'ignore']);
  assert.equal(buildTrace(c, { at: '2026-09-24T10:00:00.000Z' }).ok, true);
  const slash = parseRequirement('A user wants to open /admin now.').card;
  if (slash.open[0]) assert.equal(JSON.stringify(choiceFromCardQuestion(slash, slash.open[0], 'ignore')).includes('/admin'), false, 'paths in a word are hidden the way a chooser summary hides them');
});

test('a placement decision becomes a choice with the question AS OFFERED, the attribution kept; the q-shape offer included', () => {
  const card = parseRequirement('A user wants to see a list of products').card;
  const options = { answers: { 'q-shape': { option: 'list', by: 'llm', provider: 'jev' } } };
  const placement = placeCard(card, options);
  const [c, ...rest] = choicesFromPlacement(card, options, placement);
  assert.equal(rest.length, 0);
  assert.equal(c.chooser.id, 'requirement.placement.shape');
  assert.deepEqual([c.chosen, c.by, c.provider], ['list', 'llm', 'jev']);
  assert.deepEqual(c.summary.options.map((o) => o.id), ['list', 'scaffold']);
  assert.equal(c.summary.chosen, null);
  assert.equal(buildTrace({ ...c, provider: { name: 'jev', version: '1' } }, { at: '2026-09-24T10:00:00.000Z' }).ok, true);
  assert.deepEqual(choicesFromPlacement(card, {}, placeCard(card, {})), [], 'no answers, no choices');

  const server = parseRequirement('A user can click a button safely.').card;
  const opts = { answers: { 'q-server': 'mutation' } };
  const [q] = choicesFromPlacement(server, opts, placeCard(server, opts));
  assert.deepEqual([q.chooser.id, q.chosen], ['requirement.placement.server-check', 'mutation']);
  assert.deepEqual(['q-v1', 'q-c2', 'q-server', 'q-shape', 'q-zz'].map(placementChooserId), ['requirement.placement.ambiguity', 'requirement.placement.check', 'requirement.placement.server-check', 'requirement.placement.shape', 'requirement.placement.other']);
});

test('#654: the answered wiring questions of a shaped plan become choices; an unanswered one records nothing', () => {
  const dir = makeTempDir('construct-wiring-trace-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "x", "dependencies": {} }\n');
  const card = parseRequirement('A user wants to see a list of products').card;
  const placed = placeCard(card, { framework: 'react-spa', answers: { 'q-shape': 'list' } });
  const opts = { feature: 'products', root: dir, decisions: placed.decisions };
  assert.deepEqual(choicesFromWiring(planFromBlocks(placed.blocks, opts)), [], 'the default was applied, nobody chose');
  const planned = planFromBlocks(placed.blocks, { ...opts, answers: { 'q-dependency': { option: 'skip', by: 'decision-model', provider: 'rules' } } });
  const [c, ...rest] = choicesFromWiring(planned);
  assert.equal(rest.length, 0, 'the shape decision is the placement adapter\'s, not this one');
  assert.deepEqual([c.chooser.id, c.chosen, c.by, c.provider, c.summary.chosen], ['requirement.plan.dependency', 'skip', 'decision-model', 'rules', null]);
  assert.deepEqual(c.summary.options.map((o) => o.id), ['add-dependency', 'skip']);
  assert.equal(buildTrace({ ...c, provider: { name: 'rules', version: '1' } }, { at: '2026-09-24T10:00:00.000Z' }).ok, true);
  assert.deepEqual(['q-dependency', 'q-route', 'q-route-orders', 'q-zz'].map(wiringChooserId), ['requirement.plan.dependency', 'requirement.plan.route', 'requirement.plan.route', 'requirement.plan.other']);
});

test('compileChain decisions become choices with their attribution; the chooser summary is what was offered', async () => {
  const feature = (id, name) => ({ id, label: `Feature ${name}`, flow: 'create.feature', args: { name } });
  const chooser = defineChooser({ id: 'app.feature', question: 'Which feature?', options: [feature('cart', 'cart'), feature('wishlist', 'wishlist')] });
  const root = makeTempDir('og643-chain-');
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'features:\n  root: features\n');
  const result = compileChain([chooser], { 'app.feature': { option: 'wishlist', by: 'decision-model', provider: 'jev' } }, { root });
  assert.equal(result.ok, true);
  const choices = choicesFromChain([chooser], result.decisions, { states: { 'app.feature': { chosen: 'wishlist', facts: [] } } });
  assert.equal(choices.length, 1);
  assert.deepEqual([choices[0].chooser.id, choices[0].chosen, choices[0].by, choices[0].provider], ['app.feature', 'wishlist', 'decision-model', 'jev']);
  assert.equal(choices[0].summary.chosen, null, 'the state\'s chosen is not part of what was offered');
  assert.deepEqual(choicesFromChain([], result.decisions), []);
  const { stateDir, root: projectRoot, opts } = setup();
  const r = await recordChoices(projectRoot, choices, { ...opts, outcome: { planValidated: true } });
  assert.deepEqual([r.ok, r.recorded], [true, 1]);
  const [d] = readTraces(projectRoot, { stateDir }).decisions;
  assert.deepEqual([d.by, d.provider, d.outcome], ['decision-model', { name: 'jev', version: 'unversioned' }, { planValidated: true }]);
});
