// Line Import v2, the static breakdown (packages/engine/line/importV2/breakdown.mjs, owner 2026-10-14): each pure
// function the fit puts in a domain block becomes atom calls through atomic-codemod's toAtoms, a rewrite counting only
// when the QuickJS check says old and new behave the same; what it leaves untranslated is a refusal that goes through
// the one repair loop (construct.repair, repairLoop). No model here.
//
// Most tests use the mock converter (importV2/mock.mjs createMockStaticBreakdown), so they run without atomic-codemod or
// the atom runtime. The last ones use the real links (atomic-codemod-atoms.json, smith-functional.json) and skip with
// the link's own sentence when a source is not on this machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { assertImportAgentView, assertImportPlanFile, IMPORT_PLAN_FILE } from '../packages/engine/line/contract.mjs';
import { assertAtomBreakdown, assertAtomUnitResult, ATOMS_FILE, ATOMS_TOOL } from '../packages/engine/line/importV2/contract.mjs';
import { createMockStaticBreakdown, MOCK_ATOM_BREAKDOWN } from '../packages/engine/line/importV2/mock.mjs';
import { functionOf, syntaxTreeOf, AST_AFTER_FAILURES, domainFunctions, breakDownImport, breakdownCounts, breakdownLinks, createStaticBreakdown, refusalOf } from '../packages/engine/line/importV2/breakdown.mjs';
import { createImportAgent } from '../packages/engine/line/importAgent.mjs';
import { fileStore } from '../packages/engine/line/importAgentDisk.mjs';
import { createLogicOnDisk } from '../packages/engine/line/importLoopDisk.mjs';
import { createMockPlanService } from '../packages/engine/line/mockImportAgent.mjs';
import { repairLoop } from '../packages/core/line-decide.mjs';

const FOLDER = 'src/calc';
const RULES = `export function total(a: number, b: number): number {
  return a + b;
}

export const isBig = (n: number): boolean => n > 100;

export function label(n: number, m: number): string {
  return \`\${n + m} items\`;
}

export const LIMIT = 100;
`;
const FIT = { proposal: { feature: 'calc', blocks: [{ kind: 'domain', name: 'rules', units: ['u1', 'u2', 'u3'], from: [`${FOLDER}/rules.ts#isBig`, `${FOLDER}/rules.ts#label`, `${FOLDER}/rules.ts#total`, `${FOLDER}/rules.ts#LIMIT`], sentence: 'rules is a domain.', area: 'feature' }, { kind: 'page', name: 'Home', units: [], from: [`${FOLDER}/Home.tsx#Home`], sentence: 'Home is a page.', area: 'feature' }], unassigned: [] }, steps: [] };

/** The fixture app: src/calc/rules.ts, three pure functions and a constant. */
function fixtureApp() {
  const dir = makeTempDir('construct-line-breakdown-');
  fs.mkdirSync(path.join(dir, FOLDER), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"calc-app","type":"module","private":true}\n');
  fs.writeFileSync(path.join(dir, FOLDER, 'rules.ts'), RULES);
  return dir;
}

/** A repair "model" that answers with `body` for `name` (repairLoop's propose, the JSON its grammar asks for). */
const proposeBody = (body) => async ({ prompt }) => {
  const change = JSON.parse(/Change: (.*)/.exec(prompt)[1]);
  return JSON.stringify({ tool: change.tool, args: { ...change.args, body } });
};
const LABEL_REPAIRED = "function label(n: number, m: number): string {\n  return joinedText([plus(n, m), ' items']);\n}";

// ------------------------------------------------------------------------------------------------- reading functions

test('functionOf: an exported declaration loses its export, an arrow bound to a const becomes a declaration, a value is no function', () => {
  const total = functionOf(RULES, 'total', 'rules.ts');
  assert.deepEqual(total, { code: 'function total(a: number, b: number): number {\n  return a + b;\n}', line: 1, exact: true });
  assert.deepEqual(functionOf(RULES, 'isBig', 'rules.ts'), { code: 'function isBig(n: number): boolean {\n  return n > 100;\n}', line: 5, exact: false });
  assert.equal(functionOf(RULES, 'LIMIT', 'rules.ts'), null);
  assert.equal(functionOf(RULES, 'missing', 'rules.ts'), null);
  assert.equal(functionOf('export default async function load(x: string) { return x; }', 'load')?.code, 'async function load(x: string) { return x; }');
});

