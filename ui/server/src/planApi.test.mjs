// #289 / #332 — Plan mode API. Security first: the plan comes from the browser, so every refusal is proven
// to start NOTHING; then behaviour on a real fixture project.
import '../../../test-utils/workspaceRoot.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { SESSION_COOKIE, createAuth, resolveAuthConfig, signValue } from './auth.mjs';
import { createPlanRouter } from './planApi.mjs';
import { createPlanService, PATH_ARGS, unsafePathReason, checkPlan } from './planService.mjs';
import { createProcessesService } from './processesService.mjs';
import { PLAN_FLOWS } from '../../../packages/core/plan.mjs';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { app as realApp, auth as realAuth } from './index.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SHARED = path.join(REPO, 'fixtures', 'impact-shared');
const ORIGIN = 'http://localhost:3000';
const SECRET = 's'.repeat(48);
const ENV = { CONSTRUCT_AUTH: 'required', CONSTRUCT_AUTH_TEST_USER: 'e2e-user', CONSTRUCT_SESSION_SECRET: SECRET };
const cookie = () => `${SESSION_COOKIE}=${encodeURIComponent(signValue({ login: 'e2e-user', exp: Date.now() + 60_000 }, SECRET))}`;

const makeProject = () => {
  const dir = makeTempDir('og289-plan-');
  fs.cpSync(SHARED, dir, { recursive: true });
  return dir;
};

const step = (over = {}) => ({ id: 's1', title: 'List features', flow: 'summarize.list', args: { kind: 'feature' }, executor: 'deterministic', ...over });
const plan = (steps = [step()]) => ({ version: 1, ticket: { source: 'text', title: 'A ticket' }, steps });

