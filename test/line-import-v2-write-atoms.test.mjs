// Line Import v2, line.import.writeAtoms (packages/engine/line/importV2/writeAtoms.mjs, owner 2026-10-14, option C):
// one converted function of the static breakdown is written into its app file through Construct's writer as a plan
// step, importing its atoms from @line/atoms (packages/line-atoms re-exports the pinned Smith atoms; the app gets a copy
// in its library atoms and a tsconfig alias). It counts (unit.written in line/atoms.json) only after its behaviour test
// passes: the function as written, read back from the file, against the original in QuickJS.
//
// Most tests use the mock tester (importV2/mock.mjs behaves); the last uses the real links and skips with the link's
// own sentence when a source is not on this machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { ATOMS_FILE, ATOMS_PACKAGE, ATOMS_WRITE_TOOL, assertAtomBreakdown, assertAtomUnitResult } from '../packages/engine/line/importV2/contract.mjs';
import { createMockStaticBreakdown, MOCK_ATOM_BREAKDOWN } from '../packages/engine/line/importV2/mock.mjs';
import { breakDownImport, breakdownLinks, functionStatement, importOf } from '../packages/engine/line/importV2/breakdown.mjs';
import { planWriteAtoms, withAtomsImport, withAtomsAlias, createAtomsTester, ATOMS_COPY_DIR } from '../packages/engine/line/importV2/writeAtoms.mjs';
import { lineTools, REAL_PLAN_OPS, runChange, previewStep } from '../packages/engine/line/planTools.mjs';
import { functionalFiles, functionalPin, snapshotFunctional, FUNCTIONAL_PIN, FUNCTIONAL_TABLE } from '../packages/line-atoms/runtime.mjs';
import { findAtomCopies } from '../packages/line-atoms/check.mjs';

const FOLDER = 'src/calc';
const FILE = `${FOLDER}/rules.ts`;
const RULES = `import { clamp } from './util';

export function total(a: number, b: number): number {
  return a + b;
}

export const isBig = (n: number): boolean => n > 100;

export function label(n: number, m: number): string {
  return \`\${n + m} items\`;
}
`;
const FIT = { proposal: { feature: 'calc', blocks: [{ kind: 'domain', name: 'rules', units: [], from: [`${FILE}#total`, `${FILE}#isBig`, `${FILE}#label`], sentence: 'rules is a domain.', area: 'feature' }], unassigned: [] }, steps: [] };

/** The fixture app with its breakdown (the mock converter) saved in the import folder's line/atoms.json. */
async function fixture({ rules = RULES } = {}) {
  const dir = makeTempDir('construct-line-write-atoms-');
  fs.mkdirSync(path.join(dir, FOLDER), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"calc-app","type":"module","private":true}\n');
  fs.writeFileSync(path.join(dir, FILE), rules);
  fs.writeFileSync(path.join(dir, FOLDER, 'util.ts'), 'export const clamp = (n: number) => Math.max(0, n);\n');
  const r = await breakDownImport(dir, FIT, { create: createMockStaticBreakdown });
  fs.mkdirSync(path.join(dir, FOLDER, 'line'), { recursive: true });
  fs.writeFileSync(path.join(dir, FOLDER, ATOMS_FILE), `${JSON.stringify(r.breakdown)}\n`);
  return { dir, folderRoot: path.join(dir, FOLDER) };
}
const args = (name = 'total') => ({ folder: FOLDER, file: FILE, name });
const mockTester = (o = {}) => createAtomsTester({ create: () => createMockStaticBreakdown(o) });
const unitOf = (folderRoot, name) => JSON.parse(fs.readFileSync(path.join(folderRoot, ATOMS_FILE), 'utf8')).units.find((u) => u.name === name);
const toolsWith = async (dir, o = {}) => lineTools({ root: dir, ops: /** @type {any} */ ({ ...REAL_PLAN_OPS, atomsTester: await mockTester(o) }) });
const run = async (tools, a) => tools.find((t) => t.name === ATOMS_WRITE_TOOL).run(a);

// ------------------------------------------------------------------------------------------------- @line/atoms

