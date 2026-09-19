import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { listWorkflowFeatures, listWorkflowFiles, resolveWorkflowFile, readWorkflowMachines, readWorkflowNarrative, editWorkflowFile } from './workflowsViewer.mjs';
import { PagesEditorError } from './pagesEditor.mjs';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

const MACHINE = `import { setup } from 'xstate';
export const A = setup({}).createMachine({ id: 'a', initial: 'x', states: { x: { on: { GO: 'y' } }, y: { type: 'final' } } });
`;

function makeFixture() {
  const root = makeTempDir('construct-workflows-');
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

// Epic #223 -- context / actions / guards go through the same hash-checked, enforcement-gated path.
test('context + action edits: preview, hash guard, commit, read back and narrated', () => {
  const root = makeFixture();
  const file = path.join(root, 'features/demo/workflows/A.ts');
  const commit = (req) => {
    const p = editWorkflowFile(root, 'demo', 'A.ts', req, { commit: false });
    return editWorkflowFile(root, 'demo', 'A.ts', req, { commit: true, contentHash: p.contentHash });
  };
  commit({ machine: 0, op: 'addContextField', name: 'count', initial: '0' });
  commit({ machine: 0, op: 'declareAction', name: 'log' });
  const saved = commit({ machine: 0, op: 'assignAction', name: 'log', where: 'entry', path: 'x' });
  assert.deepEqual(saved.machines[0].context, [{ name: 'count', initial: '0' }]);
  assert.deepEqual(saved.machines[0].declared.actions, ['log']);
  assert.deepEqual(saved.machines[0].states[0].entry, ['log']);
  assert.ok(fs.readFileSync(file, 'utf8').includes('entry: \'log\''));
  const nar = readWorkflowNarrative(root, 'demo', 'A.ts');
  assert.deepEqual(nar.machines[0].context, ['It remembers count, starting as 0.']);
  const req = { machine: 0, op: 'addContextField', name: 'bad', initial: 'evil()' };
  assert.throws(() => editWorkflowFile(root, 'demo', 'A.ts', req, { commit: false }), (e) => e.status === 422);
  assert.throws(() => editWorkflowFile(root, 'demo', 'A.ts', { machine: 0, op: 'removeAction', name: 'log' }, { commit: false }), (e) => e.status === 422);
});

// Epic #185 -- plain-English narrative for a workflow file.
test('narrative: English, scenarios and findings derived fresh from source, same scope guard', () => {
  const root = makeFixture();
  const r = readWorkflowNarrative(root, 'demo', 'A.ts');
  assert.equal(r.machines[0].summary, 'The "a" flow has 2 steps. It starts in *x* and can end in *y*.');
  assert.deepEqual(r.machines[0].scenarios[0].events, ['GO']);
  assert.deepEqual(r.machines[0].findings, []);
  // fresh on every call: an edit on disk changes the English
  fs.writeFileSync(path.join(root, 'features/demo/workflows/A.ts'), MACHINE.replace("y: { type: 'final' }", 'y: {}'));
  const again = readWorkflowNarrative(root, 'demo', 'A.ts');
  assert.match(again.machines[0].summary, /no end state/);
  assert.equal(again.machines[0].findings.some((f) => f.kind === 'dead-end'), true);
  assert.notEqual(again.contentHash, r.contentHash);
  // unparseable file: error, no throw
  assert.match(readWorkflowNarrative(root, 'demo', 'Broken.ts').error, /Could not parse/);
  // scope guard applies
  assert.throws(() => readWorkflowNarrative(root, 'demo', '../secret.ts'), PagesEditorError);
  fs.symlinkSync(path.join(root, 'features/demo/secret.ts'), path.join(root, 'features/demo/workflows/link.ts'));
  assert.throws(() => readWorkflowNarrative(root, 'demo', 'link.ts'), PagesEditorError);
  assert.deepEqual(fs.readdirSync(path.join(root, 'features/demo/workflows')).sort(), ['A.test.ts', 'A.ts', 'Broken.ts', 'link.ts']);
});

test('unsupported edits are refused with 422 and the file is untouched', () => {
  const root = makeFixture();
  assert.throws(() => editWorkflowFile(root, 'demo', 'A.ts', { machine: 0, op: 'removeState', path: 'x' }, { commit: false }), (e) => e.status === 422);
  assert.throws(() => editWorkflowFile(root, 'demo', '../secret.ts', { machine: 0, op: 'addState', name: 'q' }, { commit: false }), PagesEditorError);
});
