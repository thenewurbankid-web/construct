// #633 -- `construct decide`: the decision model as a tool. JSON summary in (a file or stdin), one suggestion out; or a sentence in and
// a suggestion per open question and offer out. Read-only, no model unless the project names a plugin, exit code 2 for a usage
// error, and `construct traces replay --provider <name>` finds the same project plugin. Runs the real binary.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { writeFixtureTraces } from '../test-utils/decisionTraceFixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'packages', 'cli', 'construct.mjs');
const stateDir = makeTempDir('og633-cli-state-');
const summary = {
  id: 'o1',
  question: 'What does "invoice" mean here?',
  options: [
    { id: 'entity', label: 'A data object', enabled: true, why: 'Something the app stores.' },
    { id: 'ui-part', label: 'A part of the screen', enabled: true, why: 'A button or a list.' },
  ],
  chosen: null,
};

function project(decision, plugins = {}) {
  const root = makeTempDir('og633-cli-project-');
  fs.writeFileSync(path.join(root, 'architecture.yml'), `version: 1\n${decision ? `decision:\n${Object.entries(decision).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join('\n')}\n` : ''}`);
  for (const [rel, body] of Object.entries(plugins)) fs.writeFileSync(path.join(root, rel), body);
  return root;
}
const decide = (root, args, input) => spawnSync(process.execPath, [CLI, 'decide', ...args, '--dir', root], { encoding: 'utf8', input, env: { ...process.env, CONSTRUCT_STATE_DIR: stateDir } });
const json = (r) => JSON.parse(r.stdout);
const listing = (root) => fs.readdirSync(root, { recursive: true }).sort();

test('--summary from a file: the rules suggestion as JSON, exit 0, nothing written', () => {
  const root = project();
  const file = path.join(makeTempDir('og633-cli-in-'), 'summary.json');
  fs.writeFileSync(file, JSON.stringify(summary));
  const before = listing(root);
  const r = decide(root, ['--summary', file, '--format', 'json']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(json(r), { ok: true, provider: { name: 'rules', version: '1' }, requested: 'rules', fellBackFrom: null, notes: [], suggestion: { option: 'entity', reason: 'first available step', runnerUp: 'ui-part' } });
  assert.deepEqual(listing(root), before, 'read-only: the project is unchanged');
  assert.equal(fs.existsSync(path.join(stateDir, 'traces')), false, 'and nothing was recorded');
  assert.equal(r.stderr, '');
});

test('--summary - reads stdin; the text form says what and why; --provider off suggests nothing (still exit 0)', () => {
  const root = project();
  const text = decide(root, ['--summary', '-'], JSON.stringify(summary));
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /suggested: entity \(rules 1\)\. Why: first available step\. Runner-up: ui-part\./);
  const off = decide(root, ['--summary', '-', '--provider', 'off', '--format', 'json'], JSON.stringify(summary));
  assert.equal(off.status, 0);
  assert.deepEqual([json(off).suggestion, json(off).provider.name], [null, 'off']);
  assert.match(decide(root, ['--summary', '-', '--provider', 'off'], JSON.stringify(summary)).stdout, /no suggestion \(off 1\)/);
});

test('--requirement: the suggestion for each open question and offer of a sentence, as JSON', () => {
  const root = project();
  const products = json(decide(root, ['--requirement', 'A user wants to see a list of products', '--format', 'json']));
  assert.equal(products.questions.length, 1);
  const [shape] = products.questions;
  assert.deepEqual([shape.id, shape.source, shape.options.map((o) => o.id), shape.suggestion.option, shape.suggestion.provider], ['q-shape', 'placement', ['list', 'scaffold'], 'list', { name: 'rules', version: '1' }]);
  assert.match(shape.suggestion.reason, /plural/);
  const unknown = json(decide(root, ['--requirement', 'A customer wants to frobnicate the invoice list.', '--format', 'json']));
  assert.deepEqual(unknown.questions.map((q) => [q.id, q.source, q.suggestion.option]), [['o1', 'card', 'read']]);
  assert.match(unknown.note, /not known yet/);
  const none = json(decide(root, ['--requirement', 'A logged-in user needs to see their current subscription plan and be able to click a button to manage their billing details safely via Stripe.', '--format', 'json']));
  assert.deepEqual(none.questions, [], 'nothing open: the sentence places without a question');
  const text = decide(root, ['--requirement', 'A user wants to see a list of products']);
  assert.match(text.stdout, /q-shape \[placement\] .*\n {2}options: list, scaffold\n {2}suggested: list \(rules 1\)/);
});

