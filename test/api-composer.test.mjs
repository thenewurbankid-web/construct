import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncPublicApi, checkPublicApiDrift } from '../src/api-composer.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, '..', 'fixtures');

function tmpProject() {
  return makeTempDir('construct-composer-');
}

function writeFile(root, relPath, contents) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

function scaffoldFeature(root, name) {
  for (const dir of ['controllers', 'workflows', 'hooks', 'domain', 'services', 'pages', 'components']) {
    fs.mkdirSync(path.join(root, 'features', name, dir), { recursive: true });
  }
}

test('syncPublicApi adds export lines for controllers, hooks and types.ts', () => {
  const d = tmpProject();
  scaffoldFeature(d, 'alpha');
  writeFile(d, 'features/alpha/types.ts', `export type AlphaId = string;\n`);
  writeFile(d, 'features/alpha/controllers/AlphaController.tsx', `export function AlphaController() { return null; }\n`);
  writeFile(d, 'features/alpha/hooks/useAlpha.ts', `export function useAlpha() { return {}; }\n`);
  writeFile(d, 'features/alpha/domain/rules.ts', `export function rule() { return true; }\n`); // internal-only, must NOT be auto-added

  const result = syncPublicApi(d, 'alpha');
  assert.equal(result.changed, true);
  assert.equal(result.path, 'features/alpha/index.ts');

  const indexSrc = fs.readFileSync(path.join(d, 'features/alpha/index.ts'), 'utf8');
  assert.match(indexSrc, /export type \* from '\.\/types';/);
  assert.match(indexSrc, /export \* from '\.\/controllers\/AlphaController';/);
  assert.match(indexSrc, /export \* from '\.\/hooks\/useAlpha';/);
  assert.doesNotMatch(indexSrc, /domain\/rules/);
});

test('syncPublicApi is additive: it never removes or reorders hand-written lines', () => {
  const d = tmpProject();
  scaffoldFeature(d, 'alpha');
  writeFile(d, 'features/alpha/controllers/AlphaController.tsx', `export function AlphaController() { return null; }\n`);
  writeFile(
    d,
    'features/alpha/index.ts',
    `// hand-written header, keep me first\nexport * from './domain/rules'; // intentionally exposed by a human\n`
  );
  writeFile(d, 'features/alpha/domain/rules.ts', `export function rule() { return true; }\n`);

  syncPublicApi(d, 'alpha');
  const indexSrc = fs.readFileSync(path.join(d, 'features/alpha/index.ts'), 'utf8');
  const lines = indexSrc.split('\n');
  assert.equal(lines[0], '// hand-written header, keep me first');
  assert.equal(lines[1], `export * from './domain/rules'; // intentionally exposed by a human`);
  assert.match(indexSrc, /export \* from '\.\/controllers\/AlphaController';/);
});

test('syncPublicApi idempotency: running it twice on an unchanged tree is a no-op', () => {
  const d = tmpProject();
  scaffoldFeature(d, 'alpha');
  writeFile(d, 'features/alpha/types.ts', `export type AlphaId = string;\n`);
  writeFile(d, 'features/alpha/controllers/AlphaController.tsx', `export function AlphaController() { return null; }\n`);
  writeFile(d, 'features/alpha/hooks/useAlpha.ts', `export function useAlpha() { return {}; }\n`);

  const first = syncPublicApi(d, 'alpha');
  assert.equal(first.changed, true);
  const contentsAfterFirst = fs.readFileSync(path.join(d, 'features/alpha/index.ts'), 'utf8');
  const mtimeAfterFirst = fs.statSync(path.join(d, 'features/alpha/index.ts')).mtimeMs;

  const second = syncPublicApi(d, 'alpha');
  assert.equal(second.changed, false, 'second run must report changed: false');
  const contentsAfterSecond = fs.readFileSync(path.join(d, 'features/alpha/index.ts'), 'utf8');
  assert.equal(contentsAfterSecond, contentsAfterFirst, 'second run must produce an identical file');
  assert.equal(fs.statSync(path.join(d, 'features/alpha/index.ts')).mtimeMs, mtimeAfterFirst, 'file must not be rewritten on a no-op run');
});

test('syncPublicApi idempotency against the soc-clean fixture (already-synced tree)', () => {
  const d = tmpProject();
  fs.cpSync(path.join(fixturesRoot, 'soc-clean'), d, { recursive: true });
  const before = fs.readFileSync(path.join(d, 'features/alpha/index.ts'), 'utf8');
  const result = syncPublicApi(d, 'alpha');
  const after = fs.readFileSync(path.join(d, 'features/alpha/index.ts'), 'utf8');
  assert.equal(result.changed, false);
  assert.equal(after, before);
});

test('checkPublicApiDrift: flags a stale export whose target no longer exists', () => {
  const d = tmpProject();
  scaffoldFeature(d, 'alpha');
  writeFile(d, 'features/alpha/index.ts', `export * from './domain/gone';\n`);
  const result = checkPublicApiDrift(d);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].rule, 'SLICE-003');
  assert.equal(result.violations[0].severity, 'warning');
  assert.equal(result.violations[0].module, 'separation-of-concerns');
  assert.match(result.violations[0].suggestedFix, /Remove the line/);
});

test('checkPublicApiDrift: flags an obviously-public module missing from index.ts', () => {
  const d = tmpProject();
  scaffoldFeature(d, 'alpha');
  writeFile(d, 'features/alpha/index.ts', `// nothing exported yet\n`);
  writeFile(d, 'features/alpha/controllers/AlphaController.tsx', `export function AlphaController() { return null; }\n`);
  const result = checkPublicApiDrift(d);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].rule, 'SLICE-003');
  assert.match(result.violations[0].suggestedFix, /export \* from '\.\/controllers\/AlphaController';/);
});

test('checkPublicApiDrift: a fully-synced feature reports no drift', () => {
  const result = checkPublicApiDrift(path.join(fixturesRoot, 'soc-clean'));
  assert.deepEqual(result.violations, []);
});

test('syncPublicApi followed by checkPublicApiDrift leaves no drift', () => {
  const d = tmpProject();
  scaffoldFeature(d, 'alpha');
  writeFile(d, 'features/alpha/controllers/AlphaController.tsx', `export function AlphaController() { return null; }\n`);
  writeFile(d, 'features/alpha/hooks/useAlpha.ts', `export function useAlpha() { return {}; }\n`);
  syncPublicApi(d, 'alpha');
  const result = checkPublicApiDrift(d);
  assert.deepEqual(result.violations, []);
});
