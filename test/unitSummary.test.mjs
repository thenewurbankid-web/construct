import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import Ajv from 'ajv'; // draft-07 validator (transitive dev dependency via eslint)
import {
  summarizeUnit, resolveUnit, listUnits, listFeatures, summarizeFeatureForAgents, unitApiManifest,
  renderUnitMarkdown, TOKEN_BUDGETS, SCHEMA_VERSION,
} from '../packages/engine/unitSummary.mjs';
import { createUnitRegistry, defaultUnitRegistry } from '../packages/engine/units/registry.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = path.join(REPO, 'example');
const GOLDEN_DIR = path.join(REPO, 'test', 'golden', 'unit-summary');
const schema = JSON.parse(fs.readFileSync(path.join(REPO, 'schemas', 'unit-summary.v1.json'), 'utf8'));
const validate = new Ajv({ allErrors: true }).compile(schema);
const assertSchema = (v, label = '') => assert.ok(validate(v), `${label} schema errors: ${JSON.stringify(validate.errors)}`);

// One golden per unit kind, on real code (the example app; the invalid fixture for a rule with violations).
const CASES = [
  ['project', EXAMPLE, '.', 'standard'],
  ['feature', EXAMPLE, 'feature:login', 'standard'],
  ['feature-brief', EXAMPLE, 'login', 'brief'],
  ['feature-full', EXAMPLE, 'feature:login', 'full'],
  ['layer', EXAMPLE, 'layer:login/hook', 'standard'],
  ['file', EXAMPLE, 'file:features/login/index.ts', 'standard'],
  ['component', EXAMPLE, 'component:features/login/components/Login.tsx', 'standard'],
  ['hook', EXAMPLE, 'useLogin', 'standard'],
  ['service', EXAMPLE, 'service:features/login/services/Login.tsx', 'standard'],
  ['domain', EXAMPLE, 'domain:features/login/domain/Login.tsx', 'standard'],
  ['page', EXAMPLE, 'LoginPage', 'standard'],
  ['controller', EXAMPLE, 'LoginController', 'standard'],
  ['workflow', EXAMPLE, 'workflow:features/login/workflows/Login.tsx', 'full'],
  ['export', EXAMPLE, 'features/login/hooks/useLogin.tsx#useLogin', 'standard'],
  ['route', EXAMPLE, '/login', 'standard'],
  ['package', EXAMPLE, 'features/login', 'standard'],
  ['rule', EXAMPLE, 'rule:PAGE-001', 'standard'],
  ['rule-violations', path.join(REPO, 'fixtures', 'architecture-invalid'), 'rule:PAGE-003', 'standard'],
  ['envelope', EXAMPLE, 'envelope', 'standard'],
];

for (const [name, root, ref, detail] of CASES) {
  test(`golden: ${name} (${detail})`, () => {
    const r = summarizeUnit(root, ref, { detail });
    assert.equal(r.ok, true, JSON.stringify(r));
    assertSchema(r, name);
    const text = JSON.stringify(r, null, 2) + '\n';
    const file = path.join(GOLDEN_DIR, `${name}.json`);
    if (process.env.UPDATE_GOLDEN) { fs.mkdirSync(GOLDEN_DIR, { recursive: true }); fs.writeFileSync(file, text); }
    assert.equal(text, fs.readFileSync(file, 'utf8'), `${name} drifted; run UPDATE_GOLDEN=1 node --test test/unitSummary.test.mjs if intended`);
  });
}

test('generator summary is structural (its module is Construct source, so no golden)', () => {
  const r = summarizeUnit(EXAMPLE, 'generator:workflow', { detail: 'standard' });
  assert.equal(r.ok, true);
  assertSchema(r);
  assert.equal(r.kind, 'generator');
  assert.match(r.sections.generator.cli, /construct create workflow/);
  assert.ok(r.sections.exports.some((e) => e.name === 'generateWorkflow'));
});

test('determinism: same input gives byte-identical output, across fresh calls', () => {
  for (const ref of ['login', 'signup', '/login', 'useLogin', 'PAGE-001', '.']) {
    for (const detail of ['brief', 'standard', 'full']) {
      const a = JSON.stringify(summarizeUnit(EXAMPLE, ref, { detail, kind: ref === 'login' || ref === 'signup' ? 'feature' : undefined }));
      const b = JSON.stringify(summarizeUnit(EXAMPLE, ref, { detail, kind: ref === 'login' || ref === 'signup' ? 'feature' : undefined }));
      assert.equal(a, b, `${ref}/${detail}`);
    }
  }
});

