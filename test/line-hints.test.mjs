// #885: every refusal a builder can meet is said in the owner's one shape (hints.mjs): (1) what was wrong, quoting the
// bad value; (2) the rule in one clause; (3) numbered choices f1..fn with the exact step, recommended first, and (4) how
// to apply one; a code with no fix gives a concrete correct call instead. One table: every code, both ways.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createLineProject } from '../packages/engine/line/newProject.mjs';
import { createLinePlanService } from '../packages/engine/line/planService.mjs';
import { REFUSAL_FIXES } from '../packages/engine/line/refusals.mjs';
import { PLAN_REFUSAL_CODES } from '../packages/engine/line/contract.mjs';
import { REFUSAL_HINTS, TOOL_EXAMPLES, hintOf, shapeRefusal, stepText } from '../packages/engine/line/hints.mjs';

/** Every code: the builder modules' (refusals.mjs), the plan protocol's, the plan service's and a plan store's. */
const CODES = [...new Set([...Object.keys(REFUSAL_FIXES), ...PLAN_REFUSAL_CODES, 'NEEDS_FIX', 'NO_QUESTION', 'BAD_OPTION', 'TOO_LATE', 'PLAN_CONFLICT'])].sort();
const BAD = 'zz-bad-value';
const STEPS = [{ tool: 'line.addRoute', args: { route: '/', page: 'features/home/pages/HomePage.tsx' } }, { tool: 'line.leaveAsIs', args: { stepId: 's1' } }];
/** A request that carries the bad value in every field the code's hint names. */
const reqFor = (code) => {
  const fields = hintOf(code)?.fields ?? ['file'];
  const args = Object.fromEntries(fields.map((f) => [f, BAD]));
  return code === 'UNKNOWN_TOOL' ? { tool: BAD, args: {} } : code === 'UNKNOWN_FIX' ? { fix: BAD } : code === 'NO_QUESTION' || code === 'TOO_LATE' ? { answer: BAD } : code === 'BAD_OPTION' ? { answer: 'q1', option: BAD }
    : code === 'NOT_RETRYABLE' ? { tool: 'line.setCode', args: { retry: { of: BAD } } } : code === 'BAD_ARGS' ? { tool: 'line.createFeature', args: { points: BAD } } : { tool: 'line.setCode', args };
};
const sentenceFor = (code) => (code === 'BAD_ARGS' ? 'The arguments do not fit line.createFeature: points must be a JSON list.' : 'Line could not do this. The second sentence says more.');
const NO_PATHS = /fixes\[|options\[|\[\]\.step/;

test('every refusal code has a hint: its rule in one clause', () => {
  for (const code of CODES) {
    const h = hintOf(code);
    assert.ok(h, `${code} has a hint`);
    assert.match(h.rule, /^[a-z"A-Z].{8,}[^.]$/, `${code}: one clause, no full stop: ${h.rule}`);
  }
  for (const code of Object.keys(REFUSAL_HINTS)) assert.doesNotMatch(REFUSAL_HINTS[code].rule, NO_PATHS);
});

for (const code of CODES) {
  test(`${code}: wrong (quoting the bad value), rule, and a correct call when there is no fix`, () => {
    const req = reqFor(code);
    const s = shapeRefusal({ code, sentence: sentenceFor(code), ...req, tools: Object.keys(TOOL_EXAMPLES) });
    const lines = s.text.split('\n');
    assert.ok(lines[0].startsWith(`Refused (${code}): `), lines[0]);
    if (hintOf(code)?.fields || ['UNKNOWN_TOOL', 'UNKNOWN_FIX', 'NO_QUESTION', 'BAD_OPTION', 'NOT_RETRYABLE', 'BAD_ARGS'].includes(code)) assert.ok(lines[0].includes(BAD), `${code} quotes the bad value: ${lines[0]}`);
    assert.equal(lines[1], `Rule: ${hintOf(code).rule}.`);
    assert.deepEqual(s.choices, []);
    assert.equal(s.apply, null);
    const call = lines.at(-1);
    const m = /^A correct call: (?:([\w.]+) (\{.*\})|(\{.*\}))$/.exec(call);
    assert.ok(m, `${code} ends with a concrete correct call: ${call}`);
    assert.doesNotThrow(() => JSON.parse(m[2] ?? m[3]), call);
    assert.doesNotMatch(s.text, NO_PATHS);
  });

  test(`${code}: with typed fixes, numbered choices with their exact steps and how to apply one`, () => {
    const s = shapeRefusal({ code, sentence: `${sentenceFor(code)} Add fixes[0].step (or another of fixes[].step) instead.`, ...reqFor(code), fixes: STEPS.map((step, i) => ({ ref: `f${i + 1}`, id: `X/${i}`, step })) });
    const lines = s.text.split('\n');
    assert.ok(lines[0].startsWith(`Refused (${code}): `));
    assert.equal(lines[1], `Rule: ${hintOf(code).rule}.`);
    assert.equal(lines[2], 'Choices, recommended first:');
    assert.equal(lines[3], `  f1: ${stepText(STEPS[0])}`);
    assert.ok(lines.includes(`  f2: ${stepText(STEPS[1])}`));
    assert.equal(lines.at(-1), 'To apply one, send {"fix":"f1"}.');
    assert.deepEqual(s.choices.map((c) => [c.ref, c.recommended]), [['f1', true], ['f2', false]]);
    assert.doesNotMatch(s.text, NO_PATHS);
  });
}

const project = () => {
  const parent = fs.realpathSync(makeTempDir('line-hints-'));
  const r = createLineProject(parent, { name: 'shop', firstFeature: 'home' });
  assert.equal(r.ok, true, r.sentence);
  return { root: /** @type {string} */ (r.dir), done: () => fs.rmSync(parent, { recursive: true, force: true }) };
};
const svcOf = (root) => createLinePlanService({ root, commands: null, trace: null, records: null });

test('plan service: every refusal carries the shaped text; a fix ref sent as a tool name gets the offered fixes back (r2 R1)', async () => {
  const { root, done } = project();
  try {
    fs.writeFileSync(path.join(root, 'features/home/pages/HomePage.tsx'), 'export function HomePage() { return null; }\n');
    const svc = svcOf(root);
    const r = /** @type {any} */ (await svc.addStep({ tool: 'line.addRoute', args: { route: '/', page: 'home/HomePage' }, why: 'Serve home.' }, 'agent'));
    assert.equal(r.code, 'UNKNOWN_ITEM');
    assert.match(r.text, /^Refused \(UNKNOWN_ITEM\): "home\/HomePage" is not a feature page file\.\nRule: /);
    assert.match(r.text, /\n {2}f1: line\.addRoute \{"route":"\/","page":"features\/home\/pages\/HomePage\.tsx"\}/);
    const asTool = /** @type {any} */ (await svc.addStep({ tool: 'fixes[0].step', args: {} }, 'agent'));
    assert.equal(asTool.code, 'UNKNOWN_TOOL');
    assert.match(asTool.text, /\(you sent tool "fixes\[0\]\.step"\)/);
    assert.match(asTool.text, /f1: line\.addRoute/);
    assert.match(asTool.text, /To apply one, send \{"fix":"f1"\}\.$/);
    const picked = /** @type {any} */ (await svc.addStep({ fix: 'f1' }, 'agent'));
    assert.equal(picked.ok, true, picked.text);
    const unknown = /** @type {any} */ (await svc.addStep({ tool: 'line.addRoutes', args: {} }, 'agent'));
    assert.match(unknown.text, /A correct call: line\.addRoute \{"route":"\/cart"/);
  } finally { done(); }
});

test('#886: every fix says why and what it does; context is deterministic, at most 5 lines, 15 when the same refusal repeats', async () => {
  const { root, done } = project();
  try {
    fs.writeFileSync(path.join(root, 'features/home/pages/HomePage.tsx'), '// @line-base pages/ListPage\nexport function HomePage() { return null; }\n');
    fs.writeFileSync(path.join(root, 'features/home/pages/AboutPage.tsx'), 'export function AboutPage() { return null; }\n');
    const svc = svcOf(root);
    const req = { tool: 'line.addRoute', args: { route: '/', page: 'home/HomePage' }, why: 'Serve home.' };
    const r = /** @type {any} */ (await svc.addStep(req, 'agent'));
    assert.equal(r.code, 'UNKNOWN_ITEM');
    for (const [i, f] of r.fixes.entries()) {
      assert.match(f.why, /\(rule [\w/-]+\)\.$/, `${f.ref} why names its rule`);
      assert.match(f.effect, /^writes the route entry for \/, which shows /);
      if (i === 0) assert.match(f.why, /^Recommended because its path is the closest feature page to "home\/HomePage"/);
    }
    assert.ok(r.fixes[0].context.includes('features/home/pages/HomePage.tsx exports HomePage, based on pages/ListPage'), JSON.stringify(r.fixes[0].context));
    assert.equal(r.hintContext.cap, 5);
    assert.ok(r.hintContext.kept.length <= 5);
    assert.match(r.text, /\n {6}does: writes the route entry for \/, which shows HomePage\n/);
    const again = /** @type {any} */ (await svc.addStep(req, 'agent'));
    assert.equal(again.hintContext.cap, 15);
    assert.equal(again.hintContext.repeat, 1);
    // The same request on the same files gives the same lines (deterministic).
    assert.deepEqual(again.hintContext.candidates, r.hintContext.candidates);
  } finally { done(); }
});

test('#886: a type error shows the failing line +-2 of the code that was sent', async () => {
  process.env.LINE_TYPE_GATE_BUDGET_MS ??= '60000';
  const { root, done } = project();
  try {
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, module: 'esnext', moduleResolution: 'bundler', target: 'es2020', noEmit: true, skipLibCheck: true, types: [] } }));
    fs.mkdirSync(path.join(root, 'node_modules'));
    const code = '// one\n// two\nexport const price = (c: number): string => c;\n// four\n// five\n';
    const r = /** @type {any} */ (await svcOf(root).addStep({ tool: 'line.setCode', args: { file: 'features/home/services/price.ts', code }, why: 'Price.' }, 'agent'));
    assert.equal(r.code, 'TYPE_ERROR', r.text);
    const win = r.hint.context.find((l) => /TS2322/.test(l)) ?? r.fixes?.flatMap((f) => f.context ?? []).find((l) => /TS2322/.test(l));
    assert.ok(win, r.text);
    assert.match(win, /^features\/home\/services\/price\.ts:3 TS2322 /);
    assert.match(win, /\n 1\| \/\/ one\n 2\| \/\/ two\n>3\| export const price/);
    assert.match(win, /\n 5\| \/\/ five$/);
  } finally { done(); }
});

test('#888: a rules card names 2-4 rules for a step\'s tool and layer, each in plain English with an example', async () => {
  const { rulesCard } = await import('../packages/engine/line/hints.mjs');
  const { BUILDER_TOOLS } = await import('../bench/ecommerce/driver/plan-cli.mjs');
  const cases = [['line.addRoute', { route: '/cart', page: 'features/cart/pages/CartPage.tsx' }, 'page'], ['line.setCode', { file: 'features/cart/pages/CartPage.tsx' }, 'page'],
    ['line.setCode', { file: 'features/cart/components/CartLine.tsx' }, 'component'], ['line.setCode', { file: 'library/services/orders.ts' }, 'service'],
    ['line.baseOn', { libraryId: 'pages/FormPage', feature: 'cart', name: 'CartPage' }, 'page'], ['line.createFeature', {}, 'feature'], ['line.setCode', { file: 'features/cart/spec.md' }, 'spec']];
  for (const [tool, args, layer] of cases) {
    const c = rulesCard(tool, args);
    assert.equal(c.layer, layer, tool);
    assert.ok(c.rules.length >= 2 && c.rules.length <= 4, `${tool} (${layer}): ${c.rules.length} rules`);
    const lines = c.text.split('\n');
    assert.equal(lines[0], `Rules for ${tool} (${layer}):`);
    for (const l of lines.slice(1)) assert.match(l, /^- [^\n]+\. Example: \S/);
  }
  assert.deepEqual(rulesCard('line.setCode', { file: 'features/cart/pages/CartPage.tsx' }).rules.map((r) => r.id), ['contentHash', 'LINE-BASE', 'LINE-DIR', 'PAGE-003']);
  for (const t of BUILDER_TOOLS) assert.ok(rulesCard(t, {}).rules.length <= 4, t);
});

test('#888: plan status carries the next open step\'s card; plan-cli shows a card with the first add of a tool and layer, on request, and logs it', async () => {
  const { root, done } = project();
  const { createPlanCli } = await import('../bench/ecommerce/driver/plan-cli.mjs');
  try {
    const svc = svcOf(root);
    const r = /** @type {any} */ (await svc.addStep({ tool: 'line.baseOn', args: { libraryId: 'pages/ListPage', feature: 'home', name: 'ShopPage' }, why: 'A page.' }, 'agent'));
    assert.equal(r.ok, true, r.text);
    const v = /** @type {any} */ (await svc.view());
    assert.equal(v.next.stepId, r.stepId);
    assert.equal(v.next.card.tool, 'line.baseOn');
    const log = path.join(root, '..', 'cards', 'calls.jsonl');
    const cli = createPlanCli({ project: root, log, builder: 'test' });
    const first = await cli.run('add', ['line.baseOn', JSON.stringify({ libraryId: 'pages/ListPage', feature: 'home', name: 'MorePage' })], { why: 'Another page.' });
    assert.match(first.sentence, /\nRules for line\.baseOn \(page\):\n- /);
    const second = await cli.run('add', ['line.baseOn', JSON.stringify({ libraryId: 'pages/ListPage', feature: 'home', name: 'ThirdPage' })], { why: 'One more.' });
    assert.doesNotMatch(second.sentence, /Rules for/);
    const asked = await cli.run('rules', ['line.addRoute']);
    assert.match(asked.sentence, /^Rules for line\.addRoute \(page\):/);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.kind === 'call');
    assert.deepEqual(calls.find((c) => c.cmd === 'add').result.card, { tool: 'line.baseOn', layer: 'page', rules: ['base-name', 'LINE-BASE', 'LINE-DIR', 'PAGE-003'] });
    assert.match(calls.find((c) => c.cmd === 'add').result.shown, /Rules for line\.baseOn/);
  } finally { done(); }
});

