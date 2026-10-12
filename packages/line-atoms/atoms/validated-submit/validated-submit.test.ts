import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machine, validatedSubmit, fieldErrors, fromValibot } from './index.ts';
import type { Schema } from './index.ts';
import { kitFor } from '../../testkit.mjs';

const kit = kitFor(machine);

type Form = { name: string; email: string; terms: boolean };
// A hand-made schema with zod's safeParse shape (the real zod is tried below when it is installed).
const schema: Schema<Form, Form> = {
  safeParse(v) {
    const issues = [];
    if (!v.name) issues.push({ path: ['name'], message: 'Full name is required' });
    if (!/^[^@\s]+@[^@\s]+\.[a-z]+$/i.test(v.email)) issues.push({ path: ['email'], message: 'Enter a valid email' });
    if (!v.terms) issues.push({ path: ['terms'], message: 'Accept the terms to continue' });
    if (issues.length) return { success: false, error: { issues } };
    return { success: true, data: v };
  },
};
const empty: Form = { name: '', email: '', terms: false };
const good: Form = { name: 'Ada', email: 'ada@example.com', terms: true };

test('an invalid submit reports one message per field and never submits', () => {
  let s = kit.init({ schema, values: empty });
  assert.equal(s.status, 'idle');
  s = kit.send(s, { type: 'EDIT', values: { ...empty, name: '' } });
  assert.equal(s.status, 'idle');
  s = kit.send(s, { type: 'SUBMIT' });
  assert.equal(s.status, 'invalid');
  assert.deepEqual(s.errors, { name: 'Full name is required', email: 'Enter a valid email', terms: 'Accept the terms to continue' });
  s = kit.send(s, { type: 'EDIT', values: { ...empty, name: 'Ada' } });
  assert.equal(s.status, 'invalid');
  assert.deepEqual(Object.keys(s.errors), ['email', 'terms'], 'editing a field clears only its own error');
  s = kit.send(s, { type: 'SUBMIT' });
  assert.equal(s.status, 'invalid');
});

test('a valid submit goes submitting then submitted; a second SUBMIT while submitting is ignored', () => {
  let s = kit.init({ schema, values: good });
  s = kit.send(s, { type: 'SUBMIT' });
  assert.equal(s.status, 'submitting');
  assert.equal(s.attempts, 1);
  assert.equal(kit.send(s, { type: 'SUBMIT' }), s);
  assert.equal(kit.send(s, { type: 'EDIT', values: empty }), s, 'values are locked while submitting');
  s = kit.send(s, { type: 'RESOLVE', result: { order: 7 } });
  assert.equal(s.status, 'submitted');
  assert.deepEqual(s.result, { order: 7 });
  assert.equal(kit.send(s, { type: 'RESOLVE', result: 1 }), s, 'RESOLVE outside submitting is ignored');
  s = kit.send(s, { type: 'EDIT', values: good });
  assert.equal(s.status, 'submitted');
  s = kit.send(s, { type: 'RESET', values: empty });
  assert.equal(s.status, 'idle');
  assert.deepEqual(s.values, empty);
});

test('a failed submit can be edited and retried', () => {
  let s = kit.init({ schema, values: good });
  s = kit.send(s, { type: 'SUBMIT' });
  assert.equal(kit.send(kit.init({ schema, values: good }), { type: 'REJECT', error: 'x' }).status, 'idle', 'REJECT outside submitting is ignored');
  s = kit.send(s, { type: 'REJECT', error: new Error('network') });
  assert.equal(s.status, 'failed');
  s = kit.send(s, { type: 'EDIT', values: { ...good, name: 'Ada L.' } });
  assert.equal(s.status, 'failed');
  s = kit.send(s, { type: 'SUBMIT' });
  assert.equal(s.status, 'submitting');
  assert.equal(s.attempts, 2);
  s = kit.send(s, { type: 'RESET' });
  assert.equal(s.status, 'idle');
});

test('validatedSubmit runs the whole round: submitted, failed or invalid', async () => {
  const sent: Form[] = [];
  const ok = await validatedSubmit(machine.init({ schema, values: good }), async (d: Form) => { sent.push(d); return 'order-1'; });
  assert.equal(ok.status, 'submitted');
  assert.equal(ok.result, 'order-1');
  const failed = await validatedSubmit(machine.init({ schema, values: good }), async () => { throw new Error('down'); });
  assert.equal(failed.status, 'failed');
  const invalid = await validatedSubmit(machine.init({ schema, values: good }), async () => 'never', empty);
  assert.equal(invalid.status, 'invalid');
  assert.equal(sent.length, 1);
});

test('fieldErrors keeps the first message per nested path', () => {
  assert.deepEqual(fieldErrors([{ path: ['address', 'city'], message: 'a' }, { path: ['address', 'city'], message: 'b' }, { path: [], message: 'root' }]), { 'address.city': 'a', '': 'root' });
});

test('a valibot-style safeParse plugs in through fromValibot', () => {
  const v = fromValibot<Form, Form>((x) => (x.name ? { success: true, output: x } : { success: false, issues: [{ path: [{ key: 'name' }], message: 'Full name is required' }] }));
  assert.equal(machine.send(machine.init({ schema: v, values: empty }), { type: 'SUBMIT' }).errors.name, 'Full name is required');
  assert.equal(machine.send(machine.init({ schema: v, values: good }), { type: 'SUBMIT' }).status, 'submitting');
});

test('a real zod schema is the schema input as it is (when zod is installed)', async (t) => {
  let z: any;
  try { z = (await import('zod')).z; } catch { t.skip('zod is not installed here'); return; }
  const zs = z.object({ name: z.string().min(1, 'Full name is required'), email: z.string().email('Enter a valid email'), terms: z.literal(true, { message: 'Accept the terms to continue' }) });
  const bad = machine.send(machine.init({ schema: zs, values: empty }), { type: 'SUBMIT' });
  assert.equal(bad.status, 'invalid');
  assert.equal(bad.errors.name, 'Full name is required');
  assert.equal(bad.errors.email, 'Enter a valid email');
  assert.equal(machine.send(machine.init({ schema: zs, values: good }), { type: 'SUBMIT' }).status, 'submitting');
});

test('the test kit covered every state, event and transition', () => kit.assertComplete());
