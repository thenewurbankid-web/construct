// #543 -- PLAN_FLOWS derived into contract blocks (packages/core/block-flows.mjs): the registry is untouched, every flow
// yields a valid block, scope/actions follow the flow's own rules, run reports the files that really changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PLAN_FLOWS, validatePlan } from '../packages/core/plan.mjs';
import { expectedFiles, DERIVED_FLOWS } from '../packages/core/plan-touches.mjs';
import { validateBlock, validateActions, runBlock, GUARDRAILS } from '../packages/core/block-contract.mjs';
import { flowBlock, flowBlocks, flowScopeKind, processLifecycleBlock, SCOPE_KINDS } from '../packages/core/block-flows.mjs';
import { PROCESS_STATE_PATHS } from '../packages/engine/processMachine.mjs';
import { createFeature } from '../packages/core/generators.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'cli', 'construct.mjs');
const cliExec = ({ argv, cwd }) => spawnSync('node', [bin, ...argv], { cwd, encoding: 'utf8' });
const ids = (actions) => actions.map((a) => a.id);

test('adapting is wrapping: every flow yields a valid block and PLAN_FLOWS is not changed by it', () => {
  const before = JSON.stringify(PLAN_FLOWS);
  const blocks = flowBlocks();
  assert.deepEqual(Object.keys(blocks), Object.keys(PLAN_FLOWS));
  for (const [id, block] of Object.entries(blocks)) {
    assert.equal(block.id, id);
    assert.equal(block.writes, !!PLAN_FLOWS[id].writes, id);
    const r = validateBlock(block, { state: { args: {}, root: '/nowhere' }, args: {}, ctx: { root: '/nowhere' } });
    assert.deepEqual(r.errors, [], id);
  }
  assert.equal(JSON.stringify(PLAN_FLOWS), before);
  assert.equal(Object.isFrozen(PLAN_FLOWS), true);
  assert.throws(() => flowBlock('nope'), /Unknown flow/);
  assert.throws(() => flowScopeKind('nope'), /Unknown flow/);
});

test('scope kinds: read-only flows are empty, the three plan-touches flows derived, every other writer declared by the plan', () => {
  for (const [id, flow] of Object.entries(PLAN_FLOWS)) {
    const kind = flowScopeKind(id);
    assert.ok(SCOPE_KINDS.includes(kind));
    assert.equal(kind, !flow.writes ? 'empty' : DERIVED_FLOWS.includes(id) ? 'derived' : 'declared', id);
    assert.equal(flowBlocks()[id].meta.scope, kind);
  }
  assert.deepEqual(Object.entries(PLAN_FLOWS).filter(([id]) => flowScopeKind(id) === 'declared').map(([id]) => id).sort(), [
    'create.controller.bind', 'create.page.from', 'create.service.openapi', 'create.workflow.from', 'import.plan', 'import.route',
    'import.unit', 'manual.task', 'pipeline.run', 'project.init', 'refactor.move', 'refactor.rename', 'sync',
  ]);
});

test('declaredScope: empty for a read-only flow, never null for one; null (not a guess) for a writer it cannot derive', () => {
  const root = makeTempDir('og543-');
  for (const [id, flow] of Object.entries(PLAN_FLOWS)) {
    const scope = flowBlocks()[id].declaredScope({}, { root });
    if (!flow.writes) assert.deepEqual(scope, { features: [], files: [] }, id);
    else if (!DERIVED_FLOWS.includes(id)) assert.equal(scope, null, id);
  }
  assert.equal(flowBlocks()['create.unit'].declaredScope({ layer: 'domain', name: 'x' }, { root }), null, 'incomplete args derive nothing');
  assert.equal(flowBlocks()['create.unit'].declaredScope({ layer: 'domain', name: 'x', feature: 'f' }, {}), null, 'no root, no derivation');
});

