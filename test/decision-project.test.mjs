// #633 -- the decision model as a pluggable provider: the contract, the project setting, the plugin loader (containment, lazy
// loading), the fallback to the rules provider (a throwing, slow, junk or off-list plugin), and what a plugin can see (a frozen,
// path-free summary). No model is called: every "plugin" here is a few lines of JavaScript in a temp project.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { normalizeDecision, loadConfig, DEFAULT_DECISION } from '../packages/core/config.mjs';
import { askProvider, getDecisionProvider, providerInput, suggest } from '../packages/core/decision-provider.mjs';
import { loadDecisionPlugin, validateProviderContract } from '../packages/core/decision-plugin.mjs';
import { openDecision, clearDecisionCache, suggestForQuestions, questionSummary } from '../packages/core/decision-project.mjs';

const summary = (extra = {}) => ({
  id: 'o1',
  question: 'What does "invoice" mean here?',
  options: [
    { id: 'entity', label: 'A data object', enabled: true, why: 'Something the app stores.' },
    { id: 'ui-part', label: 'A part of the screen', enabled: true, why: 'A button or a list.' },
    { id: 'ignore', label: 'Ignore this word', enabled: false, why: 'Not offered here.' },
  ],
  chosen: null,
  ...extra,
});

/** A throwaway project: an architecture.yml with the given decision block, and plugin files by relative path. */
function project({ decision, plugins = {} } = {}) {
  const root = makeTempDir('og633-project-');
  fs.writeFileSync(path.join(root, 'architecture.yml'), `version: 1\n${decision ? `decision:\n${Object.entries(decision).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join('\n')}\n` : ''}`);
  for (const [rel, body] of Object.entries(plugins)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}
const pluginSource = (body, name = 'jev', version = '0.1') => `export default { name: ${JSON.stringify(name)}, version: ${JSON.stringify(version)}, suggest(summary) { ${body} } };\n`;
const GOOD = pluginSource("return { option: 'ui-part', reason: 'It looks like a screen word.', score: 0.9, runnerUp: 'entity' };");

beforeEach(() => {
  clearDecisionCache();
  delete globalThis.__decision633;
});

test('the provider contract: name, version, suggest; the built-in names are taken', () => {
  assert.deepEqual(validateProviderContract({ name: 'jev', version: '0.1', suggest() { return null; } }), { ok: true, errors: [] });
  for (const [bad, pattern] of [
    [null, /object/],
    [{ version: '1', suggest() {} }, /name/],
    [{ name: 'Jev!', version: '1', suggest() {} }, /name/],
    [{ name: 'rules', version: '1', suggest() {} }, /built-in/],
    [{ name: 'off', version: '1', suggest() {} }, /built-in/],
    [{ name: 'jev', suggest() {} }, /version/],
    [{ name: 'jev', version: '', suggest() {} }, /version/],
    [{ name: 'jev', version: 'x'.repeat(33), suggest() {} }, /version/],
    [{ name: 'jev', version: '1' }, /suggest/],
    [{ name: 'jev', version: '1', suggest: 'no' }, /suggest/],
  ]) {
    const r = validateProviderContract(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match(r.errors.join(' '), pattern);
  }
});

test('the project setting: rules by default, a provider name, a relative plugin, a timeout; anything else is a named usage error', () => {
  assert.deepEqual(normalizeDecision(undefined), DEFAULT_DECISION);
  assert.deepEqual(normalizeDecision({ provider: 'jev', plugin: 'tools/jev.mjs', timeoutMs: 500 }), { provider: 'jev', plugin: 'tools/jev.mjs', timeoutMs: 500 });
  assert.deepEqual(normalizeDecision({ plugin: 'tools/jev.mjs' }), { provider: null, plugin: 'tools/jev.mjs', timeoutMs: 3000 }, 'a plugin with no provider named means that plugin');
  assert.deepEqual(normalizeDecision({ provider: 'off' }), { provider: 'off', plugin: null, timeoutMs: 3000 });
  for (const [bad, pattern] of [
    ['jev', /mapping/], [[], /mapping/], [{ provider: 'Jev Model' }, /decision\.provider/], [{ provider: 3 }, /decision\.provider/],
    [{ plugin: 3 }, /decision\.plugin/], [{ plugin: '  ' }, /decision\.plugin/], [{ timeoutMs: 5 }, /timeoutMs/], [{ timeoutMs: 60000 }, /timeoutMs/], [{ timeoutMs: 'slow' }, /timeoutMs/],
    [{ provider: 'rules', model: 'big' }, /decision\.model/],
  ]) assert.throws(() => normalizeDecision(bad), pattern, JSON.stringify(bad));
  assert.deepEqual(loadConfig(project()).decision, DEFAULT_DECISION, 'no decision block: the default');
  assert.deepEqual(loadConfig(project({ decision: { provider: 'jev', plugin: 'tools/jev.mjs' } })).decision, { provider: 'jev', plugin: 'tools/jev.mjs', timeoutMs: 3000 });
});

test('rules is deterministic and frozen: the same summary gives the same answer every time, with no model', async () => {
  const s = summary();
  const first = JSON.stringify(await suggest(s));
  for (let i = 0; i < 20; i += 1) assert.equal(JSON.stringify(await suggest(s)), first);
  assert.deepEqual(JSON.parse(first), { option: 'entity', reason: 'first available step', runnerUp: 'ui-part', provider: 'rules', version: '1' });
  assert.equal(Object.isFrozen(getDecisionProvider('rules')), true);
  const decision = await openDecision(project());
  assert.deepEqual([decision.provider, decision.requested, decision.fellBackFrom, decision.notes], [{ name: 'rules', version: '1' }, 'rules', null, []]);
  assert.equal(JSON.stringify(await decision.suggest(s)), first);
});

test('a plugin loads only when named: with provider rules or off its file is never imported', async () => {
  const marker = (name) => `globalThis.__decision633 = [...(globalThis.__decision633 ?? []), ${JSON.stringify(name)}];\n`;
  for (const provider of ['rules', 'off']) {
    const root = project({ decision: { provider, plugin: 'tools/jev.mjs' }, plugins: { 'tools/jev.mjs': marker(provider) + GOOD } });
    const decision = await openDecision(root);
    assert.equal(decision.provider.name, provider);
    assert.equal(globalThis.__decision633, undefined, `${provider}: the plugin file was not imported`);
  }
  const named = project({ decision: { provider: 'jev', plugin: 'tools/jev.mjs' }, plugins: { 'tools/jev.mjs': marker('named') + GOOD } });
  const decision = await openDecision(named);
  assert.deepEqual(globalThis.__decision633, ['named'], 'named, so imported once');
  assert.deepEqual(decision.provider, { name: 'jev', version: '0.1' });
  assert.equal(await (await openDecision(project({ decision: { provider: 'off' } }))).suggest(summary()), null, 'off never suggests');
});

test('a plugin from architecture.yml suggests through the contract: option, reason, score, runner-up, its name and version', async () => {
  const lines = [];
  const root = project({ decision: { provider: 'jev', plugin: 'tools/jev.mjs' }, plugins: { 'tools/jev.mjs': GOOD } });
  const decision = await openDecision(root, { log: (l) => lines.push(l) });
  assert.deepEqual(await decision.suggest(summary()), { option: 'ui-part', reason: 'It looks like a screen word.', runnerUp: 'entity', provider: 'jev', version: '0.1', score: 0.9 });
  assert.equal(decision.fellBackFrom, null);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /loaded provider "jev" version 0\.1/);
  assert.deepEqual(decision.notes, lines);
  const bare = await openDecision(project({ decision: { plugin: 'tools/jev.mjs' }, plugins: { 'tools/jev.mjs': GOOD } }));
  assert.equal(bare.provider.name, 'jev', 'no provider named: the plugin\'s own name applies');
});

test('containment: an absolute path, a path that leaves the project, a link that points out, a missing file, a directory and a wrong extension are refused, never imported', async () => {
  const root = project({ plugins: { 'ok.mjs': GOOD, 'dir.mjs/index.mjs': GOOD, 'notes.txt': 'x' } });
  const outside = makeTempDir('og633-outside-');
  fs.writeFileSync(path.join(outside, 'evil.mjs'), `globalThis.__decision633 = 'ran';\n${GOOD}`);
  fs.symlinkSync(path.join(outside, 'evil.mjs'), path.join(root, 'link.mjs'));
  fs.symlinkSync(outside, path.join(root, 'linkdir'));
  const cases = [
    [path.join(outside, 'evil.mjs'), 'PLUGIN_PATH_INVALID'],
    [`../${path.basename(outside)}/evil.mjs`, 'PLUGIN_OUTSIDE_PROJECT'],
    ['../../../../etc/passwd', 'PLUGIN_OUTSIDE_PROJECT'],
    ['link.mjs', 'PLUGIN_OUTSIDE_PROJECT'],
    ['linkdir/evil.mjs', 'PLUGIN_OUTSIDE_PROJECT'],
    ['nope.mjs', 'PLUGIN_NOT_FOUND'],
    ['dir.mjs', 'PLUGIN_PATH_INVALID'],
    ['notes.txt', 'PLUGIN_PATH_INVALID'],
    ['', 'PLUGIN_PATH_INVALID'],
  ];
  for (const [file, code] of cases) {
    const r = await loadDecisionPlugin(file, { root, expectName: 'jev' });
    assert.deepEqual([r.ok, r.code], [false, code], `${JSON.stringify(file)}: ${r.message}`);
    assert.equal(r.message.includes(root) || r.message.includes(outside), false, 'the message names no absolute path');
  }
  assert.equal(globalThis.__decision633, undefined, 'the file outside the project was never imported');
  assert.equal((await loadDecisionPlugin('ok.mjs', { root, expectName: 'jev' })).ok, true);
  // Through the project setting: the same refusal, the rules provider answers and the line says why.
  const escaped = project({ decision: { provider: 'jev', plugin: `../${path.basename(outside)}/evil.mjs` } });
  const decision = await openDecision(escaped);
  assert.equal(decision.provider.name, 'rules');
  assert.equal(decision.fellBackFrom, 'jev');
  assert.match(decision.notes[0], /PLUGIN_OUTSIDE_PROJECT/);
  assert.equal(globalThis.__decision633, undefined);
});

test('a plugin that cannot be used costs nothing: a syntax error, no default export, a contract problem or another name falls back to rules with a path-free line', async () => {
  const cases = {
    'syntax.mjs': ['export default {', /PLUGIN_LOAD_FAILED/],
    'nodefault.mjs': ['export const x = 1;', /PLUGIN_NO_PROVIDER/],
    'noversion.mjs': ["export default { name: 'jev', suggest() { return null; } };", /PLUGIN_CONTRACT_INVALID.*version/],
    'builtin.mjs': [pluginSource('return null;', 'rules'), /PLUGIN_CONTRACT_INVALID.*built-in/],
    'other.mjs': [pluginSource('return null;', 'other'), /PLUGIN_NAME_MISMATCH/],
    'throws-on-load.mjs': ["throw new Error('cannot start in /home/someone/secret-place');", /PLUGIN_LOAD_FAILED/],
  };
  for (const [file, [source, pattern]] of Object.entries(cases)) {
    const root = project({ decision: { provider: 'jev', plugin: file }, plugins: { [file]: source } });
    const decision = await openDecision(root);
    assert.deepEqual([decision.provider.name, decision.fellBackFrom], ['rules', 'jev'], file);
    assert.match(decision.notes.join('\n'), pattern, file);
    assert.equal(decision.notes.join('\n').includes(root), false, `${file}: no project path in a line`);
    assert.doesNotMatch(decision.notes.join('\n'), /\/home\/someone/, `${file}: a path inside an error message is hidden`);
    assert.equal((await decision.suggest(summary())).provider, 'rules', `${file}: rules still answer`);
  }
});

test('where plugins are not enabled (a hosted server) the file is not even imported: rules answer and the line says how to enable', async () => {
  const root = project({ decision: { provider: 'jev', plugin: 'tools/jev.mjs' }, plugins: { 'tools/jev.mjs': `globalThis.__decision633 = 'ran';\n${GOOD}` } });
  const decision = await openDecision(root, { allowPlugins: false });
  assert.equal(globalThis.__decision633, undefined);
  assert.deepEqual([decision.provider.name, decision.fellBackFrom], ['rules', 'jev']);
  assert.match(decision.notes[0], /CONSTRUCT_DECISION_PLUGINS=on/);
});

test('a throwing plugin, a slow plugin, junk and an option that is not on the list each fall back to rules, are recorded, and the plugin is not asked again in that request', async () => {
  const cases = {
    throws: ["throw new Error('model down');", /failed \(error: model down\)/],
    slow: ['return new Promise((resolve) => setTimeout(resolve, 1500, { option: "entity", reason: "late" }).unref());', /failed \(timeout: no answer within 60 ms\)/],
    junk: ["return 'entity';", /failed \(invalid/],
    'off-list': ["return { option: 'ignore', reason: 'disabled option' };", /failed \(invalid/],
    'unknown-option': ["return { option: 'teleport', reason: 'not an option at all' };", /failed \(invalid/],
    'no-reason': ["return { option: 'entity' };", /failed \(invalid/],
  };
  for (const [name, [body, pattern]] of Object.entries(cases)) {
    const root = project({ decision: { provider: 'jev', plugin: 'jev.mjs', timeoutMs: 100 }, plugins: { 'jev.mjs': `globalThis.__decision633 = (globalThis.__decision633 ?? 0) + 1;\n${pluginSource(`globalThis.__decision633 += 1; ${body}`)}` } });
    const decision = await openDecision(root, { timeoutMs: name === 'slow' ? 60 : undefined });
    globalThis.__decision633 = 0;
    const first = await decision.suggest(summary());
    assert.deepEqual([first.option, first.provider, first.fellBackFrom], ['entity', 'rules', 'jev'], `${name}: rules answered instead`);
    assert.match(decision.notes.join('\n'), pattern, name);
    assert.equal(decision.fellBackFrom, 'jev');
    const calls = globalThis.__decision633;
    const second = await decision.suggest(summary({ id: 'o2' }));
    assert.equal(second.provider, 'rules');
    assert.equal(globalThis.__decision633, calls, `${name}: not called again after a failure in this request`);
    delete globalThis.__decision633;
  }
});

test('an abstention (null) is not a failure: no suggestion, no fallback, nothing logged', async () => {
  const root = project({ decision: { provider: 'jev', plugin: 'jev.mjs' }, plugins: { 'jev.mjs': pluginSource('return null;') } });
  const decision = await openDecision(root);
  assert.equal(await decision.suggest(summary()), null);
  assert.equal(decision.fellBackFrom, null);
  assert.equal(decision.notes.length, 1, 'only the load line');
});

test('what a plugin receives: one frozen, path-free object with the four fixed fields, and nothing else', async () => {
  const seen = [];
  const source = pluginSource("globalThis.__decision633 = { args: arguments.length, frozen: Object.isFrozen(summary) && Object.isFrozen(summary.options) && Object.isFrozen(summary.options[0]), json: JSON.stringify(summary), keys: Object.keys(summary).sort() }; try { summary.options[0].enabled = false; globalThis.__decision633.mutated = summary.options[0].enabled === false; } catch { globalThis.__decision633.mutated = false; } return { option: 'entity', reason: 'ok' };");
  const root = project({ decision: { provider: 'jev', plugin: 'jev.mjs' }, plugins: { 'jev.mjs': source } });
  const decision = await openDecision(root);
  const dirty = summary({ chosen: null, hidden: '/home/dev/.ssh/id_rsa', entity: 'Invoice', fields: 'id:string', suggestion: { option: 'entity', reason: 'x', provider: 'rules' }, block: 'b1' });
  dirty.options[0].why = 'Read /etc/passwd and ~/.ssh/config or ../../secret.env for details';
  dirty.options[0].path = '/home/dev/project/src/x.ts';
  await decision.suggest(dirty);
  const got = globalThis.__decision633;
  seen.push(got);
  assert.equal(got.args, 1, 'the summary is the only argument');
  assert.equal(got.frozen, true);
  assert.equal(got.mutated, false, 'it cannot change what it was given');
  assert.deepEqual(got.keys, ['chosen', 'id', 'options', 'question']);
  assert.doesNotMatch(got.json, /\/etc|\.ssh|passwd|secret\.env|\/home|hidden|entity":"Invoice|block/);
  assert.match(got.json, /\[path\]/);
  assert.equal(Object.isFrozen(dirty), false, 'the caller\'s own object is left alone');
  assert.equal(dirty.options[0].path, '/home/dev/project/src/x.ts');
});

test('a plugin that tries to read the file the summary points at gets "[path]", not the path, and an error falls back to rules', async () => {
  const source = pluginSource("const fs = process.getBuiltinModule('node:fs'); globalThis.__decision633 = summary.options[0].why; return { option: 'entity', reason: fs.readFileSync(summary.options[0].why, 'utf8').slice(0, 20) || 'empty' };");
  const root = project({ decision: { provider: 'jev', plugin: 'jev.mjs' }, plugins: { 'jev.mjs': source } });
  const decision = await openDecision(root);
  const s = summary();
  s.options[0].why = '/etc/hostname';
  const answer = await decision.suggest(s);
  assert.equal(globalThis.__decision633, '[path]', 'the path was hidden before the plugin saw it');
  assert.deepEqual([answer.provider, answer.fellBackFrom], ['rules', 'jev'], 'reading "[path]" failed, so the rules answered');
});

test('a summary holding a secret is refused before any provider is called', async () => {
  const source = pluginSource("globalThis.__decision633 = 'called'; return { option: 'entity', reason: 'ok' };");
  const root = project({ decision: { provider: 'jev', plugin: 'jev.mjs' }, plugins: { 'jev.mjs': source } });
  const decision = await openDecision(root);
  const leaky = summary();
  leaky.options[0].why = 'api_key=sk_live_abcdefghijklmnop1234';
  assert.equal(await decision.suggest(leaky), null);
  assert.equal(globalThis.__decision633, undefined, 'the plugin was never called');
  assert.equal(providerInput(leaky), null);
  assert.equal(providerInput(summary({ options: Array.from({ length: 6 }, (_, i) => ({ id: `o${i}`, label: 'l', enabled: true, why: 'w' })) })), null, 'more than 5 options');
  assert.equal(providerInput(summary({ question: 'x'.repeat(20000) })), null, 'more than 16 KiB');
  assert.equal((await askProvider(getDecisionProvider('rules'), leaky)).status, 'bad-summary');
  assert.equal(decision.fellBackFrom, null, 'a refused summary is not the plugin failing');
});

test('answers are cached per project, provider, version and summary, so a stateless caller asks the model once per question', async () => {
  const source = pluginSource("globalThis.__decision633 = (globalThis.__decision633 ?? 0) + 1; return { option: 'entity', reason: 'ok' };");
  const root = project({ decision: { provider: 'jev', plugin: 'jev.mjs' }, plugins: { 'jev.mjs': source } });
  for (let i = 0; i < 3; i += 1) await (await openDecision(root)).suggest(summary());
  assert.equal(globalThis.__decision633, 1, 'three requests, one call');
  await (await openDecision(root)).suggest(summary({ id: 'o2' }));
  assert.equal(globalThis.__decision633, 2, 'another question is another call');
});

test('suggestForQuestions: by question id, with the provider and version; the rules keep an offer\'s own reason; off gives none', async () => {
  const q = (id, extra = {}) => ({ id, question: 'Q?', options: [{ id: 'list', label: 'List', enabled: true, why: 'w' }, { id: 'scaffold', label: 'Scaffold', enabled: true, why: 'w' }], ...extra });
  const questions = [q('q-shape', { suggestion: { option: 'list', reason: 'the data object "products" is plural', provider: 'rules' } }), q('o1')];
  const rules = await suggestForQuestions(await openDecision(project()), questions);
  assert.deepEqual(rules['q-shape'], { option: 'list', reason: 'the data object "products" is plural', runnerUp: 'scaffold', provider: { name: 'rules', version: '1' } });
  assert.equal(rules.o1.reason, 'first available step');
  assert.deepEqual(await suggestForQuestions(await openDecision(project({ decision: { provider: 'off' } })), questions), {});
  assert.deepEqual(questionSummary(questions[0]).chosen, null);
  const jev = project({ decision: { provider: 'jev', plugin: 'jev.mjs' }, plugins: { 'jev.mjs': pluginSource("return { option: 'scaffold', reason: 'A different view.' };") } });
  const plug = await suggestForQuestions(await openDecision(jev), questions);
  assert.deepEqual(plug['q-shape'], { option: 'scaffold', reason: 'A different view.', runnerUp: null, provider: { name: 'jev', version: '0.1' } }, 'a plugin\'s own reason, not the offer\'s');
});

test('an unknown provider name with no plugin, and an unreadable setting, fall back to rules with a line', async () => {
  const none = await openDecision(project(), { provider: 'jev' });
  assert.deepEqual([none.provider.name, none.fellBackFrom], ['rules', 'jev']);
  assert.match(none.notes[0], /no provider named "jev"/);
  const broken = makeTempDir('og633-broken-');
  fs.writeFileSync(path.join(broken, 'architecture.yml'), 'decision:\n  timeoutMs: 5\n');
  const d = await openDecision(broken);
  assert.equal(d.provider.name, 'rules');
  assert.match(d.notes[0], /architecture\.yml could not be read/);
});