test('@line/atoms re-exports the pinned Smith atoms: a generated snapshot at the same commit the breakdown checks against', () => {
  const table = JSON.parse(fs.readFileSync(FUNCTIONAL_TABLE, 'utf8'));
  assert.equal(FUNCTIONAL_PIN, table.source.commit);
  assert.equal(functionalPin().from, 'src/atoms');
  const files = functionalFiles();
  assert.ok(files.length > 20 && files.some((f) => f.rel === 'index.ts') && files.some((f) => f.rel === 'arithmetic.ts'));
  for (const f of files) assert.match(f.content, /^\/\/ @line-atoms functional 939c25c: generated from smith-functional src\/atoms\/.* do not edit\.\n/, f.rel);
  assert.match(files.find((f) => f.rel === 'arithmetic.ts').content, /export function plus\(a: any, b: any\): any \{\n {2}return a \+ b;/);
  const pkg = JSON.parse(fs.readFileSync(new URL('../packages/line-atoms/package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.exports['./functional'], './functional/index.ts');
});

const smithDir = process.env.SMITH_FUNCTIONAL_SOURCE_DIR ?? path.join(os.homedir(), 'Repositories', 'smith-functional');
test('the snapshot is what the pinned commit gives (regenerate with node packages/line-atoms/runtime.mjs --write)', { skip: fs.existsSync(smithDir) ? false : `the smith-functional source folder ${smithDir} is missing` }, () => {
  const snap = snapshotFunctional({ sourceDir: smithDir });
  assert.deepEqual(snap.files.map((f) => f.rel), functionalPin().files);
  assert.deepEqual(snap.files, functionalFiles());
});

test('LINE-ATOM: the copy in an app\'s atoms kind is not a hand-written copy (the rule does not read the atoms kind)', () => {
  const f = functionalFiles().find((x) => x.rel === 'lists.ts');
  assert.deepEqual(findAtomCopies({ file: `library/atoms/${ATOMS_COPY_DIR}/lists.ts`, source: f.content, ast: { body: [] }, kind: 'atoms' }), []);
});

test('the breakdown imports its atoms from @line/atoms; a unit importing from anywhere else is refused by the contract', () => {
  assert.equal(importOf(['plus', 'join']), `import { plus, join } from '${ATOMS_PACKAGE}';`);
  assert.equal(importOf([]), '');
  for (const u of MOCK_ATOM_BREAKDOWN.units) assert.match(u.importDecl, /from '@line\/atoms';$/);
  assert.throws(() => assertAtomUnitResult({ ...MOCK_ATOM_BREAKDOWN.units[0], importDecl: "import { plus } from 'smith';" }), /importDecl must import from '@line\/atoms'/);
  assert.throws(() => assertAtomUnitResult({ ...MOCK_ATOM_BREAKDOWN.units[1], written: { file: 'x.ts', sentence: 'Written.' } }), /written must be set only on a converted unit/);
});

// ------------------------------------------------------------------------------------------------- the pieces

test('functionStatement: the whole statement and its export, a const arrow included; a shared const is not one', () => {
  const at = functionStatement(RULES, 'isBig');
  assert.equal(RULES.slice(at.start, at.end), 'export const isBig = (n: number): boolean => n > 100;');
  assert.equal(at.prefix, 'export ');
  assert.equal(functionStatement('const a = () => 1, b = 2;', 'a'), null);
  assert.equal(functionStatement('export default function f() { return 1; }', 'f').prefix, 'export default ');
});

test('withAtomsImport: merges into an existing @line/atoms import, else goes after the last import or the directive', () => {
  assert.equal(withAtomsImport("import { a } from './a';\nconst x = 1;\n", ['plus']), "import { a } from './a';\nimport { plus } from '@line/atoms';\nconst x = 1;\n");
  assert.equal(withAtomsImport("import { join } from '@line/atoms';\nconst x = 1;\n", ['plus', 'join']), "import { join, plus } from '@line/atoms';\nconst x = 1;\n");
  assert.equal(withAtomsImport("'use client';\nconst x = 1;\n", ['plus']), "'use client';\nimport { plus } from '@line/atoms';\nconst x = 1;\n");
  assert.equal(withAtomsImport('const x = 1;\n', ['plus']), "import { plus } from '@line/atoms';\nconst x = 1;\n");
});

test('withAtomsAlias: adds the @line/atoms path (relative to baseUrl when set), keeps the rest, and is null when already there', () => {
  const entry = 'library/atoms/line/index.ts';
  assert.deepEqual(JSON.parse(withAtomsAlias(null, entry)), { compilerOptions: { paths: { '@line/atoms': ['./library/atoms/line/index.ts'] } } });
  const withBase = JSON.parse(withAtomsAlias('{ // a comment\n "compilerOptions": { "baseUrl": "library", "strict": true, "paths": { "~/*": ["./*"] } } }', entry));
  assert.deepEqual(withBase.compilerOptions, { baseUrl: 'library', strict: true, paths: { '~/*': ['./*'], '@line/atoms': ['./atoms/line/index.ts'] } });
  assert.equal(withAtomsAlias(JSON.stringify(withBase), entry), null);
  assert.throws(() => withAtomsAlias('{ nope', entry), /does not parse/);
});

// ------------------------------------------------------------------------------------------------- the plan step

test('plan: the function becomes its atom body (export kept), the import is added, the atoms are copied and aliased', async () => {
  const { folderRoot } = await fixture();
  const c = planWriteAtoms(folderRoot, args('total'), await mockTester());
  const main = c.files.find((f) => f.path === 'rules.ts');
  assert.equal(main.content, RULES.replace("import { clamp } from './util';\n", "import { clamp } from './util';\nimport { plus } from '@line/atoms';\n").replace('return a + b;', 'return plus(a, b);'));
  const copies = c.files.filter((f) => f.path.startsWith(`library/atoms/${ATOMS_COPY_DIR}/`));
  assert.equal(copies.length, functionalFiles().length);
  assert.deepEqual(JSON.parse(c.files.find((f) => f.path === 'tsconfig.json').content).compilerOptions.paths, { '@line/atoms': ['./library/atoms/line/index.ts'] });
  assert.deepEqual(c.behaviour, { file: 'rules.ts', name: 'total', code: unitOf(folderRoot, 'total').code });
  assert.match(c.summary, /^Writes total as atom calls into src\/calc\/rules\.ts, importing plus from @line\/atoms/);
});

test('plan refusals: not converted, unknown, stale, a name clash, no breakdown, outside the folder', async () => {
  const { dir, folderRoot } = await fixture();
  const code = (fn) => { try { fn(); return null; } catch (e) { return /** @type {any} */ (e).code; } };
  assert.equal(code(() => planWriteAtoms(folderRoot, args('label'))), 'NOT_CONVERTED');
  assert.equal(code(() => planWriteAtoms(folderRoot, args('nope'))), 'UNKNOWN_ITEM');
  assert.equal(code(() => planWriteAtoms(folderRoot, { folder: FOLDER, file: 'elsewhere/rules.ts', name: 'total' })), 'UNKNOWN_FILE');
  fs.writeFileSync(path.join(dir, FILE), RULES.replace('return a + b;', 'return b + a;'));
  assert.equal(code(() => planWriteAtoms(folderRoot, args('total'))), 'STALE');
  fs.writeFileSync(path.join(dir, FILE), `${RULES}\nexport const plus = 1;\n`);
  assert.equal(code(() => planWriteAtoms(folderRoot, args('total'))), 'NAME_TAKEN');
  fs.rmSync(path.join(folderRoot, ATOMS_FILE));
  assert.equal(code(() => planWriteAtoms(folderRoot, args('total'))), 'NO_BREAKDOWN');
});

test('the behaviour test gates the write: links down or a different behaviour refuses before anything is written', async () => {
  const { folderRoot } = await fixture();
  assert.throws(() => planWriteAtoms(folderRoot, args('total'), { ok: false, reason: 'The atom runtime is not linked.' }), (e) => /** @type {any} */ (e).code === 'NOT_CHECKED' && /^The behaviour test cannot run \(the atom runtime is not linked\), so total is not written\.$/.test(e.message));
  const differs = await mockTester({ different: ['total'] });
  assert.throws(() => planWriteAtoms(folderRoot, args('total'), differs), (e) => /** @type {any} */ (e).code === 'BEHAVIOUR');
  // A preview (no tester) only plans.
  assert.ok(previewStep(path.dirname(path.dirname(folderRoot)), ATOMS_WRITE_TOOL, args('total')).files.length > 1);
});

test('step: through the plan tools it writes the function, its behaviour test passes, and only then the unit counts as written', async () => {
  const { dir, folderRoot } = await fixture();
  const r = await run(await toolsWith(dir), args('total'));
  assert.equal(r.needsYou, false, r.sentence);
  assert.deepEqual(r.checks.map((c) => [c.checkId, c.ok]), [['validate', true], ['files', true], ['behaviour', true]]);
  assert.match(r.checks[2].sentence, /^total as written behaves as the original on 25 generated inputs/);
  assert.match(fs.readFileSync(path.join(dir, FILE), 'utf8'), /import \{ plus \} from '@line\/atoms';[\s\S]*export function total\(a: number, b: number\): number \{\n {2}return plus\(a, b\);\n\}/);
  assert.ok(fs.existsSync(path.join(folderRoot, 'library/atoms/line/index.ts')));
  assert.ok(fs.existsSync(path.join(folderRoot, 'tsconfig.json')));
  const saved = JSON.parse(fs.readFileSync(path.join(folderRoot, ATOMS_FILE), 'utf8'));
  assertAtomBreakdown(saved);
  assert.deepEqual(saved.units.find((u) => u.name === 'total').written, { file: FILE, sentence: r.checks[2].sentence });
  assert.equal(saved.units.find((u) => u.name === 'label').written, undefined);
});

test('step: a written function whose behaviour test fails needs you and does not count', async () => {
  const { dir, folderRoot } = await fixture();
  // The tester passes the planned file, then the file is found different after the write (the mock's `different`
  // decides per call: the second call, on the written file, says different).
  const tester = await mockTester();
  let calls = 0;
  const flaky = { ok: true, behaves: (fn, w) => (++calls === 1 ? tester.behaves(fn, w) : { ok: false, compared: 25, sentence: `${fn.name} as written behaves differently from the original (mock).` }) };
  const tools = lineTools({ root: dir, ops: /** @type {any} */ ({ ...REAL_PLAN_OPS, atomsTester: flaky }) });
  const r = await run(tools, args('total'));
  assert.equal(r.needsYou, true);
  assert.deepEqual(r.checks.map((c) => [c.checkId, c.ok]), [['validate', true], ['files', true], ['behaviour', false]]);
  assert.equal(unitOf(folderRoot, 'total').written, undefined);
});

test('step: run outside the plan tools (no tester) it is refused and writes nothing', async () => {
  const { dir } = await fixture();
  const r = runChange(dir, ATOMS_WRITE_TOOL, args('total'));
  assert.equal(r.needsYou, true);
  assert.match(r.apply.sentence, /^Nothing was saved: the behaviour test cannot run \(the behaviour test is not set up for this run\), so total is not written\.$/);
  assert.equal(fs.readFileSync(path.join(dir, FILE), 'utf8'), RULES);
});

// ------------------------------------------------------------------------------------------------- real links

const links = breakdownLinks();
const skip = links.codemod.ok && links.runtime.ok ? false : `${links.codemod.ok ? '' : links.codemod.message} ${links.runtime.ok ? '' : links.runtime.message}`.trim();

test('real: the breakdown converts the fixture, the step writes isBig as atom calls and QuickJS says the file behaves the same', { skip, timeout: 180_000 }, async () => {
  const dir = makeTempDir('construct-line-write-atoms-real-');
  fs.mkdirSync(path.join(dir, FOLDER), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"calc-app","type":"module","private":true}\n');
  fs.writeFileSync(path.join(dir, FILE), RULES);
  fs.writeFileSync(path.join(dir, FOLDER, 'util.ts'), 'export const clamp = (n: number) => Math.max(0, n);\n');
  const r = await breakDownImport(dir, FIT, {});
  r.dispose();
  const isBig = r.breakdown.units.find((u) => u.name === 'isBig');
  assert.equal(isBig.status, 'converted', isBig.sentence);
  assert.equal(isBig.importDecl, "import { greaterThan } from '@line/atoms';");
  fs.mkdirSync(path.join(dir, FOLDER, 'line'), { recursive: true });
  fs.writeFileSync(path.join(dir, FOLDER, ATOMS_FILE), `${JSON.stringify(r.breakdown)}\n`);
  const res = await run(lineTools({ root: dir }), args('isBig'));
  assert.equal(res.needsYou, false, res.sentence);
  assert.match(res.checks.find((c) => c.checkId === 'behaviour').sentence, /^isBig as written behaves as the original on \d+ generated inputs\.$/);
  assert.match(fs.readFileSync(path.join(dir, FILE), 'utf8'), /import \{ greaterThan \} from '@line\/atoms';[\s\S]*export function isBig\(n: number\): boolean \{\n {2}return greaterThan\(n, 100\);\n\}/);
  assert.ok(unitOf(path.join(dir, FOLDER), 'isBig').written);
});
