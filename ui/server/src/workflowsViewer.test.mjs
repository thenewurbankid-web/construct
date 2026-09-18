import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listWorkflowFeatures, listWorkflowFiles, resolveWorkflowFile, readWorkflowMachines, editWorkflowFile } from './workflowsViewer.mjs';
import { PagesEditorError } from './pagesEditor.mjs';

const MACHINE = `import { setup } from 'xstate';
export const A = setup({}).createMachine({ id: 'a', initial: 'x', states: { x: { on: { GO: 'y' } }, y: { type: 'final' } } });
`;

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-workflows-'));
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'version: 1\npreset: strict-nextjs\nfeatures:\n  root: features\n');
  fs.mkdirSync(path.join(root, 'features/demo/workflows'), { recursive: true });
  fs.mkdirSync(path.join(root, 'features/empty/pages'), { recursive: true });
  fs.writeFileSync(path.join(root, 'features/demo/workflows/A.ts'), MACHINE);
  fs.writeFileSync(path.join(root, 'features/demo/workflows/A.test.ts'), MACHINE);
  fs.writeFileSync(path.join(root, 'features/demo/workflows/Broken.ts'), 'export const b = createMachine({ initial: ');
  fs.writeFileSync(path.join(root, 'features/demo/secret.ts'), 'export const secret = 1;');
  return root;
}

test('lists only features with workflows/ and their non-test source files', () => {
  const root = makeFixture();
  assert.deepEqual(listWorkflowFeatures(root), ['demo']);
  assert.deepEqual(listWorkflowFiles(root, 'demo'), ['A.ts', 'Broken.ts']);
});

test('reads machines fresh from disk every time (edit is reflected, nothing cached)', () => {
  const root = makeFixture();
  assert.equal(readWorkflowMachines(root, 'demo', 'A.ts').machines[0].states.length, 2);
  fs.writeFileSync(path.join(root, 'features/demo/workflows/A.ts'), MACHINE.replace("y: { type: 'final' }", "y: {}, z: {}"));
  assert.equal(readWorkflowMachines(root, 'demo', 'A.ts').machines[0].states.length, 3);
});

test('unparseable file reports an error instead of throwing', () => {
  const r = readWorkflowMachines(makeFixture(), 'demo', 'Broken.ts');
  assert.match(r.error, /Could not parse/);
  assert.deepEqual(r.machines, []);
});

test('scope guard: no traversal, absolute paths, wrong extension, symlink escape', () => {
  const root = makeFixture();
  assert.throws(() => resolveWorkflowFile(root, 'demo', '../secret.ts'), PagesEditorError);
  assert.throws(() => resolveWorkflowFile(root, 'demo', '/etc/passwd'), PagesEditorError);
  assert.throws(() => resolveWorkflowFile(root, '../demo', 'A.ts'), PagesEditorError);
  assert.throws(() => resolveWorkflowFile(root, 'demo', 'nope.ts'), PagesEditorError);
  fs.writeFileSync(path.join(root, 'features/demo/workflows/x.json'), '{}');
  assert.throws(() => resolveWorkflowFile(root, 'demo', 'x.json'), PagesEditorError);
  fs.symlinkSync(path.join(root, 'features/demo/secret.ts'), path.join(root, 'features/demo/workflows/link.ts'));
  assert.throws(() => resolveWorkflowFile(root, 'demo', 'link.ts'), PagesEditorError);
});

test('edit preview does not write; commit writes only after hash check', () => {
  const root = makeFixture();
  const file = path.join(root, 'features/demo/workflows/A.ts');
  const before = fs.readFileSync(file, 'utf8');
  const req = { machine: 0, op: 'addState', name: 'z' };
  const preview = editWorkflowFile(root, 'demo', 'A.ts', req, { commit: false });
  assert.ok(preview.after.includes('z: {}'));
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.throws(() => editWorkflowFile(root, 'demo', 'A.ts', req, { commit: true, contentHash: 'stale' }), (e) => e.status === 409);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  const saved = editWorkflowFile(root, 'demo', 'A.ts', req, { commit: true, contentHash: preview.contentHash });
  assert.equal(saved.machines[0].states.length, 3);
  assert.ok(fs.readFileSync(file, 'utf8').includes('z: {}'));
  // nothing else was created next to the source (zero metadata)
  assert.deepEqual(fs.readdirSync(path.join(root, 'features/demo/workflows')).sort(), ['A.test.ts', 'A.ts', 'Broken.ts']);
});

test('unsupported edits are refused with 422 and the file is untouched', () => {
  const root = makeFixture();
  assert.throws(() => editWorkflowFile(root, 'demo', 'A.ts', { machine: 0, op: 'removeState', path: 'x' }, { commit: false }), (e) => e.status === 422);
  assert.throws(() => editWorkflowFile(root, 'demo', '../secret.ts', { machine: 0, op: 'addState', name: 'q' }, { commit: false }), PagesEditorError);
});
