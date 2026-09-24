// #543 -- the uniform block contract { id, writes, declaredScope, actions, run }: shape validator, derived actions,
// guardrails on ai/free actions, and the run-result check. Fails by named code, never by message text.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_KINDS,
  GUARDRAILS,
  BLOCK_ERROR_CODES,
  emptyScope,
  isEmptyScope,
  validateScope,
  validateAction,
  validateActions,
  validateBlock,
  defineBlock,
  deriveActions,
  runBlock,
} from '../packages/core/block-contract.mjs';
import { validatePlan, PLAN_ERROR_CODES } from '../packages/core/plan.mjs';

const codes = (r) => r.errors.map((e) => e.code);
const reader = (over = {}) => ({ id: 'validate', writes: false, declaredScope: () => emptyScope(), actions: () => [], run: () => ({ changedFiles: [] }), ...over });
const writer = (over = {}) => ({
  id: 'create.unit',
  writes: true,
  declaredScope: () => ({ features: ['cart'], files: [{ path: 'features/cart/domain/Cart.domain.ts', change: 'create', layer: 'domain' }] }),
  actions: () => [],
  run: () => ({ changedFiles: ['features/cart/domain/Cart.domain.ts'] }),
  ...over,
});

test('kinds and guardrails are the closed sets the issue names', () => {
  assert.deepEqual([...ACTION_KINDS], ['mechanical', 'ai', 'free']);
  assert.deepEqual([...GUARDRAILS], ['containment', 'approval', 'sessionGate', 'checks']);
});

test('a well-formed reader and writer both validate, and defineBlock freezes them', () => {
  assert.equal(validateBlock(reader(), { state: {}, args: {} }).valid, true);
  assert.equal(validateBlock(writer(), { state: {}, args: {} }).valid, true);
  const block = defineBlock(reader());
  assert.equal(Object.isFrozen(block), true);
  assert.equal(block.id, 'validate');
});

test('block shape: every missing or mistyped part is named by code', () => {
  assert.deepEqual(codes(validateBlock(null)), ['BLOCK_NOT_OBJECT']);
  assert.deepEqual(codes(validateBlock([])), ['BLOCK_NOT_OBJECT']);
  assert.deepEqual(codes(validateBlock(reader({ id: '' }))), ['BLOCK_ID_INVALID']);
  assert.deepEqual(codes(validateBlock(reader({ id: 'has space' }))), ['BLOCK_ID_INVALID']);
  assert.deepEqual(codes(validateBlock(reader({ writes: 'no' }))), ['BLOCK_WRITES_INVALID']);
  const noFns = validateBlock({ id: 'x', writes: false });
  assert.deepEqual(codes(noFns), ['BLOCK_FIELD_NOT_FUNCTION', 'BLOCK_FIELD_NOT_FUNCTION', 'BLOCK_FIELD_NOT_FUNCTION']);
  assert.deepEqual(noFns.errors.map((e) => e.path), ['declaredScope', 'actions', 'run']);
  assert.throws(() => defineBlock(reader({ run: 'nope' })), /BLOCK_FIELD_NOT_FUNCTION/);
});

test('scope: is exactly a step\'s touches, so a valid scope passes validatePlan as touches', () => {
  const scope = writer().declaredScope();
  assert.equal(validateScope(scope).valid, true);
  const plan = { version: 1, ticket: { source: 'text', title: 't' }, steps: [{ id: 's1', title: 'x', flow: 'create.unit', args: { layer: 'domain', name: 'Cart', feature: 'cart' }, executor: 'deterministic', touches: scope }] };
  assert.equal(validatePlan(plan).valid, true);
  // and what validatePlan rejects, the contract rejects
  for (const bad of [{ files: [{ path: '/abs/x.ts', change: 'create' }] }, { files: [{ path: 'a.ts', change: 'explode' }] }, { nope: [] }, 'x']) {
    assert.equal(validateScope(bad).valid, false, JSON.stringify(bad));
    assert.equal(validatePlan({ ...plan, steps: [{ ...plan.steps[0], touches: bad }] }).errors.some((e) => e.code.startsWith('STEP_TOUCHES')), true);
  }
  assert.ok(PLAN_ERROR_CODES.STEP_TOUCHES_INVALID);
});

