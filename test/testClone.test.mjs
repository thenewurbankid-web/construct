// #300/#301 -- listing a feature's tests and cloning a locked generated test: lineage, the never-overwrite
// rule, and path safety against hostile names and symlinks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { generateFeatureTests } from '../packages/engine/testGenerator.mjs';
import { CLONE_MARKER, cloneGeneratedTest, listFeatureTests, parseLineage, readFeatureTest } from '../packages/engine/testClone.mjs';

const LOCK_YML = 'frozen:\n  - features/*/tests/generated/**\nnonLayer:\n  - features/*/tests/**\n';
const BASE_YML = 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n';
const LAYERS = ['controllers', 'workflows', 'hooks', 'domain', 'services', 'pages', 'components'];
const MACHINE = `import { setup } from 'xstate';
export const Simple = setup({}).createMachine({
  id: 'simple',
  initial: 'idle',
  states: {
    idle: { on: { START_JOB: 'working' } },
    working: { on: { finishJob: 'done', JOB_FAILED: 'failed' } },
    failed: { type: 'final' },
    done: { type: 'final' },
  },
});
`;

function project({ lock = true, generate = true } = {}) {
  const dir = makeTempDir('construct-testclone-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), BASE_YML + (lock ? LOCK_YML : ''));
  for (const l of LAYERS) fs.mkdirSync(path.join(dir, 'features', 'jobs', l), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'types.ts'), 'export type Id = string;\n');
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'index.ts'), "export type * from './types';\n");
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'workflows', 'Simple.ts'), MACHINE);
  if (generate && lock) generateFeatureTests(dir, 'jobs');
  return dir;
}
const gen = (dir) => path.join(dir, 'features', 'jobs', 'tests', 'generated');
const tests = (dir) => path.join(dir, 'features', 'jobs', 'tests');
const firstGenerated = (dir) => fs.readdirSync(gen(dir)).sort()[0];

test('listFeatureTests: coverage rows say generated / cloned / last result, with the distinguishing branch', () => {
  const dir = project();
  const r = listFeatureTests(dir, 'jobs');
  assert.equal(r.ok, true);
  assert.equal(r.lock.declared, true);
  assert.equal(r.coverage[0].title, 'Happy path', 'rows are in flow order, the happy path first');
  assert.deepEqual(r.coverage.map((c) => c.n), r.coverage.map((_, i) => i + 1));
  assert.equal(r.generated.length, r.scenarios);
  assert.ok(r.scenarios >= 2);
  for (const row of r.coverage) {
    assert.equal(row.generated, true);
    assert.equal(row.locked, true);
    assert.equal(row.lastResult, 'none');
    assert.equal(row.outOfDate, false);
    assert.equal(typeof row.branch, 'string');
    assert.deepEqual(row.cloned, []);
  }
  assert.deepEqual(r.yours, []);
});

test('listFeatureTests: an ungenerated scenario is an uncovered row; a missing lock is reported with the YAML', () => {
  const dir = project({ generate: false });
  const r = listFeatureTests(dir, 'jobs');
  assert.ok(r.coverage.length >= 2);
  assert.ok(r.coverage.every((c) => c.generated === false && c.file === null));
  const bare = project({ lock: false });
  const b = listFeatureTests(bare, 'jobs');
  assert.equal(b.lock.declared, false);
  assert.match(b.lock.message, /frozen:\n {2}- features\/\*\/tests\/generated\/\*\*/);
});

