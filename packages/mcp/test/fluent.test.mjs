// T5.2 -- line_english and line_atoms through the SDK's in-process client: listed read-only with their schemas, each answers
// for a file and a snippet with what the CLI and the codemod give for the same code, choices are closed, a file outside the
// root is refused, and nothing is written.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { FLUENT_TOOLS } from '../src/server.mjs';
import { FLUENT_LIMITS } from '../src/fluent.mjs';
import { englishView } from '@line/fluent/cli/english.mjs';
import { entryForMcp } from '@line/construct-engine/line/tool-registry';
import { connectInProcess, callTool, hashTree } from '../test-utils/harness.mjs';

process.env.CONSTRUCT_STATE_DIR = makeTempDir('construct-mcp-fluent-state-');
const require = createRequire(import.meta.url);
const NAMES = ['line_english', 'line_atoms'];
const FIXTURE = fs.readFileSync(new URL('../../line-fluent/cli/fixtures/three.js', import.meta.url), 'utf8');
const SNIPPET = 'function f(xs, n) { const ys = xs.filter(x => x > n); return ys.length + 1; }';
const PLUS = '61-74:BinaryExpression +';
let root; let session;
before(async () => {
  root = fs.realpathSync(makeTempDir('construct-mcp-fluent-'));
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'version: 1\npreset: line\n');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/three.js'), FIXTURE);
  fs.writeFileSync(path.join(root, 'src/broken.js'), 'function (\n');
  session = await connectInProcess({ root, ratePerMinute: 600 }, 'claude-code');
});
after(async () => { await session.close(); });
const call = (name, args) => callTool(session.client, name, args);

test('both tools are listed, read-only, each an entry of Line\'s tool registry with an object schema', async () => {
  assert.deepEqual(FLUENT_TOOLS.map((t) => t.name), NAMES);
  const { tools } = await session.client.listTools();
  for (const n of NAMES) {
    const t = tools.find((x) => x.name === n);
    assert.ok(t, n);
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(t.inputSchema.required, undefined, `${n} takes file or code, neither required by the schema`);
    assert.deepEqual([t.annotations.readOnlyHint, t.annotations.destructiveHint, t.annotations.openWorldHint], [true, false, false], n);
    assert.equal(entryForMcp(n)?.kind, 'read', n);
  }
  assert.deepEqual(Object.keys(tools.find((t) => t.name === 'line_atoms').inputSchema.properties).sort(), ['choices', 'code', 'file']);
});

test('line_english: a file and a snippet read exactly as construct english prints them, and the project is unchanged', async () => {
  const before = hashTree(root);
  const file = await call('line_english', { file: 'src/three.js' });
  assert.equal(file.body.ok, true);
  assert.equal(file.body.from, 'src/three.js');
  assert.deepEqual(file.body.functions, englishView(FIXTURE));
  assert.equal(file.body.total, 3);
  assert.equal(file.body.sentence, '3 top-level functions.');
  const snip = await call('line_english', { code: 'export const twice = (n) => n * 2;' });
  assert.deepEqual([snip.body.from, snip.body.functions], ['snippet', [{ name: 'twice', line: 1, english: 'twice using n: return n * 2.' }]]);
  const none = await call('line_english', { code: 'const x = 1;' });
  assert.deepEqual([none.body.total, none.body.functions], [0, []]);
  assert.match(none.body.sentence, /^No top-level function/);
  assert.equal(hashTree(root), before);
});

test('line_english: at most 40 functions, the count says how many there are', async () => {
  const code = Array.from({ length: FLUENT_LIMITS.functions + 5 }, (_, i) => `function f${i}(a) { return a; }`).join('\n');
  const r = await call('line_english', { code });
  assert.deepEqual([r.body.total, r.body.functions.length], [45, 40]);
  assert.equal(r.body.sentence, '45 top-level functions, the first 40 shown.');
});

