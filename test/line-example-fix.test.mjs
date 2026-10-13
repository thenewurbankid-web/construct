// #932 (c): TYPE_ERROR refusals show the offending line corrected ("Example fix for line N: <code>"), from a small table
// keyed by TS code + message pattern; unknown codes keep the refusal as it was. Replay: lending-qwen-7b-r1 turn 8 sent
// PicksPage with `JSON.parse(localStorage.getItem('picks'))` (TS2345 string | null) and got only "<the whole file, fixed
// where the error points>" 7 times; re-rendered now, the refusal and its repeat-stop carry the corrected line.
import test from 'node:test';
process.env.LINE_TYPE_GATE_BUDGET_MS ??= '60000';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { exampleFix, exampleFixLines, parseTypeDetail, EXAMPLE_FIX_RULES } from '../packages/engine/line/context/exampleFix.mjs';
import { escalate } from '../packages/engine/line/repeatGuard.mjs';
import { createLineProject } from '../packages/engine/line/newProject.mjs';
import { createPlanCli } from '../bench/ecommerce/driver/plan-cli.mjs';

const fx = (code, message, src, o = {}) => exampleFix({ code, message, line: 7 }, { src, ...o })?.code ?? null;

test('TS2345 string | null argument -> ?? <default> (a JSON string inside JSON.parse)', () => {
  assert.equal(fx('TS2345', "Argument of type 'string | null' is not assignable to parameter of type 'string'.", " const pickedBooks = JSON.parse(localStorage.getItem('picks')) || [];"),
    "const pickedBooks = JSON.parse(localStorage.getItem('picks') ?? '[]') || [];");
  assert.equal(fx('TS2345', "Argument of type 'string | null' is not assignable to parameter of type 'string'.", "setQuery(params.get('q'));"), "setQuery(params.get('q') ?? '');");
  assert.equal(fx('TS2345', "Argument of type 'number | undefined' is not assignable to parameter of type 'number'.", 'total(prices.find((p) => p > 3));'), 'total(prices.find((p) => p > 3) ?? 0);');
  assert.equal(fx('TS2345', "Argument of type 'string' is not assignable to parameter of type 'number'.", "f(localStorage.getItem('x'));"), null, 'not a nullable argument: no example');
});

test('TS18047 / TS18048 / TS2532 possibly null or undefined -> optional chaining', () => {
  assert.equal(fx('TS18048', "'item' is possibly 'undefined'.", '  return <DetailPage title={item.title} />;'), 'return <DetailPage title={item?.title} />;');
  assert.equal(fx('TS18047', "'el' is possibly 'null'.", 'el.focus();'), 'el?.focus();');
  assert.equal(fx('TS18048', "'list' is possibly 'undefined'.", 'const first = list[0];'), 'const first = list?.[0];');
  assert.equal(fx('TS2532', "Object is possibly 'undefined'.", 'const t = books.find((b) => b.id === id).title;'), 'const t = books.find((b) => b.id === id)?.title;');
});

test('TS2322 simple literal mismatches: quoted number, number for a string, a near member of a literal union', () => {
  assert.equal(fx('TS2322', "Type 'string' is not assignable to type 'number'.", '<Pager page="1" />'), '<Pager page={1} />');
  assert.equal(fx('TS2322', "Type 'string' is not assignable to type 'number'.", "const n: number = '3';"), 'const n: number = 3;');
  assert.equal(fx('TS2322', "Type 'number' is not assignable to type 'string'.", '<Card title={2021} />'), '<Card title="2021" />');
  assert.equal(fx('TS2322', "Type 'number' is not assignable to type 'string'.", '<Card title={book.year} />'), '<Card title={String(book.year)} />');
  assert.equal(fx('TS2322', 'Type \'"Titel"\' is not assignable to type \'"Title" | "Year"\'.', "const sort: Sort = 'Titel';"), "const sort: Sort = 'Title';");
  assert.equal(fx('TS2322', "Type 'Book[]' is not assignable to type 'Loan[]'.", 'const x: Loan[] = books;'), null, 'not a simple literal: no example');
});

test('TS2307 module not found -> the nearest existing path, relative to the file', () => {
  const files = ['library/pages/ListPage.tsx', 'library/fixtures/books.json', 'features/picks/pages/PicksPage.tsx'];
  const file = 'features/picks/pages/PicksPage.tsx';
  assert.equal(fx('TS2307', "Cannot find module '../../library/pages/ListPage' or its corresponding type declarations.", "import { ListPage } from '../../library/pages/ListPage';", { file, files }),
    "import { ListPage } from '../../../library/pages/ListPage';");
  assert.equal(fx('TS2307', "Cannot find module '../../../library/fixtures/book.json' or its corresponding type declarations.", "import books from '../../../library/fixtures/book.json';", { file, files }),
    "import books from '../../../library/fixtures/books.json';");
});

