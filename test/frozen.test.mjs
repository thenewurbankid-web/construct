// #23 -- frozen (externally-authored) presentation: config, write-path
// refusal, and the wrap-don't-duplicate rules (PAGE-007 / COMPONENT-004 /
// CONTROLLER-002).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadConfig, DEFAULT_RULES } from '../src/config.mjs';
import { normalizeFrozen, matchFrozen, assertNotFrozen } from '../src/frozen.mjs';
import { validateArchitecture } from '../src/architecture-enforcer.mjs';
import { createFeature, generateLayer, generateVertical, renderLayer } from '../src/generators.mjs';
import { importVertical } from '../src/import.mjs';
import { moveLayerFile, renameLayerFile } from '../src/refactor.mjs';
import { createTransaction } from '../packages/engine/transactionalWriter.mjs';
import { runPipeline } from '../packages/engine/pipeline.mjs';
import { write } from '../src/fs.mjs';
import { ConstructError } from '../src/diagnostics.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, '..', 'fixtures', 'frozen-presentation');
const bin = path.join(here, '..', 'bin', 'construct.mjs');
const FROZEN_RULES = ['PAGE-007', 'COMPONENT-004', 'CONTROLLER-002'];

/** Copy the fixture (frozen source + both projects) into a temp dir so tests
 * can mutate architecture.yml / write files without touching the repo. */
