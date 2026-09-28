// #553 -- project-local rules referenced from architecture.yml's `localRules:` list (same catalog
// shape #542 settles on for the built-in rule catalog), plus `construct add-rule`'s scaffold.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { loadConfig, normalizeLocalRules } from '../packages/core/config.mjs';
import { ConstructError } from '../packages/core/diagnostics.mjs';
import { validateRuleShape, loadLocalRules, runDetector, validateLocalRules, scaffoldRule } from '../packages/core/local-rules.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, '..', 'packages', 'cli', 'construct.mjs');

function tmpProject() {
  return makeTempDir('construct-local-rules-');
}

function writeRule(proj, relPath, obj) {
  const abs = path.join(proj, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const yamlText = Object.entries(obj)
    .map(([k, v]) => {
      if (k === 'layers' || k === 'expected') return `${k}:\n${v.map((x) => `  - ${x}`).join('\n')}`;
      if (k === 'detect') return `detect:\n${Object.entries(v).map(([dk, dv]) => `  ${dk}: ${JSON.stringify(dv)}`).join('\n')}`;
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join('\n');
  fs.writeFileSync(abs, yamlText + '\n');
  return relPath;
}

const VALID_RULE = {
  id: 'no-console-log',
  module: 'readability',
  layers: ['domain'],
  scope: 'project',
  defaultSeverity: 'warning',
  why: 'console.log left in domain code ships noisy output to production.',
  expected: ['Use the project logger instead of console.log.'],
  detect: { kind: 'forbiddenPattern', regex: 'console\\.log' },
};

// ---- config.mjs: normalizeLocalRules / loadConfig -------------------------

test('normalizeLocalRules defaults to [] when absent', () => {
  assert.deepEqual(normalizeLocalRules(undefined), []);
  assert.deepEqual(normalizeLocalRules(null), []);
});

test('normalizeLocalRules accepts an array of path strings', () => {
  assert.deepEqual(normalizeLocalRules(['local-rules/a/rule.yml', 'local-rules/b/rule.yml']), ['local-rules/a/rule.yml', 'local-rules/b/rule.yml']);
});

test('normalizeLocalRules rejects non-array and non-string entries', () => {
  assert.throws(() => normalizeLocalRules('x'), (e) => e instanceof ConstructError && /array/.test(e.message));
  assert.throws(() => normalizeLocalRules([5]), /localRules/);
  assert.throws(() => normalizeLocalRules(['']), /localRules/);
});

test('loadConfig parses architecture.yml\'s localRules: list', () => {
  const proj = tmpProject();
  fs.writeFileSync(path.join(proj, 'architecture.yml'), 'version: 1\nlocalRules:\n  - local-rules/no-console-log/rule.yml\n');
  assert.deepEqual(loadConfig(proj).localRules, ['local-rules/no-console-log/rule.yml']);
});

test('loadConfig defaults localRules to [] with no architecture.yml', () => {
  const proj = tmpProject();
  assert.deepEqual(loadConfig(proj).localRules, []);
});

// ---- validateRuleShape -----------------------------------------------------

test('validateRuleShape accepts a well-formed rule', () => {
  assert.deepEqual(validateRuleShape(VALID_RULE, 'local-rules/no-console-log/rule.yml'), VALID_RULE);
});

test('validateRuleShape rejects a missing/invalid field, naming the source path', () => {
  const bad = (patch, msgRe) => assert.throws(
    () => validateRuleShape({ ...VALID_RULE, ...patch }, 'local-rules/x/rule.yml'),
    (e) => e instanceof ConstructError && /local-rules\/x\/rule\.yml/.test(e.message) && msgRe.test(e.message),
  );
  bad({ id: '' }, /"id"/);
  bad({ module: 'nope' }, /"module"/);
  bad({ layers: [] }, /"layers"/);
  bad({ scope: 'nope' }, /"scope"/);
  bad({ defaultSeverity: 'nope' }, /"defaultSeverity"/);
  bad({ why: '' }, /"why"/);
  bad({ expected: 'nope' }, /"expected"/);
  bad({ detect: { kind: 'evalSomething' } }, /"detect\.kind"/);
  bad({ detect: { kind: 'forbiddenPattern' } }, /"detect" is missing/);
});

test('validateRuleShape refuses a non-mapping rule (e.g. a YAML scalar or list)', () => {
  assert.throws(() => validateRuleShape('not-an-object', 'x.yml'), /must be a YAML mapping/);
  assert.throws(() => validateRuleShape(['a'], 'x.yml'), /must be a YAML mapping/);
});

test('validateRuleShape never accepts a function-shaped detect.kind (declarative-only security boundary)', () => {
  assert.throws(() => validateRuleShape({ ...VALID_RULE, detect: { kind: 'exec', code: 'require("child_process")' } }, 'x.yml'), /detect\.kind.*must be one of/s);
});

// ---- loadLocalRules ---------------------------------------------------------

test('loadLocalRules reads and validates every path in architecture.yml\'s localRules: list', () => {
  const proj = tmpProject();
  writeRule(proj, 'local-rules/no-console-log/rule.yml', VALID_RULE);
  fs.writeFileSync(path.join(proj, 'architecture.yml'), 'version: 1\nlocalRules:\n  - local-rules/no-console-log/rule.yml\n');
  const rules = loadLocalRules(proj);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].id, 'no-console-log');
  assert.equal(rules[0].sourcePath, 'local-rules/no-console-log/rule.yml');
});

test('loadLocalRules throws a usage error naming the path when the file is missing', () => {
  const proj = tmpProject();
  fs.writeFileSync(path.join(proj, 'architecture.yml'), 'version: 1\nlocalRules:\n  - local-rules/nope/rule.yml\n');
  assert.throws(() => loadLocalRules(proj), (e) => e instanceof ConstructError && /local-rules\/nope\/rule\.yml/.test(e.message));
});

test('loadLocalRules throws a usage error on invalid YAML', () => {
  const proj = tmpProject();
  fs.mkdirSync(path.join(proj, 'local-rules', 'broken'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'local-rules', 'broken', 'rule.yml'), 'id: [unterminated\n');
  fs.writeFileSync(path.join(proj, 'architecture.yml'), 'version: 1\nlocalRules:\n  - local-rules/broken/rule.yml\n');
  assert.throws(() => loadLocalRules(proj), /Failed to parse local rule/);
});

// ---- runDetector ------------------------------------------------------------

test('runDetector forbiddenImport reports the import line', () => {
  const rule = { detect: { kind: 'forbiddenImport', module: 'lodash' } };
  const source = `import x from 'x';\nimport _ from 'lodash';\n`;
  const hits = runDetector(rule, source);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
});

test('runDetector forbiddenPattern / requiredPattern', () => {
  assert.equal(runDetector({ detect: { kind: 'forbiddenPattern', regex: 'TODO' } }, 'ok').length, 0);
  assert.equal(runDetector({ detect: { kind: 'forbiddenPattern', regex: 'TODO' } }, '// TODO: fix').length, 1);
  assert.equal(runDetector({ detect: { kind: 'requiredPattern', regex: 'license' } }, 'no header').length, 1);
  assert.equal(runDetector({ detect: { kind: 'requiredPattern', regex: 'license' } }, '// license').length, 0);
});

// ---- validateLocalRules (the enforcer) --------------------------------------

test('validateLocalRules is a no-op when localRules: is absent', () => {
  const proj = tmpProject();
  assert.deepEqual(validateLocalRules(proj), { violations: [] });
});

test('validateLocalRules flags a matching file in a rule\'s declared layer, and only that layer', () => {
  const proj = tmpProject();
  writeRule(proj, 'local-rules/no-console-log/rule.yml', VALID_RULE);
  fs.writeFileSync(path.join(proj, 'architecture.yml'), 'version: 1\nlocalRules:\n  - local-rules/no-console-log/rule.yml\n');
  fs.mkdirSync(path.join(proj, 'features/checkout/domain'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'features/checkout/domain/total.ts'), 'export function total() { console.log("x"); return 1; }\n');
  fs.mkdirSync(path.join(proj, 'features/checkout/services'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'features/checkout/services/CheckoutService.ts'), 'export function fetchTotal() { console.log("y"); }\n');

  const { violations } = validateLocalRules(proj);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'no-console-log');
  assert.equal(violations[0].file, 'features/checkout/domain/total.ts');
  assert.equal(violations[0].severity, 'warning');
  assert.equal(violations[0].why, VALID_RULE.why);
});