test('token budgets: every listed unit fits its detail budget (brief ~500 tokens)', () => {
  const kinds = listUnits(EXAMPLE).kinds.map((k) => k.kind);
  let n = 0;
  for (const kind of kinds) {
    for (const u of listUnits(EXAMPLE, { kind }).units.slice(0, 6)) {
      for (const detail of ['brief', 'standard', 'full']) {
        const r = summarizeUnit(EXAMPLE, u.ref, { detail });
        if (!r.ok) { assert.equal(r.error.code, 'UNIT_AMBIGUOUS', u.ref); continue; }
        assertSchema(r, u.ref);
        assert.ok(!r.budget.exceeded, `${u.ref} ${detail} exceeded budget`);
        assert.ok(r.budget.estimatedTokens <= TOKEN_BUDGETS[detail], `${u.ref} ${detail}: ${r.budget.estimatedTokens}`);
        n++;
      }
    }
  }
  assert.ok(n > 50);
});

test('detail levels are monotonic in size and `include` filters sections', () => {
  const size = (d) => JSON.stringify(summarizeUnit(EXAMPLE, 'feature:login', { detail: d })).length;
  assert.ok(size('brief') < size('standard') && size('standard') < size('full'));
  const r = summarizeUnit(EXAMPLE, 'feature:login', { detail: 'standard', include: ['layers', 'workflows'] });
  assert.deepEqual(Object.keys(r.sections), ['layers', 'workflows']);
  assert.ok(r.health && r.next);
});

test('feature summary reports layers, contracts, data flow, machines in plain English, routes and tests', () => {
  const r = summarizeUnit(EXAMPLE, 'feature:login', { detail: 'standard' });
  assert.deepEqual(r.sections.layers.missing, []);
  assert.deepEqual(r.sections.contracts.routes.map((x) => x.route), ['/login']);
  assert.ok(r.sections.dataFlow.layers.some((e) => e.from === 'hook' && e.to === 'workflow'));
  assert.match(r.sections.workflows[0].summary, /flow has 3 steps/);
  assert.equal(r.sections.contracts.hooks[0], 'useLogin()');
});

test('listFeatures / listUnits / summarizeFeatureForAgents', () => {
  const lf = listFeatures(EXAMPLE);
  assert.deepEqual(lf.features.map((f) => f.name), ['core', 'login', 'signup']);
  assertSchema(lf);
  const lu = listUnits(EXAMPLE);
  assertSchema(lu);
  assert.ok(lu.kinds.find((k) => k.kind === 'hook').count >= 2);
  assert.equal(summarizeFeatureForAgents(EXAMPLE, 'login', { detail: 'brief' }).kind, 'feature');
  assert.equal(summarizeFeatureForAgents(EXAMPLE, '/login', { detail: 'brief' }).kind, 'route');
});

test('errors are structured, never thrown: not found, ambiguous, invalid input, traversal, bad root', () => {
  const nf = summarizeUnit(EXAMPLE, 'feature:nope');
  assert.equal(nf.error.code, 'UNIT_NOT_FOUND');
  assertSchema(nf);
  const amb = summarizeUnit(EXAMPLE, 'Login');
  assert.equal(amb.error.code, 'UNIT_AMBIGUOUS');
  assert.ok(amb.error.candidates.length >= 4 && amb.error.candidates.every((c) => c.ref.includes(':')));
  assertSchema(amb);
  assert.equal(summarizeUnit(EXAMPLE, 'login', { detail: 'huge' }).error.code, 'INVALID_ARGUMENT');
  assert.equal(summarizeUnit(EXAMPLE, '').error.code, 'INVALID_ARGUMENT');
  assert.equal(summarizeUnit(EXAMPLE, 'login', { kind: 'bogus' }).error.code, 'UNKNOWN_KIND');
  assert.equal(summarizeUnit(EXAMPLE, 'file:../../etc/passwd').error.code, 'INVALID_ARGUMENT');
  assert.equal(summarizeUnit('/no/such/root', 'x').error.code, 'ROOT_NOT_FOUND');
  assert.equal(summarizeUnit(EXAMPLE, 'login', { include: 'x' }).error.code, 'INVALID_ARGUMENT');
  for (const junk of [null, undefined, 42, {}, [], '\0']) assert.equal(summarizeUnit(EXAMPLE, junk).ok, false);
  assert.equal(resolveUnit(EXAMPLE, 'Login').error.code, 'UNIT_AMBIGUOUS');
  assert.equal(resolveUnit(EXAMPLE, 'login').ref, 'feature:login');
});