function tmpFixture() {
  const dir = makeTempDir('construct-frozen-');
  fs.cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

function setFrozen(projectDir, globs, extraYaml = '') {
  const file = path.join(projectDir, 'architecture.yml');
  const base = fs.readFileSync(file, 'utf8').replace(/\nfrozen:\n(  - .*\n)+/, '\n');
  const block = globs.length ? `frozen:\n${globs.map((g) => `  - ${g}`).join('\n')}\n` : '';
  fs.writeFileSync(file, base + block + extraYaml);
}

const frozenViolations = (res) => res.violations.filter((v) => FROZEN_RULES.includes(v.rule));

// ---- config ---------------------------------------------------------------

test('DEFAULT_RULES registers the three new rule ids as warnings and none of the taken ids changed', () => {
  for (const id of FROZEN_RULES) assert.equal(DEFAULT_RULES[id].severity, 'warning');
  assert.equal(DEFAULT_RULES['PAGE-005'].name, 'Pages cannot import domain logic');
  assert.equal(DEFAULT_RULES['CONTROLLER-001'].severity, 'error');
});

test('loadConfig parses frozen globs (including ones that reach outside the root)', () => {
  const cfg = loadConfig(path.join(FIXTURE, 'project-good'));
  assert.deepEqual(cfg.frozen, ['../design-system/screens/**']);
});

test('loadConfig defaults frozen to [] when absent (and when there is no architecture.yml)', () => {
  const dir = tmpFixture();
  const proj = path.join(dir, 'project-good');
  setFrozen(proj, []);
  assert.deepEqual(loadConfig(proj).frozen, []);
  assert.deepEqual(loadConfig(path.join(dir, 'nope')).frozen, []);
});

test('normalizeFrozen rejects malformed values with an error naming the entry', () => {
  assert.throws(() => normalizeFrozen('x'), (e) => e instanceof ConstructError && /expected a list/.test(e.message));
  assert.throws(() => normalizeFrozen(['ok/**', '']), /frozen\[1\].*non-empty/);
  assert.throws(() => normalizeFrozen([5]), /frozen\[0\]/);
  assert.throws(() => normalizeFrozen(['/etc/**']), /frozen\[0\].*absolute/);
  assert.throws(() => normalizeFrozen(['a\0b']), /NUL/);
  assert.deepEqual(normalizeFrozen([' ../a/** ']), ['../a/**']);
});

test('an invalid frozen entry in architecture.yml fails validate with a usage error', () => {
  const dir = tmpFixture();
  const proj = path.join(dir, 'project-good');
  setFrozen(proj, ['/abs/**']);
  assert.throws(() => validateArchitecture(proj), /frozen\[0\]/);
});

test('matchFrozen resolves globs relative to the root, normalizing ../ segments', () => {
  const dir = tmpFixture();
  const proj = path.join(dir, 'project-good');
  const hit = path.join(dir, 'design-system', 'screens', 'CpoHome.tsx');
  assert.equal(matchFrozen(proj, hit, ['../design-system/screens/**']), '../design-system/screens/**');
  assert.equal(matchFrozen(proj, hit, ['../design-system/other/**']), null);
  // a sneaky ../ path that normalizes to somewhere else does not match
  assert.equal(matchFrozen(proj, path.join(proj, '..', 'project-bad', 'x.tsx'), ['../design-system/**']), null);
});

// ---- generator / write-path refusal ---------------------------------------

test('generateLayer / generateVertical / create refuse to scaffold into a frozen path, naming the glob', () => {
  const dir = tmpFixture();
  const proj = path.join(dir, 'project-good');
  setFrozen(proj, ['features/cpo/pages/**']);
  assert.throws(
    () => generateLayer(proj, 'page', 'Other', 'cpo'),
    (e) => e instanceof ConstructError && e.message.includes('features/cpo/pages/**') && /frozen/.test(e.message),
  );
  assert.equal(fs.existsSync(path.join(proj, 'features/cpo/pages/OtherPage.tsx')), false);
  assert.throws(() => generateVertical(proj, 'Other', 'cpo', ['page']), /frozen glob/);
  // a layer outside the frozen glob is still generated normally
  const file = generateLayer(proj, 'domain', 'Thing', 'cpo');
  assert.equal(fs.existsSync(file), true);
});

test('createFeature refuses when the new feature files fall inside a frozen glob', () => {
  const dir = tmpFixture();
  const proj = path.join(dir, 'project-good');
  setFrozen(proj, ['features/brand-new/**']);
  assert.throws(() => createFeature(proj, 'brand-new'), /frozen glob "features\/brand-new\/\*\*"/);
});

test('a frozen glob that lives OUTSIDE the project root is refused as a write target when the root is known', () => {
  const dir = tmpFixture();
  const proj = path.join(dir, 'project-good');
  const target = path.join(dir, 'design-system', 'screens', 'Injected.tsx');
  assert.throws(() => assertNotFrozen(target, 'write to', proj), /frozen glob "\.\.\/design-system\/screens\/\*\*"/);
  assert.equal(fs.existsSync(target), false);
});

test('a path outside the project that matches no frozen glob is never blocked', () => {
  const dir = tmpFixture();
  const other = path.join(dir, 'design-system', 'unrelated', 'ok.txt');
  assert.doesNotThrow(() => assertNotFrozen(other)); // outside root, not frozen: guard is a no-op
});

test('importVertical refuses a frozen destination', async () => {
  const dir = tmpFixture();
  const proj = path.join(dir, 'project-good');
  setFrozen(proj, ['features/cpo/pages/**']);
  const from = path.join(dir, 'design-system', 'screens', 'CpoHome.tsx');
  await assert.rejects(() => importVertical(proj, 'Legacy', 'cpo', ['page'], from), /frozen glob/);
});

test('refactor move/rename refuse a frozen source, a frozen destination, and a frozen importer', () => {
  const dir = tmpFixture();
  const proj = path.join(dir, 'project-good');
  generateLayer(proj, 'domain', 'Foo', 'cpo');
  generateLayer(proj, 'hook', 'Bar', 'cpo');
  const hook = path.join(proj, 'features/cpo/hooks/useBar.tsx');
  fs.writeFileSync(hook, `import { Foo } from '../domain/Foo';\nexport function useBar() { return Foo(); }\n`);

  setFrozen(proj, ['features/cpo/services/**']);
  assert.throws(() => moveLayerFile(proj, 'cpo', 'Foo', 'domain', 'service'), /move into.*frozen glob/s);
  assert.equal(fs.existsSync(path.join(proj, 'features/cpo/domain/Foo.tsx')), true);

  setFrozen(proj, ['features/cpo/domain/**']);
  assert.throws(() => renameLayerFile(proj, 'cpo', 'Foo', 'Foo2', 'domain'), /frozen glob/);

  // a frozen file inside the root that imports the moved file: refuse before touching anything
  setFrozen(proj, ['features/cpo/hooks/**']);
  const before = fs.readFileSync(hook, 'utf8');
  assert.throws(() => moveLayerFile(proj, 'cpo', 'Foo', 'domain', 'service'), /rewrite an import inside.*frozen glob/s);
  assert.equal(fs.readFileSync(hook, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(proj, 'features/cpo/domain/Foo.tsx')), true);
});

test('transaction/pipeline refuse to stage a frozen path before any commit', () => {
  const dir = tmpFixture();
  const proj = path.join(dir, 'project-good');
  setFrozen(proj, ['features/cpo/pages/**']);
  const txn = createTransaction(proj);
  assert.throws(() => txn.writeFile('features/cpo/pages/X.tsx', 'x'), /frozen glob/);
  assert.deepEqual(txn.pendingFiles(), []);
  assert.throws(
    () => runPipeline(proj, { feature: 'cpo', steps: [{ layer: 'domain', name: 'Ok' }, { layer: 'page', name: 'Nope' }] }),
    /frozen glob/,
  );
  assert.equal(fs.existsSync(path.join(proj, 'features/cpo/domain/Ok.tsx')), false);
});

test('renderLayer stays pure (no write, no refusal) even for a frozen target', () => {
  const dir = tmpFixture();
  const proj = path.join(dir, 'project-good');
  setFrozen(proj, ['features/cpo/pages/**']);
  assert.doesNotThrow(() => renderLayer(proj, 'page', 'Other', 'cpo'));
});

test('CLI: `create page` into a frozen path exits non-zero with a clear message', () => {
  const dir = tmpFixture();
  const proj = path.join(dir, 'project-good');
  setFrozen(proj, ['features/cpo/pages/**']);
  const r = spawnSync('node', [bin, 'create', 'page', 'Other', '--feature', 'cpo', '--dir', proj], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /Refusing to write to .*features\/cpo\/pages\/OtherPage\.tsx.*frozen glob "features\/cpo\/pages\/\*\*"/s);
});

// ---- the wrap-don't-duplicate rules ---------------------------------------

test('good project (controller wraps frozen source): none of the frozen rules fire, no errors', () => {
  const res = validateArchitecture(path.join(FIXTURE, 'project-good'));
  assert.deepEqual(frozenViolations(res), []);
  assert.equal(res.ok, true);
});

test('bad project: PAGE-007 (same-name + structure), COMPONENT-004, CONTROLLER-002 fire as warnings', () => {
  const res = validateArchitecture(path.join(FIXTURE, 'project-bad'));
  const v = frozenViolations(res);
  const byRule = (r) => v.filter((x) => x.rule === r);
  assert.equal(byRule('PAGE-007').length, 2);
  assert.ok(byRule('PAGE-007').some((x) => /Exports "CpoHome"/.test(x.message)));
  assert.ok(byRule('PAGE-007').some((x) => /structure duplicates/.test(x.message)));
  assert.equal(byRule('COMPONENT-004').length, 1);
  assert.equal(byRule('COMPONENT-004')[0].file, 'features/cpo/components/HomeShell.tsx');
  assert.equal(byRule('CONTROLLER-002').length, 1);
  assert.match(byRule('CONTROLLER-002')[0].message, /8 JSX elements/);
  assert.ok(v.every((x) => x.severity === 'warning'));
  assert.equal(res.ok, true);
});

test('severity is configurable: error makes validate fail, off silences it', () => {
  const dir = tmpFixture();
  const proj = path.join(dir, 'project-bad');
  fs.appendFileSync(path.join(proj, 'architecture.yml'), 'rules:\n  PAGE-007: error\n  COMPONENT-004: off\n');
  const res = validateArchitecture(proj);
  assert.equal(res.ok, false);
  assert.ok(res.violations.filter((x) => x.rule === 'PAGE-007').every((x) => x.severity === 'error'));
  assert.equal(res.violations.some((x) => x.rule === 'COMPONENT-004'), false);
});

test('thresholds are configurable per rule', () => {
  const dir = tmpFixture();
  const proj = path.join(dir, 'project-bad');
  fs.appendFileSync(path.join(proj, 'architecture.yml'), 'rules:\n  CONTROLLER-002:\n    severity: warning\n    maxOwnElements: 8\n  COMPONENT-004:\n    severity: warning\n    minDuplicateElements: 20\n');
  const res = validateArchitecture(proj);
  assert.equal(res.violations.some((x) => x.rule === 'CONTROLLER-002'), false);
  assert.equal(res.violations.some((x) => x.rule === 'COMPONENT-004'), false);
});

test('a small hand-written page that merely shares a few tags with the frozen source does not trip', () => {
  const dir = tmpFixture();
  const proj = path.join(dir, 'project-good');
  fs.writeFileSync(path.join(proj, 'features/cpo/pages/Tiny.tsx'), `export function Tiny() {\n  return <div><h1>hi</h1><ul><li>x</li></ul></div>;\n}\n`);
  assert.deepEqual(frozenViolations(validateArchitecture(proj)), []);
});

test('an exception suppresses the frozen rules like any other rule', () => {
  const dir = tmpFixture();
  const proj = path.join(dir, 'project-bad');
  fs.appendFileSync(path.join(proj, 'architecture.yml'), '');
  const yml = fs.readFileSync(path.join(proj, 'architecture.yml'), 'utf8').replace('exceptions: []', 'exceptions:\n  - path: features/cpo/pages/CpoHome.tsx\n    rule: PAGE-007');
  fs.writeFileSync(path.join(proj, 'architecture.yml'), yml);
  const res = validateArchitecture(proj);
  assert.equal(res.violations.some((x) => x.rule === 'PAGE-007'), false);
  assert.ok(res.violations.some((x) => x.rule === 'COMPONENT-004'));
});

test('a frozen file that lives inside the project root is exempt from layer rules', () => {
  const dir = tmpFixture();
  const proj = path.join(dir, 'project-bad');
  setFrozen(proj, ['../design-system/screens/**', 'features/cpo/pages/**']);
  const res = validateArchitecture(proj);
  assert.equal(res.violations.some((x) => x.file === 'features/cpo/pages/CpoHome.tsx'), false);
});

// ---- no `frozen:` => unchanged --------------------------------------------

test('without frozen: the exact same bad project raises none of the new rules (behavior unchanged)', () => {
  const dir = tmpFixture();
  const proj = path.join(dir, 'project-bad');
  setFrozen(proj, []);
  const res = validateArchitecture(proj);
  assert.deepEqual(frozenViolations(res), []);
  assert.deepEqual(loadConfig(proj).frozen, []);
});

test('without frozen: generators and refactor write everywhere as before', () => {
  const dir = tmpFixture();
  const proj = path.join(dir, 'project-good');
  setFrozen(proj, []);
  const file = generateLayer(proj, 'page', 'Other', 'cpo');
  assert.equal(fs.existsSync(file), true);
  fs.rmSync(file);
});
