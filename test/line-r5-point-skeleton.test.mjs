// #920: the point-step gap the r5 bench exposed (pilot-qwen-7b-r5 calls.jsonl:15). plan_status gave uncovered CAT-2 a
// line.setCode whose code was prose ("<the whole file of CatalogPage, now also showing CAT-2: ...>"); qwen2.5-coder:7b
// sent it verbatim 8 times and got a bare BAD_CODE "does not parse". Replayed on a copy of the bench starter.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsxParseError } from '@construct/ast';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createPlanCli } from '../bench/ecommerce/driver/plan-cli.mjs';
import { pointSlot, slotOf, itemText } from '../packages/engine/line/openWork.mjs';

const STARTER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bench', 'ecommerce', 'starter');
const PAGE = 'features/catalog/pages/CatalogPage.tsx';
// r5's CatalogPage as the seed pass left it.
const R5_PAGE = `// @line-base pages/ListPage
// @line-route /
import Link from 'next/link';
import { ListPage } from '../../../library/pages/ListPage';
import products from '../../../library/fixtures/products.json';

type Product = { id: string; name: string; category: string; price: number };

export function CatalogPage() {
  const items = products as Product[];
  return (
    <ListPage title="Products" empty={<p>No products yet.</p>}>
      {items.map((item) => (
        <article key={item.id}>
          <h2><Link href={\`/products/\${item.id}\`}>{item.name}</Link></h2>
          <p>{item.category}</p>
        </article>
      ))}
    </ListPage>
  );
}
`;
// r5 calls.jsonl:15: the code the model sent, verbatim.
const R5_PROSE = '<the whole file of CatalogPage, now also showing CAT-2: A filter labelled "Category" offers All, Clothing, Home and Electronics; choosing a category shows only its 4 products, and All shows all 12 again.>';

async function r5Project() {
  const parent = fs.realpathSync(makeTempDir('line-r5-skeleton-'));
  const root = path.join(parent, 'shop');
  fs.cpSync(STARTER, root, { recursive: true, filter: (src) => !/node_modules|\.next/.test(src) });
  const cli = createPlanCli({ project: root, log: path.join(parent, 'log', 'calls.jsonl'), builder: 'test', shadowJev: false });
  assert.equal((await cli.run('add', ['line.baseOn', JSON.stringify({ libraryId: 'pages/ListPage', feature: 'catalog', name: 'CatalogPage' })], { why: 'Create the catalog page.' })).ok, true);
  assert.equal((await cli.run('run-next')).landed, true);
  assert.equal((await cli.run('add', ['line.addRoute', JSON.stringify({ route: '/', page: PAGE })], { why: 'Serve the catalog at /.' })).ok, true);
  assert.equal((await cli.run('run-next')).landed, true);
  fs.writeFileSync(path.join(root, PAGE), R5_PAGE);
  return { root, cli, done: () => fs.rmSync(parent, { recursive: true, force: true }) };
}