test('clone: bytes equal the header lines plus the source, lineage is kept, and the original is untouched', () => {
  const dir = project();
  const src = firstGenerated(dir);
  const before = fs.readFileSync(path.join(gen(dir), src), 'utf8');
  const r = cloneGeneratedTest(dir, { feature: 'jobs', source: src, name: 'my-copy' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.path, 'features/jobs/tests/my-copy.spec.ts');
  const out = fs.readFileSync(path.join(tests(dir), 'my-copy.spec.ts'), 'utf8');
  assert.ok(out.startsWith(`${CLONE_MARKER}\n// cloned from: features/jobs/tests/generated/${src} (scenario "`));
  assert.ok(out.endsWith(`\n${before}`), 'the source follows byte for byte');
  const head = out.slice(0, out.length - before.length);
  assert.equal(head.split('\n').filter((l) => l.startsWith('//')).length, 4);
  assert.equal(fs.readFileSync(path.join(gen(dir), src), 'utf8'), before, 'generated file unchanged');
  const lin = parseLineage(out);
  const orig = parseLineage(before);
  assert.equal(lin.machineHash, orig.machineHash);
  assert.equal(lin.scenarioHash, orig.scenarioHash);
  assert.equal(lin.clonedFrom.file, `features/jobs/tests/generated/${src}`);
  assert.equal(fs.readdirSync(gen(dir)).includes('my-copy.spec.ts'), false);
});

test('clone survives regeneration and shows under Yours, linked to its scenario', () => {
  const dir = project();
  const src = firstGenerated(dir);
  cloneGeneratedTest(dir, { feature: 'jobs', source: src, name: 'keep-me' });
  const mine = fs.readFileSync(path.join(tests(dir), 'keep-me.spec.ts'), 'utf8');
  generateFeatureTests(dir, 'jobs', { prune: true });
  assert.equal(fs.readFileSync(path.join(tests(dir), 'keep-me.spec.ts'), 'utf8'), mine);
  const r = listFeatureTests(dir, 'jobs');
  assert.deepEqual(r.yours.map((y) => [y.name, y.kind]), [['keep-me.spec.ts', 'clone']]);
  assert.deepEqual(r.coverage.find((c) => c.file === src).cloned, ['keep-me.spec.ts']);
});

test('clone never overwrites: it refuses and suggests a free name', () => {
  const dir = project();
  const src = firstGenerated(dir);
  assert.equal(cloneGeneratedTest(dir, { feature: 'jobs', source: src, name: 'dup' }).ok, true);
  const first = fs.readFileSync(path.join(tests(dir), 'dup.spec.ts'), 'utf8');
  const again = cloneGeneratedTest(dir, { feature: 'jobs', source: src, name: 'dup' });
  assert.equal(again.ok, false);
  assert.equal(again.code, 'exists');
  assert.equal(again.suggested, 'dup-2');
  assert.equal(fs.readFileSync(path.join(tests(dir), 'dup.spec.ts'), 'utf8'), first);
  // a hand-written file is just as safe
  fs.writeFileSync(path.join(tests(dir), 'mine.spec.ts'), 'mine\n');
  assert.equal(cloneGeneratedTest(dir, { feature: 'jobs', source: src, name: 'mine' }).code, 'exists');
  assert.equal(fs.readFileSync(path.join(tests(dir), 'mine.spec.ts'), 'utf8'), 'mine\n');
});

test('hostile names are refused and nothing is written', () => {
  const dir = project();
  const src = firstGenerated(dir);
  const before = fs.readdirSync(tests(dir)).sort();
  for (const name of ['..', '../x', 'a/b', '/etc/passwd', 'a\0b', 'a\nb', 'A', '-x', '', 'generated/x', 'x.spec.ts', ' x', 'a'.repeat(81), 5, {}]) {
    const r = cloneGeneratedTest(dir, { feature: 'jobs', source: src, name });
    assert.equal(r.ok, false, `accepted ${JSON.stringify(name)}`);
    assert.equal(r.code, 'bad-name');
  }
  for (const source of ['../architecture.yml', '/etc/passwd', 'a\0.spec.ts', 'nope--x.spec.ts', 'x.spec.ts', `${src}\n`, `generated/${src}`, undefined, 7]) {
    assert.equal(cloneGeneratedTest(dir, { feature: 'jobs', source, name: 'ok' }).ok, false, `accepted source ${JSON.stringify(source)}`);
  }
  for (const feature of ['..', '../x', 'a/b', 'nosuch', 'x\0', '', undefined, '/tmp']) {
    assert.equal(cloneGeneratedTest(dir, { feature, source: src, name: 'ok' }).ok, false, `accepted feature ${JSON.stringify(feature)}`);
  }
  assert.deepEqual(fs.readdirSync(tests(dir)).sort(), before);
});

test('only a generator-marked file in generated/ can be cloned', () => {
  const dir = project();
  fs.writeFileSync(path.join(gen(dir), 'sneaky--file.spec.ts'), 'not generated\n');
  assert.equal(cloneGeneratedTest(dir, { feature: 'jobs', source: 'sneaky--file.spec.ts', name: 'x' }).code, 'not-generated');
  fs.writeFileSync(path.join(tests(dir), 'mine--one.spec.ts'), '// hi\n');
  assert.equal(cloneGeneratedTest(dir, { feature: 'jobs', source: 'mine--one.spec.ts', name: 'x' }).code, 'not-generated');
  assert.equal(listFeatureTests(dir, 'jobs').generated.some((g) => g.name === 'sneaky--file.spec.ts'), false);
});

test('a symlinked tests/ (or generated/, or source file) is refused and nothing is written outside the project', () => {
  const outside = makeTempDir('construct-testclone-outside-');
  const dir = project();
  const src = firstGenerated(dir);
  const real = path.join(dir, 'features', 'jobs', 'tests');
  fs.renameSync(real, `${real}-moved`);
  fs.symlinkSync(outside, real);
  const r = cloneGeneratedTest(dir, { feature: 'jobs', source: src, name: 'ok' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'unsafe-path');
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(listFeatureTests(dir, 'jobs').ok, false);
  assert.equal(readFeatureTest(dir, 'jobs', { area: 'generated', name: src }).ok, false);
  fs.unlinkSync(real);
  fs.renameSync(`${real}-moved`, real);

  // a symlinked source file is not readable as a generated test
  const secret = path.join(outside, 'secret--x.spec.ts');
  fs.writeFileSync(secret, `${fs.readFileSync(path.join(gen(dir), src), 'utf8')}`);
  fs.symlinkSync(secret, path.join(gen(dir), 'linked--x.spec.ts'));
  assert.equal(cloneGeneratedTest(dir, { feature: 'jobs', source: 'linked--x.spec.ts', name: 'ok' }).code, 'not-generated');

  // a dangling symlink where the clone would go is never followed
  fs.symlinkSync(path.join(outside, 'new-file'), path.join(tests(dir), 'trap.spec.ts'));
  const t = cloneGeneratedTest(dir, { feature: 'jobs', source: src, name: 'trap' });
  assert.equal(t.ok, false);
  assert.equal(fs.existsSync(path.join(outside, 'new-file')), false);
});

test('a name that is `generated` still lands one level up, never under generated/', () => {
  const dir = project();
  const src = firstGenerated(dir);
  const r = cloneGeneratedTest(dir, { feature: 'jobs', source: src, name: 'generated' });
  assert.equal(r.ok, true);
  assert.equal(r.path, 'features/jobs/tests/generated.spec.ts');
  assert.equal(fs.readdirSync(gen(dir)).includes('generated.spec.ts'), false);
});

test('readFeatureTest: reads listed files only', () => {
  const dir = project();
  const src = firstGenerated(dir);
  const ok = readFeatureTest(dir, 'jobs', { area: 'generated', name: src });
  assert.equal(ok.ok, true);
  assert.equal(ok.locked, true);
  assert.match(ok.text, /@construct-generated/);
  for (const name of ['../architecture.yml', '/etc/passwd', 'a\0', 'x--y.spec.ts']) {
    assert.equal(readFeatureTest(dir, 'jobs', { area: 'generated', name }).ok, false);
    assert.equal(readFeatureTest(dir, 'jobs', { area: 'yours', name }).ok, false);
  }
  assert.equal(readFeatureTest(dir, 'jobs', { area: 'elsewhere', name: src }).ok, false);
});
