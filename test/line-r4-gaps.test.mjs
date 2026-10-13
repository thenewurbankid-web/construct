// #915/#916/#917: the tool gaps the r4 bench exposed, replayed on a copy of the bench starter through plan-cli.
//   r4 (pilot-qwen-7b-r4): 99 adds, 7 distinct, 0 landed; the model never ran plan_run_next because open work kept
//     re-suggesting the approved spec.md setCode and baseOn, and the setCode on ListPage was refused TYPE_ERROR while
//     its own baseOn was approved but unrun, with no "run it first".
//   r4-s2 (pilot-qwen-7b-r4-s2): a NO_CHANGE setCode whose "A correct call" named features/cart/pages/CartPage.tsx
//     (not in the project), and "CAT-2 is not covered yet" with no step.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createPlanCli } from '../bench/ecommerce/driver/plan-cli.mjs';
import { readSpec } from '../bench/ecommerce/driver/spec-slice.mjs';
import { openWork, pointStep } from '../packages/engine/line/openWork.mjs';
import { shapeRefusal, rulesCard, hintOf, TOOL_EXAMPLES, createExampleResolver, plannedFiles } from '../packages/engine/line/hints.mjs';
import { REFUSAL_FIXES } from '../packages/engine/line/refusals.mjs';
import { stepCovering, pendingDependency } from '../packages/engine/line/planService.mjs';

const STARTER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bench', 'ecommerce', 'starter');
const SPEC_MD = 'features/catalog/spec.md';
const LIST = 'features/catalog/pages/ListPage.tsx';
// r4 turns.jsonl:10: the model's setCode on ListPage, importing a library barrel that does not exist.
const R4_LIST_CODE = "// @line-base pages/ListPage\n\nimport { List, ListItem, Button } from '../../../library/components';\nimport products from '../../../library/fixtures/products.json';\n\nexport default function ListPage() {\n  return (\n    <List>\n      {products.map((product: any) => (\n        <ListItem key={product.id}>{product.name}</ListItem>\n      ))}\n    </List>\n  );\n}\n";

function starter() {
  const parent = fs.realpathSync(makeTempDir('line-r4-gaps-'));
  const root = path.join(parent, 'shop');
  fs.cpSync(STARTER, root, { recursive: true, filter: (src) => !/node_modules|\.next/.test(src) });
  const cli = createPlanCli({ project: root, log: path.join(parent, 'log', 'calls.jsonl'), builder: 'test', shadowJev: false });
  return { root, cli, done: () => fs.rmSync(parent, { recursive: true, force: true }) };
}
/** Every features/... path a text names. */
const featurePaths = (text) => [...String(text).matchAll(/features\/[\w-]+(?:\/[\w.-]+)+/g)].map((m) => m[0].replace(/[.,;:]+$/, ''));

