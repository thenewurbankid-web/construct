// cl1 -- Line describes itself from its code: `construct line spec` and the MCP tool `line_spec` (packages/engine/line/
// spec.mjs). The spec is generated (never hand-written), versioned by a hash of its content, and changes exactly when
// the code it is read from changes: a rule, a command, a tool schema or a module's exports.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { buildLineSpec, sliceSpec, moduleContract } from '../packages/engine/line/spec.mjs';
import { lineToolSpecs, createLinePlanRegistry } from '../packages/engine/line/planTools.mjs';
import { assertLineSpec, SPEC_TOPICS, LINE_PLAN_TOOLS } from '../packages/engine/line/contract.mjs';
import { LINE_RULES } from '../packages/core/profiles/line/contract.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(REPO, 'examples/line-sample');
const spec = await buildLineSpec();

test('spec: fits the contract, has every topic, and the same code gives the same version', async () => {
  assertLineSpec(spec);
  assert.deepEqual(Object.keys(spec.topics), [...SPEC_TOPICS]);
  assert.equal((await buildLineSpec()).version, spec.version, 'deterministic');
  assert.throws(() => assertLineSpec({ ...spec, version: 'v1' }), /16 hex/);
  assert.throws(() => assertLineSpec({ ...spec, topics: { prose: [] } }), /not a topic/);
});

test('spec: adding a rule changes the version and the rules topic, and nothing else', async () => {
  const added = { ...LINE_RULES, 'LINE-NEW': { id: 'LINE-NEW', defaultSeverity: 'error', why: 'A new rule exists so this test can see it.', expected: ['nothing'], check: 'None.' } };
  const next = await buildLineSpec({ sources: { lineRules: added } });
  assert.notEqual(next.version, spec.version);
  assert.ok(next.topics.rules.some((r) => r.id === 'LINE-NEW'));
  for (const t of SPEC_TOPICS.filter((x) => x !== 'rules')) assert.deepEqual(next.topics[t], spec.topics[t], `${t} did not change`);
  assert.equal((await buildLineSpec({ sources: { lineRules: LINE_RULES } })).version, spec.version, 'taking it out again gives the old version');
});

test('spec: a new command or a changed tool schema changes the commands topic and the version', async () => {
  const cmds = spec.topics.commands.construct;
  const more = await buildLineSpec({ sources: { commands: [...cmds, { name: 'brand-new', tool: 'construct.brandNew', kind: 'write', summary: 'New.', args: { type: 'object' } }] } });
  assert.notEqual(more.version, spec.version);
  const tools = lineToolSpecs().map((t) => (t.name === 'line.promote' ? { ...t, args: { ...t.args, required: [...t.args.required, 'extra'] } } : t));
  assert.notEqual((await buildLineSpec({ sources: { lineTools: tools } })).version, spec.version);
});

test('invariant: every line tool in the spec is the registry\'s tool, and its JSON Schema accepts and refuses what the registry does', () => {
  const reg = createLinePlanRegistry({ root: SAMPLE });
  const byName = new Map(reg.list().map((t) => [t.name, t]));
  assert.deepEqual(spec.topics.commands.line.map((t) => t.name).sort(), LINE_PLAN_TOOLS.map((t) => t.name).sort());
  for (const t of spec.topics.commands.line) {
    const real = byName.get(t.name);
    assert.equal(t.kind, real.kind, t.name);
    const full = Object.fromEntries(Object.entries(t.args.properties).filter(([k]) => !['expect', 'retry', 'fixOf'].includes(k)).map(([k, s]) => [k, s.enum ? s.enum[0] : 'x']));
    assert.equal(real.schema.safeParse(full).success, true, `${t.name} accepts every field its schema lists`);
    for (const k of t.args.required) {
      const { [k]: _gone, ...without } = full;
      assert.equal(real.schema.safeParse(without).success, false, `${t.name} refuses a request without ${k}`);
    }
    assert.equal(real.schema.safeParse({ ...full, notAField: 1 }).success, false, `${t.name} refuses an unknown field (additionalProperties false)`);
  }
});

test('spec: the modules topic is read from the source, so a new export changes it', async () => {
  const engine = spec.topics.modules.find((m) => m.module === 'line-engine');
  assert.ok(engine.files.find((f) => f.file.endsWith('/planService.mjs')).exports.includes('createLinePlanService'));
  assert.ok(engine.files.find((f) => f.file.endsWith('/spec.mjs')).header.startsWith('cl1 -- Line describes itself'));
  const repo = makeTempDir('line-spec-repo-');
  fs.mkdirSync(path.join(repo, 'packages/engine/line'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'packages/engine/line/a.mjs'), '// A module.\nexport function one() {}\n');
  const before = await buildLineSpec({ repo });
  fs.appendFileSync(path.join(repo, 'packages/engine/line/a.mjs'), 'export const two = 2;\n');
  const after = await buildLineSpec({ repo });
  assert.notEqual(after.version, before.version);
  assert.deepEqual(moduleContract(path.join(repo, 'packages/engine/line/a.mjs')), { header: 'A module.', exports: ['one', 'two'] });
});

test('slice: one topic keeps the spec version; an id narrows it; an unknown topic is one plain sentence', () => {
  const s = sliceSpec(spec, 'rules', 'line-dir');
  assert.equal(s.version, spec.version);
  assert.deepEqual(s.topics.rules.map((r) => r.id), ['LINE-DIR']);
  assert.deepEqual(Object.keys(sliceSpec(spec, 'plan').topics), ['plan']);
  assert.ok(sliceSpec(spec, 'modules', 'planService').topics.modules.every((m) => m.files.length));
  assert.throws(() => sliceSpec(spec, 'prose'), /^Error: "prose" is not a spec topic; the topics are rules, commands, plan, model, modules\.$/);
  for (const t of SPEC_TOPICS) assert.ok(Buffer.byteLength(JSON.stringify(sliceSpec(spec, t))) < 32 * 1024, `${t} fits one MCP call`);
});

test('CLI: construct line spec --topic rules --id LINE-DIR prints the slice as JSON', () => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'packages/cli/construct.mjs'), 'line', 'spec', '--topic', 'rules', '--id', 'LINE-DIR'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.version, spec.version);
  assert.equal(out.topics.rules[0].id, 'LINE-DIR');
  const bad = spawnSync(process.execPath, [path.join(REPO, 'packages/cli/construct.mjs'), 'line', 'spec', '--topic', 'prose'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /"prose" is not a spec topic/);
});
