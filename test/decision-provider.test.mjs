// #617 -- the decision-provider seam: the built-in rule-based provider needs no model, 'off' never suggests, a plugin gets
// a frozen summary and nothing else, and anything a plugin returns is validated (junk falls back to null, never a throw).
import test from 'node:test';
import assert from 'node:assert/strict';
import { defineChooser, chooserSummary } from '../packages/core/chooser.mjs';
import { DEFAULT_PROVIDER, REASON_MAX_LENGTH, getDecisionProvider, listDecisionProviders, registerDecisionProvider, suggest, unregisterDecisionProvider } from '../packages/core/decision-provider.mjs';

const opt = (id, name) => ({ id, label: `Feature ${name}`, flow: 'create.feature', args: { name } });
const chooser = defineChooser({
  id: 'app.feature',
  question: 'Which feature?',
  options: [opt('cart', 'cart'), { ...opt('wishlist', 'wishlist'), requires: ['openapi'] }, opt('orders', 'orders'), opt('users', 'users')],
});
const summary = (state = {}) => chooserSummary(chooser, state);

const plugin = async (name, fn, run) => {
  registerDecisionProvider(name, { suggest: fn });
  try {
    return await run();
  } finally {
    unregisterDecisionProvider(name);
  }
};

test('the built-ins: rules is the default, off is there, and both are frozen', () => {
  assert.equal(DEFAULT_PROVIDER, 'rules');
  assert.deepEqual(listDecisionProviders().slice(0, 2), ['rules', 'off']);
  assert.equal(Object.isFrozen(getDecisionProvider('rules')), true);
  assert.equal(Object.isFrozen(getDecisionProvider('off')), true);
  assert.equal(getDecisionProvider(), getDecisionProvider('rules'));
  assert.equal(getDecisionProvider('nope'), undefined);
});

test('rules: the first enabled option, reason "first available step", the next enabled one as runner-up; deterministic', async () => {
  const s = summary();
  assert.deepEqual(await suggest(s), { option: 'cart', reason: 'first available step', runnerUp: 'orders', provider: 'rules' });
  assert.deepEqual(await suggest(s, { provider: 'rules' }), await suggest(s));
  assert.equal(JSON.stringify(await suggest(s)), JSON.stringify(await suggest(summary())));
  const open = await suggest(summary({ facts: ['openapi'], disabled: { cart: 'Already there.' } }));
  assert.deepEqual([open.option, open.runnerUp], ['wishlist', 'orders'], 'disabled options are skipped');
  const last = await suggest(summary({ disabled: { cart: 'x', orders: 'x' } }));
  assert.deepEqual([last.option, last.runnerUp], ['users', null], 'no runner-up when only one is left');
  assert.equal(await suggest(summary({ disabled: { cart: 'x', orders: 'x', users: 'x' } })), null, 'nothing enabled, nothing to suggest');
});

test('off: never suggests', async () => {
  assert.equal(await suggest(summary(), { provider: 'off' }), null);
});

test('the built-ins cannot be replaced or removed, and a bad registration is refused', () => {
  assert.throws(() => registerDecisionProvider('rules', { suggest: () => null }), /built-in/);
  assert.throws(() => registerDecisionProvider('off', { suggest: () => null }), /built-in/);
  assert.equal(unregisterDecisionProvider('rules'), false);
  assert.deepEqual(listDecisionProviders().slice(0, 2), ['rules', 'off']);
  assert.throws(() => registerDecisionProvider('', { suggest: () => null }), /name/);
  assert.throws(() => registerDecisionProvider('x', null), /suggest/);
  assert.throws(() => registerDecisionProvider('x', {}), /suggest/);
  assert.throws(() => registerDecisionProvider('x', { suggest: 'no' }), /suggest/);
});

test('an unknown provider name, a junk summary or a non-string provider is null, never a throw', async () => {
  assert.equal(await suggest(summary(), { provider: 'nope' }), null);
  assert.equal(await suggest(summary(), { provider: { suggest: () => null } }), null);
  for (const junk of [null, undefined, 'x', [], {}, { id: 'a', options: 'x' }, { id: 'a', options: [{ id: 'a' }] }]) assert.equal(await suggest(junk), null);
});

