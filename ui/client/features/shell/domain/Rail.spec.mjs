import test from 'node:test';
import assert from 'node:assert/strict';
import { railNextIndex } from './RailKeys.ts';
import { parseRailCollapsed, serializeRailCollapsed } from './RailState.ts';
import { isProjectFreeRoute, shellMode } from './ProjectRequirement.ts';

test('rail keys: arrows wrap, Home/End jump, other keys are not the rail\'s', () => {
  assert.equal(railNextIndex('ArrowDown', 0, 5), 1);
  assert.equal(railNextIndex('ArrowDown', 4, 5), 0);
  assert.equal(railNextIndex('ArrowUp', 0, 5), 4);
  assert.equal(railNextIndex('ArrowRight', 1, 5), 2);
  assert.equal(railNextIndex('ArrowLeft', 1, 5), 0);
  assert.equal(railNextIndex('Home', 3, 5), 0);
  assert.equal(railNextIndex('End', 1, 5), 4);
  assert.equal(railNextIndex('Enter', 1, 5), null);
  assert.equal(railNextIndex('ArrowDown', 0, 0), null);
});

test('rail state: only the exact word collapsed collapses; garbage is expanded', () => {
  assert.equal(parseRailCollapsed('collapsed'), true);
  assert.equal(parseRailCollapsed('expanded'), false);
  assert.equal(parseRailCollapsed(null), false);
  assert.equal(parseRailCollapsed('yes'), false);
  assert.equal(parseRailCollapsed(serializeRailCollapsed(true)), true);
  assert.equal(parseRailCollapsed(serializeRailCollapsed(false)), false);
});

test('shell mode: unknown loads, a project opens the shell, none gates everything but the profile-menu pages', () => {
  assert.equal(shellMode(false, null, '/'), 'loading');
  assert.equal(shellMode(true, '/ws/shop', '/pages'), 'full');
  for (const p of ['/', '/plan', '/pages', '/tests', '/workflows', '/review', '/wizard', '/dashboard', '/states']) assert.equal(shellMode(true, null, p), 'gate', p);
  for (const p of ['/settings', '/ollama', '/help']) assert.equal(shellMode(true, null, p), 'page', p);
  assert.equal(isProjectFreeRoute('/settingsx'), false);
});