test('domainFunctions: only the domain blocks, only names that are functions, read from disk', () => {
  const dir = fixtureApp();
  const fns = domainFunctions(dir, FIT);
  assert.deepEqual(fns.map((f) => [f.name, f.block, f.line]), [['isBig', 'domain:rules', 5], ['label', 'domain:rules', 7], ['total', 'domain:rules', 1]]);
  assert.equal(fns[0].abs, path.join(dir, FOLDER, 'rules.ts'));
});

// ------------------------------------------------------------------------------------------------- the contract

test('contract: the mock breakdown fits; a rewrite counts only when the check says same', () => {
  assertAtomBreakdown(MOCK_ATOM_BREAKDOWN);
  const ok = MOCK_ATOM_BREAKDOWN.units[0];
  assertAtomUnitResult(ok);
  assert.throws(() => assertAtomUnitResult({ ...ok, check: { ...ok.check, status: 'different' } }), /count a rewrite only when the check says same/);
  assert.throws(() => assertAtomUnitResult({ ...ok, rewrites: 0 }), /count a rewrite only when the check says same/);
  assert.throws(() => assertAtomUnitResult({ ...ok, status: 'unchecked', check: { ...ok.check, status: 'unchecked' } }), /be the original when no rewrite counts/);
  assert.throws(() => assertAtomUnitResult({ ...ok, untranslated: [{ form: 'TemplateLiteral', text: '`x`', line: 1 }] }), /leave no part untranslated when converted/);
  assert.throws(() => assertAtomBreakdown({ ...MOCK_ATOM_BREAKDOWN, counts: { ...MOCK_ATOM_BREAKDOWN.counts, functions: 3 } }), /equal the number of units/);
  assert.equal(breakdownCounts(MOCK_ATOM_BREAKDOWN.units).sentence, MOCK_ATOM_BREAKDOWN.sentence);
});

test('refusalOf: one refusal per function, its parts listed as the finding, the kept body as the option', () => {
  const r = refusalOf(MOCK_ATOM_BREAKDOWN.units[1]);
  assert.deepEqual(r.option, { tool: ATOMS_TOOL, args: { file: 'src/alerts/rules.ts', name: 'label', body: MOCK_ATOM_BREAKDOWN.units[1].body } });
  assert.equal(r.refusal.sentence, '1 part of label has no atom, so the function is not atom calls yet.');
  assert.equal(r.refusal.rule, 'LINE-ATOMS');
  assert.equal(r.refusal.finding, 'Rewrite with atoms the runtime has: `${n + m} alerts` (line 6).');
});

// ------------------------------------------------------------------------------------------------- the breakdown (mock converter)

test('breakDownImport: each domain function is checked atoms or left as written; untranslated parts become refusals', async () => {
  const dir = fixtureApp();
  const r = await breakDownImport(dir, FIT, { create: createMockStaticBreakdown });
  assertAtomBreakdown(r.breakdown);
  assert.deepEqual(r.breakdown.units.map((u) => [u.name, u.status, u.untranslated.length]), [['isBig', 'unchanged', 0], ['label', 'partial', 1], ['total', 'converted', 0]]);
  assert.equal(r.breakdown.units[2].body, 'function total(a: number, b: number): number {\n  return plus(a, b);\n}');
  assert.equal(r.breakdown.units[1].untranslated[0].line, 8, 'the line in the file');
  assert.deepEqual(r.refusals.map((x) => x.option.args.name), ['label']);
  assert.equal(r.breakdown.sentence, '1 of 3 domain functions is atom calls now, each checked against the original in QuickJS; 1 is partly atoms; 1 has parts with no atom, sent to the repair step.');
  // Construct's check of a repaired body: refused while a part is left, accepted when every part is an atom call.
  const still = r.check({ tool: ATOMS_TOOL, args: { file: `${FOLDER}/rules.ts`, name: 'label', body: r.breakdown.units[1].body } });
  assert.equal(still.ok, false);
  assert.match(still.refusal.sentence, /still has 1 part/);
  assert.deepEqual(r.check({ tool: ATOMS_TOOL, args: { file: `${FOLDER}/rules.ts`, name: 'label', body: LABEL_REPAIRED } }), { ok: true, refusal: null, passed: 1 });
  assert.equal(r.check({ tool: ATOMS_TOOL, args: { file: 'other.ts', name: 'label', body: LABEL_REPAIRED } }).ok, false);
});

