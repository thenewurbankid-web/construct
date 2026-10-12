import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machine, can, covers, permissionsOf, missingPermissions, checkPermission } from './index.ts';
import { kitFor } from '../../testkit.mjs';

const kit = kitFor(machine);
const table = { admin: ['*'], manager: ['orders:*', 'reports:read'], clerk: ['orders:read'] };
const clerk = { id: 'u1', roles: ['clerk'] };
const manager = { id: 'u2', roles: ['manager'] };

test('checks: allowed, denied with what is missing, any-of, and a new user resets', () => {
  let s = kit.init({ user: clerk, table });
  assert.equal(s.status, 'unchecked');
  s = kit.send(s, { type: 'CHECK', require: 'orders:read' });
  assert.equal(s.status, 'allowed');
  s = kit.send(s, { type: 'CHECK', require: ['orders:read', 'orders:refund'] });
  assert.equal(s.status, 'denied');
  assert.deepEqual(s.missing, ['orders:refund']);
  s = kit.send(s, { type: 'CHECK', require: ['orders:read', 'orders:refund'], mode: 'any' });
  assert.equal(s.status, 'allowed');
  s = kit.send(s, { type: 'SET_USER', user: manager });
  assert.equal(s.status, 'unchecked');
  s = kit.send(s, { type: 'CHECK', require: 'orders:refund' });
  assert.equal(s.status, 'allowed', 'orders:* covers every orders action');
  s = kit.send(s, { type: 'SET_USER', user: null });
  s = kit.send(s, { type: 'CHECK', require: 'orders:read' });
  assert.equal(s.status, 'denied', 'nobody signed in is denied');
});

test('helpers: covers, permissionsOf, missingPermissions, can, checkPermission', () => {
  assert.equal(covers('*', 'anything:at-all'), true);
  assert.equal(covers('orders:*', 'orders:read'), true);
  assert.equal(covers('orders:*', 'ordersx:read'), false);
  assert.equal(covers('orders:read', 'orders:write'), false);
  assert.deepEqual([...permissionsOf({ id: 'x', roles: ['clerk', 'ghost'] }, table)], ['orders:read'], 'an unknown role grants nothing');
  assert.deepEqual(missingPermissions(clerk, table, ['reports:read']), ['reports:read']);
  assert.equal(can({ id: 'a', roles: ['admin'] }, table, ['reports:delete', 'users:ban']), true);
  assert.equal(can(clerk, table, []), true, 'nothing required is allowed');
  assert.deepEqual(checkPermission(clerk, table, 'reports:read'), { allowed: false, missing: ['reports:read'] });
});

test('the test kit covered every state, event and transition', () => kit.assertComplete());
