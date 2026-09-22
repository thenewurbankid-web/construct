// #333 — plan templates (core mechanism). The only template used here is the
// illustrative FIXTURE in test/fixtures/plan-templates; it is not a curated flow.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadTemplate, loadTemplateDir, createTemplateRegistry, instantiate, TemplateError, TEMPLATE_ERROR_CODES as E } from '../packages/engine/planTemplate.mjs';
import { validatePlan, planToCommand } from '../src/plan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const FIXTURES = path.join(here, 'fixtures', 'plan-templates');
const raw = () => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'og-demo-add-feature.json'), 'utf8'));
const registry = () => loadTemplateDir(FIXTURES);
const codeOf = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof TemplateError, String(e)); return e.code; } return null; };

test('an instantiated plan is an ordinary plan.v1 that passes validatePlan and maps to real commands', () => {
  const plan = registry().instantiate('demo.add-feature', { feature: 'checkout', layer: 'hook' });
  assert.equal(validatePlan(plan).valid, true);
  assert.equal(plan.version, 1);
  assert.deepEqual(planToCommand(plan.steps[0]).argv, ['create', 'feature', 'checkout']);
  assert.deepEqual(planToCommand(plan.steps[1]).argv, ['create', 'hook', 'checkout', '--feature', 'checkout']);
});

test('defaults apply and instantiation is byte-identical run to run', () => {
  const a = JSON.stringify(registry().instantiate('demo.add-feature', { feature: 'x' }));
  const b = JSON.stringify(loadTemplateDir(FIXTURES).instantiate('demo.add-feature', { feature: 'x' }));
  assert.equal(a, b);
  assert.match(a, /"layer":"service"/);
  assert.doesNotMatch(a, /createdAt|timestamp|uuid/i);
  // key order of the supplied params does not matter
  const t = loadTemplate(raw());
  assert.equal(JSON.stringify(instantiate(t, { feature: 'x', layer: 'domain' })), JSON.stringify(instantiate(t, { layer: 'domain', feature: 'x' })));
  // instantiating does not mutate the template
  const before = JSON.stringify(t);
  instantiate(t, { feature: 'y' });
  assert.equal(JSON.stringify(t), before);
});

test('each parameter refusal has a named error', () => {
  const t = loadTemplate(raw());
  assert.equal(codeOf(() => instantiate(t, {})), E.PARAM_MISSING);
  assert.equal(codeOf(() => instantiate(t, { feature: 'x', nope: 'y' })), E.PARAM_UNKNOWN);
  assert.equal(codeOf(() => instantiate(t, { feature: 5 })), E.PARAM_TYPE);
  assert.equal(codeOf(() => instantiate(t, { feature: '' })), E.PARAM_INVALID);
  assert.equal(codeOf(() => instantiate(t, { feature: 'has space' })), E.PARAM_INVALID);
  assert.equal(codeOf(() => instantiate(t, { feature: 'x', layer: 'page' })), E.PARAM_ENUM);
  assert.equal(codeOf(() => instantiate(t, 'nope')), E.PARAM_TYPE);
});

test('path parameters: project-relative only (no .., absolute, NUL, leading dash, empty segments)', () => {
  const tpl = raw();
  tpl.parameters.dir = { type: 'path', required: false, example: 'apps/web' };
  tpl.steps[0].args.dir = '{{dir}}';
  const t = loadTemplate(tpl);
  assert.equal(instantiate(t, { feature: 'x', dir: 'apps/web' }).steps[0].args.dir, 'apps/web');
  for (const bad of ['../etc', 'a/../../b', '/etc/passwd', 'C:\\x', 'C:/x', 'a\0b', '-rf', 'a/-b', 'a//b', './a', 'a/', 'a b', '~/x', 'a;b', '$(id)']) {
    assert.equal(codeOf(() => instantiate(t, { feature: 'x', dir: bad })), E.PARAM_INVALID, JSON.stringify(bad));
  }
});