test('(r5) status: the point step carries the real page with one marked slot, parses, and differs from it only by the slot', async () => {
  const { cli, done } = await r5Project();
  try {
    const st = await cli.run('status', ['catalog']);
    const pts = st.sentence.split('\n').filter((l) => /^\d+\. CAT-\d+ is not covered yet/.test(l));
    assert.ok(pts.length >= 2, st.sentence);
    const step = JSON.parse(/ Step: line\.setCode (\{.*\})$/.exec(pts[0])?.[1] ?? 'null');
    const read = await cli.run('read', [PAGE]);
    assert.equal(step.file, PAGE);
    assert.equal(step.contentHash, read.contentHash);
    assert.equal(jsxParseError(step.code), null, 'the suggested code parses as it is');
    const slot = slotOf(step.code);
    assert.ok(slot && !slot.prose && /^CAT-\d+$/.test(String(slot.id)), step.code);
    // plan-cli prints one line per item with spaces collapsed, so the indents are gone; nothing else differs.
    const flat = (x) => x.replace(/\s+/g, ' ').trim();
    assert.equal(flat(slot.rest ?? ''), flat(R5_PAGE), 'the slot comment is the only difference');
    assert.match(step.code, /\{\/\* CAT-\d+: .* — add it here \*\/\}\n ?<\/ListPage>/);
    const same = await cli.run('add', ['line.setCode', JSON.stringify(step)], { why: 'Sent as suggested.' });
    assert.equal(same.code, 'NO_CHANGE', same.sentence);
    assert.match(same.sentence, /fill the slot at line \d+ of features\/catalog\/pages\/CatalogPage\.tsx/);
    assert.doesNotMatch(st.sentence, /<the whole file/);
    assert.match(pts[1], /Its step, with the code, comes once the items above land\.$/, 'the same page, so its hash changes first');
    assert.doesNotMatch(st.sentence, /\.\.\.","contentHash"/, 'no step code is cut');
  } finally { done(); }
});

test('(r5) pasting the placeholder, or the skeleton unchanged, is refused by name; a filled slot lands', async () => {
  const { cli, done } = await r5Project();
  try {
    const read = await cli.run('read', [PAGE]);
    const prose = await cli.run('add', ['line.setCode', JSON.stringify({ file: PAGE, code: R5_PROSE, contentHash: read.contentHash })], { why: 'CAT-2' });
    assert.equal(prose.code, 'BAD_CODE', prose.sentence);
    const line = pointSlot(R5_PAGE, { id: 'CAT-2', text: 'x' }).line;
    assert.match(prose.sentence, new RegExp(`You sent the suggestion's placeholder, not code, so nothing was saved; replace the marked slot at line ${line} of features/catalog/pages/CatalogPage\\.tsx with the code that shows CAT-2: A filter labelled "Category" offers All, Clothing, Home and Electronics; choosing a category shows only its 4 products, and All shows all 12 again\\.\\n`));

    const skeleton = pointSlot(R5_PAGE, { id: 'CAT-2', text: 'A filter labelled "Category" offers All, Clothing, Home and Electronics.' }).code;
    const same = await cli.run('add', ['line.setCode', JSON.stringify({ file: PAGE, code: skeleton, contentHash: read.contentHash })], { why: 'CAT-2' });
    assert.equal(same.code, 'NO_CHANGE', same.sentence);
    assert.match(same.sentence, new RegExp(`You sent the suggestion's skeleton unchanged, so nothing changed; fill the slot at line ${line} of features/catalog/pages/CatalogPage\\.tsx \\(the /\\* CAT-2: \\.\\.\\. \\*/ comment\\) with the code that shows CAT-2`));

    const broken = skeleton.replace('</ListPage>', '<select>\n    </ListPage>');
    const bad = await cli.run('add', ['line.setCode', JSON.stringify({ file: PAGE, code: broken, contentHash: read.contentHash })], { why: 'CAT-2' });
    assert.equal(bad.code, 'BAD_CODE', bad.sentence);
    assert.match(bad.sentence, /does not parse, so nothing was saved; the slot at line \d+ of features\/catalog\/pages\/CatalogPage\.tsx is still marked: replace it with the code that shows CAT-2/);

    const filled = skeleton.replace(/\{\/\* CAT-2: .* \*\/\}/, '<label>Category <select><option>All</option></select></label>');
    const ok = await cli.run('add', ['line.setCode', JSON.stringify({ file: PAGE, code: filled, contentHash: read.contentHash })], { why: 'CAT-2: the Category filter.' });
    assert.equal(ok.ok, true, ok.sentence);
    assert.equal((await cli.run('run-next')).landed, true);
  } finally { done(); }
});

test('(r5) the example placeholder is named too; real code and other tools are left alone; a page with no closing tag still gets a slot', () => {
  assert.deepEqual(slotOf('<the whole file>'), { prose: true, id: null, text: null });
  assert.equal(slotOf(R5_PAGE), null);
  assert.equal(slotOf('<a href="/x" />'), null);
  const bare = 'export function P() {\n  return null;\n}\n';
  const s = pointSlot(bare, { id: 'P-1', text: 'Shows */ "Hi".' });
  assert.equal(jsxParseError(s.code), null);
  assert.equal(s.line, 1);
  assert.equal(slotOf(s.code)?.rest, bare);
  const it = { sentence: 'P-1 is not covered yet.', step: { tool: 'line.setCode', args: { file: 'f.tsx', code: `${'x'.repeat(200)}\n${s.code}` } } };
  assert.ok(itemText(it).includes(JSON.stringify(s.code).slice(1, -1)), 'step code is never cut');
  assert.equal(itemText(it, false), 'P-1 is not covered yet. Its step, with the code, comes once the items above land.');
});
