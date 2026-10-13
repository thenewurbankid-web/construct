// #937 (epic #934): the coder's read tools (coder/reads.mjs: feature_summary, scope, atoms), the per-turn selector, the
// registry read dispatcher (toolRegistry.mjs), the bench builder's per-turn tool list and miss log (read-tools.mjs), and
// plan-cli refusing line.project as a step. On a copy of examples/line-sample.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { featureSummary, scopeOf, atomsFor, selectReadTools, projectFile } from '../packages/engine/line/coder/reads.mjs';
import { entryById, mcpNameOf, createReadDispatcher, registryReads, READ_SKIPPED } from '../packages/engine/line/toolRegistry.mjs';
import { createTurnReads, readFunction, ALWAYS, toolTokens } from '../bench/ecommerce/driver/read-tools.mjs';
import { TOOLS } from '../bench/ecommerce/driver/qwen-agent.mjs';

const SAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples/line-sample');
function copy() {
  const dir = makeTempDir('construct-coder-reads-');
  fs.cpSync(SAMPLE, dir, { recursive: true });
  return fs.realpathSync(dir);
}

test('#937 feature_summary: orders in English lines: the summary, each item with its base and imports, spec coverage', () => {
  const root = copy();
  const r = featureSummary(root, { name: 'orders' });
  assert.equal(r.ok, true);
  assert.equal(r.lines[0], 'orders has 1 page, 2 components and 1 workflow.');
  assert.ok(r.lines.includes('OrdersPage (features/orders/pages/OrdersPage.tsx) is based on pages/ListPage; imports library/pages/ListPage.tsx.'), r.sentence);
  assert.ok(r.lines.some((l) => /^Spec features\/orders\/spec\.md: 1 of 2 points covered\.$/.test(l)), r.sentence);
  assert.ok(r.lines.some((l) => l.startsWith('Open: s1.p2 ')), r.sentence);
  assert.equal(r.sentence, r.lines.join('\n'));
  const billing = featureSummary(root, { name: 'billing' });
  assert.ok(billing.lines.some((l) => /^LINE-(BASE|DIR) at features\/billing\//.test(l)), billing.sentence);
  assert.throws(() => featureSummary(root, { name: 'nope' }), (e) => e.code === 'UNKNOWN_ITEM');
});

test('#937 scope: a feature page may import its own feature and the library, each with a sentence and its exports', () => {
  const root = copy();
  const r = scopeOf(root, { file: 'features/orders/pages/OrdersPage.tsx' });
  const files = r.entries.map((e) => e.file);
  assert.ok(files.includes('library/pages/ListPage.tsx'));
  assert.ok(files.includes('features/orders/components/OrderCard.tsx'));
  assert.ok(!files.includes('features/orders/pages/OrdersPage.tsx'), 'not itself');
  assert.ok(!files.some((f) => f.startsWith('features/billing/')), 'never another feature');
  assert.ok(files.indexOf('features/orders/components/OrderCard.tsx') < files.indexOf('library/pages/ListPage.tsx'), 'own feature first');
  const list = r.entries.find((e) => e.file === 'library/pages/ListPage.tsx');
  assert.equal(list.import, '../../../library/pages/ListPage');
  assert.ok(list.exports.includes('ListPage'));
  assert.match(list.sentence, /^ListPage\.tsx is a library page, \d+ lines/);
  assert.match(r.sentence, /^features\/orders\/pages\/OrdersPage\.tsx may import \d+ files: its own feature \(features\/orders\) and the library\./);
  assert.match(r.sentence, /\n- \.\.\/\.\.\/\.\.\/library\/pages\/ListPage: ListPage\.tsx is a library page/);
  for (const bad of ['../etc/passwd', '/etc/passwd', '~/x', 'features/../../x']) assert.throws(() => projectFile(bad), (e) => e.code === 'BAD_REQUEST', bad);
});

test('#937 atoms: a request names its atoms with inputs, outputs and the line.useAtom step; none fits lists every atom', () => {
  const r = atomsFor({ request: 'a paginated list of loans' });
  assert.ok(r.atoms.length >= 1);
  assert.match(r.atoms[0].id, /pagination|paginated/);
  assert.match(r.sentence, /Inputs: /);
  assert.match(r.sentence, /Outputs: /);
  assert.match(r.sentence, new RegExp(`plan_add \\{"tool": "line.useAtom", "args": \\{"atom": "${r.atoms[0].id}"\\}\\}`));
  const none = atomsFor({ request: 'zzz qqq' });
  assert.deepEqual(none.atoms, []);
  assert.match(none.sentence, /^No atom fits "zzz qqq"\. The atoms are: .*client-pagination/);
});

test('#937 selector table: page, data and point steps, a TYPE_ERROR or import refusal, a rule refusal; always 3-6 reads', () => {
  const cases = [
    [{ kind: 'page', openStep: { kind: 'page', feature: 'loans', sentence: 'Feature loans has no page yet' } }, ['line.featureSummary', 'line.scope', 'line.pageTree', 'line.pageBinding']],
    [{ kind: 'data', openStep: { kind: 'data', file: 'features/loans/pages/LoansPage.tsx', sentence: 'LoansPage renders its library page with no children and imports no data' } }, ['line.scope', 'line.featureSummary', 'line.atoms']],
    [{ kind: 'fixture' }, ['line.scope', 'line.featureSummary', 'line.atoms']],
    [{ kind: 'point', openStep: { kind: 'point', file: 'features/loans/pages/LoansPage.tsx', step: { tool: 'line.setCode', args: { file: 'features/loans/pages/LoansPage.tsx' } } }, point: { id: 'LN-1', text: 'The page at `/loans` lists every loan' } },
      ['line.scope', 'line.featureSummary', 'line.pageTree', 'line.atoms']],
    [{ kind: 'route', openStep: { kind: 'route', step: { tool: 'line.addRoute', args: { route: '/loans', page: 'features/loans/pages/LoansPage.tsx' } } } }, ['line.featureSummary', 'line.pageTree', 'line.scope']],
    [{ kind: 'feature', openStep: { kind: 'feature', step: { tool: 'line.createFeature', args: {} } } }, ['line.atoms', 'line.trace', 'line.workflows']],
    [{ kind: 'page', lastRefusal: { code: 'TYPE_ERROR', sentence: 'The saved code does not compile.' } }, ['line.scope', 'line.featureSummary', 'line.pageTree', 'line.pageBinding']],
    [{ kind: 'data', lastRefusal: { code: 'REFUSED', sentence: "Cannot find module '@/library/pages/Lists'." } }, ['line.scope', 'line.featureSummary', 'line.atoms']],
    [{ lastRefusal: { code: 'LINE-DIR', sentence: 'A feature never imports another feature.' } }, ['line.scope', 'line.featureSummary', 'line.atoms']],
    [{}, ['line.featureSummary', 'line.scope', 'line.atoms']],
  ];
  for (const [input, want] of cases) {
    const got = selectReadTools(input);
    assert.deepEqual(got, want, JSON.stringify(input));
    assert.ok(got.length >= 3 && got.length <= 6);
    for (const id of got) assert.equal(entryById(id)?.kind, 'read', id);
  }
  // Trace's matcher reads the point's words: "change the title" needs the page tree.
  assert.ok(selectReadTools({ kind: 'point', point: { text: 'Change the title of the page' } }).includes('line.pageTree'));
});

test('#937 read dispatcher: every agent read of the registry has a handler or a reason; args and file paths are checked', async () => {
  const root = copy();
  const d = await createReadDispatcher(root);
  for (const e of registryReads()) {
    const onMcpByHand = e.surfaces.mcp && !['feature_summary', 'scope', 'atoms'].includes(e.surfaces.mcp);
    assert.ok(d.has(e.id) || e.id in READ_SKIPPED || onMcpByHand, `${e.id} has a handler, a skip reason, or construct-mcp's own tool`);
    assert.ok(!(d.has(e.id) && e.id in READ_SKIPPED), `${e.id} is not both`);
  }
  for (const id of ['line.featureSummary', 'line.scope', 'line.atoms', 'line.trace', 'line.pageTree']) assert.ok(d.has(id), id);
  assert.equal(d.byName('feature_summary').id, 'line.featureSummary');
  assert.equal(d.byName('line_pageTree').id, 'line.pageTree');
  const ok = await d.dispatch('line.scope', { file: 'features/orders/pages/OrdersPage.tsx' });
  assert.equal(ok.ok, true);
  assert.equal((await d.dispatch('line.scope', {})).code, 'BAD_ARGS');
  assert.equal((await d.dispatch('line.scope', { file: '../outside.ts' })).code, 'PATH_OUTSIDE_ROOT');
  assert.equal((await d.dispatch('line.featureSummary', { name: 'nope' })).code, 'UNKNOWN_ITEM');
  const trace = await d.dispatch('line.trace', { request: 'change the title of the orders page' });
  assert.equal(trace.ok, true);
  assert.equal(trace.tools[0].toolId, 'line.setPageProp');
});

test('#937 builder turn: plan tools + finish + the selected reads; an unoffered read is served and logged as a miss', async () => {
  const root = copy();
  const logDir = makeTempDir('construct-coder-reads-log-');
  const work = { first: { kind: 'data', feature: 'orders', file: 'features/orders/pages/OrdersPage.tsx', sentence: 'OrdersPage imports no data' } };
  const reads = await createTurnReads({ root, logDir, base: TOOLS.line, work: () => work });
  const sel = reads.select();
  assert.deepEqual(sel.ids, ['line.scope', 'line.featureSummary', 'line.atoms']);
  assert.deepEqual(sel.names, [...ALWAYS, 'scope', 'feature_summary', 'atoms']);
  assert.deepEqual(sel.open, { kind: 'data', feature: 'orders', tool: null });
  assert.deepEqual(sel.tools.at(-3), readFunction(entryById('line.scope')));
  assert.deepEqual(sel.tools.at(-3).function.parameters.required, ['file']);
  const typed = reads.select({ lastRefusal: { code: 'TYPE_ERROR', sentence: 'does not compile' } });
  assert.equal(typed.ids[0], 'line.scope');

  // Offered: served, no miss. Not offered (line_pageTree, list_dir): served all the same, each logged once as a miss.
  const out = await reads.call('scope', { file: 'features/orders/pages/OrdersPage.tsx' });
  assert.deepEqual(Object.keys(out), ['ok', 'sentence']);
  assert.equal(reads.miss(3, 'scope', sel), false);
  assert.equal(reads.serves('line_pageTree'), true);
  const tree = await reads.call('line_pageTree', { file: 'features/orders/pages/OrdersPage.tsx' });
  assert.notEqual(tree.ok, false);
  assert.equal(reads.miss(4, 'line_pageTree', sel), true);
  assert.equal(reads.miss(4, 'list_dir', sel), true);
  assert.equal(reads.miss(4, 'no_such_tool', sel), false, 'an unknown name is not a selection miss');
  const misses = fs.readFileSync(path.join(logDir, 'read-misses.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(misses.map((m) => [m.turn, m.tool, m.offered.join(',')]), [[4, 'line_pageTree', 'scope,feature_summary,atoms'], [4, 'list_dir', 'scope,feature_summary,atoms']]);
  assert.deepEqual(misses[0].open, { kind: 'data', feature: 'orders', tool: null });

  // The tool-schema budget: the per-turn list stays near the old 10 tools.
  assert.ok(toolTokens(sel.tools) < toolTokens(TOOLS.line) + 200, `${toolTokens(sel.tools)} vs ${toolTokens(TOOLS.line)}`);
});

test('#937 plan-cli: line.project is not a step (its answer never reached the builder); the refusal names the read tool', async () => {
  const { createPlanCli, BUILDER_TOOLS } = await import('../bench/ecommerce/driver/plan-cli.mjs');
  assert.ok(!BUILDER_TOOLS.includes('line.project'));
  const root = copy();
  const cli = createPlanCli({ project: root, log: path.join(makeTempDir('construct-coder-reads-cli-'), 'calls.jsonl'), spec: null, shadowJev: false });
  const r = await cli.run('add', ['line.project', '{}'], { why: 'Look at the features.' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'READ_NOT_A_STEP');
  assert.match(r.sentence, /feature_summary/);
  assert.ok(mcpNameOf(entryById('line.featureSummary')) === 'feature_summary');
});