test('injection through a parameter is refused and cannot add argv or change the flow', () => {
  const t = loadTemplate(raw());
  for (const evil of ['x --llm claude', '--llm', '-h', 'x;rm -rf /', 'x\nfoo', '$(id)', '`id`', 'a|b', 'x"y', '{{layer}}', 'x,y']) {
    assert.equal(codeOf(() => instantiate(t, { feature: evil })), E.PARAM_INVALID, JSON.stringify(evil));
  }
  // an accepted value fills exactly one argv slot, never more
  const plan = instantiate(t, { feature: 'good-name_1' });
  const cmd = planToCommand(plan.steps[1]);
  assert.equal(cmd.argv.filter((a) => a === 'good-name_1').length, 2);
  assert.equal(cmd.argv.length, 5);
  assert.deepEqual(plan.steps.map((s) => s.flow), ['create.feature', 'create.unit']);
});

test('a placeholder can never choose the flow, id, executor or dependency (refused at load)', () => {
  for (const [field, value] of [['flow', '{{feature}}'], ['id', 'a-{{feature}}'], ['executor', '{{feature}}'], ['dependsOn', ['{{feature}}']]]) {
    const tpl = raw();
    tpl.steps[1][field] = value;
    assert.equal(codeOf(() => loadTemplate(tpl)), E.TEMPLATE_PLACEHOLDER_FORBIDDEN, field);
  }
  const tpl = raw();
  tpl.steps[0].args['{{feature}}'] = 'x';
  assert.equal(codeOf(() => loadTemplate(tpl)), E.TEMPLATE_PLACEHOLDER_FORBIDDEN);
});

test('load-time refusals: unknown flow, undefined parameter, malformed, bad example, bad shape', () => {
  let tpl = raw(); tpl.steps[0].flow = 'no.such.flow';
  assert.equal(codeOf(() => loadTemplate(tpl)), E.TEMPLATE_FLOW_UNKNOWN);
  tpl = raw(); tpl.steps[0].args.name = '{{ghost}}';
  assert.equal(codeOf(() => loadTemplate(tpl)), E.TEMPLATE_PARAM_UNDEFINED);
  tpl = raw(); tpl.ticket.title = 'Add {{feature';
  assert.equal(codeOf(() => loadTemplate(tpl)), E.TEMPLATE_INVALID);
  tpl = raw(); tpl.steps[0].args.bogusArg = 'x'; // unknown arg for the flow -> example does not yield a valid plan
  assert.equal(codeOf(() => loadTemplate(tpl)), E.TEMPLATE_EXAMPLE_INVALID);
  tpl = raw(); delete tpl.steps[0].args.name; // required arg missing
  assert.equal(codeOf(() => loadTemplate(tpl)), E.TEMPLATE_EXAMPLE_INVALID);
  tpl = raw(); delete tpl.parameters.feature.example;
  assert.equal(codeOf(() => loadTemplate(tpl)), E.TEMPLATE_PARAM_INVALID);
  tpl = raw(); tpl.parameters.feature.example = '../x';
  assert.equal(codeOf(() => loadTemplate(tpl)), E.TEMPLATE_PARAM_INVALID);
  tpl = raw(); tpl.parameters.feature.type = 'shell';
  assert.equal(codeOf(() => loadTemplate(tpl)), E.TEMPLATE_PARAM_INVALID);
  tpl = raw(); tpl.templateVersion = 2;
  assert.equal(codeOf(() => loadTemplate(tpl)), E.TEMPLATE_VERSION_INVALID);
  tpl = raw(); tpl.name = 'Bad Name';
  assert.equal(codeOf(() => loadTemplate(tpl)), E.TEMPLATE_NAME_INVALID);
  tpl = raw(); tpl.extra = 1;
  assert.equal(codeOf(() => loadTemplate(tpl)), E.TEMPLATE_INVALID);
  assert.equal(codeOf(() => loadTemplate(null)), E.TEMPLATE_NOT_OBJECT);
  assert.equal(codeOf(() => createTemplateRegistry([raw(), raw()])), E.TEMPLATE_DUPLICATE);
  assert.equal(codeOf(() => registry().get('nope')), E.TEMPLATE_NOT_FOUND);
  assert.equal(codeOf(() => loadTemplateDir(path.join(here, 'no-such-dir'))), E.TEMPLATE_NOT_FOUND);
});

