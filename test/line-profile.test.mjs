// ca1 -- the Line profile (packages/core/profiles/line, docs/line-architecture.md): a passing mini Line
// project and one failing fixture per LINE-* rule under packages/core/profiles/line/fixtures/, plus unit cases for the
// static detectors and the `construct validate --profile line` wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateLine, LINE_RULES, LINE_RULE_IDS, normalizeLineConfig } from '../packages/core/profiles/line/index.mjs';
import { findFsWrites, resolveSpecifier, resolveLayout, isPageShaped, moduleEdges, findSharedCopies, packageNameOf } from '../packages/core/profiles/line/checks.mjs';
import { SHARED_CONCERNS } from '../packages/core/profiles/line/contract.mjs';
import { selectProfile, enforcersForProfile, PROFILES } from '../packages/core/profiles/index.mjs';
import { DEFAULT_ENFORCERS } from '../packages/engine/defaultEnforcers.mjs';
import { ConstructError } from '../packages/core/diagnostics.mjs';
import { parseToAst } from '../packages/ast/index.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, '..', 'packages', 'core', 'profiles', 'line', 'fixtures');
const bin = path.join(here, '..', 'packages', 'cli', 'construct.mjs');

/** A scratch copy of a fixture project, optionally with files added or replaced. */
function copyFixture(name, overlay = {}) {
  const dir = makeTempDir('construct-line-');
  fs.cpSync(path.join(FIXTURES, name), dir, { recursive: true });
  for (const [rel, text] of Object.entries(overlay)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

const where = (vs) => vs.map((v) => `${v.rule} ${v.file}:${v.line}`).sort();

test('contract: six LINE rules, each with a one-sentence why and how it is checked', () => {
  assert.deepEqual([...LINE_RULE_IDS].sort(), ['LINE-BASE', 'LINE-DIR', 'LINE-LAYOUT', 'LINE-OWNER', 'LINE-SHARED', 'LINE-WRITER']);
  for (const id of LINE_RULE_IDS) {
    const r = LINE_RULES[id];
    assert.equal(r.id, id);
    assert.match(r.why, /^[A-Z].*\.$/, `${id} why is a full sentence`);
    assert.equal(r.why.split(/\.\s/).length, 1, `${id} why is one sentence`);
    assert.ok(r.check.length > 20 && r.expected.length > 0);
  }
});

test('contract: line config defaults and plain-English usage errors', () => {
  const c = normalizeLineConfig(undefined);
  assert.equal(c.state, 'line');
  assert.deepEqual(c.writers, []);
  assert.ok(c.writerExempt.includes('**/*.test.*'));
  assert.equal(c.rules['LINE-WRITER'].severity, 'error');
  assert.equal(normalizeLineConfig({ rules: { 'LINE-WRITER': 'warning' } }).rules['LINE-WRITER'].severity, 'warning');
  assert.throws(() => normalizeLineConfig({ rules: { 'LINE-NOPE': 'error' } }), (e) => e instanceof ConstructError && /is not a Line rule/.test(e.message));
  assert.throws(() => normalizeLineConfig({ rules: { 'LINE-BASE': 'loud' } }), /must be error, warning, info or off/);
  assert.throws(() => normalizeLineConfig({ writers: 'packages/writer' }), /must be a list of path patterns/);
  assert.throws(() => normalizeLineConfig({ library: '../lib' }), /folder path inside the project/);
  assert.throws(() => normalizeLineConfig(['x']), /must be a mapping/);
});

test('passing fixture: a complete mini Line project has no violations', () => {
  const r = validateLine(path.join(FIXTURES, 'passing'));
  assert.deepEqual(r.violations, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.layout, { library: 'library', features: 'features', state: 'line' });
});

const EXPECTED = {
  'LINE-BASE': [
    'LINE-BASE features/billing/pages/InvoicesPage.tsx:2',
    'LINE-BASE features/orders/components/OrderButton.tsx:1',
    'LINE-BASE features/orders/fixtures/order.json:2',
    'LINE-BASE features/orders/workflows/orderCheckout.ts:1',
  ],
  'LINE-OWNER': [
    'LINE-OWNER app/about/page.tsx:1',
    'LINE-OWNER features/billing/pages/InvoicesPage.tsx:2',
    'LINE-OWNER features/orders/pages/OrdersPage.tsx:1',
  ],
  'LINE-DIR': [
    'LINE-DIR features/billing/pages/InvoicesPage.tsx:4',
    'LINE-DIR library/components/Button.tsx:1',
  ],
  'LINE-WRITER': [
    'LINE-WRITER packages/tool/save.js:10',
    'LINE-WRITER packages/tool/save.js:6',
    'LINE-WRITER packages/tool/save.js:7',
    'LINE-WRITER packages/tool/save.js:8',
  ],
  'LINE-SHARED': [
    'LINE-SHARED packages/tool/ask.js:1',
    'LINE-SHARED packages/tool/ask.js:5',
    'LINE-SHARED packages/tool/tools.js:1',
  ],
  'LINE-LAYOUT': [
    'LINE-LAYOUT features/orders/notes.txt:1',
    'LINE-LAYOUT features/orders/services:1',
    'LINE-LAYOUT features/stray.ts:1',
    'LINE-LAYOUT library/hooks:1',
  ],
};

for (const [rule, expected] of Object.entries(EXPECTED)) {
  test(`failing fixture ${rule}: only ${rule} fires, at exactly the planted spots, in full sentences`, () => {
    const r = validateLine(path.join(FIXTURES, rule));
    assert.equal(r.ok, false);
    assert.deepEqual(where(r.violations), expected);
    for (const v of r.violations) {
      assert.equal(v.module, 'architecture');
      assert.equal(v.why, LINE_RULES[rule].why);
      assert.match(v.message, /^["A-Z].*\.$/, `message is a full sentence: ${v.message}`);
    }
  });
}

test('LINE-BASE messages say what is wrong and what to do', () => {
  const msgs = validateLine(path.join(FIXTURES, 'LINE-BASE')).violations.map((v) => v.message).join('\n');
  assert.match(msgs, /has no library base; add one "@line-base components\/<Name>" comment/);
  assert.match(msgs, /links to 2 library bases/);
  assert.match(msgs, /is not a library workflow; base it on an item in library\/workflows\//);
  assert.match(msgs, /"fixtures\/customer" .* does not exist in library\//);
});

test('LINE-BASE: spec.md, index barrels and tests are not feature items', () => {
  const dir = copyFixture('passing', {
    'features/orders/components/OrderButton.test.tsx': "import { OrderButton } from './OrderButton';\nOrderButton();\n",
    'features/orders/components/OrderButton.stories.tsx': 'export default {};\n',
  });
  assert.deepEqual(validateLine(dir).violations, []);
});

test('rule options: line.rules severities and architecture.yml exceptions apply', () => {
  const dir = copyFixture('LINE-DIR');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\npreset: line\nline:\n  writers: ["packages/writer/**"]\n  rules:\n    LINE-DIR: warning\n');
  const r = validateLine(dir);
  assert.equal(r.ok, true);
  assert.ok(r.violations.every((v) => v.severity === 'warning'));
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\npreset: line\nline:\n  writers: ["packages/writer/**"]\n  rules:\n    LINE-DIR: "off"\n');
  assert.deepEqual(validateLine(dir).violations, []);
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\npreset: line\nline:\n  writers: ["packages/writer/**"]\nexceptions:\n  - rule: LINE-DIR\n    path: library/components/Button.tsx\n    reason: migrating\n');
  assert.deepEqual(where(validateLine(dir).violations), ['LINE-DIR features/billing/pages/InvoicesPage.tsx:4']);
});

test('existing layer rules still apply to Line components, pages and workflows', () => {
  const dir = copyFixture('passing', {
    'library/pages/ListPage.tsx': "export function ListPage() {\n  fetch('/api/x');\n  return <main />;\n}\n",
    'features/orders/workflows/orderCheckout.ts': "// @line-base workflows/checkout\nimport { useState } from 'react';\nexport const s = useState;\n",
  });
  const rules = validateLine(dir).violations.map((v) => `${v.rule} ${v.file}`);
  assert.ok(rules.includes('PAGE-004 library/pages/ListPage.tsx'), rules.join('\n'));
  assert.ok(rules.includes('WORKFLOW-001 features/orders/workflows/orderCheckout.ts'), rules.join('\n'));
});

test('opts.files and opts.rules scope a run', () => {
  const r = validateLine(path.join(FIXTURES, 'LINE-DIR'), { files: ['library/components/Button.tsx'] });
  assert.deepEqual(where(r.violations), ['LINE-DIR library/components/Button.tsx:1']);
  assert.deepEqual(validateLine(path.join(FIXTURES, 'LINE-DIR'), { rules: ['LINE-WRITER'] }).violations, []);
});

test('layout: src/library and src/features are found when the project keeps its code under src/', () => {
  const dir = makeTempDir('construct-line-src-');
  fs.mkdirSync(path.join(dir, 'src', 'features', 'a', 'pages'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'library', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'library', 'pages', 'Base.tsx'), 'export const Base = () => null;\n');
  fs.writeFileSync(path.join(dir, 'src', 'features', 'a', 'pages', 'A.tsx'), '// @line-base pages/Base\nexport const A = () => null;\n');
  fs.writeFileSync(path.join(dir, 'src', 'features', 'a', 'spec.md'), '# A\n');
  assert.deepEqual(resolveLayout(dir, normalizeLineConfig(undefined)), { library: 'src/library', features: 'src/features', state: 'line' });
  assert.deepEqual(validateLine(dir).violations, []);
});

test('a project with neither folder gets one LINE-LAYOUT finding', () => {
  const dir = makeTempDir('construct-line-empty-');
  fs.writeFileSync(path.join(dir, 'index.ts'), 'export const x = 1;\n');
  assert.deepEqual(where(validateLine(dir).violations), ['LINE-LAYOUT .:1']);
});

test('resolveSpecifier: relative, @/, ~/ and src-less aliases into features or the library', () => {
  const layout = { library: 'src/library', features: 'src/features', state: 'line' };
  assert.equal(resolveSpecifier(layout, 'src/features/a/pages/P.tsx', '../../b/x'), 'src/features/b/x');
  assert.equal(resolveSpecifier(layout, 'src/features/a/pages/P.tsx', '@/features/b/x'), 'src/features/b/x');
  assert.equal(resolveSpecifier(layout, 'src/features/a/pages/P.tsx', '~/src/library/c'), 'src/library/c');
  assert.equal(resolveSpecifier(layout, 'src/features/a/pages/P.tsx', 'react'), null);
});

test('moduleEdges: type-only imports, re-exports, dynamic import and require all count', () => {
  const src = "import type { A } from './a';\nexport * from './b';\nconst c = require('./c');\nconst d = import('./d');\nexport { e } from './e';\n";
  assert.deepEqual(moduleEdges(parseToAst(src)).map((e) => e.specifier), ['./a', './b', './c', './d', './e']);
});

test('isPageShaped: pages/ folders, app router page files and Name.page.tsx', () => {
  assert.equal(isPageShaped('src/pages/Home.tsx'), true);
  assert.equal(isPageShaped('app/x/page.tsx'), true);
  assert.equal(isPageShaped('src/features/a/components/Home.page.tsx'), true);
  assert.equal(isPageShaped('app/x/layout.tsx'), false);
  assert.equal(isPageShaped('src/pages/Home.test.tsx'), false);
});

test('findFsWrites: every binding form of a file write, and nothing else', () => {
  const names = (src) => findFsWrites(parseToAst(src)).map((w) => `${w.name}:${w.line}`);
  assert.deepEqual(names("import fs from 'fs';\nfs.writeFileSync('a', 'b');\nfs.readFileSync('a');\n"), ['writeFileSync:2']);
  assert.deepEqual(names("import { promises as p } from 'node:fs';\nawait p.appendFile('a', 'b');\n"), ['appendFile:2']);
  assert.deepEqual(names("import { mkdir } from 'node:fs/promises';\nconst f = mkdir;\n"), ['mkdir:2']);
  assert.deepEqual(names("const { copyFileSync: cp } = require('fs');\ncp('a', 'b');\n"), ['copyFileSync:2']);
  assert.deepEqual(names("const fse = require('fs-extra');\nfse.outputFile('a', 'b');\nfse.readJson('a');\n"), ['outputFile:2']);
  assert.deepEqual(names("import fs from 'fs';\nconst { unlink } = fs.promises;\nunlink('a');\n"), ['unlink:3']);
  assert.deepEqual(names("require('fs').rmSync('a');\n"), ['rmSync:1']);
  assert.deepEqual(names("import { writeFile } from './my-writer';\nwriteFile('a');\nconst w = { writeFile() {} };\nw.writeFile();\n"), []);
  assert.deepEqual(names("import fs from 'fs';\nconst s = fs.createWriteStream('log');\nprocess.stdout.write('x');\n"), ['createWriteStream:2']);
});

test('LINE-SHARED: each concern names the module that wins and its signals; owners and sharedOwners are allowed', () => {
  const ids = SHARED_CONCERNS.map((c) => c.id);
  assert.deepEqual(ids, ['ai', 'plan', 'registry', 'summarizer', 'matcher', 'architecture']);
  for (const c of SHARED_CONCERNS) assert.ok(c.module && c.path && c.owners.length && (c.imports || c.strings || c.declares), c.id);
  const concern = (id) => SHARED_CONCERNS.find((c) => c.id === id);
  const hits = (src, id) => findSharedCopies(parseToAst(src), concern(id)).map((h) => h.line);
  assert.deepEqual(hits("import { Ollama } from 'ollama';\n", 'ai'), [1]);
  assert.deepEqual(hits("const u = 'https://api.openai.com/v1/chat';\n", 'ai'), [1]);
  assert.deepEqual(hits("const u = 'http://localhost:3000/api/chat';\n", 'ai'), []);
  assert.deepEqual(hits("export function addStep() {}\nfunction runNext() {}\n", 'plan'), [1]);
  assert.deepEqual(hits("export const toEnglish = (x) => x;\n", 'summarizer'), [1]);
  assert.deepEqual(hits("import x from 'eslint-plugin-boundaries';\n", 'architecture'), [1]);
  // The owner package itself may do the work; line.sharedOwners adds owners.
  assert.equal(packageNameOf(path.join(FIXTURES, 'passing'), 'packages/reason/decide.js', new Map()), '@mx/reason');
  const dir = copyFixture('LINE-SHARED');
  fs.writeFileSync(path.join(dir, 'packages', 'tool', 'package.json'), '{"name":"tool"}\n');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\npreset: line\nline:\n  writers: ["packages/writer/**"]\n  sharedOwners:\n    ai: [tool]\n');
  assert.deepEqual(where(validateLine(dir).violations), ['LINE-SHARED packages/tool/tools.js:1']);
  assert.throws(() => normalizeLineConfig({ sharedOwners: { cooking: ['x'] } }), /is not a shared concern/);
});

test('profiles: strict-nextjs stays the default; preset: line or --profile line selects the Line enforcer', () => {
  assert.equal(enforcersForProfile('strict-nextjs'), DEFAULT_ENFORCERS);
  assert.deepEqual(Object.keys(PROFILES).sort(), ['line', 'strict-nextjs']);
  const plain = makeTempDir('construct-line-plain-');
  assert.equal(selectProfile(plain), 'strict-nextjs');
  assert.equal(selectProfile(path.join(FIXTURES, 'passing')), 'line');
  assert.equal(selectProfile(plain, 'line'), 'line');
  assert.throws(() => selectProfile(plain, 'nope'), /"nope" is not a validation profile/);
});

test('cli: construct validate runs the Line profile and exits 0, 1 or 2', () => {
  const run = (...args) => spawnSync(process.execPath, [bin, 'validate', ...args], { encoding: 'utf8' });
  const ok = run('--dir', path.join(FIXTURES, 'passing'));
  assert.equal(ok.status, 0, ok.stderr);
  const bad = run('--profile', 'line', '--format', 'json', '--dir', path.join(FIXTURES, 'LINE-DIR'));
  assert.equal(bad.status, 1);
  assert.deepEqual(JSON.parse(bad.stdout).violations.map((v) => v.rule), ['LINE-DIR', 'LINE-DIR']);
  const unknown = run('--profile', 'nope', '--dir', path.join(FIXTURES, 'passing'));
  assert.equal(unknown.status, 2);
});
