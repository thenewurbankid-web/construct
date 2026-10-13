// #932 (b): the per-file context pack. lending-qwen-7b-r1 wrote features/picks/pages/PicksPage.tsx blind: never its
// current code, nor library/pages/ListPage's props (it passed only `title`), nor a page that landed. A refusal or an
// open-work item that targets a file now carries: the current code + contentHash, the @line-base item's props, the spec
// points the file covers, and one landed example of the same kind (or the library item itself). Code blocks render
// through one pluggable function (representation 'code' by default; 'english' once the context probe picks it).
import test from 'node:test';
process.env.LINE_TYPE_GATE_BUDGET_MS ??= '60000';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createLineProject } from '../packages/engine/line/newProject.mjs';
import { hashOf } from '../packages/engine/pagesEditor.mjs';
import { contextPack, packText, packTarget, propsOf, renderCodeBlock, registerRepresentation, representationOf, PACK_CAP } from '../packages/engine/line/contextPack.mjs';
import { createPlanCli } from '../bench/ecommerce/driver/plan-cli.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PICKS = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/builder-context/lending-picks.json'), 'utf8'));
const FILE = 'features/picks/pages/PicksPage.tsx';
const SEEDED = "// @line-base pages/ListPage\n// @line-route /picks\nimport { ListPage } from '../../../library/pages/ListPage';\n\nexport function PicksPage() {\n  return <ListPage title=\"Picks\" />;\n}\n";
const LANDED_BOOK = "// @line-base pages/DetailPage\n// @line-route /books/:id\nimport { DetailPage } from '../../../library/pages/DetailPage';\nimport books from '../../../library/fixtures/books.json';\n\nexport function BookPage({ params }: { params: { id: string } }) {\n  const item = books.find((b) => b.id === params.id);\n  return (\n    <DetailPage title={item?.title ?? 'Book not found'}>\n      <p>{item?.author}</p>\n    </DetailPage>\n  );\n}\n";

/** The lending project as r1 had it after the seed: ListPage, picks' spec.md, the seeded PicksPage. */
function lending() {
  const parent = fs.realpathSync(makeTempDir('line-context-pack-'));
  const r = createLineProject(parent, { name: 'lending', firstFeature: 'picks' });
  assert.equal(r.ok, true, r.sentence);
  const root = /** @type {string} */ (r.dir);
  fs.writeFileSync(path.join(root, 'library/pages/ListPage.tsx'), PICKS.listPage);
  fs.writeFileSync(path.join(root, 'features/picks/spec.md'), PICKS.picksSpec);
  fs.mkdirSync(path.join(root, 'features/picks/pages'), { recursive: true });
  fs.writeFileSync(path.join(root, FILE), SEEDED);
  return { root, parent, done: () => fs.rmSync(parent, { recursive: true, force: true }) };
}

test('packTarget: setCode writes its file, baseOn the page it creates; other tools none', () => {
  assert.equal(packTarget({ tool: 'line.setCode', args: { file: FILE, code: 'x' } }), FILE);
  assert.equal(packTarget({ tool: 'line.baseOn', args: { libraryId: 'pages/ListPage', feature: 'picks', name: 'PicksPage' } }), FILE);
  assert.equal(packTarget({ tool: 'line.setCode', args: { file: 'features/picks/spec.md', code: 'x' } }), null, 'a spec.md is not code');
  assert.equal(packTarget({ tool: 'line.addRoute', args: { route: '/picks', page: FILE } }), null);
});

test('propsOf: the exported <Name>Props type, else the function parameters', () => {
  assert.match(/** @type {string} */ (propsOf(PICKS.listPage, 'ListPage')), /^export type ListPageProps = \{\n {2}title: string;[^]*empty\?: ReactNode;\n\}$/);
  assert.equal(propsOf("export function Button({ label }: { label: string }) {\n  return null;\n}\n", 'Button'), 'export function Button({ label }: { label: string })');
});

