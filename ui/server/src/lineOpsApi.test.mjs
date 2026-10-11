// T4 -- /api/line routes (lineOpsApi.mjs) on a copy of examples/line-sample: the real engine operations behind HTTP,
// refusals as one sentence, and nothing written unless Construct's writer lets the change land. Since the integration
// of cp1 (11 Oct) every change is a plan step: the old direct write routes are gone, so each change here goes through
// /api/line/plan (add the step, approve it as the Cockpit page does, run it) and the step's result is checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createLineOpsRouter } from './lineOpsApi.mjs';
import { createLinePlanRouter } from './linePlanApi.mjs';
import { createLinePlanService, loadPlanApi } from '../../../packages/engine/line/planService.mjs';
import { assertApplyResult, assertFragmentList, assertLineWorkspace } from '../../../packages/engine/line/contract.mjs';
import { lineFindings } from '../../../packages/engine/line/model.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/line-sample');
const ORIGIN = 'http://localhost:3000';
const NO_LINK = { env: { ...process.env, LINE_SOURCE_DIR: path.join(makeTempDir('no-source-'), 'nope') } };

async function serve(t, { root = null, saved = [] } = {}) {
  const dir = root ?? makeTempDir('construct-line-ops-api-');
  if (!root) fs.cpSync(SAMPLE, dir, { recursive: true });
  const app = express();
  app.use(express.json());
  app.use('/api/line', createLineOpsRouter({ clientOrigin: ORIGIN, afterSave: (_r, f) => saved.push(f), getRoot: () => ({ ok: true, root: dir }) }));
  const svc = createLinePlanService({ root: dir, commands: null, afterSave: (_r, f) => saved.push(f), load: (o) => loadPlanApi({ ...o, linkOptions: NO_LINK }) });
  app.use('/api/line', createLinePlanRouter({ clientOrigin: ORIGIN, getRoot: () => ({ ok: true, root: dir }), serviceFor: () => svc }));
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/api/line`;
  const { approvalToken } = await (await fetch(`${base}/plan`)).json();
  const post = (p, body, headers = {}) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-line-approval': approvalToken, ...headers }, body: JSON.stringify(body) });
  /**
   * One change as Cockpit makes it: add the plan step, approve it, run it. A refusal before the step joins the plan is
   * `{status, body}` (400 with a sentence); otherwise the step's ApplyResult (`apply`) and the step itself. A step that
   * needed the person is left as it is, so the next change can run.
   */
  const change = async (tool, args, headers = {}) => {
    const added = await post('/plan/step', { tool, args }, headers);
    const body = await added.json();
    if (added.status !== 200) return { status: added.status, body };
    await post('/plan/approve', { stepId: body.stepId });
    const ran = await (await post('/plan/run', { stepId: body.stepId })).json();
    const step = ran.steps.find((x) => x.id === body.stepId);
    if (step.state !== 'done') {
      const leave = await (await post('/plan/step', { tool: 'line.leaveAsIs', args: { stepId: step.id } })).json();
      await post('/plan/approve', { stepId: leave.stepId });
      await post('/plan/run', { stepId: leave.stepId });
    }
    return { status: 200, step, apply: step.result.apply };
  };
  return { dir, base, post, change, saved };
}

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

test('page tree and set a prop: the parts come back, and a title change lands through the writer', async (t) => {
  const { dir, base, change, saved } = await serve(t);
  const file = 'features/orders/pages/OrdersPage.tsx';
  const tree = await (await fetch(`${base}/page-tree?file=${encodeURIComponent(file)}`)).json();
  assert.equal(tree.feature, 'orders');
  const all = (nodes) => nodes.flatMap((n) => [n, ...all(n.children)]);
  const node = all(tree.roots).find((n) => n.props.some((p) => p.name === 'title'));
  assert.ok(node, 'the page has a part with a title');
  const body = (await change('line.setPageProp', { file, nodeId: node.id, prop: 'title', kind: 'string', value: 'All orders' })).apply;
  assertApplyResult(body);
  assert.equal(body.ok, true, body.sentence);
  assert.match(read(dir, file), /title="All orders"/);
  assert.deepEqual(saved, [file]);
});

test('base on a library item lands a new feature file; promote moves OrderButton into the library and fixes the planted cross-feature import', async (t) => {
  const { dir, change } = await serve(t);
  const r = (await change('line.baseOn', { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge' })).apply;
  assertApplyResult(r);
  assert.equal(r.ok, true, r.sentence);
  assert.match(read(dir, 'features/orders/components/StatusBadge.tsx'), /^\/\/ @line-base components\/Badge/);
  const p = (await change('line.promote', { featureItemId: 'orders/components/OrderButton' })).apply;
  assertApplyResult(p);
  assert.equal(p.ok, true, p.sentence);
  assert.ok(fs.existsSync(path.join(dir, 'library/components/OrderButton.tsx')));
  assert.equal(fs.existsSync(path.join(dir, 'features/orders/components/OrderButton.tsx')), false);
  assert.doesNotMatch(read(dir, 'features/billing/pages/InvoicesPage.tsx'), /features\/orders|\.\.\/\.\.\/orders/, 'the planted cross-feature import now points at the library');
});

test('refusals are one sentence with a code, and change nothing', async (t) => {
  const { dir, base, change } = await serve(t);
  const before = read(dir, 'features/orders/pages/OrdersPage.tsx');
  const unknown = await change('line.baseOn', { libraryId: 'components/Nope', feature: 'orders', name: 'X' });
  assert.equal(unknown.status, 400);
  const u = unknown.body;
  assert.equal(u.code, 'UNKNOWN_ITEM');
  assert.match(u.sentence, /^There is no library item/);
  const missing = await fetch(`${base}/page-tree?file=${encodeURIComponent('features/orders/pages/Nope.tsx')}`);
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).code, 'UNKNOWN_ITEM');
  const foreign = await change('line.setPageProp', {}, { origin: 'http://evil.example' });
  assert.equal(foreign.status, 403);
  for (const gone of ['/page-prop', '/base-on', '/promote', '/fix', '/fragment']) {
    const r = await fetch(`${base}${gone}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: '{}' });
    assert.equal(r.status, 404, `POST ${gone} is gone: every change is a plan step`);
  }
  assert.equal(read(dir, 'features/orders/pages/OrdersPage.tsx'), before);
});