test('declaredScope for the derived flows equals plan-touches, names the feature, and is a valid step touches', () => {
  const root = makeTempDir('og543-');
  const cases = [
    ['create.feature', { name: 'wishlist' }, ['wishlist']],
    ['create.unit', { layer: 'domain', name: 'itemRules', feature: 'wishlist' }, ['wishlist']],
    ['create.layer', { name: 'cart', feature: 'wishlist', layers: ['page', 'domain'] }, ['wishlist']],
  ];
  for (const [id, args, features] of cases) {
    const scope = flowBlocks()[id].declaredScope(args, { root });
    assert.deepEqual(scope.files, expectedFiles(root, id, args), id);
    assert.deepEqual(scope.features, features, id);
    const step = { id: 's1', title: id, flow: id, args, executor: 'deterministic', touches: scope };
    assert.equal(validatePlan({ version: 1, ticket: { source: 'text', title: 't' }, steps: [step] }).valid, true, id);
  }
});

test('actions are derived from state: create.unit, valid args vs not', () => {
  const block = flowBlocks()['create.unit'];
  const bad = block.actions({ args: { layer: 'domain' }, root: '/x' });
  assert.deepEqual(ids(bad), ['run', 'fill-with-ai', 'view-code', 'edit-code', 'do-by-hand']);
  const run = bad.find((a) => a.id === 'run');
  assert.equal(run.enabled, false);
  assert.match(run.why, /name|feature/);
  assert.equal(bad.find((a) => a.id === 'edit-code').enabled, false);

  const root = makeTempDir('og543-');
  const good = block.actions({ args: { layer: 'domain', name: 'Cart', feature: 'cart' }, root });
  assert.deepEqual(good.map((a) => [a.id, a.kind, a.enabled]), [
    ['run', 'mechanical', true], ['fill-with-ai', 'ai', true], ['view-code', 'mechanical', true], ['edit-code', 'free', true], ['do-by-hand', 'free', true],
  ]);
  assert.equal(validateActions(good).valid, true);
});

test('actions follow executors: read-only flows offer Run only; model path only where an llm path exists; a manual-only flow offers no Run', () => {
  const st = { args: {}, root: '/x' };
  assert.deepEqual(ids(flowBlocks().validate.actions(st)), ['run']);
  assert.deepEqual(ids(flowBlocks()['refactor.move'].actions(st)), ['run', 'view-code', 'edit-code', 'do-by-hand']);
  assert.deepEqual(ids(flowBlocks()['import.route'].actions(st)), ['view-code', 'edit-code', 'do-by-hand']);
  assert.deepEqual(ids(flowBlocks()['manual.task'].actions(st)), ['do-by-hand']);
  for (const [id, flow] of Object.entries(PLAN_FLOWS)) {
    assert.equal(ids(flowBlocks()[id].actions(st)).includes('fill-with-ai'), flow.executors.includes('local-model'), id);
  }
});

test('a declared-scope writer only opens "Edit code" once the plan step declares what it touches', () => {
  const block = flowBlocks()['refactor.move'];
  const args = { name: 'Cart', feature: 'cart', from: 'domain', to: 'service' };
  const closed = block.actions({ args, root: '/x' }).find((a) => a.id === 'edit-code');
  assert.equal(closed.enabled, false);
  assert.match(closed.why, /declares what it touches/);
  const open = block.actions({ args, root: '/x', touches: { files: [{ path: 'features/cart/domain/Cart.domain.ts', change: 'move' }] } }).find((a) => a.id === 'edit-code');
  assert.equal(open.enabled, true);
});

test('every ai/free action of every flow carries all guardrails; free actions are the labelled exits', () => {
  for (const id of Object.keys(PLAN_FLOWS)) {
    for (const a of flowBlocks()[id].actions({ args: {}, root: '/x' })) {
      if (a.kind === 'mechanical') continue;
      assert.deepEqual(a.gates, [...GUARDRAILS], `${id}/${a.id}`);
      if (a.kind === 'free') assert.ok(['edit-code', 'do-by-hand'].includes(a.id), `${id}/${a.id}`);
    }
  }
});