test('the CLI lists, shows and instantiates; refuses bad params; has no default directory', () => {
  const run = (...a) => spawnSync(process.execPath, [path.join(root, 'bin', 'construct.mjs'), 'template', ...a], { encoding: 'utf8', env: { ...process.env, CONSTRUCT_TEMPLATES_DIR: '' } });
  const list = run('list', '--templates', FIXTURES);
  assert.equal(list.status, 0);
  assert.equal(JSON.parse(list.stdout).templates[0].name, 'demo.add-feature');
  assert.equal(JSON.parse(run('show', 'demo.add-feature', '--templates', FIXTURES).stdout).template.name, 'demo.add-feature');
  const ok = run('instantiate', 'demo.add-feature', '--param', 'feature=cart', '--templates', FIXTURES);
  assert.equal(ok.status, 0);
  assert.equal(validatePlan(JSON.parse(ok.stdout)).valid, true);
  assert.equal(ok.stdout, run('instantiate', 'demo.add-feature', '--params-json', '{"feature":"cart"}', '--templates', FIXTURES).stdout);
  const bad = run('instantiate', 'demo.add-feature', '--param', 'feature=--llm', '--templates', FIXTURES);
  assert.equal(bad.status, 2);
  assert.equal(JSON.parse(bad.stdout).error.code, 'PARAM_INVALID');
  assert.equal(run('instantiate', 'demo.add-feature', '--params-json', '{oops', '--templates', FIXTURES).status, 2);
  assert.equal(run('list').status, 2); // no bundled curated set
  assert.equal(run('bogus').status, 2);
});

// The open-core boundary: core must never import a curated location, and no
// curated template may live in src/.
test('open-core boundary: no src import reaches ui/, tools/ or any curated/proprietary location, and no template JSON lives in src/', () => {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(path.join(root, 'src'));
  const spec = /^(?:import|export)\b[^'"\n]*?(?:from\s*)?['"]([^'"]+)['"]|^[^/*\n]*\bimport\(\s*['"]([^'"]+)['"]/gm;
  for (const f of files.filter((p) => p.endsWith('.mjs') || p.endsWith('.js'))) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(spec)) {
      const s = m[1] || m[2];
      if (!s.startsWith('.')) continue;
      const target = path.resolve(path.dirname(f), s);
      const rel = path.relative(root, target).split(path.sep)[0];
      assert.ok(!rel.startsWith('..') && !['ui', 'tools', 'proprietary', 'curated', 'templates', 'flows', 'mcp'].includes(rel), `${path.relative(root, f)} imports a non-core location: ${s}`);
      assert.doesNotMatch(s, /(^|\/)(ui|proprietary|curated|flows|mcp)(\/|$)/, `${path.relative(root, f)} imports a proprietary-side path: ${s}`);
    }
  }
  const planTemplate = fs.readFileSync(path.join(root, 'packages', 'engine', 'planTemplate.mjs'), 'utf8');
  assert.deepEqual([...planTemplate.matchAll(spec)].map((m) => m[1] || m[2]).filter((s) => s.startsWith('.')).sort(), ['../../src/plan.mjs']);
  const inSrc = files.filter((p) => p.endsWith('.json') && /"templateVersion"/.test(fs.readFileSync(p, 'utf8')));
  assert.deepEqual(inSrc, [], 'a template lives under src/: curated flows are proprietary and must load from outside core');
});