test('validateLocalRules skips a rule whose defaultSeverity is "off"', () => {
  const proj = tmpProject();
  writeRule(proj, 'local-rules/off-rule/rule.yml', { ...VALID_RULE, id: 'off-rule', defaultSeverity: 'off' });
  fs.writeFileSync(path.join(proj, 'architecture.yml'), 'version: 1\nlocalRules:\n  - local-rules/off-rule/rule.yml\n');
  fs.mkdirSync(path.join(proj, 'features/checkout/domain'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'features/checkout/domain/total.ts'), 'console.log("x");\n');
  assert.deepEqual(validateLocalRules(proj).violations, []);
});

test('validateLocalRules end-to-end through the CLI\'s validate command', () => {
  const proj = tmpProject();
  writeRule(proj, 'local-rules/no-console-log/rule.yml', VALID_RULE);
  fs.writeFileSync(path.join(proj, 'architecture.yml'), 'version: 1\nlocalRules:\n  - local-rules/no-console-log/rule.yml\n\nrules: {}\nexceptions: []\n');
  fs.mkdirSync(path.join(proj, 'features/checkout/domain'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'features/checkout/domain/total.ts'), 'console.log("x");\n');
  const r = spawnSync('node', [bin, 'validate', '--dir', proj], { encoding: 'utf8' });
  assert.match(r.stdout, /no-console-log/);
});

