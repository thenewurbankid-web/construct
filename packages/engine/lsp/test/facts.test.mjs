import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attrsOf, buildIndex, compileFacts, plainTypeError, propUses, stableIdOf, stepsShape, FACTS_MAX_TOKENS } from '../facts.mjs';
import { glossFacts, factsMessages } from '../glossFacts.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'facts');
// Smith's sentences (hardened Smith, atomic-codemod cbc2567) for the fixture's functions, after the title.
const SMITH = {
  PicksPage: ["It returns shows a <ListPage> with title as 'Picks'."],
  ListPage: ["It returns shows a <main> with class name as 'flex flex-col gap-4' containing a <h1> with class name as 'text-2xl font-bold' containing title and if toolbar then a <div> with class name as 'flex flex-wrap items-end gap-4' containing toolbar, otherwise nothing and if children then a <div> with class name as 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3' containing children, otherwise empty."],
};
const BOOK = ['Let {id} be params.', "Let item be books find entry's id === id.", "If not (item), return shows a <DetailPage> with title as 'Book not found' and back as back.", "It returns shows a <DetailPage> with title as item's title and back as back containing a <p> containing item's author and a <p> containing item's genre."];
const QUICK = {
  PicksPage: 'function PicksPage(): JSX.Element',
  ListPage: 'function ListPage({ title, toolbar, children, empty }: ListPageProps): JSX.Element',
  ListPageProps: 'type ListPageProps = { title: string; toolbar?: ReactNode; children?: ReactNode; empty?: ReactNode; }',
};
const SCOPE = {
  picks: { declares: { pages: [{ name: 'PicksPage', file: 'features/picks/pages/PicksPage.tsx', base: 'pages/ListPage' }] }, exports: [], imports: { library: [{ id: 'pages/ListPage' }] } },
  browse: { declares: {}, exports: [], imports: { library: [] } },
};
const smith = async (code) => SMITH[/function (\w+)/.exec(code)[1]] ?? [];
const fakes = { smith, quickInfo: (_r, _f, sym) => (QUICK[sym] ? { ok: true, type: QUICK[sym] } : { ok: false }), moduleScope: (_r, f) => SCOPE[f] };
const REFUSAL = { code: 'TYPE_ERROR', repeat: 5, file: 'features/picks/pages/PicksPage.tsx', line: 7, message: "Argument of type 'string | null' is not assignable to parameter of type 'string'.", caret: ">7| const picked = JSON.parse(localStorage.getItem('picks')) || [];", exampleFix: "Example fix for line 7: const picked = JSON.parse(localStorage.getItem('picks') ?? '[]');", contentHash: 'h1' };
const TASK1 = { target: { feature: 'picks', file: 'features/picks/pages/PicksPage.tsx' }, libraryPages: ['ListPage'], fetch: true, step: { kind: 'setCode', file: 'features/picks/pages/PicksPage.tsx', contentHash: 'h1', point: 'PCK-1: Every page shows a link "My picks (N)".' }, refusal: REFUSAL };
const TASK2 = { target: { feature: 'browse' }, libraryPages: ['ListPage'], step: { kind: 'baseOn', feature: 'browse', route: '/', points: ['BRW-1: The page at / lists the books.'] } };

test('stable ids', () => {
  assert.equal(stableIdOf('features/picks/pages/PicksPage.tsx', 'PicksPage'), 'picks/pages/PicksPage');
  assert.equal(stableIdOf('library/pages/ListPage.tsx', 'ListPage'), 'library/pages/ListPage.tsx#ListPage');
});

test('Smith steps read as structure: element, attributes, children, early return, reads', () => {
  assert.deepEqual(attrsOf("title as item's title and back as back"), [['title', '{item.title}'], ['back', '{back}']]);
  assert.deepEqual(attrsOf("class name as 'x'"), [['className', '"x"']]);
  const sh = stepsShape(BOOK);
  assert.equal(sh.renders, '<DetailPage title={item.title} back={back}>');
  assert.deepEqual(sh.inside, ['p', 'p']);
  assert.deepEqual(sh.early, [{ when: 'item is missing', renders: '<DetailPage title="Book not found" back={back}>' }]);
  assert.ok(sh.reads.includes('books'));
  assert.equal(stepsShape(SMITH.PicksPage).renders, '<ListPage title="Picks">');
});

test('where each prop of a library page ends up', () => {
  assert.deepEqual(propUses(SMITH.ListPage, ['title', 'toolbar', 'children', 'empty']), ['title in <h1>', 'toolbar in <div> when given', 'children in a grid <div> when given', 'empty when children is missing']);
  assert.deepEqual(propUses(["It returns shows a <form> with on submit as submit containing a <Button> with type as 'submit' and label as submit label."], ['submitLabel']), ['submitLabel as label of <Button>']);
});

test('a TypeScript error in plain words', () => {
  assert.equal(plainTypeError(REFUSAL.message), 'it passes a value that can be null (string | null) where only a string is allowed');
  assert.equal(plainTypeError("Cannot find module '../x'"), 'it imports ../x, which does not exist');
});

