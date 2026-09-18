import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  compileWorkflow,
  generateWorkflow,
  extractEventNames,
  eventsToEnvelope,
} from '../src/engine/workflowGenerator.mjs';
import { createFeature } from '../src/generators.mjs';
import { validateArchitecture, detectLayerViolations } from '../src/architecture-enforcer.mjs';
import { parseToAst } from '../src/parser.mjs';
import { ConstructError, EXIT_CODES } from '../src/diagnostics.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..');
const bin = path.join(REPO_ROOT, 'bin', 'construct.mjs');
const CHECKOUT_DESCRIPTOR = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'fixtures', 'workflow-graphs', 'checkout.json'), 'utf8'));

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-workflow-test-'));
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n');
  createFeature(dir, 'checkout');
  return dir;
}

/** Real tsc --noEmit style check via the compiler API's Program, with a
 * minimal ambient `xstate` module stub (the repo doesn't install the real
 * `xstate` package -- generated files only ever run inside a *target*
 * project that does) so only this generator's own output is being checked,
 * not a third-party library's types. */
function tscCheck(tsxSource) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-workflow-tsc-'));
  const file = path.join(dir, 'Workflow.tsx');
  fs.writeFileSync(file, tsxSource);
  fs.writeFileSync(path.join(dir, 'xstate.d.ts'), `declare module 'xstate' {\n  export function setup(config: any): { createMachine(config: any): any };\n}\n`);

  const program = ts.createProgram([file, path.join(dir, 'xstate.d.ts')], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: false,
    noEmit: true,
    skipLibCheck: true,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  fs.rmSync(dir, { recursive: true, force: true });
  return diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

// ---- descriptor validation --------------------------------------------

test('compileWorkflow rejects a descriptor missing "states"', () => {
  assert.throws(() => compileWorkflow({ initial: 'idle' }, { name: 'X' }), (err) => {
    assert.ok(err instanceof ConstructError);
    assert.match(err.message, /"states"/);
    return true;
  });
});

test('compileWorkflow rejects a descriptor missing "initial"', () => {
  assert.throws(() => compileWorkflow({ states: { idle: {} } }, { name: 'X' }), /"initial"/);
});

test('compileWorkflow rejects an "initial" not present among "states"', () => {
  assert.throws(() => compileWorkflow({ initial: 'nope', states: { idle: {} } }, { name: 'X' }), /not one of its declared states/);
});

test('compileWorkflow rejects a malformed transition target', () => {
  const descriptor = { initial: 'idle', states: { idle: { on: { GO: { noTarget: true } } } } };
  assert.throws(() => compileWorkflow(descriptor, { name: 'X' }), /Invalid transition target/);
});

// ---- event extraction ---------------------------------------------------

test('extractEventNames collects every distinct event across states, deduped, in first-appearance order', () => {
  const events = extractEventNames(CHECKOUT_DESCRIPTOR.states);
  assert.deepEqual(events, ['SUBMIT', 'SUCCESS', 'FAILURE']);
});

test('eventsToEnvelope shapes event names into the Context Envelope events array', () => {
  assert.deepEqual(eventsToEnvelope(['SUBMIT', 'SUCCESS']), [
    { type: 'SUBMIT', payload: {} },
    { type: 'SUCCESS', payload: {} },
  ]);
});

// ---- compileWorkflow: AST synthesis output shape -------------------------

test('compileWorkflow emits a real setup(...).createMachine(...) XState v5 call with the right structure', () => {
  const { source, events, contextFields } = compileWorkflow(CHECKOUT_DESCRIPTOR, { name: 'Checkout' });

  assert.deepEqual(events, ['SUBMIT', 'SUCCESS', 'FAILURE']);
  assert.deepEqual(contextFields, ['quantity', 'error']);

  assert.match(source, /import \{ setup \} from 'xstate';/);
  assert.match(source, /export interface CheckoutContext \{/);
  assert.match(source, /quantity: number;/);
  assert.match(source, /error: string \| null;/);
  assert.match(source, /export type CheckoutEvent =/);
  assert.match(source, /type: "SUBMIT";/);
  assert.match(source, /export const CheckoutWorkflow = setup\(\{/);
  assert.match(source, /\}\)\.createMachine\(\{/);
  assert.match(source, /id: 'checkout',/);
  assert.match(source, /initial: 'idle',/);
  assert.match(source, /context: \{ quantity: 1, error: null \}/); // runtime defaults

  // Shorthand string target for a guardless transition ...
  assert.match(source, /SUBMIT: "submitting"/);
  assert.match(source, /SUCCESS: "done"/);
  // ... vs. the full object form once a guard is present.
  assert.match(source, /FAILURE: \{ target: "idle", guard: "hasError" \}/);
  assert.match(source, /type: "final"/);
});

test('compileWorkflow supports array-form (multi-guarded) transitions', () => {
  const descriptor = {
    initial: 'idle',
    states: {
      idle: { on: { GO: [{ target: 'a', guard: 'isA' }, { target: 'b' }] } },
      a: {},
      b: {},
    },
  };
  const { source } = compileWorkflow(descriptor, { name: 'Multi' });
  assert.match(source, /GO: \[\s*\{ target: "a", guard: "isA" \},\s*"b"\s*\]/);
});

test('compileWorkflow with no context declared falls back to a Record<string, never> alias (still valid TS)', () => {
  const { source, contextFields } = compileWorkflow({ initial: 'idle', states: { idle: {} } }, { name: 'Bare' });
  assert.deepEqual(contextFields, []);
  assert.match(source, /export type BareContext = Record<string, never>;/);
  assert.doesNotMatch(source, /context: \{/); // no defaults given -> no runtime context object emitted
});

test('compileWorkflow with no events at all still emits syntactically valid TS', () => {
  const { source, events } = compileWorkflow({ initial: 'idle', states: { idle: {} } }, { name: 'NoEvents' });
  assert.deepEqual(events, []);
  assert.doesNotThrow(() => parseToAst(source));
});

// ---- the generated output is real, valid, clean TypeScript ---------------

test('compileWorkflow output parses cleanly via typescript-estree', () => {
  const { source } = compileWorkflow(CHECKOUT_DESCRIPTOR, { name: 'Checkout' });
  assert.doesNotThrow(() => parseToAst(source));
});

test('compileWorkflow output compiles cleanly under tsc --noEmit (against a minimal xstate ambient stub)', () => {
  const { source } = compileWorkflow(CHECKOUT_DESCRIPTOR, { name: 'Checkout' });
  const diagnostics = tscCheck(source);
  assert.deepEqual(diagnostics, [], `expected zero tsc diagnostics, got:\n${diagnostics.join('\n')}`);
});

// ---- WORKFLOW-001: generator output trivially passes; the rule still catches corruption

test('the generated workflow source itself trips no WORKFLOW-001 violation (never imports React/UI)', () => {
  const { source } = compileWorkflow(CHECKOUT_DESCRIPTOR, { name: 'Checkout' });
  const violations = detectLayerViolations('workflow', source);
  assert.deepEqual(violations.filter((v) => v.rule === 'WORKFLOW-001'), []);
});

test('WORKFLOW-001 regression: corrupting this generator\'s own clean output with a React import is still caught', () => {
  const { source } = compileWorkflow(CHECKOUT_DESCRIPTOR, { name: 'Checkout' });
  const corrupted = `import { useState } from 'react';\n${source}`;
  const violations = detectLayerViolations('workflow', corrupted);
  assert.ok(violations.some((v) => v.rule === 'WORKFLOW-001'));
});

// ---- generateWorkflow: filesystem-backed, end-to-end via validateArchitecture

test('generateWorkflow writes a workflow file that passes construct validate cleanly', () => {
  const dir = tmpProject();
  const { file, events, contextFields } = generateWorkflow(dir, 'Checkout', 'checkout', CHECKOUT_DESCRIPTOR);

  assert.equal(file, path.join(dir, 'features', 'checkout', 'workflows', 'CheckoutWorkflow.tsx'));
  assert.deepEqual(events, ['SUBMIT', 'SUCCESS', 'FAILURE']);
  assert.deepEqual(contextFields, ['quantity', 'error']);
  assert.equal(fs.existsSync(file), true);

  const { violations } = validateArchitecture(dir);
  assert.deepEqual(violations.filter((v) => v.severity === 'error'), []);
});

// ---- end-to-end via the real CLI binary ------------------------------------

test('construct create workflow <name> --feature <f> --from <path> compiles end to end and construct validate passes', () => {
  const dir = tmpProject();
  const res = spawnSync('node', [
    bin, 'create', 'workflow', 'Checkout', '--feature', 'checkout', '--from', path.join(REPO_ROOT, 'fixtures', 'workflow-graphs', 'checkout.json'),
  ], { encoding: 'utf8', cwd: dir });

  assert.equal(res.status, EXIT_CODES.OK, res.stderr);
  assert.match(res.stdout, /CheckoutWorkflow\.tsx/);
  assert.match(res.stdout, /3 event\(s\): SUBMIT, SUCCESS, FAILURE/);

  const validateRes = spawnSync('node', [bin, 'validate'], { encoding: 'utf8', cwd: dir });
  assert.equal(validateRes.status, EXIT_CODES.OK, validateRes.stdout);
});

test('construct create workflow: malformed descriptor JSON is a usage error, not an internal crash', () => {
  const dir = tmpProject();
  const badPath = path.join(dir, 'bad.json');
  fs.writeFileSync(badPath, '{ not valid json');
  const res = spawnSync('node', [bin, 'create', 'workflow', 'Checkout', '--feature', 'checkout', '--from', badPath], { encoding: 'utf8', cwd: dir });
  assert.equal(res.status, EXIT_CODES.USAGE_ERROR);
  assert.match(res.stderr, /Malformed workflow descriptor JSON/);
});

test('construct create workflow: a missing descriptor file is a usage error naming the path', () => {
  const dir = tmpProject();
  const res = spawnSync('node', [bin, 'create', 'workflow', 'Checkout', '--feature', 'checkout', '--from', path.join(dir, 'nope.json')], { encoding: 'utf8', cwd: dir });
  assert.equal(res.status, EXIT_CODES.USAGE_ERROR);
  assert.match(res.stderr, /Workflow descriptor not found/);
});
