// T3 page prop (packages/engine/line/pageProp.mjs) on a temp copy of the line profile's passing fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planSetProp, readPageTree } from '../packages/engine/line/pageProp.mjs';
import { assertStagedChange, LineOpError } from '../packages/engine/line/contract.mjs';
import { serializeTree, parsePageTree } from '../packages/engine/pagesEditor.mjs';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../packages/core/profiles/line/fixtures/passing');
const PAGE = 'features/orders/pages/OrdersPage.tsx';
const RICH = 'features/orders/pages/OrderDetailPage.tsx';
const RICH_SOURCE = `/**
 * One order.
 * @line-base pages/ListPage
 */
import { ListPage } from '@/library/pages/ListPage';

export function OrderDetailPage({ orderId }: { orderId: string }) {
  // keep this comment
  return (
    <>
      <ListPage
        title="Order"
        count={3}
        dense
      >
        <section className='detail'>
          <h1>{orderId}</h1>
          <p />
        </section>
      </ListPage>
    </>
  );
}
`;

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-line-page-prop-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, RICH), RICH_SOURCE);
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const ROOT = tempProject();
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** The change's one file content, after the shape check every result must pass. */
function plan(req) {
  const change = planSetProp(ROOT, req);
  assertStagedChange(change);
  assert.equal(change.files.length, 1);
  assert.equal(change.files[0].path, req.file);
  return change.files[0].content;
}

/** Asserts `after` equals `before` except that the slice [start, end) of `before` became `inserted`. */
function onlyChanged(before, after, oldText, newText) {
  const at = before.indexOf(oldText);
  assert.notEqual(at, -1, `expected "${oldText}" in the original`);
  assert.equal(after, before.slice(0, at) + newText + before.slice(at + oldText.length));
}

const refused = (req, code) => {
  assert.throws(() => planSetProp(ROOT, req), (e) => {
    assert.ok(e instanceof LineOpError);
    assert.equal(e.code, code);
    assert.match(e.sentence, /^\S.*[.?!]$/s);
    return true;
  });
};

test('page prop: replacing an existing string attribute changes only that attribute', () => {
  const before = read(PAGE);
  const after = plan({ file: PAGE, nodeId: 'n0', prop: 'title', kind: 'string', value: 'All orders' });
  onlyChanged(before, after, 'title="Orders"', 'title="All orders"');
  assert.equal(read(PAGE), before, 'planning writes nothing');
});

test('page prop: a new attribute is added after the last one, and nothing else moves', () => {
  const before = read(PAGE);
  onlyChanged(before, plan({ file: PAGE, nodeId: 'n0', prop: 'pageSize', kind: 'number', value: 25 }), 'title="Orders" />', 'title="Orders" pageSize={25} />');
});

test('page prop: number, boolean and expression values are written in their JSX form', () => {
  const before = read(RICH);
  onlyChanged(before, plan({ file: RICH, nodeId: 'n1', prop: 'count', kind: 'number', value: 7.5 }), 'count={3}', 'count={7.5}');
  onlyChanged(before, plan({ file: RICH, nodeId: 'n1', prop: 'dense', kind: 'boolean', value: false }), 'dense\n', 'dense={false}\n');
  onlyChanged(before, plan({ file: RICH, nodeId: 'n1', prop: 'title', kind: 'expression', value: '`Order ${orderId}`' }), 'title="Order"', 'title={`Order ${orderId}`}');
  onlyChanged(before, plan({ file: RICH, nodeId: 'n2', prop: 'className', kind: 'string', value: 'say "hi"' }), "className='detail'", 'className="say &quot;hi&quot;"');
});

test('page prop: a new attribute on a multi-line tag goes on its own line, indented like its siblings', () => {
  const before = read(RICH);
  onlyChanged(before, plan({ file: RICH, nodeId: 'n1', prop: 'loading', kind: 'boolean', value: true }), '        dense\n', '        dense\n        loading\n');
});

