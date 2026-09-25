// #649 -- what the tools must never do: write, leave the project root, leak a path or a secret, exceed their caps or their rate,
// or answer a bad call with anything but a typed error. Every check runs through the SDK's in-process client on a real project.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { LIMITS, DEFAULT_RATE_PER_MINUTE } from '../src/limits.mjs';
import { createConstructMcpServer } from '../src/server.mjs';
import { makeProject, hashTree, connectInProcess, callTool } from '../test-utils/harness.mjs';

const SENTENCE = 'A user wants to see a list of products';
const stateDir = makeTempDir('construct-mcp-safety-state-');
process.env.CONSTRUCT_STATE_DIR = stateDir;
delete process.env.CONSTRUCT_DECISION_PLUGINS;

const SUMMARY = { id: 'q-x', question: 'Which shape?', options: [{ id: 'list', label: 'List', enabled: true, why: 'many' }, { id: 'scaffold', label: 'Scaffold', enabled: true, why: 'empty' }] };
const PLAN = { version: 1, ticket: { source: 'text', title: 'x' }, steps: [{ id: 's1', title: 'Create feature x', flow: 'create.feature', args: { name: 'x' } }] };

/** One call of every tool, with a few inputs each, good and bad: the widest surface a "does it write" test can cover. */
const EVERYTHING = [
  ['requirement_parse', { text: SENTENCE }],
  ['requirement_parse', { text: 'A user can frobnicate the widget' }],
  ['placement_place', { text: SENTENCE }],
  ['placement_place', { text: SENTENCE, answers: [{ id: 'q-shape', option: 'list' }, { id: 'q-dependency', option: 'add-dependency' }] }],
  ['placement_place', { text: 'A user can edit the profile name', answers: [{ id: 'q-shape', option: 'form' }] }],
  ['placement_place', { text: 'A user can frobnicate the widget' }],
  ['plan_validate', { plan: PLAN }],
  ['plan_validate', { plan: { version: 9 } }],
  ['decide', { summary: SUMMARY }],
  ['decide', { text: SENTENCE }],
  ['summarize', {}],
  ['summarize', { feature: 'billing' }],
  ['summarize', { feature: 'nope' }],
  ['summarize', { backend: true }],
  ['validate', {}],
  ['validate', { limit: 2 }],
  ['machine_capabilities', {}],
  ['traces_stats', {}],
  ['traces_stats', { chooser: 'q-shape' }],
];

const project = (files = {}) => makeProject({ files: { 'features/billing/domain/Invoice.domain.ts': 'export type Invoice = { id: string };\n', ...files } });

test('no tool writes: the project tree and the state directory are byte-identical after every tool ran, good input and bad', async () => {
  const root = project();
  const { client, close } = await connectInProcess({ root, ratePerMinute: 600 });
  const before = { project: hashTree(root), state: hashTree(stateDir) };
  for (const [name, args] of EVERYTHING) await callTool(client, name, args);
  for (const [name, args] of EVERYTHING) await callTool(client, name, args); // twice: a second call must not find or leave anything either
  await close();
  assert.equal(hashTree(root), before.project, 'the project is byte-identical');
  assert.equal(hashTree(stateDir), before.state, 'no decision trace was recorded: no tool records a choice');
});