// ---- scaffoldRule / `construct add-rule` ------------------------------------

test('scaffoldRule writes rule.yml plus a violates/passes fixture pair whose marker matches the rule', () => {
  const proj = tmpProject();
  const result = scaffoldRule(proj, 'no-todo');
  assert.equal(result.ruleFile, 'local-rules/no-todo/rule.yml');
  assert.equal(result.violatesFile, 'local-rules/no-todo/violates.ts');
  assert.equal(result.passesFile, 'local-rules/no-todo/passes.ts');
  assert.equal(result.rule.id, 'no-todo');
  assert.equal(result.rule.detect.kind, 'forbiddenPattern');

  for (const f of [result.ruleFile, result.violatesFile, result.passesFile]) {
    assert.equal(fs.existsSync(path.join(proj, f)), true);
  }
  const rules = validateRuleShape(loadYamlFile(path.join(proj, result.ruleFile)), result.ruleFile);
  assert.equal(rules.id, 'no-todo');

  const violatesSrc = fs.readFileSync(path.join(proj, result.violatesFile), 'utf8');
  const passesSrc = fs.readFileSync(path.join(proj, result.passesFile), 'utf8');
  assert.equal(runDetector({ detect: rules.detect }, violatesSrc).length, 1);
  assert.equal(runDetector({ detect: rules.detect }, passesSrc).length, 0);
});

function loadYamlFile(p) {
  return yaml.load(fs.readFileSync(p, 'utf8'));
}

test('scaffoldRule rejects a malformed id, and an invalid module/scope/severity', () => {
  const proj = tmpProject();
  assert.throws(() => scaffoldRule(proj, ''), /add-rule requires a rule id/);
  assert.throws(() => scaffoldRule(proj, '1-bad'), /add-rule requires a rule id/);
  assert.throws(() => scaffoldRule(proj, 'ok', { module: 'nope' }), /--module/);
  assert.throws(() => scaffoldRule(proj, 'ok', { scope: 'nope' }), /--scope/);
  assert.throws(() => scaffoldRule(proj, 'ok', { severity: 'nope' }), /--severity/);
});

test('scaffoldRule never edits architecture.yml', () => {
  const proj = tmpProject();
  fs.writeFileSync(path.join(proj, 'architecture.yml'), 'version: 1\n');
  scaffoldRule(proj, 'no-todo');
  assert.equal(fs.readFileSync(path.join(proj, 'architecture.yml'), 'utf8'), 'version: 1\n');
});

test('CLI: `construct add-rule <id>` scaffolds the same three files and prints them', () => {
  const proj = tmpProject();
  const r = spawnSync('node', [bin, 'add-rule', 'no-magic-numbers', '--layers', 'domain', '--dir', proj], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /local-rules\/no-magic-numbers\/rule\.yml/);
  assert.match(r.stdout, /local-rules\/no-magic-numbers\/violates\.ts/);
  assert.match(r.stdout, /local-rules\/no-magic-numbers\/passes\.ts/);
  assert.equal(fs.existsSync(path.join(proj, 'local-rules/no-magic-numbers/rule.yml')), true);
});

test('CLI: `construct add-rule` with no id prints usage and exits non-zero', () => {
  const r = spawnSync('node', [bin, 'add-rule'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /Usage: construct add-rule/);
});
