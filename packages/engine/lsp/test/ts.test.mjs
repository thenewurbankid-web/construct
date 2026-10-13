// #943 -- the Line LSP's TypeScript layer on a small fixture (no model, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lsp from '../index.mjs';
import { clearHostCache } from '../host.mjs';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture');
const capped = (o) => { const s = JSON.stringify(o); assert.ok(lsp.approxTokens(s) <= lsp.MAX_TOKENS + 200, `over budget: ${s.length}`); };

test('diagnostics: one line per error, syntactic + semantic, unsaved text via overlay', () => {
  clearHostCache();
  const d = lsp.diagnostics(R, 'src/app/broken.ts');
  assert.equal(d.ok, true);
  assert.equal(d.count, 2);
  assert.match(d.lines[0], /^src\/app\/broken\.ts:5:22 TS2551 /);
  assert.match(d.lines[1], /TS2304 Cannot find name 'shelf'/);
  const s = lsp.diagnostics(R, 'src/app/broken.ts', { text: 'export const x = ;\n' });
  assert.match(s.lines[0], /TS1109/);
  // the overlay is gone afterwards: the file on disk is unchanged and answered again
  assert.equal(lsp.diagnostics(R, 'src/app/broken.ts').count, 2);
  capped(d);
});

test('fixes: combined missing-import fix plus a single-candidate spelling fix, as edits against the original', () => {
  const before = fs.readFileSync(path.join(R, 'src/app/broken.ts'), 'utf8');
  const f = lsp.fixes(R, 'src/app/broken.ts');
  assert.equal(f.ok, true);
  assert.deepEqual(f.applied.map((a) => a.fix), ['fixMissingImport', 'spelling']);
  assert.deepEqual(f.unfixed, []);
  const after = lsp.applyFixEdits(before, f.edits);
  assert.match(after, /import \{ findBook, shelf \} from '\.\.\/lib\/books';/);
  assert.match(after, /book\.pages :/);
  assert.equal(fs.readFileSync(path.join(R, 'src/app/broken.ts'), 'utf8'), before, 'nothing is written');
  assert.equal(lsp.diagnostics(R, 'src/app/broken.ts', { text: after }).count, 0);
  // an import path that does not resolve is re-pointed when exactly one project file ends with it
  const wrong = before.replace("'../lib/books'", "'src/lib/books'");
  const p = lsp.fixes(R, 'src/app/broken.ts', { text: wrong });
  assert.equal(p.applied[0].fix, 'fixImportPath');
  assert.match(lsp.applyFixEdits(wrong, p.edits), /from '\.\.\/lib\/books'/);
  assert.deepEqual(p.unfixed, []);
  assert.deepEqual(lsp.diffEdits('a\nb\nc\n', 'a\nB\nc\n'), [{ start: 2, end: 4, newText: 'B\n' }]);
});

test('completionsAt: members, import names and import paths, with an Ollama format enum', () => {
  const m = lsp.completionsAt(R, 'src/app/view.ts', '/*H*/', { text: "import { findBook } from '../lib/books';\nconst b = findBook('a')!;\nb./*H*/" });
  assert.deepEqual(m.items.map((i) => i.name), ['author', 'id', 'pages', 'title']);
  assert.deepEqual(m.schema.properties.name.enum, ['author', 'id', 'pages', 'title']);
  const n = lsp.completionsAt(R, 'src/app/view.ts', '/*H*/', { text: "import { /*H*/ } from '../lib/books';\n" });
  assert.deepEqual(n.items.map((i) => i.name).sort(), ['Book', 'findBook', 'pageLabel', 'shelf']);
  const p = lsp.completionsAt(R, 'src/app/view.ts', '/*H*/', { text: "import { findBook } from '../lib//*H*/';\n" });
  assert.deepEqual(p.items.map((i) => i.name), ['../lib/books']);
  const g = lsp.completionsAt(R, 'src/app/view.ts', '/*H*/', { text: "import { findBook } from '../lib/books';\nexport const y = fin/*H*/" });
  assert.equal(g.items[0].name, 'findBook');
  assert.ok(g.items.length <= 30);
  capped(g);
});

test('quickInfo and signatureAt: the exact type / signature as a short string', () => {
  const q = lsp.quickInfo(R, 'src/app/view.ts', 'findBook');
  assert.equal(q.type, 'function findBook(id: string): Book | undefined');
  assert.equal(q.file, 'src/lib/books.ts');
  assert.match(lsp.quickInfo(R, 'src/lib/books.ts', 'Book').type, /^type Book = \{ id: string; title: string; author: string; pages: number; \}$/);
  const s = lsp.signatureAt(R, 'src/app/view.ts', { symbol: 'findBook' });
  assert.equal(s.signature, 'findBook(id: string): Book | undefined');
  const m = lsp.signatureAt(R, 'src/lib/books.ts', '/*S*/', { text: `${fs.readFileSync(path.join(R, 'src/lib/books.ts'), 'utf8')}\nexport const z = pageLabel(shelf[0], /*S*/);\n` });
  assert.equal(m.signature, 'pageLabel(book: Book, suffix?: string): string');
  assert.equal(m.argument, 1);
});

test('definition and references: locations with a one-line excerpt, never whole files', () => {
  const d = lsp.definition(R, 'src/app/view.ts', 'findBook');
  assert.deepEqual(d.locations, [{ file: 'src/lib/books.ts', line: 5, text: 'export function findBook(id: string): Book | undefined {' }]);
  const r = lsp.references(R, 'src/lib/books.ts', 'findBook');
  assert.equal(r.locations.length, 4);
  assert.ok(r.locations.every((l) => !l.text.includes('\n') && l.text.length <= 120));
  // a symbol not in the file is found through the project index
  assert.equal(lsp.definition(R, 'src/app/broken.ts', 'pageLabel').locations[0].file, 'src/lib/books.ts');
});

test('a file outside the project is refused, not read', () => {
  const r = lsp.diagnostics(R, '/etc/hosts');
  assert.equal(r.ok, false);
  assert.match(r.reason, /outside the project/);
});