test('line_atoms: the codemod\'s rewrite over Smith\'s catalog, sites with stable ids, open places as closed choices', async () => {
  const { toAtoms } = require('@line/codemod/atoms-transform.js');
  const { loadCatalog } = require('@line/codemod/atoms-catalog.js');
  const file = require.resolve('@line/smith/package.json').replace(/package\.json$/, 'src/atoms/catalog.json');
  const direct = toAtoms(SNIPPET, { catalog: loadCatalog(file, { runtimeRoot: path.dirname(file) }), kind: 'module', choices: {} });
  const r = await call('line_atoms', { code: SNIPPET });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.code, direct.code);
  assert.deepEqual(r.body.atoms, ['keepWhere', 'lengthOf']);
  assert.deepEqual(r.body.sites, [{ id: '31-52:CallExpression .filter()', atom: 'keepWhere' }, { id: '61-70:MemberExpression .length', atom: 'lengthOf' }]);
  assert.deepEqual(r.body.ambiguous, [{ id: '46-51:BinaryExpression >', alternatives: ['greaterThan', 'isAfter'] }, { id: PLUS, alternatives: ['plus', 'join'] }]);
  assert.deepEqual(r.body.untranslated, { 'ambiguous type': 2 });
  assert.equal(r.body.sentence, '2 rewrites into 2 atoms. 2 places fit several atoms: answer each by id in choices.');
});

test('line_atoms: an answer by id closes that place; an id or atom that was not offered is refused', async () => {
  const r = await call('line_atoms', { code: SNIPPET, choices: { [PLUS]: 'plus' } });
  assert.deepEqual(r.body.atoms, ['keepWhere', 'lengthOf', 'plus']);
  assert.ok(r.body.sites.some((s) => s.id === PLUS && s.atom === 'plus'));
  assert.deepEqual(r.body.ambiguous.map((a) => a.id), ['46-51:BinaryExpression >']);
  assert.match(r.body.code, /return plus\(lengthOf\(ys\), 1\);/);
  const wrongAtom = await call('line_atoms', { code: SNIPPET, choices: { [PLUS]: 'keepWhere' } });
  assert.deepEqual([wrongAtom.isError, wrongAtom.body.error.code], [true, 'ANSWER_REFUSED']);
  assert.match(wrongAtom.body.error.message, /the options are plus, join\.$/);
  const wrongId = await call('line_atoms', { code: SNIPPET, choices: { '0-1:Nope': 'plus' } });
  assert.equal(wrongId.body.error.code, 'ANSWER_REFUSED');
});

test('line_atoms: a file reads like its snippet; code with no atom says so', async () => {
  const f = await call('line_atoms', { file: 'src/three.js' });
  const s = await call('line_atoms', { code: FIXTURE });
  assert.deepEqual({ ...f.body, from: 'snippet' }, s.body);
  assert.equal(f.body.from, 'src/three.js');
  const none = await call('line_atoms', { code: 'function id(a) { return a; }' });
  assert.deepEqual([none.body.atoms, none.body.converted, none.body.sentence], [[], 0, 'Nothing here matches an atom.']);
});

test('both tools refuse: neither or both sources, a path out of the root, a missing file, code that does not parse', async () => {
  for (const name of NAMES) {
    const cases = [
      [{}, 'INVALID_INPUT'],
      [{ file: 'src/three.js', code: 'const a = () => 1;' }, 'INVALID_INPUT'],
      [{ file: '../outside.js' }, 'PATH_OUTSIDE_ROOT'],
      [{ file: '/etc/hosts' }, 'PATH_OUTSIDE_ROOT'],
      [{ file: 'src/missing.js' }, 'NOT_FOUND'],
      [{ file: 'src/broken.js' }, 'PARSE_FAILED'],
    ];
    for (const [args, code] of cases) {
      const r = await call(name, args);
      assert.deepEqual([r.isError, r.body.ok, r.body.error.code], [true, false, code], `${name} ${JSON.stringify(args)}`);
      assert.doesNotMatch(r.body.error.message, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'no absolute path in a refusal');
    }
  }
  const parse = await call('line_english', { file: 'src/broken.js' });
  assert.equal(parse.body.error.message, 'Cannot parse src/broken.js at line 1.');
});
