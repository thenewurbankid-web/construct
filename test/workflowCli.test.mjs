// Epic #185 / #188 -- `construct research workflow`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_CODES } from '../src/diagnostics.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, '..', 'bin', 'construct.mjs');
const fixtures = path.join(here, '..', 'fixtures', 'workflow-graphs');
const run = (args, cwd) => spawnSync('node', [bin, ...args], { encoding: 'utf8', cwd });

function project() {
  const dir = makeTempDir('construct-wf-');
  assert.equal(run(['create', 'feature', 'refunds'], dir).status, 0);
  const wf = path.join(dir, 'features', 'refunds', 'workflows');
  fs.mkdirSync(wf, { recursive: true });
  fs.copyFileSync(path.join(fixtures, 'refund-request.ts'), path.join(wf, 'RefundRequestWorkflow.ts'));
  fs.writeFileSync(path.join(wf, 'Plain.ts'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(wf, 'Broken.ts'), "export const m = createMachine({ ...base, initial: 'a', states: { a: {} } });\n");
  fs.writeFileSync(path.join(dir, 'secret.ts'), 'export const m = createMachine({ initial: "a", states: { a: {} } });\n');
  return dir;
}

test('research workflow explains a machine in prose with narrative, scenarios, health and elapsed time', () => {
  const dir = project();
  const res = run(['research', 'workflow', 'refunds', 'RefundRequestWorkflow.ts'], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  assert.match(res.stdout, /The "refund request" flow has 8 steps\. It starts in \*submitted\*/);
  assert.match(res.stdout, /Happy path\n\s+Route: submitted → auto check → approved → refunded → closed/);
  assert.match(res.stdout, /Health\n/);
  assert.match(res.stdout, /Explained 1 machine\(s\) in 1 file\(s\) \(\d+\.\d\ds\)/);
  assert.match(res.stdout, /\[tool: .*\] \[llm: 0 calls/);
});

test('research workflow without <file> covers every workflow file that has machines', () => {
  const dir = project();
  const res = run(['research', 'workflow', 'refunds', '--dir', dir], os.tmpdir());
  assert.equal(res.status, EXIT_CODES.OK);
  assert.match(res.stdout, /== features\/refunds\/workflows\/RefundRequestWorkflow\.ts ==/);
  assert.match(res.stdout, /== features\/refunds\/workflows\/Broken\.ts ==/);
  assert.match(res.stdout, /cannot be explained in plain English: object spread/);
  assert.doesNotMatch(res.stdout, /Plain\.ts/);
});

test('research workflow --format json is pure JSON; scenarios and md formats work', () => {
  const dir = project();
  const json = run(['research', 'workflow', 'refunds', 'RefundRequestWorkflow.ts', '--format', 'json'], dir);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.feature, 'refunds');
  assert.equal(parsed.files[0].machines[0].scenarios[0].happy, true);
  assert.deepEqual(run(['research', 'workflow', 'refunds', 'RefundRequestWorkflow.ts', '--format', 'json'], dir).stdout, json.stdout);
  const sc = run(['research', 'workflow', 'refunds', 'RefundRequestWorkflow.ts', '--format', 'scenarios'], dir);
  assert.match(sc.stdout, /Given the flow starts in \*submitted\*/);
  assert.doesNotMatch(sc.stdout, /^Health/m);
  const md = run(['research', 'workflow', 'refunds', 'RefundRequestWorkflow.ts', '--format', 'md'], dir);
  assert.match(md.stdout, /### Scenarios/);
});

test('research workflow is path-scoped and fails cleanly', () => {
  const dir = project();
  const escape = run(['research', 'workflow', 'refunds', '../../../secret.ts'], dir);
  assert.equal(escape.status, EXIT_CODES.USAGE_ERROR);
  assert.match(escape.stderr, /escapes features\/refunds\/workflows/);
  assert.equal(run(['research', 'workflow', 'refunds', 'Nope.ts'], dir).status, EXIT_CODES.USAGE_ERROR);
  assert.match(run(['research', 'workflow', 'ghost'], dir).stderr, /no workflows\/ folder/);
  assert.match(run(['research', 'workflow', '../x'], dir).stderr, /Invalid feature name/);
  assert.match(run(['research', 'workflow'], dir).stderr, /Usage: construct research workflow/);
  assert.match(run(['research', 'workflow', 'refunds', '--format', 'xml'], dir).stderr, /Usage: construct research workflow/);
  fs.symlinkSync(path.join(dir, 'secret.ts'), path.join(dir, 'features', 'refunds', 'workflows', 'Link.ts'));
  assert.match(run(['research', 'workflow', 'refunds', 'Link.ts'], dir).stderr, /resolves outside/);
});
