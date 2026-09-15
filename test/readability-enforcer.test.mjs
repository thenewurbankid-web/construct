import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReadability, READABILITY_RULES } from '../src/readability-enforcer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(here, '..', 'fixtures');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'construct-readability-'));
}

function writeFile(root, relPath, content) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

test('READABILITY_RULES is shaped like config.mjs DEFAULT_RULES', () => {
  for (const [id, def] of Object.entries(READABILITY_RULES)) {
    assert.match(id, /^READ-\d{3}$/);
    assert.ok(['error', 'warning', 'off'].includes(def.severity));
    assert.equal(typeof def.name, 'string');
  }
});

test('READ-001: fixtures/readability-naming produces the exact guiding messages for a mis-named component and hook', () => {
  const { violations } = validateReadability(path.join(fixturesRoot, 'readability-naming'));
  const naming = violations.filter((v) => v.rule === 'READ-001');
  assert.equal(naming.length, 2);

  const component = naming.find((v) => v.file === 'features/demo/components/button.tsx');
  assert.equal(component.module, 'readability');
  assert.equal(component.severity, 'error');
  assert.equal(component.message, 'Component file "button.tsx" does not follow PascalCase naming matching its export.');
  assert.equal(component.suggestedFix, 'Rename features/demo/components/button.tsx to features/demo/components/Button.tsx.');

  const hook = naming.find((v) => v.file === 'features/demo/hooks/toggle.ts');
  assert.equal(hook.message, 'Hook file "toggle.ts" does not export a use-prefixed camelCase function matching its filename.');
  assert.equal(
    hook.suggestedFix,
    'Rename features/demo/hooks/toggle.ts to features/demo/hooks/useToggle.ts and export a function named useToggle.'
  );
});

test('READ-001: a correctly named component/hook produces no naming violation', () => {
  const root = tmpRoot();
  writeFile(root, 'features/demo/components/Card.tsx', `export function Card() {\n  return <div />;\n}\n`);
  writeFile(root, 'features/demo/hooks/useCard.ts', `export function useCard() {\n  return true;\n}\n`);
  const { violations } = validateReadability(root);
  assert.equal(violations.filter((v) => v.rule === 'READ-001').length, 0);
});

test('READ-002: fixtures/readability-length flags an oversized file and an oversized function', () => {
  const { violations } = validateReadability(path.join(fixturesRoot, 'readability-length'));
  const length = violations.filter((v) => v.rule === 'READ-002');

  const bigFile = length.find((v) => v.file === 'features/demo/domain/BigFile.ts');
  assert.ok(bigFile, 'expected a file-length violation for BigFile.ts');
  assert.equal(bigFile.message, 'File is 206 lines, exceeding the 200-line threshold.');
  assert.equal(bigFile.suggestedFix, 'Split features/demo/domain/BigFile.ts into smaller modules along its distinct exports/responsibilities.');

  const longFn = length.find((v) => v.file === 'features/demo/services/LongFunctionService.ts');
  assert.ok(longFn, 'expected a function-length violation for LongFunctionService.ts');
  assert.match(longFn.message, /^Function "processAll" is approximately \d+ lines, exceeding the 40-line guideline\.$/);
  assert.match(longFn.suggestedFix, /^Extract part of "processAll" \(starting at line \d+\) in features\/demo\/services\/LongFunctionService\.ts into a smaller, named helper function\.$/);
});

test('READ-002: max-loc threshold is configurable via architecture.yml rules.READ-002-max-loc', () => {
  const root = tmpRoot();
  const lines = Array.from({ length: 12 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';
  writeFile(root, 'features/demo/domain/Small.ts', lines);
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'rules:\n  READ-002-max-loc: 10\n');
  const { violations } = validateReadability(root);
  assert.ok(violations.some((v) => v.rule === 'READ-002' && v.file === 'features/demo/domain/Small.ts' && v.line === 1));
});

test('READ-003: fixtures/readability-jsdoc flags only the undocumented public export', () => {
  const { violations } = validateReadability(path.join(fixturesRoot, 'readability-jsdoc'));
  const jsdocViolations = violations.filter((v) => v.rule === 'READ-003');
  assert.equal(jsdocViolations.length, 1);
  const v = jsdocViolations[0];
  assert.equal(v.severity, 'warning');
  assert.equal(v.file, 'features/demo/index.ts');
  assert.equal(v.message, 'Public API export "startDemo" has no JSDoc summary.');
  assert.equal(
    v.suggestedFix,
    'Add a JSDoc block above "startDemo" in features/demo/index.ts, e.g. /** Describe what startDemo does and when to use it. */'
  );
  assert.ok(!jsdocViolations.some((x) => x.message.includes('stopDemo')));
});

test('rule severity can be overridden to "off" via architecture.yml', () => {
  const root = tmpRoot();
  writeFile(root, 'features/demo/components/lowercase.tsx', `export function lowercase() {\n  return <div />;\n}\n`);
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'rules:\n  READ-001: off\n');
  const { violations } = validateReadability(root);
  assert.equal(violations.filter((v) => v.rule === 'READ-001').length, 0);
});

test('exceptions scoped to a path suppress a rule for that path', () => {
  const root = tmpRoot();
  writeFile(root, 'features/legacy/components/legacyThing.tsx', `export function legacyThing() {\n  return <div />;\n}\n`);
  fs.writeFileSync(
    root + '/architecture.yml',
    'exceptions:\n  - rule: READ-001\n    path: features/legacy/**\n    reason: legacy code\n    owner: platform\n'
  );
  const { violations } = validateReadability(root);
  assert.equal(violations.filter((v) => v.rule === 'READ-001').length, 0);
});

test('every produced violation is a valid diagnostics-contract violation with module "readability"', () => {
  const { violations } = validateReadability(path.join(fixturesRoot, 'readability-naming'));
  assert.ok(violations.length > 0);
  for (const v of violations) assert.equal(v.module, 'readability');
});
