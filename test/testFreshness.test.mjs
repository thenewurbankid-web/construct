// #306 -- a clone's freshness against the current flow, and the plain-language diff. Real generator, real files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { generateFeatureTests } from '../src/engine/testGenerator.mjs';
import { cloneGeneratedTest } from '../src/engine/testClone.mjs';
import { assessClone, compareClone, diffFlow, listFeatureTestsFresh } from '../src/engine/testFreshness.mjs';

const LOCK_YML = 'frozen:\n  - features/*/tests/generated/**\nnonLayer:\n  - features/*/tests/**\n';
const BASE_YML = 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n';
const LAYERS = ['controllers', 'workflows', 'hooks', 'domain', 'services', 'pages', 'components'];
const machine = (working, extra = '') => `import { setup } from 'xstate';
export const Simple = setup({}).createMachine({
  id: 'simple',
  initial: 'idle',
  states: {
    idle: { on: { START_JOB: 'working' } },
    working: { on: { ${working} } },
${extra}    failed: { type: 'final' },
    done: { type: 'final' },
  },
});
`;
const ORIGINAL = machine("finishJob: 'done', JOB_FAILED: 'failed'");
const REVIEWED = machine("finishJob: 'review', JOB_FAILED: 'failed'", "    review: { on: { APPROVE_JOB: 'done' } },\n");
const NO_FAILURE = machine("finishJob: 'done'");

function project() {
  const dir = makeTempDir('construct-testfresh-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), BASE_YML + LOCK_YML);
  for (const l of LAYERS) fs.mkdirSync(path.join(dir, 'features', 'jobs', l), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'types.ts'), 'export type Id = string;\n');
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'index.ts'), "export type * from './types';\n");
  setFlow(dir, ORIGINAL);
  generateFeatureTests(dir, 'jobs');
  return dir;
}
const setFlow = (dir, src) => fs.writeFileSync(path.join(dir, 'features', 'jobs', 'workflows', 'Simple.ts'), src);
const files = (dir) => fs.readdirSync(path.join(dir, 'features', 'jobs', 'tests', 'generated')).sort();
const happy = (dir) => files(dir).find((n) => /happy-path/.test(n));
const other = (dir) => files(dir).find((n) => /ends-done/.test(n)); // the second scenario: the finishJob route
const regen = (dir) => generateFeatureTests(dir, 'jobs', { prune: true });

test('an untouched flow leaves a clone current, and a locked generated test is never flagged', () => {
  const dir = project();
  cloneGeneratedTest(dir, { feature: 'jobs', source: happy(dir), name: 'mine' });
  const r = listFeatureTestsFresh(dir, 'jobs');
  assert.equal(r.yours[0].freshness.state, 'current');
  assert.equal(r.yours[0].freshness.stale, false);
  assert.ok(r.generated.every((g) => g.freshness === undefined), 'freshness is about clones only');
  assert.ok(r.coverage.every((c) => Array.isArray(c.staleClones) && c.staleClones.length === 0));
});

test('a changed route makes the clone stale with the diff; an unaffected scenario only gets a quiet machine note', () => {
  const dir = project();
  cloneGeneratedTest(dir, { feature: 'jobs', source: other(dir), name: 'changed-copy' });
  cloneGeneratedTest(dir, { feature: 'jobs', source: happy(dir), name: 'unaffected-copy' });
  setFlow(dir, REVIEWED);
  regen(dir);
  const r = listFeatureTestsFresh(dir, 'jobs');
  const by = Object.fromEntries(r.yours.map((y) => [y.name, y.freshness]));
  assert.equal(by['changed-copy.spec.ts'].state, 'scenario-changed');
  assert.equal(by['changed-copy.spec.ts'].stale, true);
  assert.equal(by['unaffected-copy.spec.ts'].state, 'machine-changed');
  assert.equal(by['unaffected-copy.spec.ts'].stale, false);
  const row = r.coverage.find((c) => c.cloned.includes('changed-copy.spec.ts'));
  assert.deepEqual(row.staleClones, ['changed-copy.spec.ts']);

  const c = compareClone(dir, 'jobs', { name: 'changed-copy.spec.ts' });
  assert.equal(c.ok, true);
  assert.equal(c.comparable, true);
  const said = c.changes.map((x) => x.text).join('\n');
  assert.match(said, /moves to review/, 'the new state is named');
  assert.match(said, /"approve job" happens/, 'the new event is named');
  assert.ok(c.changes.some((x) => x.kind === 'added'));
  assert.match(c.next, /Nothing was changed for you/);
});