test('a plugin receives a deep-frozen copy of the summary and nothing else: no path, no credential, no second argument', async () => {
  let seen;
  let extra;
  const state = { disabled: { cart: 'Blocked by /home/dev/secret/token and C:\\Users\\me\\.env' } };
  const s = summary(state);
  const got = await plugin('jev', (received, ...rest) => { seen = received; extra = rest; return { option: 'orders', reason: 'Fewer dependencies.', runnerUp: 'users' }; }, () => suggest(s, { provider: 'jev' }));
  assert.deepEqual(got, { option: 'orders', reason: 'Fewer dependencies.', runnerUp: 'users', provider: 'jev' });
  assert.deepEqual(extra, [], 'the summary is the only argument');
  assert.notEqual(seen, s, 'a copy, not the caller\'s object');
  assert.deepEqual(seen, s);
  assert.equal(Object.isFrozen(seen), true);
  assert.equal(Object.isFrozen(seen.options), true);
  assert.equal(Object.isFrozen(seen.options[0]), true);
  assert.throws(() => { 'use strict'; seen.options[0].enabled = false; }, TypeError);
  assert.deepEqual(Object.keys(seen).sort(), ['chosen', 'id', 'options', 'question']);
  const text = JSON.stringify(seen);
  assert.doesNotMatch(text, /home\/dev|Users|secret|token|\.env/);
  assert.equal(Object.isFrozen(s), false, 'the caller\'s own summary is left alone');
});

test('a plugin can only suggest: what comes back is reduced to option/reason/runnerUp/provider, so nothing else survives', async () => {
  let ran = false;
  const got = await plugin('sneaky', () => ({ option: 'cart', reason: '  A   reason\nover lines. ', runnerUp: 'cart', execute: () => { ran = true; }, path: '/etc/passwd' }), () => suggest(summary(), { provider: 'sneaky' }));
  assert.deepEqual(got, { option: 'cart', reason: 'A reason over lines.', runnerUp: null, provider: 'sneaky' }, 'a runner-up equal to the option is dropped');
  assert.deepEqual(Object.keys(got).sort(), ['option', 'provider', 'reason', 'runnerUp']);
  assert.equal(ran, false);
  const long = await plugin('wordy', () => ({ option: 'cart', reason: 'x'.repeat(1000) }), () => suggest(summary(), { provider: 'wordy' }));
  assert.equal(long.reason.length, REASON_MAX_LENGTH);
  assert.equal(long.runnerUp, null, 'runner-up is optional');
});

test('a plugin returning junk falls back to null: wrong option, disabled option, no reason, wrong types', async () => {
  const s = summary();
  const junk = [
    { option: 'nope', reason: 'r' },
    { option: 'wishlist', reason: 'r' }, // disabled (needs openapi)
    { option: 'cart' },
    { option: 'cart', reason: '' },
    { option: 'cart', reason: 42 },
    { option: ['cart'], reason: 'r' },
    'cart', 42, null, undefined, [], true,
  ];
  for (const [i, value] of junk.entries()) {
    assert.equal(await plugin('bad', () => value, () => suggest(s, { provider: 'bad' })), null, `junk #${i}`);
  }
  assert.equal(await plugin('async-junk', async () => 'nonsense', () => suggest(s, { provider: 'async-junk' })), null);
  assert.equal((await plugin('bad-runner', () => ({ option: 'cart', reason: 'r', runnerUp: 'wishlist' }), () => suggest(s, { provider: 'bad-runner' }))).runnerUp, null, 'a disabled runner-up is dropped, the suggestion kept');
});

test('a plugin that throws, rejects or hangs falls back to null (a hung plugin never blocks a chooser)', async () => {
  const s = summary();
  assert.equal(await plugin('boom', () => { throw new Error('model down'); }, () => suggest(s, { provider: 'boom' })), null);
  assert.equal(await plugin('reject', () => Promise.reject(new Error('timeout upstream')), () => suggest(s, { provider: 'reject' })), null);
  const start = Date.now();
  assert.equal(await plugin('hang', () => new Promise(() => {}), () => suggest(s, { provider: 'hang', timeoutMs: 30 })), null);
  assert.ok(Date.now() - start < 2000);
});

test('a suggestion never changes the summary or picks for the person: chosen stays what the state says', async () => {
  const s = summary();
  const before = JSON.stringify(s);
  await suggest(s);
  assert.equal(JSON.stringify(s), before);
  assert.equal(s.chosen, null);
});