test('PicksPage pack: current code + contentHash, ListPage props, the picks points, the library item as the example', () => {
  const { root, done } = lending();
  try {
    const p = contextPack(root, FILE);
    assert.equal(p.code, SEEDED);
    assert.equal(p.contentHash, hashOf(SEEDED));
    assert.equal(p.base?.id, 'pages/ListPage');
    assert.match(p.base?.props ?? '', /children\?: ReactNode/);
    assert.deepEqual(p.points.map((x) => x.id), ['PCK-1', 'PCK-2', 'PCK-3', 'PCK-4', 'PCK-5', 'PCK-6']);
    assert.equal(p.example?.from, 'library', 'no page of the project renders content yet');
    const text = packText(p);
    assert.ok(text.length <= PACK_CAP + 40, `${text.length}`);
    assert.ok(text.startsWith(`Context for ${FILE} (contentHash ${hashOf(SEEDED)}):`), text);
    assert.ok(text.includes('return <ListPage title="Picks" />;'), 'its current code');
    assert.ok(text.includes('export type ListPageProps = {') && text.includes('toolbar?: ReactNode;'), 'ListPage props');
    assert.ok(text.includes('- PCK-1: Every page shows a link whose name starts with "My picks"'), 'its spec points');
    // With a page that landed (renders content), that page is the example and the props are shown on their own.
    fs.mkdirSync(path.join(root, 'features/book/pages'), { recursive: true });
    fs.writeFileSync(path.join(root, 'features/book/pages/BookPage.tsx'), LANDED_BOOK);
    const q = contextPack(root, FILE);
    assert.equal(q.example?.file, 'features/book/pages/BookPage.tsx');
    const t2 = packText(q);
    assert.match(t2, /Its base pages\/ListPage \(library\/pages\/ListPage\.tsx\) takes these props:\nexport type ListPageProps/);
    assert.match(t2, /Example of a page that landed \(features\/book\/pages\/BookPage\.tsx\):\n\/\/ @line-base pages\/DetailPage/);
    // A new file (baseOn): no current code, no contentHash.
    const n = contextPack(root, 'features/picks/pages/NewPage.tsx', { libraryId: 'pages/ListPage' });
    assert.equal(n.exists, false);
    assert.match(packText(n), /^Context for features\/picks\/pages\/NewPage\.tsx \(a new file: leave contentHash out\):/);
  } finally { done(); }
});

test('representation: code by default; a registered one (english) renders each code block; unknown falls back to code', () => {
  const prev = process.env.LINE_CONTEXT_REPRESENTATION;
  try {
    delete process.env.LINE_CONTEXT_REPRESENTATION;
    assert.equal(representationOf(undefined), 'code');
    assert.equal(renderCodeBlock('const a = 1;'), 'const a = 1;');
    assert.equal(renderCodeBlock('const a = 1;', { representation: 'english' }), 'const a = 1;', 'english not plugged in yet: the code');
    registerRepresentation('english', (code) => `In English: ${code.split('\n').length} line(s).`);
    assert.equal(renderCodeBlock('const a = 1;', { representation: 'english' }), 'In English: 1 line(s).');
    process.env.LINE_CONTEXT_REPRESENTATION = 'english';
    assert.equal(representationOf(undefined), 'english');
    assert.equal(renderCodeBlock('x'), 'In English: 1 line(s).');
    assert.equal(renderCodeBlock('x', { representation: 'code' }), 'x', 'the option wins over the env');
    process.env.LINE_CONTEXT_REPRESENTATION = 'nope';
    assert.equal(renderCodeBlock('x'), 'x');
  } finally {
    registerRepresentation('english', () => null);
    if (prev === undefined) delete process.env.LINE_CONTEXT_REPRESENTATION; else process.env.LINE_CONTEXT_REPRESENTATION = prev;
  }
});

test('plan-cli: the PicksPage refusal and the picks open-work card carry the pack', async () => {
  const { root, parent, done } = lending();
  try {
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noImplicitAny: false, lib: ['dom', 'esnext'], jsx: 'preserve', module: 'esnext', moduleResolution: 'bundler', target: 'es2020', noEmit: true, skipLibCheck: true, types: [] } }));
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    // A spec with only picks (the lending SPEC.md's picks section), so picks is the current feature.
    const full = fs.readFileSync(path.join(here, '../bench/lending/SPEC.md'), 'utf8');
    const head = full.slice(0, full.indexOf('\n## As '));
    const picks = full.slice(full.indexOf('\n## As a member, I want a short list'), full.indexOf('\n## As', full.indexOf('\n## As a member, I want a short list') + 5));
    const spec = path.join(parent, 'SPEC.md');
    fs.writeFileSync(spec, `${head}${picks}\n`);
    const cli = createPlanCli({ project: root, log: path.join(parent, 'logs', 'calls.jsonl'), builder: 'test', shadowJev: false, spec });
    const status = await cli.run('status');
    assert.match(status.sentence, /Current feature: picks/);
    assert.ok(status.sentence.includes(`Context for ${FILE}`), status.sentence);
    assert.ok(status.sentence.includes('export type ListPageProps = {'), 'the card shows ListPage props');
    const r = await cli.run('add', ['line.setCode', JSON.stringify({ file: FILE, code: PICKS.turn8Code, contentHash: hashOf(SEEDED) })], { why: 'Fill PCK-1.' });
    assert.equal(r.code, 'TYPE_ERROR', r.sentence);
    assert.ok(r.sentence.includes(`Context for ${FILE} (contentHash ${hashOf(SEEDED)}):`), r.sentence);
    assert.ok(r.sentence.includes('children?: ReactNode;'), 'the refusal shows ListPage props');
    assert.ok(r.sentence.includes('return <ListPage title="Picks" />;'), 'and the current code');
  } finally { done(); }
});