test('a removed scenario is reported and nothing is deleted or rewritten', () => {
  const dir = project();
  cloneGeneratedTest(dir, { feature: 'jobs', source: other(dir), name: 'unaffected-copy' });
  const clonePath = path.join(dir, 'features', 'jobs', 'tests', 'unaffected-copy.spec.ts');
  const before = fs.readFileSync(clonePath, 'utf8');
  setFlow(dir, NO_FAILURE);
  regen(dir);
  const c = compareClone(dir, 'jobs', { name: 'unaffected-copy.spec.ts' });
  assert.equal(c.state, 'scenario-removed');
  assert.equal(c.stale, true);
  assert.deepEqual(c.changes, []);
  assert.equal(fs.readFileSync(clonePath, 'utf8'), before, 'never rewritten');
});

test('unknown lineage makes no claim; edits QA made beyond the flow steps are not reported', () => {
  const dir = project();
  cloneGeneratedTest(dir, { feature: 'jobs', source: happy(dir), name: 'mine' });
  const p = path.join(dir, 'features', 'jobs', 'tests', 'mine.spec.ts');
  const text = fs.readFileSync(p, 'utf8');
  assert.equal(assessClone(text.replace(/^\/\/ lineage:.*$/m, '// lineage: nothing'), null).state, 'unknown');
  setFlow(dir, REVIEWED);
  regen(dir);
  // QA adds a visible-text check: the flow steps are the same, so it must not show as a difference on its own
  const withCheck = text.replace('await expectFlowState(', 'await expect(page.getByText("Hello")).toBeVisible({ timeout: 5000 });\n  await expectFlowState(');
  fs.writeFileSync(p, withCheck);
  const c = compareClone(dir, 'jobs', { name: 'mine.spec.ts' });
  assert.equal(c.changes.filter((x) => /Hello/.test(x.text)).length, 0);
});

test('diffFlow: added, removed and changed steps in plain words', () => {
  const s = (kind, v) => ({ kind, key: `${kind}:${v}`, sentence: `${kind} ${v}` });
  const d = diffFlow([s('event', 'a'), s('state', 'x'), s('event', 'b')], [s('event', 'a'), s('state', 'y'), s('event', 'b'), s('state', 'z')]);
  assert.deepEqual(d.map((x) => x.kind), ['changed', 'added']);
  assert.match(d[0].text, /Step 2 changed: it was state x, it is now state y/);
  assert.deepEqual(diffFlow([s('event', 'a'), s('event', 'q')], [s('event', 'a')]).map((x) => x.kind), ['removed']);
  assert.deepEqual(diffFlow([s('event', 'a')], [s('event', 'a')]), []);
});

test('compareClone refuses hostile or wrong names and writes nothing', () => {
  const dir = project();
  for (const name of ['../x.spec.ts', '/etc/passwd', 'a\0.spec.ts', 'a\n.spec.ts', 'x.spec.ts\n', undefined, 'UPPER.spec.ts']) {
    assert.equal(compareClone(dir, 'jobs', { name }).ok, false, String(name));
  }
  assert.equal(compareClone(dir, 'jobs', { name: 'absent.spec.ts' }).code, 'not-found');
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'tests', 'authored.spec.ts'), '// mine\n');
  assert.equal(compareClone(dir, 'jobs', { name: 'authored.spec.ts' }).code, 'not-a-clone');
  fs.symlinkSync(path.join(dir, 'architecture.yml'), path.join(dir, 'features', 'jobs', 'tests', 'link.spec.ts'));
  assert.equal(compareClone(dir, 'jobs', { name: 'link.spec.ts' }).code, 'not-found', 'a symlink is refused');
  assert.equal(compareClone(dir, 'nope', { name: 'x.spec.ts' }).ok, false);
});