test('run: create.feature through the real CLI reports exactly the derived files', async () => {
  const root = makeTempDir('og543-');
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'features:\n  root: features\n');
  const block = flowBlocks()['create.feature'];
  const out = await runBlock(block, { name: 'wishlist' }, { root, exec: cliExec });
  assert.deepEqual(out.changedFiles, expectedFiles(root, 'create.feature', { name: 'wishlist' }).map((f) => f.path).sort());
  assert.deepEqual(out.scope.files.map((f) => f.path).sort(), out.changedFiles);
});

test('run: reports modified and deleted files too, and a read-only flow that writes is refused', async () => {
  const root = makeTempDir('og543-');
  createFeature(root, 'wishlist');
  fs.writeFileSync(path.join(root, 'gone.txt'), 'x');
  const exec = () => { fs.appendFileSync(path.join(root, 'features/wishlist/types.ts'), '\n// edit\n'); fs.rmSync(path.join(root, 'gone.txt')); };
  const out = await runBlock(flowBlocks().sync, {}, { root, exec });
  assert.deepEqual(out.changedFiles, ['features/wishlist/types.ts', 'gone.txt']);
  await assert.rejects(runBlock(flowBlocks().validate, {}, { root, exec: () => fs.writeFileSync(path.join(root, 'new.txt'), 'x') }), { code: 'RUN_READONLY_WROTE' });
});

test('run: needs ctx.exec, and a manual step has no block behind it', async () => {
  const root = makeTempDir('og543-');
  await assert.rejects(runBlock(flowBlocks()['create.feature'], { name: 'a' }, { root }), { code: 'BLOCK_EXEC_MISSING' });
  await assert.rejects(runBlock(flowBlocks()['manual.task'], { instructions: 'x' }, { root, exec() {} }), { code: 'BLOCK_MANUAL' });
});

test('process lifecycle: read-only block whose menu is exactly allowedEvents for the state', () => {
  assert.equal(validateBlock(processLifecycleBlock, { state: { state: 'queued' }, args: {} }).valid, true);
  const menu = (state, context) => ids(processLifecycleBlock.actions({ state, context }));
  assert.deepEqual(menu('queued'), ['start', 'cancel']);
  assert.deepEqual(menu('running.active'), ['pause', 'cancel']);
  assert.deepEqual(menu('running.stopping'), []);
  assert.deepEqual(menu('paused'), ['resume', 'cancel']);
  assert.deepEqual(menu('failed'), ['retry', 'cancel']);
  assert.deepEqual(menu('done'), []);
  assert.deepEqual(menu('cancelled'), []);
  for (const s of PROCESS_STATE_PATHS) assert.equal(validateActions(processLifecycleBlock.actions({ state: s })).valid, true, s);
});

test('process lifecycle run: an event the machine accepts passes, one it refuses is named', async () => {
  const ok = await runBlock(processLifecycleBlock, { event: 'PAUSE', state: 'running.active' });
  assert.deepEqual(ok.changedFiles, []);
  await assert.rejects(runBlock(processLifecycleBlock, { event: 'RESUME', state: 'queued' }), { code: 'BLOCK_EVENT_REFUSED' });
});

test('docs/BLOCK-CONTRACT.md audits every flow, and its Scope cell is the one flowScopeKind computes', () => {
  const doc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'BLOCK-CONTRACT.md'), 'utf8');
  const rows = Object.fromEntries([...doc.matchAll(/^\| `([^`]+)` \| (empty|derived|declared) \|/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(Object.keys(rows).sort(), Object.keys(PLAN_FLOWS).sort());
  for (const [id, scope] of Object.entries(rows)) assert.equal(scope, flowScopeKind(id), id);
  const offered = Object.fromEntries([...doc.matchAll(/^\| `([^`]+)` \| (?:empty|derived|declared) \| ([^|]+) \|/gm)].map((m) => [m[1], m[2].trim()]));
  for (const id of Object.keys(PLAN_FLOWS)) assert.equal(offered[id], ids(flowBlocks()[id].actions({ args: {}, root: '/x' })).join(', '), `${id} actions`);
});