test('a refusal goes through the one repair loop (repairLoop, construct.repair) with the breakdown\'s check; a repaired body counts', async () => {
  const dir = fixtureApp();
  const r = await breakDownImport(dir, FIT, { create: createMockStaticBreakdown });
  const [{ option, refusal }] = r.refusals;
  const tries = [];
  const attempt = await repairLoop(option, refusal, { check: (x) => { tries.push(x.args.body); return r.check(x); }, propose: proposeBody(LABEL_REPAIRED) });
  assert.equal(attempt.outcome, 'repaired', attempt.sentence);
  assert.equal(attempt.step, 'construct.repair');
  assert.deepEqual(tries, [LABEL_REPAIRED]);
  r.settle(option, attempt);
  const label = r.breakdown.units.find((u) => u.name === 'label');
  assert.equal(label.status, 'converted');
  assert.equal(label.body, LABEL_REPAIRED);
  assert.deepEqual(label.atoms, ['joinedText', 'plus']);
  assert.equal(r.breakdown.counts.repaired, 1);
  assert.equal(r.breakdown.counts.refused, 0);
  // A repair that leaves the part is refused by the check, and the part stays for a person.
  const r2 = await breakDownImport(dir, FIT, { create: createMockStaticBreakdown });
  const bad = await repairLoop(r2.refusals[0].option, r2.refusals[0].refusal, { check: r2.check, propose: proposeBody('function label(n: number, m: number): string {\n  return `${plus(n, m)}!`;\n}'), maxAttempts: 1 });
  assert.notEqual(bad.outcome, 'repaired');
  r2.settle(r2.refusals[0].option, bad);
  assert.equal(r2.breakdown.units[1].status, 'partial');
  assert.equal(r2.breakdown.units[1].repair.outcome, bad.outcome);
});

test('syntaxTreeOf: a compact tree of a part, names, operators and literals kept', () => {
  assert.equal(syntaxTreeOf('`${n + m} items`'), 'TemplateExpression("", span(BinaryExpression(n + m), " items"))');
  assert.equal(syntaxTreeOf('sum += x'), 'BinaryExpression(sum += x)');
  assert.equal(syntaxTreeOf('a?.b()'), 'CallExpression(PropertyAccessExpression(a, QuestionDotToken, b))');
  assert.ok(syntaxTreeOf('x'.repeat(1000), 50).length <= 50);
});

test('after one refused repair of a function its refusal carries the parts\' syntax tree, and the next attempt reasons from it', async () => {
  assert.equal(AST_AFTER_FAILURES, 1);
  const dir = fixtureApp();
  const r = await breakDownImport(dir, FIT, { create: createMockStaticBreakdown });
  const [{ option, refusal }] = r.refusals;
  assert.doesNotMatch(refusal.sentence, /Syntax tree/, 'the first refusal is the plain one');
  const wrong = 'function label(n: number, m: number): string {\n  return `${plus(n, m)}!`;\n}';
  const prompts = [];
  const bodies = [wrong, LABEL_REPAIRED];
  const attempt = await repairLoop(option, refusal, { check: r.check, maxAttempts: 4, propose: async (q) => { prompts.push(q.prompt); return proposeBody(bodies[prompts.length - 1])(q); } });
  assert.equal(attempt.outcome, 'repaired', attempt.sentence);
  assert.equal(prompts.length, 2);
  assert.doesNotMatch(prompts[0], /Syntax tree/);
  assert.match(prompts[1], /Attempt 1: .* was refused too: The repaired function still has 1 part that are not atom calls\. Syntax tree of the parts with no atom: `\$\{n \+ m\} items` is TemplateExpression\("", span\(BinaryExpression\(n \+ m\), " items"\)\)\./);
});