test('buildIndex reads the fixture project (moduleScope, quickInfo, stub check, Smith, library)', async () => {
  const index = await buildIndex(ROOT, fakes);
  assert.deepEqual(index.features.map((f) => [f.name, f.spec, f.kinds]), [['browse', true, []], ['picks', true, ['pages']]]);
  const u = index.units[0];
  assert.equal(u.id, 'picks/pages/PicksPage');
  assert.equal(u.route, '/picks');
  assert.equal(u.signature, QUICK.PicksPage);
  assert.deepEqual(u.steps, SMITH.PicksPage);
  assert.deepEqual(u.stub, []);
  assert.deepEqual(index.library.components, ['Button']);
  assert.equal(index.library.pages[0].props, QUICK.ListPageProps);
  assert.deepEqual(index.library.fixtures, [{ stem: 'books', file: 'library/fixtures/books.json', rows: 2, fields: ['id: string', 'title: string', 'year: number', 'available: boolean'] }]);
});

test('compileFacts: the winning shape, ids and signatures, gaps, exact names, one step, the refusal; no Smith sentence', async () => {
  const index = await buildIndex(ROOT, fakes);
  const c = compileFacts({ ...TASK1, index });
  const t = c.text;
  assert.ok(t.startsWith('Facts so far (each with where it comes from):\n- '));
  assert.match(t, /features\/picks\/pages\/PicksPage\.tsx \(picks\/pages\/PicksPage\) is based on pages\/ListPage, served at \/picks and renders <ListPage title="Picks"> with nothing else\. \[moduleScope; Smith features\/picks\/pages\/PicksPage\.tsx\]/);
  assert.match(t, /browse has no page yet; its spec\.md is there\./);
  assert.match(t, /No feature has usecases, services or domains yet\./);
  assert.match(t, /There is no picks fixture/);
  assert.match(t, /ListPage \(pages\/ListPage\) takes \{title: string, toolbar\?, children\?, empty\?\}: title in <h1>, toolbar in <div> when given, children in a grid <div> when given, empty when children is missing\./);
  assert.match(t, /Use exactly: import \{ ListPage \} from '\.\.\/\.\.\/\.\.\/library\/pages\/ListPage'; import books from '\.\.\/\.\.\/\.\.\/library\/fixtures\/books\.json'\./);
  assert.match(t, /\n\nCurrent step: PCK-1: .* Write it in features\/picks\/pages\/PicksPage\.tsx with plan_add line\.setCode \(the whole file, contentHash h1\)\./);
  assert.match(t, /\n\nLast result: Refused \(TYPE_ERROR, repeated 5 times\): line 7 of features\/picks\/pages\/PicksPage\.tsx does not type-check: it passes a value that can be null/);
  assert.ok(t.includes(REFUSAL.exampleFix));
  assert.ok(t.endsWith('Read a file with read_file when you need its code.'));
  for (const s of [...SMITH.PicksPage, ...SMITH.ListPage]) assert.ok(!t.includes(s.replace(/\.$/, '')), 'a Smith sentence was copied');
  assert.ok(!/works in \d+ step|It returns shows/.test(t));
  assert.ok(c.tokens <= FACTS_MAX_TOKENS);
  const c2 = compileFacts({ ...TASK2, index });
  assert.match(c2.text, /Current step: browse has no page yet \(its spec puts one at \/\)\. Create it with plan_add line\.baseOn \{"libraryId": "pages\/<ListPage>"/);
  assert.ok(!c2.text.includes('Last result'));
  assert.equal(compileFacts({ ...TASK1, index }).text, t, 'deterministic');
});

test('glossFacts: the 1.5b facts in the same shape; an invented name falls back to the compiler', async () => {
  const index = await buildIndex(ROOT, fakes);
  const steps = [{ file: 'features/picks/pages/PicksPage.tsx', id: 'picks/pages/PicksPage', sentences: SMITH.PicksPage }, { file: 'library/pages/ListPage.tsx', sentences: SMITH.ListPage }];
  const good = ['- features/picks/pages/PicksPage.tsx (picks/pages/PicksPage) is based on pages/ListPage at /picks and renders <ListPage title="Picks">. [moduleScope]', '- browse has no page yet. [moduleScope]', '- ListPage takes title: string and toolbar, children, empty. [quickInfo]'].join('\n');
  const calls = [];
  const r = await glossFacts(steps, index, { task: TASK1, chat: async (m, msgs, opts) => { calls.push({ m, msgs, opts }); return `Here you go:\n${good}`; } });
  assert.equal(r.dropped, false, r.reason);
  assert.equal(r.facts.length, 4);
  assert.ok(r.text.startsWith('Facts so far (each with where it comes from):\n- features/picks/pages/PicksPage.tsx'));
  assert.ok(r.text.includes('Current step: PCK-1:') && r.text.includes(REFUSAL.exampleFix));
  assert.equal(calls[0].m, 'qwen2.5-coder:1.5b');
  assert.ok(calls[0].opts.temperature <= 0.2);
  assert.deepEqual(calls[0].msgs, factsMessages(steps, index, TASK1));
  assert.ok(!calls[0].msgs[1].content.includes('export function'), 'no code in the prompt');
  const compiled = compileFacts({ ...TASK1, index }).text;
  const bad = await glossFacts(steps, index, { task: TASK1, chat: async () => `${good}\n- Use usePicks() from the picks hooks. [quickInfo]` });
  assert.equal(bad.dropped, true);
  assert.match(bad.reason, /usePicks/);
  assert.equal(bad.text, compiled);
  const failed = await glossFacts(steps, index, { task: TASK1, chat: async () => { throw new Error('down'); } });
  assert.equal(failed.text, compiled);
  const short = await glossFacts(steps, index, { task: TASK1, chat: async () => '- one fact. [ls]' });
  assert.equal(short.dropped, true);
});