test('scope: empty for a read-only block, never null for one, null allowed for a writer that cannot derive it', () => {
  assert.equal(isEmptyScope(emptyScope()), true);
  assert.equal(isEmptyScope(null), false, 'unknown is not empty');
  assert.equal(isEmptyScope({ features: ['a'], files: [] }), false);
  assert.deepEqual(codes(validateBlock(reader({ declaredScope: () => ({ features: ['cart'], files: [] }) }), { args: {} })), ['BLOCK_SCOPE_NOT_EMPTY']);
  assert.deepEqual(codes(validateBlock(reader({ declaredScope: () => null }), { args: {} })), ['BLOCK_SCOPE_NULL']);
  assert.equal(validateBlock(writer({ declaredScope: () => null }), { args: {} }).valid, true);
  assert.deepEqual(codes(validateBlock(writer({ declaredScope: () => ({ files: [{ path: '/x', change: 'create' }] }) }), { args: {} })), ['BLOCK_SCOPE_INVALID']);
});

test('a throwing actions() or declaredScope() is reported, not thrown', () => {
  const boom = () => { throw new Error('boom'); };
  assert.deepEqual(codes(validateBlock(reader({ actions: boom }), { state: {} })), ['BLOCK_ACTIONS_INVALID']);
  assert.deepEqual(codes(validateBlock(reader({ declaredScope: boom }), { args: {} })), ['BLOCK_SCOPE_INVALID']);
});

test('deriveActions: applies filters, blockedBy disables with the rule\'s why, order is the rule table\'s', () => {
  const rules = [
    { id: 'run', kind: 'mechanical', label: 'Run', blockId: 'create.unit', requires: ['args-valid'], blockedBy: (s) => (s.valid ? null : 'The arguments are not valid yet.') },
    { id: 'ai', kind: 'ai', label: 'Fill with AI', applies: (s) => s.model },
    { id: 'edit', kind: 'free', label: 'Edit code' },
  ];
  const off = deriveActions(rules, { valid: false, model: false });
  assert.deepEqual(off.map((a) => a.id), ['run', 'edit']);
  assert.equal(off[0].enabled, false);
  assert.equal(off[0].why, 'The arguments are not valid yet.');
  assert.deepEqual(off[0].requires, ['args-valid']);
  assert.equal(off[0].blockId, 'create.unit');
  const on = deriveActions(rules, { valid: true, model: true });
  assert.deepEqual(on.map((a) => [a.id, a.enabled]), [['run', true], ['ai', true], ['edit', true]]);
  assert.equal('why' in on[0], false);
  assert.equal(validateActions(on).valid, true);
  assert.equal(validateActions(off).valid, true);
  assert.deepEqual(deriveActions(rules, { valid: true, model: true }), on, 'deterministic');
  assert.deepEqual(deriveActions([], {}), []);
});

test('guardrails: deriveActions stamps every ai/free action with all of them, mechanical ones need none', () => {
  const acts = deriveActions([
    { id: 'm', kind: 'mechanical', label: 'M' },
    { id: 'a', kind: 'ai', label: 'A' },
    { id: 'f', kind: 'free', label: 'F' },
  ]);
  assert.equal('gates' in acts[0], false);
  assert.deepEqual(acts[1].gates, [...GUARDRAILS]);
  assert.deepEqual(acts[2].gates, [...GUARDRAILS]);
});