test('with no project open, every route says so in one sentence', async (t) => {
  const app = express();
  app.use(express.json());
  app.use('/api/line', createLineOpsRouter({ clientOrigin: ORIGIN, getRoot: () => ({ ok: false, error: 'No project is open; pick a project first.' }) }));
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const res = await fetch(`http://127.0.0.1:${/** @type {any} */ (server.address()).port}/api/line/page-tree?file=x`);
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, sentence: 'No project is open; pick a project first.', code: 'NO_PROJECT' });
});

test('workspace: GET says the whole project until one is set; POST sets features/orders, base-on into billing is refused in one sentence, into orders lands', async (t) => {
  const { dir, base, post, change } = await serve(t);
  const w0 = await (await fetch(`${base}/workspace`)).json();
  assertLineWorkspace(w0);
  assert.equal(w0.folder, '');
  const w = await (await post('/workspace', { folder: 'features/orders' })).json();
  assertLineWorkspace(w);
  assert.equal(w.folder, 'features/orders');
  assert.equal((await (await fetch(`${base}/workspace`)).json()).folder, 'features/orders');
  assert.deepEqual(JSON.parse(read(dir, 'line/workspace.json')), { folder: 'features/orders' });
  const refused = (await change('line.baseOn', { libraryId: 'components/Badge', feature: 'billing', name: 'PaidBadge' })).apply;
  assertApplyResult(refused);
  assert.equal(refused.code, 'OUTSIDE_WORKSPACE');
  assert.equal(refused.sentence, 'Nothing was saved: features/billing/components/PaidBadge.tsx is outside your workspace folder features/orders; it stays read-only.');
  assert.equal(fs.existsSync(path.join(dir, 'features/billing/components/PaidBadge.tsx')), false);
  const landed = (await change('line.baseOn', { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge' })).apply;
  assert.equal(landed.ok, true, landed.sentence);
});

test('workspace: a folder outside the project is a 400 with one sentence, and nothing is stored', async (t) => {
  const { dir, post } = await serve(t);
  const res = await post('/workspace', { folder: '../../outside' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'BAD_FOLDER');
  assert.match(body.sentence, /^".*" is not a folder inside the project; pick one from the project's folders\.$/);
  assert.equal(fs.existsSync(path.join(dir, 'line/workspace.json')), false);
});

test('fix: the project finding carries its fixes, a line.fix step lands the top one by key, and a stale or advice-only fix is one sentence', async (t) => {
  const { dir, change, saved } = await serve(t);
  const finding = lineFindings(dir).find((f) => f.rule === 'LINE-BASE');
  assert.equal(finding.fixes[0].id, 'LINE-BASE/set-base:components/Card');
  const body = (await change('line.fix', { findingKey: finding.key, fixId: finding.fixes[0].id })).apply;
  assertApplyResult(body);
  assert.equal(body.ok, true, body.sentence);
  assert.match(read(dir, 'features/billing/components/InvoiceCard.tsx'), /^\/\/ @line-base components\/Card\n/);
  assert.deepEqual(saved, ['features/billing/components/InvoiceCard.tsx']);
  assert.ok(!lineFindings(dir).some((f) => f.rule === 'LINE-BASE'), 'the finding is gone');
  const stale = await change('line.fix', { findingKey: finding.key, fixId: finding.fixes[0].id });
  assert.equal(stale.status, 400);
  assert.equal(stale.body.code, 'UNKNOWN_FINDING');

  fs.writeFileSync(path.join(dir, 'library/workflows/save.ts'), "import fs from 'node:fs';\nexport function save(p: string): void {\n  fs.writeFileSync(p, 'x');\n}\n");
  const writer = lineFindings(dir).find((f) => f.rule === 'LINE-WRITER');
  const advice = await change('line.fix', { findingKey: writer.key, fixId: 'LINE-WRITER/use-writer' });
  assert.equal(advice.status, 400);
  const a = advice.body;
  assert.equal(a.code, 'NO_STEP');
  assert.match(a.sentence, /Construct's writer/);
});

test('fragments (cx1): the list comes back, an edit lands only in its range, and refusals are one sentence with detail', async (t) => {
  const { dir, base, change, saved } = await serve(t);
  const file = 'features/orders/pages/OrdersPage.tsx';
  const list = await (await fetch(`${base}/fragments?file=${encodeURIComponent(file)}`)).json();
  assertFragmentList(list);
  const [frag] = list.fragments;
  assert.equal(frag.label, 'What happens when Orders asks for more');
  const before = read(dir, file);

  const bad = await change('line.setFragment', { file, fragmentId: frag.id, code: '() => {', contentHash: list.contentHash });
  assert.equal(bad.status, 400);
  const badBody = bad.body;
  assert.equal(badBody.code, 'BAD_CODE');
  assert.equal(badBody.sentence, 'This code is not a single valid expression, so nothing was saved.');
  assert.ok(badBody.detail, 'the parser message is under detail');

  const dirRes = (await change('line.setFragment', { file, fragmentId: frag.id, code: "() => import('../../billing/pages/InvoicesPage')", contentHash: list.contentHash })).apply;
  assertApplyResult(dirRes);
  assert.equal(dirRes.ok, false);
  assert.ok(dirRes.findings.some((f) => f.rule === 'LINE-DIR'));
  assert.equal(read(dir, file), before);

  const code = "() => console.log('All orders')";
  const ok = (await change('line.setFragment', { file, fragmentId: frag.id, code, contentHash: list.contentHash })).apply;
  assertApplyResult(ok);
  assert.equal(ok.ok, true, ok.sentence);
  assert.equal(read(dir, file), before.slice(0, frag.range.start) + code + before.slice(frag.range.end));
  assert.deepEqual(saved, [file]);

  const stale = await change('line.setFragment', { file, fragmentId: frag.id, code: '() => undefined', contentHash: list.contentHash });
  assert.equal(stale.status, 400);
  assert.equal(stale.body.code, 'STALE');
  const outside = await fetch(`${base}/fragments?file=${encodeURIComponent('../outside.tsx')}`);
  assert.equal(outside.status, 400);
  assert.equal((await outside.json()).code, 'UNKNOWN_ITEM');
});