test('(G1, r4) approved-but-unrun steps lead status, are never re-suggested, a duplicate add is refused with run-next as f1, and f1 runs it', async () => {
  const { root, cli, done } = starter();
  try {
    const st0 = await cli.run('status');
    const specStep = openWork(root, { spec: readSpec() }).features[0].open.find((o) => o.kind === 'spec')?.step;
    assert.ok(specStep, st0.sentence);
    assert.match(st0.sentence, /Step: line\.setCode \{"file":"features\/catalog\/spec\.md"/);
    const a1 = await cli.run('add', [specStep.tool, JSON.stringify(specStep.args)], { why: 'Write the catalog story and points.' });
    assert.equal(a1.ok, true, a1.sentence);
    const a2 = await cli.run('add', ['line.baseOn', JSON.stringify({ libraryId: 'pages/ListPage', feature: 'catalog', name: 'ListPage' })], { why: 'Create the catalog page.' });
    assert.equal(a2.ok, true, a2.sentence);
    assert.match(a2.sentence, /\n2 approved steps are waiting to run \(step 1 line\.setCode features\/catalog\/spec\.md; step 2 line\.baseOn ListPage in catalog\): call plan_run_next to land them, one per call\.\n/);

    const st = await cli.run('status', ['catalog']);
    const lines = st.sentence.split('\n');
    assert.equal(lines[0], 'The plan has 2 steps.');
    assert.match(lines[1], /^2 approved steps are waiting to run .*: call plan_run_next/);
    assert.doesNotMatch(st.sentence, /Step: line\.setCode \{"file":"features\/catalog\/spec\.md"/, 'the approved spec.md step is not suggested again');
    assert.doesNotMatch(st.sentence, /has no page yet/, 'the approved baseOn covers the missing page');
    assert.equal(st.work.waiting, 2);

    // The r4 loop's third call: the same spec.md setCode again.
    const dup = await cli.run('add', [specStep.tool, JSON.stringify(specStep.args)], { why: 'Write the catalog story and points.' });
    assert.equal(dup.ok, false);
    assert.equal(dup.code, 'DUPLICATE_STEP');
    assert.match(dup.sentence, /^Refused \(DUPLICATE_STEP\): Step 1 is this same call, approved and waiting to run; run it with plan_run_next instead of adding it again/);
    assert.deepEqual(dup.fixes.map((f) => [f.ref, f.step.tool]), [['f1', 'plan_run_next']]);
    assert.match(dup.sentence, /\nChoice:\n {2}f1: plan_run_next \{\}\n/);
    assert.match(dup.sentence, /To apply one, send \{"fix":"f1"\}\./);
    assert.equal(REFUSAL_FIXES.DUPLICATE_STEP?.typed?.length > 10, true);
    assert.match(shapeRefusal({ code: 'DUPLICATE_STEP', sentence: 'Step 1 is this same call.' }).text, /\nA correct call: plan_run_next \{\}$/);

    // The r4 loop's first call: setCode on ListPage while its baseOn is approved but unrun. The r4 project had its
    // node_modules, so the type gate ran (TS2307 on the library barrel); here it runs for this one call.
    const nm = path.join(root, 'node_modules');
    fs.symlinkSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules'), nm, 'dir');
    const set = await cli.run('add', ['line.setCode', JSON.stringify({ file: LIST, code: R4_LIST_CODE })], { why: 'Write the catalog list page.' });
    fs.unlinkSync(nm);
    assert.equal(set.code, 'TYPE_ERROR', set.sentence);
    assert.match(set.sentence, /^Step 2 \(line\.baseOn \{"libraryId":"pages\/ListPage","feature":"catalog","name":"ListPage"\}\) creates features\/catalog\/pages\/ListPage\.tsx and is approved but has not run yet: run it first with plan_run_next, then send this again\.\nRefused \(/);
    assert.equal(set.fixes[0].ref, 'f1');
    assert.equal(set.fixes[0].step.tool, 'plan_run_next');
    assert.match(set.fixes[0].why, /step 2 \(line\.baseOn\), approved but not run yet, creates features\/catalog\/pages\/ListPage\.tsx/);

    // {"fix":"f1"} runs the next step (step 1) instead of adding one.
    const ran = await cli.run('add', [], { fix: 'f1' });
    assert.equal(ran.ok, true, ran.sentence);
    assert.equal(ran.n, 1);
    assert.equal(ran.landed, true, ran.sentence);
    assert.match(ran.sentence, /\n1 approved step is waiting to run \(step 2 line\.baseOn ListPage in catalog\): call plan_run_next to land it\./);
    const ran2 = await cli.run('run-next');
    assert.equal(ran2.landed, true, ran2.sentence);
    const after = await cli.run('status');
    assert.doesNotMatch(after.sentence, /waiting to run/);
    assert.equal(after.work.waiting, undefined);
  } finally { done(); }
});

test('(G1) helpers: an item covered by a pending step; the pending step a refusal waits on; the waiting line', () => {
  const plan = { steps: [
    { id: 's1', n: 1, tool: 'line.setCode', args: { file: SPEC_MD, code: 'x', expect: [] }, status: 'approved', approval: 'given' },
    { id: 's2', n: 2, tool: 'line.baseOn', args: { libraryId: 'pages/ListPage', feature: 'catalog', name: 'ListPage' }, status: 'approved', approval: 'given' },
    { id: 's3', n: 3, tool: 'line.createFeature', args: { name: 'cart' }, status: 'planned', approval: 'needed' },
    { id: 's0', n: 0, tool: 'line.addRoute', args: { route: '/x', page: 'features/x/pages/X.tsx' }, status: 'done' },
  ] };
  const pending = plan.steps.filter((s) => s.status === 'planned' || s.status === 'approved');
  assert.equal(stepCovering({ kind: 'spec', feature: 'catalog', file: SPEC_MD, step: { tool: 'line.setCode', args: { file: SPEC_MD, code: 'other' } } }, pending)?.id, 's1');
  assert.equal(stepCovering({ kind: 'page', feature: 'catalog' }, pending)?.id, 's2');
  assert.equal(stepCovering({ kind: 'feature', feature: 'cart' }, pending)?.id, 's3');
  assert.equal(stepCovering({ kind: 'page', feature: 'product' }, pending), null);
  assert.equal(stepCovering({ kind: 'route', feature: 'x', file: 'features/x/pages/X.tsx', step: { tool: 'line.addRoute', args: { route: '/x', page: 'features/x/pages/X.tsx' } } }, pending), null, 'a step that ran covers nothing');
  assert.equal(pendingDependency(plan, { tool: 'line.setCode', args: { file: LIST, code: 'y' } })?.step.id, 's2');
  assert.equal(pendingDependency(plan, { tool: 'line.addRoute', args: { route: '/', page: LIST } })?.step.id, 's2');
  assert.equal(pendingDependency(plan, { tool: 'line.baseOn', args: { libraryId: 'pages/ListPage', feature: 'cart', name: 'CartPage' } })?.step.id, 's3');
  assert.equal(pendingDependency(plan, { tool: 'line.setCode', args: { file: 'features/product/pages/P.tsx' } }), null);
  assert.deepEqual(plannedFiles(plan), [SPEC_MD, LIST, 'features/cart/spec.md']);
});

test('(G2, G3, r4-s2) NO_CHANGE names the same page, never a missing one; status gives each open point a concrete step', async () => {
  const { root, cli, done } = starter();
  try {
    const base = await cli.run('add', ['line.baseOn', JSON.stringify({ libraryId: 'pages/ListPage', feature: 'catalog', name: 'ListPage' })], { why: 'Create the catalog page.' });
    assert.equal(base.ok, true, base.sentence);
    assert.equal((await cli.run('run-next')).landed, true);
    const route = await cli.run('add', ['line.addRoute', JSON.stringify({ route: '/', page: LIST })], { why: 'Serve the catalog page at the root.' });
    assert.equal(route.ok, true, route.sentence);
    assert.equal((await cli.run('run-next')).landed, true);
    const read = await cli.run('read', [LIST]);
    const same = await cli.run('add', ['line.setCode', JSON.stringify({ file: LIST, code: read.content, contentHash: read.contentHash })], { why: 'Rewrite the catalog page.' });
    assert.equal(same.code, 'NO_CHANGE', same.sentence);
    assert.match(same.sentence, new RegExp(`\\nA correct call: line\\.setCode \\{"file":"features/catalog/pages/ListPage\\.tsx","code":"<the whole file with the change you want; the code you sent is already there>","contentHash":"${read.contentHash}"\\}`));
    for (const p of featurePaths(same.sentence)) assert.ok(fs.existsSync(path.join(root, p)), `${p} exists (${same.sentence})`);
    assert.doesNotMatch(same.sentence, /CartPage/);

    // G3: every uncovered point of catalog comes with one concrete step: setCode on ListPage with its real hash.
    const st = await cli.run('status', ['catalog']);
    const pts = st.sentence.split('\n').filter((l) => /^\d+\. CAT-\d+ is not covered yet/.test(l));
    assert.ok(pts.length >= 1, st.sentence);
    // #920: the first one carries ListPage's real code with a marked slot; the later ones wait for it to land.
    assert.match(pts[0], new RegExp(`Step: line\\.setCode \\{"file":"features/catalog/pages/ListPage\\.tsx","code":".*CAT-\\d+: .* \u2014 add it here .*","contentHash":"${read.contentHash}"\\}$`));
    for (const l of pts.slice(1)) assert.match(l, /Its step, with the code, comes once the items above land\.$/);
    for (const p of featurePaths(st.sentence)) assert.ok(fs.existsSync(path.join(root, p)), `${p} exists`);
  } finally { done(); }
});

test('(G3) pointStep: the page serving the point\'s route, else the spec route, else the first; no page: the baseOn that creates one', () => {
  const pages = [{ file: 'features/catalog/pages/A.tsx', route: '/a', src: 'a' }, { file: 'features/catalog/pages/B.tsx', route: '/', src: 'b' }];
  const point = { id: 'CAT-2', text: 'A filter labelled "Category" on `/`.' };
  assert.equal(pointStep({ feature: 'catalog', point, pages })?.args.file, 'features/catalog/pages/B.tsx');
  assert.equal(pointStep({ feature: 'catalog', point: { id: 'CAT-3', text: 'A box "Search".' }, pages, pageAt: ['/a'] })?.args.file, 'features/catalog/pages/A.tsx');
  assert.equal(pointStep({ feature: 'catalog', point: { id: 'CAT-3', text: 'A box "Search".' }, pages })?.args.file, 'features/catalog/pages/A.tsx');
  assert.match(pointStep({ feature: 'catalog', point, pages })?.args.contentHash ?? '', /^[0-9a-f]{64}$/);
  const libs = ['pages/DetailPage', 'pages/FormPage', 'pages/ListPage'];
  assert.deepEqual(pointStep({ feature: 'catalog', point, pages: [], libraryPages: libs }), { tool: 'line.baseOn', args: { libraryId: 'pages/ListPage', feature: 'catalog', name: 'ListPage' } });
  assert.equal(pointStep({ feature: 'product', point: { id: 'PROD-2', text: 'Shows "Add to cart".' }, pages: [], libraryPages: libs, pageAt: ['/products/:id'] })?.args.libraryId, 'pages/DetailPage');
  assert.equal(pointStep({ feature: 'checkout', point: { id: 'CHK-1', text: 'A form with a field "Name".' }, pages: [], libraryPages: libs })?.args.libraryId, 'pages/FormPage');
  assert.equal(pointStep({ feature: 'x', point, pages: [], libraryPages: [] }), null);
});

test('(G2) on a project with no cart, no correct call and no rules card names a features/ path that is not there (or that no pending step creates)', () => {
  const { root, done } = starter();
  try {
    fs.mkdirSync(path.join(root, 'features/catalog/pages'), { recursive: true });
    fs.writeFileSync(path.join(root, LIST), 'export function ListPage() { return null; }\n');
    const planned = ['features/catalog/components/ProductRow.tsx'];
    const x = createExampleResolver(root, { planned });
    const real = (p) => fs.existsSync(path.join(root, p)) || planned.includes(p);
    const codes = Object.keys(REFUSAL_FIXES);
    let shown = 0;
    for (const code of codes) {
      for (const tool of [undefined, ...Object.keys(TOOL_EXAMPLES)]) {
        const fields = hintOf(code)?.fields ?? [];
        const args = Object.fromEntries(fields.map((f) => [f, f === 'components' ? ['features/zz/components/Zz.tsx'] : f === 'feature' ? 'zz' : 'features/zz/pages/ZzPage.tsx']));
        const s = shapeRefusal({ code, sentence: 'No.', tool, args, resolve: x.call });
        if (s.example) shown += 1;
        // A moveFile target is a file the step creates: its feature must be real, not the file.
        const to = /"to":"([^"]+)"/.exec(s.example ?? '')?.[1];
        if (to) assert.ok(real(to.split('/').slice(0, 2).join('/')), `${code} ${tool}: ${to} is in no real feature`);
        for (const p of featurePaths(s.text)) if (!p.startsWith('features/zz/') && p !== to) assert.ok(real(p), `${code} ${tool}: ${p} is not in the project: ${s.text}`);
        assert.doesNotMatch(s.text, /features\/cart\//, `${code} ${tool}`);
      }
    }
    assert.ok(shown > 50, `examples still shown where one fits (${shown})`);
    for (const tool of ['line.addRoute', 'line.setCode', 'line.baseOn', 'line.createFeature', 'line.setLayoutSlot', 'line.leaveAsIs']) {
      for (const args of [{}, { file: LIST }, { file: 'features/zz/pages/Zz.tsx' }, { file: SPEC_MD }]) {
        const card = rulesCard(tool, args, undefined, { resolve: x });
        for (const p of featurePaths(card.text)) if (!p.startsWith('features/zz/')) assert.ok(real(p), `${tool} card: ${p} is not in the project: ${card.text}`);
      }
    }
    // The page a route example names is the project's own; the slot example names the planned component.
    assert.match(rulesCard('line.addRoute', {}, undefined, { resolve: x }).text, /"page":"features\/catalog\/pages\/ListPage\.tsx"/);
    assert.match(rulesCard('line.setLayoutSlot', {}, undefined, { resolve: x }).text, /features\/catalog\/components\/ProductRow\.tsx/);
    assert.match(rulesCard('line.setCode', { file: SPEC_MD }, undefined, { resolve: x }).text, /read features\/catalog\/spec\.md, then line\.setCode/);
    // Without a project (no resolver), the card's own examples stay as they were.
    assert.match(rulesCard('line.addRoute', {}).text, /features\/cart\/pages\/CartPage\.tsx/);
  } finally { done(); }
});