test('no write path exists in the source: no file write, no process, no network', () => {
  const src = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src');
  const forbidden = /\b(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|rmSync|rm\(|rename|renameSync|unlink|unlinkSync|copyFile|copyFileSync|symlinkSync|truncate|createWriteStream|utimes|chmod)\b|node:(child_process|http|https|net|dgram|dns|tls|worker_threads|cluster)|\bfetch\(|\bXMLHttpRequest\b|\bexecSync\b|\bspawn(Sync)?\(/;
  for (const file of fs.readdirSync(src)) {
    const code = fs.readFileSync(path.join(src, file), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.doesNotMatch(code, forbidden, `${file} must not write, spawn or use the network`);
  }
});

test('a path outside the root is refused: "..", an absolute path, a drive, "~", a separator', async () => {
  const root = project();
  const { client, close } = await connectInProcess({ root });
  for (const feature of ['..', '../..', '../etc', '/etc', '/etc/passwd', 'a/b', 'a\\b', 'C:\\Windows', '~', '~/x', '.']) {
    const r = await callTool(client, 'summarize', { feature });
    assert.equal(r.isError, true, feature);
    assert.equal(r.body.error.code, 'PATH_OUTSIDE_ROOT', feature);
  }
  const bad = await callTool(client, 'summarize', { feature: '9lives' });
  assert.equal(bad.body.error.code, 'INVALID_INPUT', 'a name that is not a path but not a name either is invalid input');
  await close();
});

test('a plan that names a path outside the root is refused before it is checked', async () => {
  const root = project();
  const { client, close } = await connectInProcess({ root });
  const withFile = (p) => ({ ...PLAN, steps: [{ ...PLAN.steps[0], touches: { features: ['x'], files: [{ path: p, change: 'create' }] } }] });
  for (const p of ['../../etc/passwd', '/etc/passwd', 'features/../../x', '~/.ssh/id_rsa', 'C:\\x\\y']) {
    const r = await callTool(client, 'plan_validate', { plan: withFile(p) });
    assert.equal(r.body.error?.code, 'PATH_OUTSIDE_ROOT', p);
  }
  const byArg = await callTool(client, 'plan_validate', { plan: { ...PLAN, steps: [{ ...PLAN.steps[0], args: { name: 'x', path: '/etc' } }] } });
  assert.equal(byArg.body.error.code, 'PATH_OUTSIDE_ROOT');
  const route = await callTool(client, 'plan_validate', { plan: { ...PLAN, steps: [{ id: 's1', title: 'r', flow: 'create.route', args: { name: 'X', feature: 'x', route: '/products' } }] } });
  assert.notEqual(route.body.error?.code, 'PATH_OUTSIDE_ROOT', 'a route such as /products is not a file path');
  await close();
});

test('a link that leaves the root is refused by every tool that reads the project, and the ones that read nothing still answer', async () => {
  const outside = makeTempDir('construct-mcp-outside-');
  fs.writeFileSync(path.join(outside, 'Secret.domain.ts'), 'export const TOKEN = "outside";\n');
  const linkedDir = project();
  fs.mkdirSync(path.join(linkedDir, 'features'), { recursive: true });
  fs.symlinkSync(outside, path.join(linkedDir, 'features', 'leak'));
  const linkedFile = project();
  fs.symlinkSync(path.join(outside, 'Secret.domain.ts'), path.join(linkedFile, 'features', 'billing-leak.ts'));
  const linkedConfig = project();
  fs.rmSync(path.join(linkedConfig, 'architecture.yml'));
  fs.writeFileSync(path.join(outside, 'architecture.yml'), 'version: 1\n');
  fs.symlinkSync(path.join(outside, 'architecture.yml'), path.join(linkedConfig, 'architecture.yml'));

  for (const root of [linkedDir, linkedFile, linkedConfig]) {
    const { client, close } = await connectInProcess({ root });
    const before = hashTree(root);
    for (const [name, args] of [['summarize', {}], ['summarize', { feature: 'leak' }], ['summarize', { backend: true }], ['validate', {}], ['placement_place', { text: SENTENCE }], ['decide', { text: SENTENCE }], ['traces_stats', {}]]) {
      const r = await callTool(client, name, args);
      assert.equal(r.isError, true, `${name} ${JSON.stringify(args)}`);
      assert.equal(r.body.error.code, 'PATH_OUTSIDE_ROOT', `${name} ${JSON.stringify(args)}`);
      assert.doesNotMatch(r.text, /construct-mcp-outside|outside"/, 'the refusal names the link inside the project, never its target');
    }
    for (const [name, args] of [['requirement_parse', { text: SENTENCE }], ['plan_validate', { plan: PLAN }], ['machine_capabilities', {}]]) {
      assert.equal((await callTool(client, name, args)).isError, false, `${name} reads nothing from the project`);
    }
    assert.equal(hashTree(root), before);
    await close();
  }

  const inside = project();
  fs.symlinkSync(path.join(inside, 'features', 'billing'), path.join(inside, 'features', 'invoices'));
  const { client, close } = await connectInProcess({ root: inside });
  assert.equal((await callTool(client, 'summarize', {})).isError, false, 'a link that stays inside the project is fine');
  await close();
});

test('the root is fixed at startup: a missing directory, a file, the file system root and the home directory are refused', () => {
  assert.throws(() => createConstructMcpServer({ root: path.join(os.tmpdir(), 'construct-mcp-does-not-exist') }), /does not exist/);
  const file = path.join(makeTempDir('construct-mcp-file-'), 'f.txt');
  fs.writeFileSync(file, 'x');
  assert.throws(() => createConstructMcpServer({ root: file }), /not a directory/);
  assert.throws(() => createConstructMcpServer({ root: '/' }), /too wide/);
  assert.throws(() => createConstructMcpServer({ root: os.homedir() }), /too wide/);
});

test('nothing that leaves a tool holds the project path, the home or temp directory, or a secret', async () => {
  const secret = 'sk-live-0123456789abcdefghijklmnop';
  const root = project({ '.env': `API_KEY=${secret}\n`, 'features/billing/domain/Notes.domain.ts': `// token=${secret}\nexport type Note = { id: string };\n` });
  const env = { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-api03-ENVSECRETENVSECRETENVSECRET' };
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  const { client, close } = await connectInProcess({ root, ratePerMinute: 600 });
  const all = [];
  for (const [name, args] of [...EVERYTHING, ['requirement_parse', { text: `The key is ${secret} for /home/someone/notes` }], ['decide', { summary: { ...SUMMARY, question: `Read ${root}/architecture.yml or ${secret}?` } }]]) all.push((await callTool(client, name, args)).text);
  await close();
  if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = saved;
  const text = all.join('\n');
  for (const needle of [root, os.homedir(), os.tmpdir(), stateDir, secret, 'ENVSECRET', '/home/someone']) assert.equal(text.includes(needle), false, `output must not contain ${needle}`);
  assert.doesNotMatch(text, /(^|[^\w.-])\/(home|Users|tmp|var|etc|root)\//, 'no absolute system path');
  assert.doesNotMatch(text, /\n\s+at .*\(.*:\d+:\d+\)/, 'no stack trace');
});

test('a result larger than the cap is refused, whole, with a typed error; the cap is 32 KiB and cannot be raised', async () => {
  assert.equal(LIMITS.outputBytes, 32768);
  const root = project();
  const small = await connectInProcess({ root, maxOutputBytes: 300 });
  const refused = await callTool(small.client, 'placement_place', { text: SENTENCE });
  await small.close();
  assert.equal(refused.isError, true);
  assert.equal(refused.body.error.code, 'OUTPUT_TOO_LARGE');
  assert.ok(Buffer.byteLength(refused.text) <= 600, 'the refusal itself is small');
  JSON.parse(refused.text);

  // Many findings: validate lists at most LIMITS.findings of them and stays under the cap however many there are.
  const files = {};
  for (let i = 0; i < 150; i += 1) files[`features/many/domain/D${i}.domain.ts`] = `import { X } from '../../missing/${'long-directory-name/'.repeat(4)}m${i}';\nexport type D${i} = { id: string };\n`;
  const noisy = project(files);
  const big = await connectInProcess({ root: noisy, maxOutputBytes: 10 ** 9 });
  const r = await callTool(big.client, 'validate', { limit: 50 });
  await big.close();
  assert.equal(r.isError, false);
  assert.ok(r.body.counts.total > 100, `many findings: ${r.body.counts.total}`);
  assert.ok(r.body.findings.length <= LIMITS.findings);
  assert.equal(r.body.truncated, true);
  assert.ok(Buffer.byteLength(r.text) <= LIMITS.outputBytes, `${Buffer.byteLength(r.text)} bytes`);
});

test('input caps: a sentence, a plan and an answer list past their limits are refused as typed invalid input', async () => {
  const root = project();
  const { client, close } = await connectInProcess({ root, ratePerMinute: 600 });
  const long = await callTool(client, 'requirement_parse', { text: 'x'.repeat(LIMITS.textChars + 1) });
  assert.equal(long.body.error.code, 'INVALID_INPUT');
  const answers = Array.from({ length: LIMITS.answers + 1 }, (_, i) => ({ id: `o${i}`, option: 'ignore' }));
  assert.equal((await callTool(client, 'placement_place', { text: SENTENCE, answers })).body.error.code, 'INVALID_INPUT');
  const steps = Array.from({ length: 300 }, (_, i) => ({ id: `s${i}`, title: 't', flow: 'create.feature', args: { name: `f${i}` } }));
  assert.equal((await callTool(client, 'plan_validate', { plan: { ...PLAN, steps } })).body.error.code, 'INVALID_INPUT');
  const fat = { ...PLAN, ticket: { source: 'text', title: 'y'.repeat(LIMITS.planBytes) } };
  assert.equal((await callTool(client, 'plan_validate', { plan: fat })).body.error.code, 'INVALID_INPUT');
  await close();
});

test('invalid input is a typed error, never a stack trace', async () => {
  const root = project();
  const { client, close } = await connectInProcess({ root, ratePerMinute: 600 });
  const bad = [
    ['requirement_parse', {}],
    ['requirement_parse', { text: 5 }],
    ['requirement_parse', { text: '' }],
    ['placement_place', { text: SENTENCE, answers: [{ id: '../x', option: 'list' }] }],
    ['placement_place', { text: SENTENCE, answers: [{ id: 'q-shape', option: 'List Shape!' }] }],
    ['placement_place', { text: SENTENCE, answers: [{ id: 'q-shape', option: 'list', extra: 1 }] }],
    ['plan_validate', { plan: 'not an object' }],
    ['plan_validate', {}],
    ['decide', { summary: { id: 'x' } }],
    ['summarize', { feature: 7 }],
    ['summarize', { backend: 'yes' }],
    ['validate', { limit: 0 }],
    ['validate', { limit: 1.5 }],
    ['validate', { limit: 'many' }],
    ['traces_stats', { chooser: '' }],
  ];
  for (const [name, args] of bad) {
    const r = await callTool(client, name, args);
    assert.equal(r.isError, true, `${name} ${JSON.stringify(args)}`);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error.code, 'INVALID_INPUT', `${name} ${JSON.stringify(args)}`);
    assert.ok(typeof r.body.error.message === 'string' && r.body.error.message.length > 0 && r.body.error.message.length <= 400);
    assert.doesNotMatch(r.text, /\n\s+at |node_modules|\.mjs:\d+/, 'no stack trace or source location');
  }
  await assert.rejects(client.callTool({ name: 'no_such_tool', arguments: {} }), (e) => !/\n\s+at /.test(e.message));
  await close();
});

test('rate limit: a token bucket of 30 calls a minute by default, configurable, refilling with time', async () => {
  assert.equal(DEFAULT_RATE_PER_MINUTE, 30);
  const root = project();
  let clock = 1_000_000;
  const { client, close } = await connectInProcess({ root, ratePerMinute: 3, now: () => clock });
  for (let i = 0; i < 3; i += 1) assert.equal((await callTool(client, 'machine_capabilities')).isError, false);
  const limited = await callTool(client, 'machine_capabilities');
  assert.equal(limited.isError, true);
  assert.equal(limited.body.error.code, 'RATE_LIMITED');
  assert.equal(limited.body.error.retryAfterSeconds, 20);
  assert.equal((await callTool(client, 'requirement_parse', { text: SENTENCE })).body.error.code, 'RATE_LIMITED', 'one bucket for every tool');
  clock += 21_000;
  assert.equal((await callTool(client, 'machine_capabilities')).isError, false, 'a token came back');
  assert.equal((await callTool(client, 'machine_capabilities')).body.error.code, 'RATE_LIMITED');
  await close();

  const dflt = await connectInProcess({ root, now: () => clock });
  let ok = 0;
  for (let i = 0; i < 31; i += 1) if (!(await callTool(dflt.client, 'machine_capabilities')).isError) ok += 1;
  await dflt.close();
  assert.equal(ok, 30);
});
