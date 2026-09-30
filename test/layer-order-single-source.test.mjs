// LIN-147: LAYER_ORDER/LAYER_PREREQUISITES must have exactly one source of
// truth (packages/core/generators.mjs). Every consumer imports it rather
// than keeping its own copy — summarize.mjs used to hardcode a stale copy
// (missing expression/adapter/viewmodel) at line ~242, which this guards
// against regressing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAYER_ORDER, LAYER_PREREQUISITES } from '../packages/core/generators.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const coreDir = path.join(here, '..', 'packages', 'core');

const CONSUMERS = ['placement.mjs', 'plan-touches.mjs', 'mechanical-plan.mjs', 'summarize.mjs'];

// A local `const LAYER_ORDER = [...]` (or `=[...]`) redefinition is the drift
// bug: it silently forks from generators.mjs's list. Importing the name is fine.
const LOCAL_REDEFINITION = /\bconst\s+LAYER_ORDER\s*=\s*\[/;
const LOCAL_PREREQ_REDEFINITION = /\bconst\s+LAYER_PREREQUISITES\s*=\s*\{/;
const IMPORTS_FROM_GENERATORS = (name) => new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"]\\./generators\\.mjs['"]`);

test('LIN-147 every LAYER_ORDER consumer imports it from generators.mjs instead of keeping its own copy', () => {
  for (const file of CONSUMERS) {
    const source = fs.readFileSync(path.join(coreDir, file), 'utf8');
    assert.doesNotMatch(source, LOCAL_REDEFINITION, `${file} redefines LAYER_ORDER locally instead of importing it`);
    assert.match(source, IMPORTS_FROM_GENERATORS('LAYER_ORDER'), `${file} does not import LAYER_ORDER from generators.mjs`);
  }
});

test('LIN-147 placement.mjs imports LAYER_PREREQUISITES from generators.mjs instead of keeping its own copy', () => {
  const source = fs.readFileSync(path.join(coreDir, 'placement.mjs'), 'utf8');
  assert.doesNotMatch(source, LOCAL_PREREQ_REDEFINITION, 'placement.mjs redefines LAYER_PREREQUISITES locally instead of importing it');
  assert.match(source, IMPORTS_FROM_GENERATORS('LAYER_PREREQUISITES'), 'placement.mjs does not import LAYER_PREREQUISITES from generators.mjs');
});

test('LIN-147 LAYER_ORDER carries every new vm-chain layer (expression, adapter, viewmodel) alongside the original layers', () => {
  for (const layer of ['domain', 'service', 'workflow', 'hook', 'component', 'expression', 'adapter', 'page', 'controller', 'viewmodel']) {
    assert.ok(LAYER_ORDER.includes(layer), `LAYER_ORDER is missing "${layer}"`);
  }
});

test('LIN-147/LIN-163 LAYER_PREREQUISITES keeps controller ahead of viewmodel (viewmodel stub imports the controller)', () => {
  assert.deepEqual(LAYER_PREREQUISITES.viewmodel, ['controller']);
  assert.ok(LAYER_ORDER.indexOf('controller') < LAYER_ORDER.indexOf('viewmodel'));
  assert.ok(LAYER_ORDER.indexOf('page') < LAYER_ORDER.indexOf('controller'));
});
