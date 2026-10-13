// #945 -- the Smith plan check, owner rule "logic exact, pages per element", on the hardened Smith (atomic-codemod
// smith-hardening, which reads TS/TSX as written). A page passes when every element its plan names has its sentence
// (an extra element is fine) and a missing one is named; a logic unit must match exactly in canonical mode (an
// equivalent form passes, a swapped branch fails). The same check answers construct-mcp's line_smith_check.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HARDENED = path.join(os.homedir(), 'Repositories', 'atomic-codemod-hardening');
if (!process.env.ATOMIC_CODEMOD_SOURCE_DIR && fs.existsSync(HARDENED)) {
  process.env.ATOMIC_CODEMOD_SOURCE_DIR = HARDENED;
  process.env.LINE_LINKS_ALLOW_DRIFT = '1';
}
const { smithElements, smithReady, smithIndexFile } = await import('../packages/engine/lsp/smith.mjs');
const { smithCheck } = await import('../packages/engine/line/lsp/smithCheck.mjs');
const { lspSmithCheck } = await import('../packages/engine/line/lsp/tools.mjs');

const BOOK_PAGE = `type Book = { id: string; title: string; author: string };
declare function add(id: string): void;
export function BookPage({ book }: { book: Book }) {
  return (
    <div>
      <h2>{book.title}</h2>
      <p>{book.author}</p>
      <button onClick={() => add(book.id)}>Add to picks</button>
    </div>
  );
}
`;
const hardened = smithReady() && (await smithElements('export function P() {\n  return <h2>x</h2>;\n}\n')) !== null;
const needHardened = hardened ? {} : { skip: 'the hardened Smith is not linked (set ATOMIC_CODEMOD_SOURCE_DIR to atomic-codemod smith-hardening and LINE_LINKS_ALLOW_DRIFT=1)' };
const PAGE_PLAN = ['<h2> containing book title', '<p> containing book author', "<button> with onClick as add of book id containing 'Add to picks'"];
const REL = 'features/book/pages/BookPage.tsx';

test('page: one sentence per JSX element, from the chips (an element\'s own tag, attributes and content)', needHardened, async () => {
  const els = await smithElements(BOOK_PAGE.slice(BOOK_PAGE.indexOf('export')));
  assert.deepEqual(els.map((e) => [e.tag, e.sentence]), [['<div>', '<div>'], ['<h2>', '<h2> containing book title'], ['<p>', '<p> containing book author'], ['<button>', "<button> with onClick as add of book id containing 'Add to picks'"]]);
  const idx = await smithIndexFile(REL, BOOK_PAGE);
  assert.equal(idx[0].elements.length, 4);
});

test('BookPage: a correct fill with an extra <h1> passes; a fill missing a planned element fails and names it', needHardened, async () => {
  const extra = BOOK_PAGE.replace('    <div>\n', '    <div>\n      <h1>Books</h1>\n');
  const ok = await smithCheck(REL, extra, 'BookPage', PAGE_PLAN);
  assert.deepEqual([ok.mode, ok.pass, ok.missing], ['elements', true, []]);
  const missing = await smithCheck(REL, BOOK_PAGE.replace('      <p>{book.author}</p>\n', ''), 'BookPage', PAGE_PLAN);
  assert.deepEqual([missing.pass, missing.missing.map((m) => m.element)], [false, ['<p>']]);
  assert.match(missing.sentence, /BookPage is missing <p> \("<p> containing book author"\)/);
  const viaTool = await lspSmithCheck('/nowhere', { file: REL, fn: 'BookPage', plan: PAGE_PLAN, text: extra });
  assert.equal(viaTool.pass, true, 'line_smith_check applies the same rule');
});

test('logic: exact in canonical mode; an equivalent form passes, a swapped branch fails', needHardened, async () => {
  const REL_L = 'features/book/domains/label.ts';
  const ifElse = "export function label(available: boolean): string {\n  if (available) { return 'Available'; } else { return 'On loan'; }\n}\n";
  const plan = (await smithIndexFile(REL_L, ifElse, { canonical: true }))[0].sentences;
  assert.deepEqual(plan, ["If available, return 'Available'.", "It returns 'On loan'."]);
  const ternary = "export function label(available: boolean): string {\n  return available ? 'Available' : 'On loan';\n}\n";
  const eq = await smithCheck(REL_L, ternary, 'label', plan);
  assert.deepEqual([eq.mode, eq.pass], ['exact', true]);
  const swapped = await smithCheck(REL_L, ternary.replace("'Available' : 'On loan'", "'On loan' : 'Available'"), 'label', plan);
  assert.equal(swapped.pass, false);
  assert.deepEqual(swapped.missing.map((m) => m.sentence), ["if available, return 'available'", "it returns 'on loan'"]);
});

test('without the per-element reading, a page is skipped with why, never failed', async () => {
  const r = await smithCheck(REL, BOOK_PAGE, 'BookPage', PAGE_PLAN, { ready: () => true });
  if (hardened) assert.equal(r.pass, true);
  else assert.match(r.skipped ?? '', /per element|not linked/);
});