test('fallback: with the codemod or the runtime not linked nothing is broken down, one sentence says why, and nothing is refused', async () => {
  const dir = fixtureApp();
  const r = await breakDownImport(dir, FIT, { create: () => createMockStaticBreakdown({ down: 'atomic-codemod is not linked' }) });
  assertAtomBreakdown(r.breakdown);
  assert.equal(r.breakdown.via, 'off');
  assert.equal(r.breakdown.sentence, 'The static breakdown into atoms is off (atomic-codemod is not linked), so the import carries on without it.');
  assert.deepEqual(r.refusals, []);
  // The real converter with its sources moved away answers the same way instead of throwing.
  const env = { ...process.env, ATOMS_CODEMOD_SOURCE_DIR: path.join(dir, 'nowhere'), SMITH_FUNCTIONAL_SOURCE_DIR: path.join(dir, 'nowhere') };
  const real = await createStaticBreakdown({ env });
  assert.equal(real.ok, false);
  assert.match(/** @type {any} */ (real).reason, /^The atom runtime is not linked: @smith\/functional-atoms is not linked because the source folder .* is missing/);
  const off = await breakDownImport(dir, FIT, { env });
  assert.equal(off.breakdown.via, 'off');
});

test('an unchecked function keeps its original and is not sent to the repair step', async () => {
  const dir = fixtureApp();
  const r = await breakDownImport(dir, FIT, { create: () => createMockStaticBreakdown({ unchecked: ['label'] }) });
  const label = r.breakdown.units.find((u) => u.name === 'label');
  assert.equal(label.status, 'unchecked');
  assert.equal(label.body, label.code);
  assert.deepEqual(r.refusals, []);
});

// ------------------------------------------------------------------------------------------------- in the Import agent

/** The agent on the fixture: real loop ops on disk with the given breakdown options, a repair spy. */
function fixtureAgent(dir, { breakdown, repair }) {
  const planService = createMockPlanService({ refuse: () => false });
  const importOps = { scan: () => ({ found: [], questions: [] }), plan: () => ({ steps: [], summary: 'Brings nothing else in.' }) };
  const logic = createLogicOnDisk(dir, FOLDER, { characterizeWith: async () => ({ tests: [], sentence: 'No tests.' }), breakdown, cache: false });
  return createImportAgent({ root: dir, folder: FOLDER, planService, store: fileStore(dir, FOLDER), importOps, logic, ...(repair ? { repair } : {}) });
}

test('agent: the classify stage breaks the domain functions down, sends the refusal to the repair loop and keeps line/atoms.json', async () => {
  const dir = fixtureApp();
  const seen = [];
  const repair = async (option, refusal, c) => {
    seen.push({ option, refusal });
    return repairLoop(option, refusal, { check: c.check, propose: proposeBody(LABEL_REPAIRED) });
  };
  const v = await fixtureAgent(dir, { breakdown: { create: createMockStaticBreakdown }, repair }).start('ui');
  assertImportAgentView(v);
  assert.equal(v.state, 'review', v.sentence);
  assert.deepEqual(seen.map((s) => [s.option.tool, s.option.args.name, s.refusal.rule]), [[ATOMS_TOOL, 'label', 'LINE-ATOMS']]);
  assert.equal(v.logic.atoms.via, 'static');
  assert.deepEqual([v.logic.atoms.functions, v.logic.atoms.converted, v.logic.atoms.repaired, v.logic.atoms.refused], [3, 2, 1, 0]);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, FOLDER, ATOMS_FILE), 'utf8'));
  assertAtomBreakdown(saved);
  assert.equal(saved.units.find((u) => u.name === 'label').repair.outcome, 'repaired');
  const doc = JSON.parse(fs.readFileSync(path.join(dir, FOLDER, IMPORT_PLAN_FILE), 'utf8'));
  assertImportPlanFile(doc);
  assert.ok(doc.changes.some((c) => c.action === 'classify' && /^broke the domain functions down into atoms: 2 of 3 domain functions are atom calls now/.test(c.sentence)), doc.changes.map((c) => c.sentence).join('\n'));
});