test('unknown codes and unreadable lines: no example (the refusal stays as it was)', () => {
  assert.equal(EXAMPLE_FIX_RULES.TS9999, undefined);
  assert.equal(exampleFix({ code: 'TS2339', message: "Property 'x' does not exist on type 'Y'.", line: 1 }, { src: 'y.x;' }), null);
  assert.equal(exampleFix({ code: 'TS2345', message: "Argument of type 'string | null' is not assignable to parameter of type 'string'.", line: 1 }, { src: '' }), null);
  const detail = "features/a.tsx:3 TS2345 Argument of type 'string | null' is not assignable to parameter of type 'string'.\n  Type 'null' is not assignable to type 'string'.\nfeatures/a.tsx:9 TS2339 Property 'x' does not exist.";
  assert.deepEqual(parseTypeDetail(detail).map((e) => [e.line, e.code]), [[3, 'TS2345'], [9, 'TS2339']]);
  const got = exampleFixLines(detail, { sourceOf: () => "a\nb\nuse(localStorage.getItem('k'));\n" });
  assert.deepEqual(got.text, ["Example fix for line 3: use(localStorage.getItem('k') ?? '');"]);
});

test('the repeat-stop shows the example fix instead of only "change the request"', () => {
  const r = { ok: false, code: 'TYPE_ERROR', sentence: 's', text: 'Refused (TYPE_ERROR): ...', hint: { exampleFixes: ["Example fix for line 7: const a = f(x ?? '');"], example: null } };
  const out = escalate(r, { tool: 'line.setCode', args: { file: 'a.tsx', code: 'x' } }, 3);
  const first = out.text.split('\n')[0];
  assert.match(first, /^Stop: this exact call was already refused 3 times/);
  assert.match(first, /Do not send it again unchanged\. Change the code where the error points, then send the whole file again\. Example fix for line 7: const a = f\(x \?\? ''\);$/);
  const plain = escalate({ ...r, hint: { example: null } }, { tool: 'line.setCode', args: { file: 'a.tsx', code: 'x' } }, 3);
  assert.match(plain.text.split('\n')[0], /change the request \(another page, tool or feature\)/, 'no example: unchanged');
});

// lending-qwen-7b-r1: library/pages/ListPage.tsx and the code turn 8 sent (logs/turn-input/16.json).
const PICKS = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/builder-context/lending-picks.json'), 'utf8'));
const LENDING_LIST_PAGE = PICKS.listPage;
const TURN8_CODE = PICKS.turn8Code;

test('replay lending-r1 turn 8/12: the PicksPage TYPE_ERROR refusal carries the example fix, the repeat-stop too', async () => {
  const parent = fs.realpathSync(makeTempDir('line-example-fix-'));
  try {
    const r0 = createLineProject(parent, { name: 'lending', firstFeature: 'picks' });
    assert.equal(r0.ok, true, r0.sentence);
    const root = /** @type {string} */ (r0.dir);
    fs.writeFileSync(path.join(root, 'library/pages/ListPage.tsx'), LENDING_LIST_PAGE);
    // The run's tsconfig (strict, dom), without React's types: JSX needs no JSX namespace with noImplicitAny off.
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noImplicitAny: false, lib: ['dom', 'esnext'], jsx: 'preserve', module: 'esnext', moduleResolution: 'bundler', target: 'es2020', noEmit: true, skipLibCheck: true, types: [] } }));
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    const cli = createPlanCli({ project: root, log: path.join(parent, 'logs', 'calls.jsonl'), builder: 'test', shadowJev: false });
    const base = await cli.run('add', ['line.baseOn', JSON.stringify({ libraryId: 'pages/ListPage', feature: 'picks', name: 'PicksPage' })], { why: 'The picks page.' });
    assert.equal(base.ok, true, base.sentence);
    const ran = await cli.run('run-next');
    assert.equal(ran.ok, true, ran.sentence);
    const file = 'features/picks/pages/PicksPage.tsx';
    const read = await cli.run('read', [file]);
    const send = () => cli.run('add', ['line.setCode', JSON.stringify({ file, code: TURN8_CODE, contentHash: read.contentHash })], { why: 'Fill PCK-1.' });
    const first = await send();
    assert.equal(first.code, 'TYPE_ERROR', first.sentence);
    assert.match(first.sentence, /TS2345/);
    assert.ok(first.sentence.includes("Example fix for line 7: const pickedBooks = JSON.parse(localStorage.getItem('picks') ?? '[]') || [];"), first.sentence);
    await send();
    const third = await send();
    const stop = third.sentence.split('\n')[0];
    assert.match(stop, /^Stop: this exact call was already refused 3 times with TYPE_ERROR/);
    assert.ok(stop.includes("Example fix for line 7: const pickedBooks = JSON.parse(localStorage.getItem('picks') ?? '[]') || [];"), stop);
    console.log(`re-rendered PicksPage refusal:\n${first.sentence.split('\n').filter((l) => !l.startsWith(' ')).join('\n')}`);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});