test('usage errors exit 2 with a named code: no input, both inputs, an unreadable file, not JSON, not a summary, a secret, a sentence that cannot be read', () => {
  const root = project();
  const dir = makeTempDir('og633-cli-bad-');
  const write = (name, content) => { const f = path.join(dir, name); fs.writeFileSync(f, content); return f; };
  const cases = [
    [[], /exactly one of/],
    [['--summary', '-', '--requirement', 'x'], /exactly one of/],
    [['--summary', path.join(dir, 'missing.json')], /Could not read the summary/],
    [['--summary', write('a.txt', 'not json')], /not JSON/],
    [['--summary', write('b.json', JSON.stringify({ id: 'x', options: 'no' }))], /must be \{ id, question, options/],
    [['--summary', write('c.json', JSON.stringify({ ...summary, options: Array.from({ length: 6 }, (_, i) => ({ id: `o${i}`, enabled: true })) }))], /at most 5 options/],
    [['--summary', write('d.json', JSON.stringify({ ...summary, question: 'token=abcd1234efgh5678' }))], /no secret/],
    [['--summary', write('e.json', 'x'.repeat(70000))], /larger than 65536/],
    [['--requirement', ''], /exactly one of|could not be read|sentence/i],
  ];
  for (const [args, pattern] of cases) {
    const r = decide(root, args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, pattern);
    assert.match(r.stderr, /Usage: construct decide/);
    const j = decide(root, [...args, '--format', 'json']);
    assert.equal(j.status, 2);
    assert.deepEqual([json(j).ok, json(j).error.code], [false, 'USAGE_ERROR']);
  }
});

test('a project plugin: its suggestion, name and version, with the load line on stderr; --provider rules ignores it', () => {
  const plugin = "export default { name: 'jev', version: '0.2', suggest(s) { return { option: 'ui-part', reason: 'A screen word.', score: 0.8 }; } };\n";
  const root = project({ provider: 'jev', plugin: 'jev.mjs' }, { 'jev.mjs': plugin });
  const r = decide(root, ['--summary', '-', '--format', 'json'], JSON.stringify(summary));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(json(r).suggestion, { option: 'ui-part', reason: 'A screen word.', runnerUp: null, score: 0.8 });
  assert.deepEqual(json(r).provider, { name: 'jev', version: '0.2' });
  assert.match(r.stderr, /loaded provider "jev" version 0\.2/);
  assert.equal(r.stderr.includes(root), false, 'the log line names no path');
  const rules = decide(root, ['--summary', '-', '--provider', 'rules', '--format', 'json'], JSON.stringify(summary));
  assert.equal(json(rules).suggestion.option, 'entity');
  assert.equal(rules.stderr, '', 'a plugin that is not named is not loaded');
});

test('a plugin that fails or is outside the project falls back to rules, says so on stderr and in the document, exit 0', () => {
  const broken = project({ provider: 'jev', plugin: 'jev.mjs' }, { 'jev.mjs': "export default { name: 'jev', version: '1', suggest() { throw new Error('model down'); } };\n" });
  const r = decide(broken, ['--summary', '-', '--format', 'json'], JSON.stringify(summary));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual([json(r).provider.name, json(r).fellBackFrom, json(r).suggestion.option], ['rules', 'jev', 'entity']);
  assert.match(r.stderr, /failed \(error: model down\); the rules provider answered instead/);
  assert.match(json(r).notes.join(' '), /model down/);
  const escaped = project({ provider: 'jev', plugin: '../elsewhere.mjs' });
  const e = decide(escaped, ['--summary', '-', '--format', 'json'], JSON.stringify(summary));
  assert.equal(e.status, 0, e.stderr);
  assert.match(e.stderr, /PLUGIN_OUTSIDE_PROJECT/);
  assert.equal(json(e).provider.name, 'rules');
});

test('`construct traces replay --provider <name>` finds the plugin the project names, with no --plugin flag', async () => {
  const root = project({ provider: 'jev', plugin: 'jev.mjs' }, { 'jev.mjs': "export default { name: 'jev', version: '1', suggest(s) { const e = s.options.filter((o) => o.enabled); return { option: e[e.length - 1].id, reason: 'last one' }; } };\n" });
  await writeFixtureTraces(root, { stateDir });
  const r = spawnSync(process.execPath, [CLI, 'traces', 'replay', '--provider', 'jev', '--json', '--dir', root], { encoding: 'utf8', env: { ...process.env, CONSTRUCT_STATE_DIR: stateDir } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).provider, 'jev');
  assert.equal(JSON.parse(r.stdout).overall.coverage, 1);
  const plain = spawnSync(process.execPath, [CLI, 'traces', 'replay', '--provider', 'jev', '--json', '--dir', project()], { encoding: 'utf8', env: { ...process.env, CONSTRUCT_STATE_DIR: stateDir } });
  assert.equal(plain.status, 2, 'a project that names no plugin: still an unregistered provider');
  const outside = spawnSync(process.execPath, [CLI, 'traces', 'replay', '--provider', 'jev', '--dir', project({ provider: 'jev', plugin: '../x.mjs' })], { encoding: 'utf8', env: { ...process.env, CONSTRUCT_STATE_DIR: stateDir } });
  assert.equal(outside.status, 2);
  assert.match(outside.stderr, /PLUGIN_OUTSIDE_PROJECT|outside the project/);
});