test('a symlink pointing outside the project root is not read', () => {
  const root = makeTempDir('construct-units-');
  const outside = path.join(makeTempDir('construct-out-'), 'secret.ts');
  fs.writeFileSync(outside, 'export const SECRET_TOKEN = 1;\n');
  fs.mkdirSync(path.join(root, 'src'));
  fs.symlinkSync(outside, path.join(root, 'src', 'link.ts'));
  const r = summarizeUnit(root, 'file:src/link.ts', { detail: 'full' });
  assert.ok(!JSON.stringify(r).includes('SECRET_TOKEN'));
});

test('registry is pluggable: a custom kind can be registered and addressed', () => {
  const registry = defaultUnitRegistry();
  registry.register({
    kind: 'greeting', description: 'test kind',
    list: () => [{ id: 'hello' }],
    resolve: (ctx, ref) => (ref === 'hello' ? [{ kind: 'greeting', id: 'hello', tier: 1 }] : []),
    summarize: () => ({ name: 'hello', summary: 'A greeting.', sections: { text: 'hi' }, health: { status: 'ok', findings: [] }, links: {}, next: [] }),
  });
  const r = summarizeUnit(EXAMPLE, 'greeting:hello', { registry });
  assert.equal(r.ok, true);
  assertSchema(r);
  assert.throws(() => createUnitRegistry().register({ kind: 'x' }), TypeError);
});

test('markdown rendering and the agent usage manifest', () => {
  const md = renderUnitMarkdown(summarizeUnit(EXAMPLE, 'feature:login', { detail: 'brief' }));
  assert.match(md, /^# feature: login/);
  assert.match(renderUnitMarkdown(summarizeUnit(EXAMPLE, 'Login')), /UNIT_AMBIGUOUS/);
  const m = unitApiManifest();
  assert.equal(m.schemaVersion, SCHEMA_VERSION);
  assert.ok(m.kinds.length >= 17 && m.cli.length && m.rest.length);
});

test('CLI: construct summarize <ref>, --list, --usage, structured errors + exit code, legacy form untouched', () => {
  const run = (...a) => spawnSync(process.execPath, [path.join(REPO, 'packages', 'cli', 'construct.mjs'), ...a], { encoding: 'utf8' });
  const ok = run('summarize', 'login', '--dir', EXAMPLE, '--detail', 'brief');
  assert.equal(ok.status, 0, ok.stderr);
  const parsed = JSON.parse(ok.stdout);
  assertSchema(parsed);
  assert.equal(parsed.ref, 'feature:login');
  assert.equal(JSON.parse(run('summarize', '--list', '--kind', 'feature', '--dir', EXAMPLE).stdout).count, 3);
  assert.ok(JSON.parse(run('summarize', '--usage', '--dir', EXAMPLE).stdout).kinds.length);
  assert.match(run('summarize', 'login', '--dir', EXAMPLE, '--format', 'markdown').stdout, /^# feature: login/);
  const bad = run('summarize', 'Login', '--dir', EXAMPLE);
  assert.equal(bad.status, 2);
  assert.equal(JSON.parse(bad.stdout).error.code, 'UNIT_AMBIGUOUS');
  const legacy = run('summarize', '--dir', EXAMPLE, '--format', 'json');
  assert.equal(legacy.status, 0);
  assert.ok(Array.isArray(JSON.parse(legacy.stdout)) || typeof JSON.parse(legacy.stdout) === 'object');
  assert.ok(!('schemaVersion' in JSON.parse(legacy.stdout)));
});

test('a feature containing a file that does not parse still summarizes (the broken file is listed with its error, not a crash) (#431)', () => {
  const dir = makeTempDir('construct-unitsummary-broken-');
  fs.cpSync(path.join(REPO, 'fixtures', 'impact-shared'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'billing', 'components', 'Broken.tsx'), 'export function Broken( {\n  return <b />;\n\nconst = ;\n');
  const s = summarizeUnit(dir, 'feature:billing');
  assert.equal(s.ok, true, JSON.stringify(s.error));
  assert.ok(s.sections.files.component.some((f) => /parse error/.test(f.error ?? '')), 'the broken file is listed with its parse error');
  const index = listFeatures(dir);
  assert.equal(index.features.find((f) => f.name === 'billing').error, undefined);
});