test('#889: the Line builder\'s prompt has the overview and a feature index; plan status carries the current feature\'s points', async () => {
  const { systemPrompt } = await import('../bench/ecommerce/driver/qwen-agent.mjs');
  const { readSpec, currentFeature } = await import('../bench/ecommerce/driver/spec-slice.mjs');
  const { createPlanCli } = await import('../bench/ecommerce/driver/plan-cli.mjs');
  const line = systemPrompt('line');
  assert.match(line, /- `cart`: As a shopper, I want a cart I can change, so that I buy exactly what I want \(CART-1\.\.CART-8, 8 points\)/);
  assert.doesNotMatch(line, /CART-3: Changing a quantity/);
  assert.match(systemPrompt('plain'), /CART-3: Changing a quantity/);
  const spec = readSpec();
  assert.deepEqual(spec.features.map((f) => [f.name, f.points.length]), [['catalog', 5], ['product', 4], ['cart', 8], ['checkout', 6]]);
  assert.equal(currentFeature(spec, [])?.name, 'catalog');
  assert.equal(currentFeature(spec, [{ tool: 'line.createFeature', args: { name: 'cart' } }, { tool: 'line.addRoute', args: { page: 'features/home/pages/X.tsx' } }])?.name, 'cart');
  const { root, done } = project();
  try {
    const log = path.join(root, '..', 'spec', 'calls.jsonl');
    const cli = createPlanCli({ project: root, log, builder: 'test' });
    const st = await cli.run('status');
    assert.match(st.sentence, /\nCurrent feature: catalog \(As a shopper, I want to browse/);
    assert.match(st.sentence, /\n1\. CAT-1: The page at `\/` has the main heading "Products"/);
    const other = await cli.run('status', ['checkout']);
    assert.match(other.sentence, /\nCurrent feature: checkout /);
    assert.equal((await cli.run('status', ['nope'])).code, 'NOT_FOUND');
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(calls[0].result.spec, { feature: 'catalog', points: ['CAT-1', 'CAT-2', 'CAT-3', 'CAT-4', 'CAT-5'] });
    assert.match(calls[0].result.shown, /Current feature: catalog/);
  } finally { done(); }
});

test('#890: "jev picks context" ships off; with jev up its scores are logged beside the static ones, and a slow jev never holds a call up', async () => {
  const http = await import('node:http');
  const { hintsJevOn, jevScores, HINTS_STEP } = await import('../packages/engine/line/hints.mjs');
  const { stepProfile } = await import('../packages/core/ai-profiles.mjs');
  const { createPlanCli } = await import('../bench/ecommerce/driver/plan-cli.mjs');
  const p = stepProfile(HINTS_STEP);
  assert.deepEqual([p.kind, p.ladder.options.on, p.ladder.measured], ['decide', false, null]);
  const { root, done } = project();
  // A stand-in jev (serve.py's /choose shape): keep-probability 0.9 for lines that name an export, else 0.2.
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const q = JSON.parse(body); seen.push(q);
      const keep = /exports/.test(q.state.line.text) ? 0.9 : 0.2;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ answers: [{ key: 'keep', choice: keep > 0.5 ? 'keep' : 'drop', probabilities: [keep, 1 - keep], confidence: 0.5 }], ms: 1 }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const was = process.env.JEV_URL;
  process.env.JEV_URL = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
  try {
    // The project's own switch cannot turn it on without a measured win (owner rule).
    fs.mkdirSync(path.join(root, 'line'), { recursive: true });
    fs.writeFileSync(path.join(root, 'line', 'ai-profiles.json'), JSON.stringify({ v: 1, steps: { [HINTS_STEP]: { on: true } } }));
    assert.equal(hintsJevOn(root), false);
    fs.writeFileSync(path.join(root, 'features/home/pages/HomePage.tsx'), 'export function HomePage() { return null; }\n');
    const log = path.join(root, '..', 'jev', 'calls.jsonl');
    const out = await createPlanCli({ project: root, log, builder: 'test', shadowJev: true }).run('add', ['line.addRoute', JSON.stringify({ route: '/', page: 'home/HomePage' })], { why: 'Serve home.' });
    assert.equal(out.code, 'UNKNOWN_ITEM');
    assert.equal(out.hintContext, undefined, 'the scores are for the log, not the builder');
    const call = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);
    assert.equal(call.result.context.via, 'static');
    assert.equal(call.shadow.via, 'jev');
    assert.equal(call.shadow.on, false);
    assert.ok(call.shadow.lines.length >= 1 && call.shadow.lines.every((l) => typeof l.static === 'number' && typeof l.jev === 'number'), JSON.stringify(call.shadow));
    assert.ok(seen.length >= 1 && seen[0].questions[0].key === 'keep' && !/\//.test(seen[0].state.line.text), 'line text is normalised like the trainer');
    // A jev that never answers: null within the shadow budget.
    const t0 = Date.now();
    assert.equal(await jevScores([{ text: 'x', kind: 'status' }], { fetch: (_u, o) => new Promise((_r, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted')))), timeoutMs: 50 }), null);
    assert.ok(Date.now() - t0 < 1000);
  } finally {
    if (was === undefined) delete process.env.JEV_URL; else process.env.JEV_URL = was;
    server.close();
    done();
  }
});

test('#887: an import question carries a hint and each option\'s effect, and is answered by id through the plan API', async () => {
  const { scanImport } = await import('../packages/engine/line/import.mjs');
  const { assertImportScan } = await import('../packages/engine/line/contract.mjs');
  const { renderQuestion } = await import('../packages/engine/line/hints.mjs');
  const q = { id: 'generic-name:src/alerts/components/Table.tsx', sentence: 'Table sounds like general UI; where should it go?', hint: 'Recommended because Table is a general UI name (rule generic-name).',
    options: [{ id: 'library', sentence: 'Put Table in the library.', effect: 'Table becomes library/components/Table' }, { id: 'feature:alerts', sentence: 'Keep Table in feature alerts.', effect: 'Table becomes features/alerts/components/Table' }], recommended: 'library' };
  assert.deepEqual(renderQuestion(q, { folder: 'src/alerts' }), [
    'Question (generic-name:src/alerts/components/Table.tsx): Table sounds like general UI; where should it go?',
    'Hint: Recommended because Table is a general UI name (rule generic-name).',
    'Options, recommended first:', '  library: Put Table in the library.', '      does: Table becomes library/components/Table',
    '  feature:alerts: Keep Table in feature alerts.', '      does: Table becomes features/alerts/components/Table',
    'To answer, send {"answer":"generic-name:src/alerts/components/Table.tsx","option":"library","folder":"src/alerts"}.',
  ]);
  const answered = [];
  const imports = {
    question: async () => q,
    answer: async (by, folder, qid, oid) => {
      if (qid !== q.id) return { ok: false, code: 'NO_QUESTION', sentence: 'There is no such question open right now.' };
      if (!q.options.some((o) => o.id === oid)) return { ok: false, code: 'BAD_OPTION', sentence: 'Pick one of the options: library, feature:alerts.' };
      answered.push([by, folder, qid, oid]);
      return { ok: true, state: 'plan' };
    },
  };
  const { root, done } = project();
  try {
    const svc = createLinePlanService({ root, commands: null, trace: null, records: null, imports });
    const wrong = /** @type {any} */ (await svc.addStep({ answer: 'nope', option: 'library', folder: 'src/alerts' }, 'agent'));
    assert.equal(wrong.code, 'NO_QUESTION');
    assert.match(wrong.text, /^Refused \(NO_QUESTION\): There is no such question open right now \(you sent answer "nope"\)\.\nRule: /);
    assert.match(wrong.text, /\n {2}Question \(generic-name:src\/alerts\/components\/Table\.tsx\): /);
    assert.match(wrong.text, /\nA correct call: \{"answer":"generic-name:src\/alerts\/components\/Table\.tsx","option":"library","folder":"src\/alerts"\}$/);
    const bad = /** @type {any} */ (await svc.addStep({ answer: q.id, option: 'elsewhere', folder: 'src/alerts' }, 'agent'));
    assert.equal(bad.code, 'BAD_OPTION');
    assert.match(bad.text, /\(you sent option "elsewhere"\)/);
    const noFolder = /** @type {any} */ (await svc.addStep({ answer: q.id, option: 'library' }, 'agent'));
    assert.equal(noFolder.code, 'BAD_ARGS');
    const ok = /** @type {any} */ (await svc.addStep({ answer: q.id, option: 'feature:alerts', folder: 'src/alerts' }, 'agent'));
    assert.equal(ok.ok, true, ok.text);
    assert.deepEqual(answered, [['agent', 'src/alerts', q.id, 'feature:alerts']]);
  } finally { done(); }
  // The scan's questions carry them for real (contract: a hint and every option's effect).
  const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const parent = fs.realpathSync(makeTempDir('line-hints-import-'));
  try {
    fs.cpSync(path.join(repo, 'examples', 'import-sample'), parent, { recursive: true });
    const scan = scanImport(parent, 'src/alerts');
    assertImportScan(scan);
    assert.ok(scan.questions.length >= 1);
    for (const x of scan.questions) { assert.match(x.hint, /\(rule [\w-]+\)\.$/); for (const o of x.options) assert.ok(o.effect, o.id); }
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('#887 follow-up: a scan question is answered by id through the plan API; unanswered, decide()\'s pick stands; who answered is recorded', async () => {
  const { createMockImportAgentService } = await import('../packages/engine/line/mockImportAgent.mjs');
  const { assertImportAgentView } = await import('../packages/engine/line/contract.mjs');
  const FOLDER = 'src/alerts';
  const TABLE_Q = `generic-name:${FOLDER}/components/Table.tsx`;
  const { agentFor } = createMockImportAgentService();
  const agent = agentFor(FOLDER);
  // The same wiring as the plan service's default (the folder's agent): the waiting question, else the first scan question.
  const imports = {
    question: async () => (await agent.view()).waiting?.question ?? (await agent.questions())[0] ?? null,
    answer: async (by, _folder, qid, oid) => agent.answer(by, qid, oid),
  };
  const tableSteps = (v) => v.steps.filter((x) => x.args.name === 'Table').map((x) => x.tool);
  const { root, done } = project();
  try {
    const svc = createLinePlanService({ root, commands: null, trace: null, records: null, imports });
    // Before the import starts there is nothing to answer.
    assert.equal((await agent.questions()).length, 0);
    // Unanswered: decide()'s pick (no picker set up: the static order, the recommended option) stands, attributed to the rules.
    let v = await agent.start('ui');
    assertImportAgentView(v);
    assert.equal(v.state, 'review');
    const ruled = v.decisions.find((d) => d.id === TABLE_Q);
    assert.deepEqual([ruled.picked, ruled.by, ruled.answeredBy], ['library', 'static', 'rules']);
    assert.deepEqual(tableSteps(v), ['line.import.toLibrary']);
    const qs = await agent.questions();
    assert.deepEqual(qs.map((q) => [q.id, q.picked, q.answeredBy]), [[TABLE_Q, 'library', 'rules']]);
    // Unknown question id: refused in the plain shape, with the scan question and the correct answer call.
    const wrong = /** @type {any} */ (await svc.addStep({ answer: 'generic-name:nope', option: 'library', folder: FOLDER }, 'agent'));
    assert.equal(wrong.code, 'NO_QUESTION');
    assert.match(wrong.text, /^Refused \(NO_QUESTION\): There is no such question open right now \(you sent answer "generic-name:nope"\)\.\nRule: /);
    assert.match(wrong.text, /\n {2}Question \(generic-name:src\/alerts\/components\/Table\.tsx\): /);
    assert.match(wrong.text, /\nA correct call: \{"answer":"generic-name:src\/alerts\/components\/Table\.tsx","option":"library","folder":"src\/alerts"\}$/);
    // Unknown option id: refused, quoting it; nothing changes.
    const bad = /** @type {any} */ (await svc.addStep({ answer: TABLE_Q, option: 'feature:nowhere', folder: FOLDER }, 'agent'));
    assert.equal(bad.code, 'BAD_OPTION');
    assert.match(bad.text, /\(you sent option "feature:nowhere"\)/);
    assert.match(bad.text, /Pick one of the options: library, feature:alerts/);
    assert.deepEqual(tableSteps(await agent.view()), ['line.import.toLibrary']);
    // Approve one step that the answer will not change: its review survives the rewrite.
    v = await agent.editStep('ui', { action: 'approve', stepId: v.steps[0].id });
    // The agent's answer by id changes the proposal: Table stays in feature alerts (a library copy plus the feature item).
    const ok = /** @type {any} */ (await svc.addStep({ answer: TABLE_Q, option: 'feature:alerts', folder: FOLDER }, 'agent'));
    assert.equal(ok.ok, true, ok.text);
    v = ok.import;
    assertImportAgentView(v);
    assert.deepEqual(tableSteps(v), ['line.import.toLibrary', 'line.import.toFeature']);
    assert.equal(v.steps.find((x) => x.args.name === 'Table' && x.tool === 'line.import.toLibrary').args.level, undefined);
    assert.equal(v.steps[0].review, 'approved');
    assert.equal(v.waiting.for, 'review');
    const answered = v.decisions.find((d) => d.id === TABLE_Q);
    assert.deepEqual([answered.picked, answered.by, answered.answeredBy], ['feature:alerts', 'agent', 'agent']);
    assert.equal(v.decisions.filter((d) => d.id === TABLE_Q).length, 1);
    assert.ok(v.changes.some((c) => c.by === 'agent' && c.action === 'answer'));
    // The owner answers the same way (Cockpit, by "ui"), and is recorded as the owner.
    v = await agent.answer('ui', TABLE_Q, 'library');
    assert.deepEqual(tableSteps(v), ['line.import.toLibrary']);
    assert.deepEqual([v.decisions.find((d) => d.id === TABLE_Q).answeredBy, v.decisions.find((d) => d.id === TABLE_Q).by], ['owner', 'person']);
    // Once a step runs, the plan is no longer rewritten: refused (TOO_LATE).
    v = await agent.editStep('ui', { action: 'approve-all' });
    assert.equal(v.state, 'execute');
    const late = /** @type {any} */ (await svc.addStep({ answer: TABLE_Q, option: 'feature:alerts', folder: FOLDER }, 'agent'));
    assert.equal(late.code, 'TOO_LATE', late.text);
    assert.match(late.text, /^Refused \(TOO_LATE\): /);
    assert.deepEqual(await agent.questions(), []);
  } finally { done(); }
});

test('#880 follow-up: bench metrics count the fixes a builder picked by id (sent, added, landed)', async () => {
  const { planStats } = await import('../bench/ecommerce/metrics.mjs');
  const parent = fs.realpathSync(makeTempDir('line-hints-metrics-'));
  try {
    fs.mkdirSync(path.join(parent, 'line', 'plans'), { recursive: true });
    const landed = { id: 's2', tool: 'line.addRoute', status: 'done', args: {}, result: { apply: { ok: true, files: ['app/page.tsx'] } } };
    fs.writeFileSync(path.join(parent, 'line', 'plans', 'ses-cockpit.json'), JSON.stringify({ plans: [{ steps: [landed] }] }));
    const calls = [
      { kind: 'call', cmd: 'add', args: { tool: 'line.addRoute', args: { route: '/', page: 'x' } }, result: { ok: false, code: 'UNKNOWN_ITEM' } },
      { kind: 'call', cmd: 'add', args: { tool: null, args: {}, fix: 'f1' }, result: { ok: true, stepId: 's2' } },
      { kind: 'call', cmd: 'add', args: { tool: null, args: {}, fix: 'f9' }, result: { ok: false, code: 'UNKNOWN_FIX' } },
    ];
    assert.deepEqual(planStats(parent, calls).fixesById, { sent: 2, added: 1, landed: 1 });
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});
