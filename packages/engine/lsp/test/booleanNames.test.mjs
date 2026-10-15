// NAME-002: a boolean function (or boolean type guard) is named is/has/can/should/does. Types come from the language
// service; the typed fix renames the declaration and every reference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../../test-utils/tmpdir.mjs';
import { validateBooleanNames, booleanNameProblems, renameEdits, hasBooleanPrefix, suggestBooleanName, booleanNameOf } from '../booleanNames.mjs';
import { clearHostCache } from '../host.mjs';
import { atomicGate } from '../gate.mjs';
import { DEFAULT_RULES } from '../../../core/config.mjs';
import { RULE_METADATA } from '../../../core/rules-catalog.mjs';

const TSCONFIG = JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'esnext', moduleResolution: 'bundler', strict: true, noEmit: true, lib: ['es2020'] } });
const PATHS = `export function withinPath(a: string, b: string) {
  return a.startsWith(b);
}
export function isBook(x: unknown): x is { title: string } {
  return typeof x === 'object' && x !== null && 'title' in x;
}
export function bookish(x: unknown): x is { title: string } {
  return isBook(x);
}
export function isoDate(d: Date): string {
  return d.toISOString();
}
export function isReady(n: number): string {
  return n > 0 ? 'yes' : 'no';
}
export function hasPages(n: number): boolean {
  return n > 0;
}
`;
const USE = "import { withinPath, bookish } from './paths';\nexport const both = (p: string): boolean => withinPath(p, '/a') && bookish({});\n";
function project(extra = {}) {
  const root = makeTempDir('construct-name-002-');
  const files = { 'tsconfig.json': TSCONFIG, 'src/paths.ts': PATHS, 'src/use.ts': USE, ...extra };
  for (const [rel, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), t); }
  clearHostCache();
  return root;
}
const apply = (text, edits) => [...edits].sort((a, b) => b.start - a.start).reduce((t, e) => t.slice(0, e.start) + e.newText + t.slice(e.end), text);

test('NAME-002 is a declared rule: warning on existing code, error on generated code, documented in the catalog', () => {
  assert.deepEqual([DEFAULT_RULES['NAME-002'].severity, DEFAULT_RULES['NAME-002'].generated], ['warning', 'error']);
  assert.equal(RULE_METADATA['NAME-002'].module, 'readability');
  assert.deepEqual(['isOpen', 'hasX', 'canGo', 'shouldShow', 'doesFit', 'useIsMobile', '_isX', 'is'].map(hasBooleanPrefix), [true, true, true, true, true, true, true, true]);
  assert.deepEqual(['isoDate', 'within', 'issue', 'useMobile', 'hash'].map(hasBooleanPrefix), [false, false, false, false, false]);
  assert.deepEqual(['withinPath', 'useMobile'].map(suggestBooleanName), ['isWithinPath', 'useIsMobile']);
});

test('a boolean function without a prefix fails, and its typed fix renames it and every reference', () => {
  const root = project();
  const { violations } = validateBooleanNames(root);
  const v = violations.find((x) => x.message.startsWith('withinPath'));
  assert.deepEqual([v.rule, v.severity, v.file, v.line, v.expected], ['NAME-002', 'warning', 'src/paths.ts', 1, ['isWithinPath']]);
  assert.match(v.message, /returns boolean \(function withinPath\(a: string, b: string\): boolean\)/);
  const fix = v.fixes[0];
  assert.deepEqual([fix.id, fix.step], ['NAME-002/rename:isWithinPath', { tool: 'lsp.rename', args: { file: 'src/paths.ts', from: 'withinPath', to: 'isWithinPath' } }]);
  for (const file of ['src/paths.ts', 'src/use.ts']) fs.writeFileSync(path.join(root, file), apply(fs.readFileSync(path.join(root, file), 'utf8'), fix.edits.filter((e) => e.file === file)));
  assert.match(fs.readFileSync(path.join(root, 'src/use.ts'), 'utf8'), /import \{ isWithinPath, bookish \}.*isWithinPath\(p, '\/a'\)/s);
  clearHostCache();
  assert.ok(!booleanNameProblems(root, 'src/paths.ts').some((p) => /withinPath/i.test(p.name)), 'renamed: no longer flagged');
});

test('type guards are covered; a non-boolean function with an is prefix is not flagged by this rule', () => {
  const root = project();
  const names = booleanNameProblems(root, 'src/paths.ts').map((p) => [p.name, p.guard, p.suggested]);
  assert.deepEqual(names, [['withinPath', false, 'isWithinPath'], ['bookish', true, 'isBookish']]);
  const all = validateBooleanNames(root).violations.map((v) => v.message.split(' ')[0]).sort();
  assert.deepEqual(all, ['bookish', 'both', 'withinPath'], 'isBook, hasPages (prefixed booleans) and isoDate, isReady (not boolean) are not flagged');
  assert.equal(renameEdits(root, 'src/paths.ts', 'bookish', 'isBookish').length, 3);
});

test('switchable in the profile: architecture.yml rules NAME-002 severity and generated; no tsconfig, nothing checked', async () => {
  const root = project({ 'architecture.yml': 'version: 1\nrules:\n  NAME-002:\n    severity: error\n    generated: warning\n' });
  assert.ok(validateBooleanNames(root).violations.every((v) => v.severity === 'error'));
  const g = await atomicGate({ rel: 'src/paths.ts', source: PATHS, fn: 'withinPath', root, smith: async () => ({ steps: ['x'], empty: null, all: [] }) });
  const naming = g.checks.find((c) => c.check === 'naming');
  assert.deepEqual([naming.ok, /warning: NAME-002 withinPath returns boolean; name it isWithinPath/.test(naming.line)], [true, true]);
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'version: 1\nrules:\n  NAME-002: off\n');
  assert.deepEqual(validateBooleanNames(root).violations, []);
  const bare = makeTempDir('construct-name-002-bare-');
  fs.writeFileSync(path.join(bare, 'a.ts'), PATHS);
  assert.deepEqual(validateBooleanNames(bare).violations, []);
});

test('atomicGate reports NAME-002 on generated code as a failure (default error), with and without a project', async () => {
  const smith = async () => ({ steps: ['x'], empty: null, all: [] });
  const src = 'export function within(a: string, b: string): boolean {\n  return a.startsWith(b);\n}\nexport function isWithin(a: string, b: string): boolean {\n  return a.startsWith(b);\n}\n';
  const bad = await atomicGate({ rel: 'features/a/domains/within.ts', source: src, fn: 'within', smith });
  assert.ok(bad.failed.includes('naming'));
  assert.match(bad.checks.find((c) => c.check === 'naming').line, /name it isWithin/);
  const good = await atomicGate({ rel: 'features/a/domains/within.ts', source: src, fn: 'isWithin', smith });
  assert.ok(!good.failed.includes('naming'));
  const root = project();
  assert.equal(booleanNameOf('src/paths.ts', PATHS, 'bookish', { root }).guard, true);
});