test('agent: the breakdown off (links down) says so once and the import carries on; without a repair step the refusals wait for a person', async () => {
  const dir = fixtureApp();
  const v = await fixtureAgent(dir, { breakdown: { create: () => createMockStaticBreakdown({ down: 'atomic-codemod is not linked' }) } }).start('ui');
  assert.equal(v.state, 'review');
  assert.equal(v.logic.atoms.via, 'off');
  assert.match(v.logic.atoms.sentence, /^The static breakdown into atoms is off/);
  const dir2 = fixtureApp();
  const v2 = await fixtureAgent(dir2, { breakdown: { create: createMockStaticBreakdown } }).start('ui');
  assert.equal(v2.logic.atoms.refused, 1);
  assert.equal(v2.logic.atoms.repaired, 0);
  const dir3 = fixtureApp();
  const v3 = await fixtureAgent(dir3, { breakdown: false }).start('ui');
  assert.equal(v3.logic.atoms, null, 'no breakdown op: no breakdown');
});

// ------------------------------------------------------------------------------------------------- the real links

const links = breakdownLinks();
const skip = links.codemod.ok && links.runtime.ok ? false : `${links.codemod.ok ? '' : links.codemod.message} ${links.runtime.ok ? '' : links.runtime.message}`.trim();

test('links: atomic-codemod (atoms-transform) and the atom runtime are pinned tables beside to-english', () => {
  assert.equal(links.codemod.pinned, '7d1e228d2e906a2bba6e7c29c154dd5ed651ed6a');
  assert.equal(links.runtime.pinned, '939c25ce7ecfa27d20eb7b9e63f0355b82896d7f');
  assert.deepEqual(links.codemod.packages.map((p) => p.name), ['@smith/atoms-transform', '@smith/atoms-checked', '@smith/atoms-runtime', '@smith/atoms-equivalence', '@smith/atoms-checker-types']);
});

test('real: an Import v2 run on the fixture app turns its pure functions into checked atom calls; the template literal reaches construct.repair', { skip, timeout: 120_000 }, async () => {
  const dir = fixtureApp();
  const seen = [];
  // The repair loop runs as in the product, its model answering "no model" (the static path is unchanged).
  const repair = async (option, refusal, c) => {
    seen.push({ option, refusal, check: c.check });
    return repairLoop(option, refusal, { check: c.check, propose: async () => { throw Object.assign(new Error('no model'), { code: 'NO_MODEL' }); } });
  };
  const v = await fixtureAgent(dir, { breakdown: {}, repair }).start('ui');
  assert.equal(v.state, 'review', v.sentence);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, FOLDER, ATOMS_FILE), 'utf8'));
  assertAtomBreakdown(saved);
  assert.equal(saved.via, 'static');
  assert.deepEqual([saved.codemod, saved.runtime], ['7d1e228', '939c25c']);
  const by = Object.fromEntries(saved.units.map((u) => [u.name, u]));
  for (const name of ['total', 'isBig']) {
    assert.equal(by[name].status, 'converted', `${name}: ${by[name].sentence}`);
    assert.equal(by[name].check.status, 'same');
    assert.ok(by[name].check.compared > 0, 'the check ran it on generated inputs');
  }
  assert.match(by.total.body, /return plus\(a, b\);/);
  assert.match(by.isBig.body, /return greaterThan\(n, 100\);/);
  assert.ok(by.label.untranslated.some((p) => p.form === 'TemplateLiteral' && p.line === 8), JSON.stringify(by.label.untranslated));
  assert.deepEqual(seen.map((s) => s.option.args.name), ['label']);
  assert.equal(by.label.repair.outcome, 'no-model');
});

test('real: Construct\'s check of a repaired body runs it against the original in QuickJS; all atoms and the same behaviour lands', { skip, timeout: 120_000 }, async () => {
  const dir = fixtureApp();
  const r = await breakDownImport(dir, FIT, {});
  try {
    const args = (body) => ({ tool: ATOMS_TOOL, args: { file: `${FOLDER}/rules.ts`, name: 'label', body } });
    assert.deepEqual(r.check(args("function label(n: number, m: number): string {\n  return join(plus(n, m), ' items');\n}")), { ok: true, refusal: null, passed: 1 });
    const differs = r.check(args("function label(n: number, m: number): string {\n  return join(plus(n, m), ' item');\n}"));
    assert.equal(differs.ok, false);
    assert.match(differs.refusal.sentence, /^The repaired function behaves differently/);
    const left = r.check(r.refusals[0].option);
    assert.equal(left.ok, false);
    assert.match(left.refusal.sentence, /^The repaired function still has 1 part that is not an atom call/);
  } finally { r.dispose(); }
});
