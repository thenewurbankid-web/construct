// cx1: spot code editing without the whole file (packages/engine/line/fragments.mjs), on copies of examples/line-sample.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFragments, planSetFragment, fragmentsOf } from '../packages/engine/line/fragments.mjs';
import { readPageTree } from '../packages/engine/line/pageProp.mjs';
import { applyChange } from '../packages/engine/line/ops.mjs';
import { assertFragmentList, assertStagedChange, assertApplyResult, LineOpError } from '../packages/engine/line/contract.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../examples/line-sample');
const ORDERS = 'features/orders/pages/OrdersPage.tsx';
const CARD = 'features/orders/components/OrderCard.tsx';

function copy() {
  const dir = fs.realpathSync(makeTempDir('line-frag-'));
  fs.cpSync(SAMPLE, dir, { recursive: true });
  return dir;
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const write = (dir, rel, s) => fs.writeFileSync(path.join(dir, rel), s); // test setup only, not a project write path
const refused = (code) => (e) => e instanceof LineOpError && e.code === code && /^\S.*[.?!]$/.test(e.sentence);

// A component with every fragment kind: handler, prop expression, style, && condition and a ternary condition.
const RICH = `// @line-base components/Card
import { Card } from '../../../library/components/Card';

export function OrderCard({ count, busy }: { count: number; busy: boolean }) {
  return (
    <section className={busy ? 'busy' : 'idle'} style={{ padding: 4 }}>
      <Card title={\`Orders: \${count}\`} />
      {count > 0 && <button type="button" onClick={() => console.log('open')}>Save</button>}
      {busy ? <span>Wait</span> : <em>Ready</em>}
      <input aria-label="Name" onChange={(e) => console.log(e.target.value)} disabled={!busy} />
    </section>
  );
}
`;

test('list: a page lists its handler with a plain-English label, the exact code and range, and page-tree part ids', () => {
  const dir = copy();
  const list = listFragments(dir, ORDERS);
  assertFragmentList(list);
  assert.equal(list.fragments.length, 1);
  const [f] = list.fragments;
  assert.equal(f.kind, 'handler');
  assert.equal(f.label, 'What happens when Orders asks for more');
  assert.equal(f.code, "() => console.log('Show more orders')");
  assert.equal(read(dir, ORDERS).slice(f.range.start, f.range.end), f.code);
  const tree = readPageTree(dir, ORDERS);
  assert.equal(tree.contentHash, list.contentHash);
  assert.equal(tree.roots[0].id, f.nodeId, 'the fragment sits on the ListPage part the Pages screen shows');
});

test('list: every kind is found on a component, labelled in plain English, never as a sentence', () => {
  const frags = fragmentsOf(RICH, CARD);
  assertFragmentList({ file: CARD, contentHash: frags[0].contentHash, fragments: frags });
  assert.deepEqual(frags.map((f) => [f.kind, f.label, f.code]), [
    ['style', 'How section looks (className)', "busy ? 'busy' : 'idle'"],
    ['style', 'How section looks (style)', '{ padding: 4 }'],
    ['prop-expression', 'The value of title on Card', '`Orders: ${count}`'],
    ['condition', 'When Save shows', 'count > 0'],
    ['handler', 'What happens when Save is clicked', "() => console.log('open')"],
    ['condition', 'Whether Wait shows instead of Ready', 'busy'],
    ['handler', 'What happens when Name changes', '(e) => console.log(e.target.value)'],
    ['prop-expression', 'The value of disabled on Name', '!busy'],
  ]);
});

test('edit: for every fragment, the planned file differs from the original only inside that range; planning writes nothing', () => {
  const dir = copy();
  write(dir, CARD, RICH);
  const list = listFragments(dir, CARD);
  for (const f of list.fragments) {
    const code = f.kind === 'handler' ? '() => undefined' : f.kind === 'style' ? "'plain'" : 'count === 1';
    const change = planSetFragment(dir, { file: CARD, fragmentId: f.id, code, contentHash: list.contentHash });
    assertStagedChange(change);
    const out = change.files[0].content;
    assert.equal(change.files.length, 1);
    assert.equal(out.slice(0, f.range.start), RICH.slice(0, f.range.start), `${f.id}: bytes before the range`);
    assert.equal(out.slice(out.length - (RICH.length - f.range.end)), RICH.slice(f.range.end), `${f.id}: bytes after the range`);
    assert.equal(out.slice(f.range.start, out.length - (RICH.length - f.range.end)), code, `${f.id}: the range holds the new code`);
  }
  assert.equal(read(dir, CARD), RICH, 'nothing was written by planning');
});

test('edit: applying through the writer lands only that range, and the list then shows the new code', () => {
  const dir = copy();
  const before = read(dir, ORDERS);
  const list = listFragments(dir, ORDERS);
  const f = list.fragments[0];
  const code = "() => console.log('All orders')";
  const result = applyChange(dir, planSetFragment(dir, { file: ORDERS, fragmentId: f.id, code, contentHash: list.contentHash }));
  assertApplyResult(result);
  assert.equal(result.ok, true, result.sentence);
  assert.equal(result.sentence, 'Saved. Changes the code for "What happens when Orders asks for more" in OrdersPage.');
  assert.equal(read(dir, ORDERS), before.slice(0, f.range.start) + code + before.slice(f.range.end));
  assert.equal(listFragments(dir, ORDERS).fragments[0].code, code);
});

test('edit: a condition that would change precedence is wrapped in brackets so it stays the same condition', () => {
  const frags = fragmentsOf(RICH, CARD);
  const dir = copy();
  write(dir, CARD, RICH);
  const cond = frags.find((f) => f.label === 'When Save shows');
  const change = planSetFragment(dir, { file: CARD, fragmentId: cond.id, code: 'count > 1 || busy', contentHash: frags[0].contentHash });
  assert.match(change.files[0].content, /\{\(count > 1 \|\| busy\) && <button/);
});

test('stale: a file that changed since the code was opened is refused with STALE and nothing is written', () => {
  const dir = copy();
  const list = listFragments(dir, ORDERS);
  write(dir, ORDERS, read(dir, ORDERS).replace('title="Orders"', 'title="Orders!"'));
  assert.throws(() => planSetFragment(dir, { file: ORDERS, fragmentId: list.fragments[0].id, code: '() => undefined', contentHash: list.contentHash }), refused('STALE'));
  assert.throws(() => planSetFragment(dir, { file: ORDERS, fragmentId: list.fragments[0].id, code: '() => undefined' }), refused('STALE'));
});

test('parse: code that is not one expression, or would break out of its place, is refused in one sentence with the parser message under detail', () => {
  const dir = copy();
  const list = listFragments(dir, ORDERS);
  const id = list.fragments[0].id;
  const plan = (code) => planSetFragment(dir, { file: ORDERS, fragmentId: id, code, contentHash: list.contentHash });
  for (const bad of ['() => {', 'a}, title={b', 'a; b', 'const x = 1']) {
    assert.throws(() => plan(bad), (e) => refused('BAD_CODE')(e) && typeof e.detail === 'string' && e.detail.length > 0, bad);
  }
  assert.throws(() => plan('   '), refused('BAD_CODE'));
  assert.throws(() => plan(list.fragments[0].code), refused('NO_CHANGE'));
  assert.throws(() => planSetFragment(dir, { file: ORDERS, fragmentId: 'handler:n9:onNope', code: '1', contentHash: list.contentHash }), refused('UNKNOWN_ITEM'));
});

test('files: only code files inside the library or features can be listed or edited', () => {
  const dir = copy();
  for (const file of ['../etc/passwd', '/etc/passwd', 'architecture.yml', 'features/orders/spec.md', 'features/orders/pages/Nope.tsx', 'README.md']) {
    assert.throws(() => listFragments(dir, file), refused('UNKNOWN_ITEM'), file);
  }
  assert.ok(listFragments(dir, 'library/pages/ListPage.tsx').fragments.some((f) => f.label === 'What happens when Show more is clicked'));
});

test('LINE-DIR: a handler that would import another feature is refused by the writer gate, and the file is untouched', () => {
  const dir = copy();
  const before = read(dir, ORDERS);
  const list = listFragments(dir, ORDERS);
  const change = planSetFragment(dir, { file: ORDERS, fragmentId: list.fragments[0].id, code: "() => import('../../billing/pages/InvoicesPage')", contentHash: list.contentHash });
  const result = applyChange(dir, change);
  assertApplyResult(result);
  assert.equal(result.ok, false);
  assert.match(result.sentence, /^Nothing was saved: /);
  assert.ok(result.findings.some((f) => f.rule === 'LINE-DIR' && f.file === ORDERS), JSON.stringify(result.findings));
  assert.equal(read(dir, ORDERS), before);
});

test('types: with a tsconfig, code that adds a type error is refused in a sentence with the TypeScript message under detail; a fitting edit passes', () => {
  const dir = copy();
  write(dir, 'tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, jsx: 'preserve', noEmit: true, module: 'esnext', moduleResolution: 'bundler', target: 'es2022' } }));
  const list = listFragments(dir, ORDERS);
  const id = list.fragments[0].id;
  const t0 = Date.now();
  assert.throws(
    () => planSetFragment(dir, { file: ORDERS, fragmentId: id, code: '42', contentHash: list.contentHash }),
    (e) => refused('TYPE_ERROR')(e) && /TS2322/.test(e.detail) && /not assignable/.test(e.detail),
  );
  const ms = Date.now() - t0;
  const ok = planSetFragment(dir, { file: ORDERS, fragmentId: id, code: '() => undefined', contentHash: list.contentHash });
  assert.equal(ok.typeCheck?.slow, false);
  assert.ok(ms < 3000, `type check took ${ms} ms (budget 3000)`);
  // No tsconfig: no type check at all.
  assert.equal(planSetFragment(copy(), { file: ORDERS, fragmentId: id, code: '42', contentHash: list.contentHash }).typeCheck, undefined);
});