test('guardrails never switch off: a hand-built ai/free action missing any gate is rejected, one gate at a time', () => {
  for (const kind of ['ai', 'free']) {
    assert.equal(validateAction({ id: 'x', kind, label: 'X', enabled: true, gates: [...GUARDRAILS] }).valid, true);
    assert.deepEqual(codes(validateAction({ id: 'x', kind, label: 'X', enabled: true })), ['ACTION_GATES_MISSING']);
    for (const g of GUARDRAILS) {
      const r = validateAction({ id: 'x', kind, label: 'X', enabled: true, gates: GUARDRAILS.filter((k) => k !== g) });
      assert.deepEqual(codes(r), ['ACTION_GATES_MISSING'], `${kind} without ${g}`);
      assert.match(r.errors[0].message, new RegExp(g));
    }
  }
});

test('action shape: kind, label, enabled, why-when-disabled, unique ids, all by code', () => {
  const ok = { id: 'run', kind: 'mechanical', label: 'Run', enabled: true };
  assert.deepEqual(codes(validateAction(null)), ['ACTION_NOT_OBJECT']);
  assert.deepEqual(codes(validateAction({ ...ok, id: '' })), ['ACTION_ID_INVALID']);
  assert.deepEqual(codes(validateAction({ ...ok, kind: 'magic' })), ['ACTION_KIND_INVALID']);
  assert.deepEqual(codes(validateAction({ ...ok, label: '' })), ['ACTION_LABEL_INVALID']);
  assert.deepEqual(codes(validateAction({ ...ok, enabled: 1 })), ['ACTION_FIELD_INVALID']);
  assert.deepEqual(codes(validateAction({ ...ok, enabled: false })), ['ACTION_WHY_MISSING']);
  assert.deepEqual(codes(validateAction({ ...ok, requires: 'x' })), ['ACTION_FIELD_INVALID']);
  assert.deepEqual(codes(validateAction({ ...ok, blockId: 3 })), ['ACTION_FIELD_INVALID']);
  assert.deepEqual(codes(validateActions([ok, ok])), ['ACTION_ID_DUPLICATE']);
  assert.deepEqual(codes(validateActions('nope')), ['BLOCK_ACTIONS_INVALID']);
  assert.ok(Object.keys(BLOCK_ERROR_CODES).every((k) => BLOCK_ERROR_CODES[k] === k));
});

test('runBlock: returns the declared scope and the sorted, de-duplicated changed files', async () => {
  const block = defineBlock(writer({ run: () => ({ changedFiles: ['b.ts', 'a.ts', 'b.ts'] }) }));
  const out = await runBlock(block, { name: 'Cart' }, {});
  assert.deepEqual(out.changedFiles, ['a.ts', 'b.ts']);
  assert.equal(out.scope.features[0], 'cart');
  const asyncBlock = defineBlock(writer({ run: async () => ({ changedFiles: ['x.ts'] }) }));
  assert.deepEqual((await runBlock(asyncBlock)).changedFiles, ['x.ts']);
});

test('runBlock: passes scope, args and ctx to run, in that order', async () => {
  let seen;
  const block = defineBlock(writer({ run: (scope, args, ctx) => { seen = { scope, args, ctx }; return { changedFiles: [] }; } }));
  await runBlock(block, { a: 1 }, { root: '/r' });
  assert.deepEqual(seen.args, { a: 1 });
  assert.deepEqual(seen.ctx, { root: '/r' });
  assert.equal(seen.scope.features[0], 'cart');
});

test('runBlock: a malformed result, an absolute path, or a read-only block that writes is refused by code', async () => {
  const bad = async (block) => runBlock(defineBlock(block)).then(() => null, (e) => e.code);
  assert.equal(await bad(writer({ run: () => undefined })), 'RUN_RESULT_INVALID');
  assert.equal(await bad(writer({ run: () => ({ changedFiles: 'a.ts' }) })), 'RUN_RESULT_INVALID');
  assert.equal(await bad(writer({ run: () => ({ changedFiles: ['/etc/passwd'] }) })), 'RUN_RESULT_INVALID');
  assert.equal(await bad(reader({ run: () => ({ changedFiles: ['a.ts'] }) })), 'RUN_READONLY_WROTE');
});