async function withStack({ authOn = true, root = makeProject(), onStarted } = {}, fn) {
  const started = [];
  const service = createPlanService({ getRoot: () => root, startPlan: (p) => { started.push(p); return { ok: true, processId: 'p-1' }; }, onStarted });
  const auth = createAuth(resolveAuthConfig(authOn ? ENV : {}, { host: '127.0.0.1', clientOrigin: ORIGIN }));
  const app = express();
  app.use(express.json());
  auth.mountRoutes(app);
  app.use('/api', auth.requireSession);
  app.use('/api/plan', createPlanRouter(service));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const call = (method, p, { body, headers = {} } = {}) => fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: { origin: ORIGIN, cookie: cookie(), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = async (method, p, opts) => { const r = await call(method, p, opts); return { status: r.status, body: await r.json() }; };
  try {
    await fn({ root, started, call, json });
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
}

// --- security --------------------------------------------------------------

test('every /api/plan route is refused with 401 when there is no session', async () => {
  await withStack({}, async ({ call, started }) => {
    for (const [method, p, body] of [
      ['GET', '/api/plan/context'],
      ['POST', '/api/plan/propose', { text: 'billing' }],
      ['POST', '/api/plan/impact', { seeds: ['feature:billing'] }],
      ['POST', '/api/plan/validate', { plan: plan() }],
      ['POST', '/api/plan/run', { plan: plan() }],
    ]) {
      const res = await call(method, p, { body, headers: { cookie: '' } });
      assert.equal(res.status, 401, `${method} ${p} must need a session`);
    }
    assert.equal((await call('GET', '/api/plan/context')).status, 200);
    assert.deepEqual(started, []);
  });
});

test('the real server registers /api/plan AFTER the session gate', () => {
  const stack = realApp._router.stack;
  const gate = stack.findIndex((layer) => layer.handle === realAuth.requireSession);
  const router = stack.findIndex((layer) => layer.handle?.stack && layer.regexp.test('/api/plan'));
  assert.ok(gate >= 0);
  assert.ok(router > gate, 'the plan router must come after the gate');
});

const REFUSED = [
  ['an invalid plan (no steps)', plan([]), 'STEPS_EMPTY'],
  ['not a plan at all', 'rm -rf /', 'PLAN_NOT_OBJECT'],
  ['an unknown flow', plan([step({ flow: 'shell.exec', args: { cmd: 'id' } })]), 'STEP_FLOW_UNKNOWN'],
  ['a deterministic step passing llm', plan([step({ flow: 'summarize.unit', args: { ref: 'feature:billing', llm: 'ollama' } })]), 'STEP_ARG_UNKNOWN'],
  ['a deterministic step passing llm on an llm flow', plan([{ id: 's1', title: 'Make', flow: 'create.unit', args: { layer: 'domain', name: 'X', feature: 'billing', llm: 'ollama' }, executor: 'deterministic', touches: { features: ['billing'], files: [] } }]), 'STEP_EXECUTOR_LLM_CONFLICT'],
  ['local-model on a flow with no model path', plan([step({ executor: 'local-model' })]), 'STEP_EXECUTOR_NOT_ALLOWED'],
  ['a forward dependency', plan([step({ id: 'a', dependsOn: ['b'] }), step({ id: 'b' })]), 'STEP_DEPENDENCY_FORWARD'],
  ['a ".." path', plan([{ id: 's1', title: 'Page', flow: 'create.page.from', args: { name: 'P', feature: 'billing', from: '../../etc/passwd' }, executor: 'deterministic', touches: { features: [], files: [] } }]), 'COCKPIT_ARG_PATH'],
  ['an absolute path', plan([{ id: 's1', title: 'Page', flow: 'create.page.from', args: { name: 'P', feature: 'billing', from: '/etc/passwd' }, executor: 'deterministic', touches: { features: [], files: [] } }]), 'COCKPIT_ARG_PATH'],
  ['a URL as a path', plan([{ id: 's1', title: 'API', flow: 'create.service.openapi', args: { name: 'P', feature: 'billing', openapi: 'http://169.254.169.254/x' }, executor: 'deterministic', touches: { features: [], files: [] } }]), 'COCKPIT_ARG_PATH'],
  ['a --dir that leaves the project', plan([step({ flow: 'summarize.list', args: { dir: '../other' } })]), 'COCKPIT_ARG_PATH'],
  ['an argument that would be read as an option', plan([step({ flow: 'summarize.unit', args: { ref: '--output=/tmp/x' } })]), 'COCKPIT_ARG_DASH'],
  ['a hosted model on a model step', plan([{ id: 's1', title: 'Make', flow: 'create.unit', args: { layer: 'domain', name: 'X', feature: 'billing', llm: 'claude' }, executor: 'local-model', touches: { features: ['billing'], files: [] } }]), 'COCKPIT_LLM_PROVIDER'],
  ['the raw-envelope flow', plan([{ id: 's1', title: 'Pipe', flow: 'pipeline.run', args: { envelope: {} }, executor: 'deterministic', touches: { features: [], files: [] } }]), 'COCKPIT_FLOW_NOT_OFFERED'],
  ['too many steps', plan(Array.from({ length: 51 }, (_, i) => step({ id: `s${i}` }))), 'COCKPIT_TOO_MANY_STEPS'],
];

test('an invalid or hostile plan is refused with the named error, and NOTHING is started', async () => {
  await withStack({}, async ({ json, started }) => {
    for (const [label, p, code] of REFUSED) {
      const r = await json('POST', '/api/plan/run', { body: { plan: p } });
      assert.equal(r.status, 400, `${label} must be refused`);
      assert.equal(r.body.ok, false);
      assert.ok(r.body.errors.some((e) => e.code === code), `${label}: expected ${code}, got ${JSON.stringify(r.body.errors.map((e) => e.code))}`);
      assert.ok(r.body.errors.every((e) => typeof e.plain === 'string' && e.plain.length > 0), `${label}: every error carries a plain sentence`);
    }
    assert.deepEqual(started, [], 'no process was created for any refused plan');
    // The same plans are reported (not run) by /validate.
    const v = await json('POST', '/api/plan/validate', { body: { plan: REFUSED[7][1] } });
    assert.equal(v.body.valid, false);
  });
});

test('a symlink that leaves the project is refused', async () => {
  const root = makeProject();
  const outside = makeTempDir('og289-outside-');
  fs.writeFileSync(path.join(outside, 'secret.tsx'), 'x');
  fs.symlinkSync(outside, path.join(root, 'linked'));
  assert.match(unsafePathReason(root, 'linked/secret.tsx'), /symbolic link/);
  assert.match(unsafePathReason(root, 'linked/new/file.tsx'), /symbolic link/, 'a not-yet-existing file under the link too');
  assert.equal(unsafePathReason(root, 'features/billing/index.ts'), null);
  assert.equal(unsafePathReason(root, 'features/does/not/exist.tsx'), null);
});

test('a valid plan is started exactly once, from the server\'s own project', async () => {
  await withStack({}, async ({ json, started, root }) => {
    const good = plan([step(), step({ id: 's2', title: 'Doctor', flow: 'research.doctor', args: {}, dependsOn: ['s1'] })]);
    const r = await json('POST', '/api/plan/run', { body: { plan: good, projectDir: '/etc', projectRoot: '/etc' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.processId, 'p-1');
    assert.deepEqual(r.body.models, []);
    assert.equal(started.length, 1);
    assert.deepEqual(started[0], good);
    assert.ok(fs.existsSync(root));
  });
});

test('a model step is reported before it runs: validate names it, run lists it', async () => {
  await withStack({}, async ({ json }) => {
    const p = plan([{ id: 's1', title: 'Make', flow: 'create.unit', args: { layer: 'domain', name: 'Thing', feature: 'billing', llm: 'ollama' }, executor: 'local-model', touches: { features: ['billing'], files: [] } }]);
    const v = await json('POST', '/api/plan/validate', { body: { plan: p } });
    assert.equal(v.body.valid, true, JSON.stringify(v.body.errors));
    assert.equal(v.body.steps[0].model, true);
    assert.deepEqual(v.body.steps[0].argv.slice(0, 4), ['construct', 'create', 'domain', 'Thing']);
    const r = await json('POST', '/api/plan/run', { body: { plan: p } });
    assert.deepEqual(r.body.models, ['s1']);
  });
});

test('validate returns the exact argv the step would run and the plan-level touches', async () => {
  await withStack({}, async ({ json }) => {
    const p = plan([{ id: 's1', title: 'Feature', flow: 'create.feature', args: { name: 'Wishlist' }, executor: 'deterministic', touches: { features: ['Wishlist'], files: [{ path: 'features/Wishlist/index.ts', change: 'create' }] } }]);
    const v = await json('POST', '/api/plan/validate', { body: { plan: p } });
    assert.equal(v.body.valid, true);
    assert.deepEqual(v.body.steps[0].argv, ['construct', 'create', 'feature', 'Wishlist']);
    assert.deepEqual(v.body.touches.features, ['Wishlist']);
  });
});

// --- context, proposals, impact -------------------------------------------------------------

test('context carries the constraints read from architecture.yml, the features and the whole flow catalogue', async () => {
  await withStack({}, async ({ json }) => {
    const r = await json('GET', '/api/plan/context');
    assert.equal(r.status, 200);
    assert.equal(r.body.constraints.framework, 'nextjs');
    assert.ok(r.body.constraints.rules.some((x) => x.id === 'SLICE-002' && x.severity === 'error'));
    assert.ok(r.body.constraints.layers.some((l) => l.name === 'domain'));
    assert.ok(r.body.features.some((f) => f.ref === 'feature:billing'));
    assert.equal(r.body.flows.length, Object.keys(PLAN_FLOWS).length);
    assert.equal(r.body.flows.find((f) => f.id === 'pipeline.run').offered, false);
  });
});

test('proposals come from the ticket text, are all inferred with evidence, and no model is involved', async () => {
  await withStack({}, async ({ json }) => {
    const r = await json('POST', '/api/plan/propose', { body: { text: 'The billing totals are wrong when checkout applies a discount.' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.method, 'text-match');
    assert.ok(r.body.seeds.length >= 1);
    assert.ok(r.body.seeds.every((s) => s.provenance === 'inferred' && s.evidence));
    assert.equal((await json('POST', '/api/plan/propose', { body: { text: '  ' } })).status, 400);
  });
});

test('impact: explicit seeds are derived; a confirmed proposal keeps provenance inferred; a made-up proposal is refused', async () => {
  await withStack({}, async ({ json }) => {
    const explicit = await json('POST', '/api/plan/impact', { body: { seeds: ['feature:billing'] } });
    assert.equal(explicit.status, 200);
    assert.ok(explicit.body.report.files.length > 0);
    assert.ok(explicit.body.report.files.every((f) => ['derived', 'inferred'].includes(f.provenance)));
    assert.ok(explicit.body.report.files.some((f) => f.provenance === 'derived'));
    const text = 'The billing totals are wrong when checkout applies a discount.';
    const proposals = (await json('POST', '/api/plan/propose', { body: { text } })).body.seeds;
    const accepted = await json('POST', '/api/plan/impact', { body: { text, accepted: [proposals[0].ref] } });
    assert.equal(accepted.status, 200);
    assert.ok(accepted.body.report.files.every((f) => f.provenance === 'inferred'), 'everything downstream of an inferred seed is inferred');
    const forged = await json('POST', '/api/plan/impact', { body: { text, accepted: ['feature:reporting'] } });
    assert.equal(forged.status, 400);
    for (const bad of ['../../etc/passwd', 'file:../../etc/passwd', '/etc/passwd', 'feature:a\nb']) {
      assert.equal((await json('POST', '/api/plan/impact', { body: { seeds: [bad] } })).status, 400, bad);
    }
    assert.equal((await json('POST', '/api/plan/impact', { body: {} })).status, 400);
  });
});

test('no project: every endpoint answers 409 with a plain sentence', async () => {
  await withStack({ root: null }, async ({ json }) => {
    assert.equal((await json('GET', '/api/plan/context')).status, 409);
    assert.equal((await json('POST', '/api/plan/run', { body: { plan: plan() } })).status, 409);
  });
});

// --- drift guards ---------------------------------------------------------------------------

test('every path-looking argument of every whitelisted flow is covered by the path check', () => {
  for (const [id, flow] of Object.entries(PLAN_FLOWS)) {
    for (const [name, spec] of Object.entries(flow.args)) {
      const looksLikePath = name === 'dir' || (!/not a path/.test(spec.description || '') && (/\bpath\b/i.test(spec.description || '') || /\.(tsx|json)/.test(spec.description || '')));
      const covered = name === 'dir' || name === 'route' || (PATH_ARGS[id] || []).includes(name);
      if (looksLikePath && spec.type === 'string') assert.ok(covered, `${id}.${name} looks like a path but is not in PATH_ARGS`);
    }
  }
});

// --- the real thing: a plan started through the real service creates a real, visible process --------

test('runPlan through the real processes service creates a process and starts it (fake executor)', async () => {
  const root = makeProject();
  const stateDir = makeTempDir('og289-state-');
  const processes = createProcessesService({ getProjectDir: () => root, stateDir, executeStep: async () => ({ ok: true, llm: null }) });
  const service = createPlanService({ getRoot: () => root, startPlan: (p) => processes.startPlan(p) });
  const bad = service.run({ plan: plan([]) });
  assert.equal(bad.status, 400);
  assert.equal(processes.list().processes.length, 0, 'a refused plan leaves no process behind');
  const good = service.run({ plan: plan() });
  assert.equal(good.status, 200);
  const listed = processes.list().processes;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, good.body.processId);
  await processes.engine().settled(good.body.processId);
  assert.equal(checkPlan(plan(), root).valid, true);
});

test('#609 a run that names a note reports it to onStarted; a failing hook never undoes the run; a refusal never calls it', async () => {
  const seen = [];
  await withStack({ onStarted: (x) => seen.push(x) }, async ({ json, started }) => {
    const ok = await json('POST', '/api/plan/run', { body: { plan: plan(), noteId: 'n-1' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.noteRan, true);
    assert.deepEqual(seen.map((x) => [x.noteId, x.processId]), [['n-1', 'p-1']]);
    const plain = await json('POST', '/api/plan/run', { body: { plan: plan() } });
    assert.equal(plain.body.noteRan, undefined, 'no note named, nothing to report');
    const refused = await json('POST', '/api/plan/run', { body: { plan: plan([]), noteId: 'n-2' } });
    assert.equal(refused.status, 400);
    assert.equal(seen.length, 1);
    assert.equal(started.length, 2);
  });
  await withStack({ onStarted: () => { throw new Error('disk'); } }, async ({ json, started }) => {
    const r = await json('POST', '/api/plan/run', { body: { plan: plan(), noteId: 'n-3' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.noteRan, false);
    assert.equal(started.length, 1);
  });
});