test('page prop: unknown pages, nodes and kinds, bad names and bad values are refused with one sentence', () => {
  refused({ file: 'features/orders/pages/Nope.tsx', nodeId: 'n0', prop: 'title', kind: 'string', value: 'x' }, 'UNKNOWN_ITEM');
  refused({ file: 'features/orders/components/OrderButton.tsx', nodeId: 'n0', prop: 'title', kind: 'string', value: 'x' }, 'UNKNOWN_ITEM');
  refused({ file: 'features/orders/pages/../../../architecture.yml', nodeId: 'n0', prop: 'title', kind: 'string', value: 'x' }, 'UNKNOWN_ITEM');
  refused({ file: PAGE, nodeId: 'n9', prop: 'title', kind: 'string', value: 'x' }, 'UNKNOWN_ITEM');
  refused({ file: PAGE, nodeId: 'n0', prop: 'title', kind: 'spread', value: 'x' }, 'UNKNOWN_PROP');
  refused({ file: PAGE, nodeId: 'n0', prop: 'title', kind: 'identifier', value: 'x' }, 'UNKNOWN_PROP');
  refused({ file: PAGE, nodeId: 'n0', prop: 'bad name', kind: 'string', value: 'x' }, 'UNKNOWN_PROP');
  refused({ file: RICH, nodeId: 'n0', prop: 'key', kind: 'string', value: 'x' }, 'UNKNOWN_PROP'); // the fragment
  refused({ file: PAGE, nodeId: 'n0', prop: 'pageSize', kind: 'number', value: 'many' }, 'BAD_VALUE');
  refused({ file: PAGE, nodeId: 'n0', prop: 'pageSize', kind: 'number', value: Infinity }, 'BAD_VALUE');
  refused({ file: PAGE, nodeId: 'n0', prop: 'open', kind: 'boolean', value: 'yes' }, 'BAD_VALUE');
  refused({ file: PAGE, nodeId: 'n0', prop: 'title', kind: 'string', value: 42 }, 'BAD_VALUE');
  refused({ file: PAGE, nodeId: 'n0', prop: 'title', kind: 'expression', value: 'a} onClick={steal' }, 'BAD_VALUE');
  refused({ file: PAGE, nodeId: 'n0', prop: 'title', kind: 'expression', value: '  ' }, 'BAD_VALUE');
  refused({ file: PAGE, nodeId: 'n0', prop: 'title', kind: 'expression', value: 'x // eats the brace' }, 'BAD_VALUE');
});

test('page prop: readPageTree is the /api/pages/tree tree with each node\'s props and scope names', () => {
  const tree = readPageTree(ROOT, RICH);
  const served = serializeTree(read(RICH));
  assert.equal(tree.file, RICH);
  assert.equal(tree.feature, 'orders');
  assert.equal(tree.contentHash, served.contentHash);
  assert.deepEqual(tree.scopeNames.includes('orderId'), true);
  const strip = (n) => { const { settable, ...rest } = n; return { ...rest, children: n.children.map(strip) }; };
  assert.deepEqual(tree.roots.map(strip), served.roots, 'same ids, tags and props as the Pages editor serves');
  assert.equal(tree.roots[0].settable, false);
  const list = tree.roots[0].children[0];
  assert.deepEqual(list.props.map((p) => `${p.name}:${p.kind}`), ['title:string', 'count:number', 'dense:boolean']);
  assert.equal(list.settable, true);
  assert.throws(() => readPageTree(ROOT, 'features/orders/pages/Nope.tsx'), (e) => e instanceof LineOpError && e.code === 'UNKNOWN_ITEM');
});

test('page prop (property): setting a string prop on any node keeps every node id and changes only that node\'s opening tag', () => {
  for (const file of [PAGE, RICH]) {
    const before = read(file);
    const ids = (src) => { const out = []; const walk = (n) => { out.push(`${n.id}:${n.tag}`); n.children.forEach(walk); }; serializeTree(src).roots.forEach(walk); return out; };
    const all = []; const walk = (n) => { all.push(n); n.children.forEach(walk); };
    readPageTree(ROOT, file).roots.forEach(walk);
    for (const node of all.filter((n) => n.settable)) {
      for (const [prop, value] of [['title', 'x'], ['data-probe', 'a "quoted" <value> {braces}'], ['aria-label', '']]) {
        const after = plan({ file, nodeId: node.id, prop, kind: 'string', value });
        assert.deepEqual(ids(after), ids(before), `${file} ${node.id} ${prop}`);
        const changed = serializeTree(after).roots;
        const find = (ns, id) => { for (const n of ns) { if (n.id === id) return n; const c = find(n.children, id); if (c) return c; } return null; };
        assert.equal(find(changed, node.id).props.find((p) => p.name === prop).value, value, 'the value reads back exactly');
        // Every byte outside the node's opening tag is untouched.
        const [s, e] = parsePageTree(before).byId.get(node.id).openingElementNode.range;
        assert.ok(after.startsWith(before.slice(0, s)) && after.endsWith(before.slice(e)), `${file} ${node.id}: bytes outside the opening tag changed`);
      }
    }
  }
});

test('a Line project that keeps its code under src/ is edited through the Line layout, not features.root', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-line-src-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    for (const d of ['library', 'features']) fs.cpSync(path.join(FIXTURE, d), path.join(dir, 'src', d), { recursive: true });
    fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\npreset: line\n');
    const file = `src/${PAGE}`;
    const [rootNode] = readPageTree(dir, file).roots;
    const change = planSetProp(dir, { file, nodeId: rootNode.id, prop: 'title', kind: 'string', value: 'All orders' });
    assertStagedChange(change);
    assert.match(change.files[0].content, /title="All orders"/);
    assert.throws(() => planSetProp(dir, { file: PAGE, nodeId: rootNode.id, prop: 'title', kind: 'string', value: 'x' }), (e) => e instanceof LineOpError && e.code === 'UNKNOWN_ITEM');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
