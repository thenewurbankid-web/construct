// #533 (Slice 3 of #518's design) -- the server-facing glue: buildWrapSuggestion (dry-run
// suggest/preview) and applyWrapConfirm (the real write), both in ui/server/src/pagesEditor.mjs.
// Additive to #527/#532's own paletteInsert.test.mjs -- buildPaletteInsertion is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildPalette } from '../packages/engine/palette.mjs';
import { applyWrapConfirm, buildWrapSuggestion, parsePageTree } from '../ui/server/src/pagesEditor.mjs';
import { createFeature } from '../packages/core/generators.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const PAGE_SOURCE = `export default function CpoHome(props: { items: string[] }) {
  return (
    <div className="home">
      <ul>
        {props.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
`;

function project() {
  const dir = makeTempDir('construct-palette-wrap-confirm-');
  createFeature(dir, 'cpo');
  const pageFile = path.join(dir, 'features', 'cpo', 'pages', 'CpoHome.tsx');
  fs.writeFileSync(pageFile, PAGE_SOURCE);
  return { dir, pageFile };
}

/** The `<li>` node's own id -- the JSX a real Alt+Click/Pick selection would land on inside the
 * flagged `.map()` loop. */
function liNodeId(source) {
  const { roots } = parsePageTree(source);
  let found = null;
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.tag === 'li') found = n;
      walk(n.children);
    }
  };
  walk(roots);
  return found.id;
}

test('buildWrapSuggestion: by default (no preview requested) the name derives but files stays null', () => {
  const { dir, pageFile } = project();
  const source = fs.readFileSync(pageFile, 'utf8');
  const palette = buildPalette(dir, 'cpo');
  const nodeId = liNodeId(source);

  const suggestion = buildWrapSuggestion(dir, pageFile, source, nodeId, palette);
  assert.equal(suggestion.ok, true);
  assert.equal(suggestion.hit.kind, 'loop');
  assert.equal(suggestion.name, 'ItemList');
  assert.equal(suggestion.nameRequired, false);
  assert.equal(suggestion.files, null); // the automatic "you selected something" call never itself previews
});

test('buildWrapSuggestion: includeFiles:true returns a real dry-run preview, and still touches no disk', () => {
  const { dir, pageFile } = project();
  const source = fs.readFileSync(pageFile, 'utf8');
  const palette = buildPalette(dir, 'cpo');
  const nodeId = liNodeId(source);

  const suggestion = buildWrapSuggestion(dir, pageFile, source, nodeId, palette, undefined, { includeFiles: true });
  assert.equal(suggestion.name, 'ItemList');
  assert.ok(suggestion.files);
  const page = suggestion.files.find((f) => f.file === 'features/cpo/pages/CpoHome.tsx');
  assert.match(page.after, /<ItemList items=\{props\.items\} \/>/);
  const expr = suggestion.files.find((f) => f.file === 'features/cpo/expressions/ItemList.tsx');
  assert.equal(expr.before, '');
  assert.match(expr.after, /defineExpression\(/);

  // Nothing touched disk -- this is a dry run all the way through.
  assert.equal(fs.existsSync(path.join(dir, 'features/cpo/expressions/ItemList.tsx')), false);
  assert.equal(fs.readFileSync(pageFile, 'utf8'), source);
});

test('buildWrapSuggestion: an unselected/unflagged node returns hit:null, no suggestions', () => {
  const { dir, pageFile } = project();
  const source = fs.readFileSync(pageFile, 'utf8');
  const palette = buildPalette(dir, 'cpo');
  const { roots } = parsePageTree(source);
  const outerDivId = roots[0].id; // the top-level <div>, not inside the loop
  const suggestion = buildWrapSuggestion(dir, pageFile, source, outerDivId, palette);
  assert.equal(suggestion.hit, null);
  assert.deepEqual(suggestion.suggestions, []);
});

test('buildWrapSuggestion: an overridden name flows straight into the preview', () => {
  const { dir, pageFile } = project();
  const source = fs.readFileSync(pageFile, 'utf8');
  const palette = buildPalette(dir, 'cpo');
  const nodeId = liNodeId(source);
  const suggestion = buildWrapSuggestion(dir, pageFile, source, nodeId, palette, 'CartLineItems', { includeFiles: true });
  assert.equal(suggestion.name, 'CartLineItems');
  assert.match(suggestion.files.find((f) => f.file.endsWith('CartLineItems.tsx')).after, /defineExpression\('CartLineItems'/);
});

test('buildWrapSuggestion: a rejected generic name surfaces nameError, not a thrown exception', () => {
  const { dir, pageFile } = project();
  const source = fs.readFileSync(pageFile, 'utf8');
  const palette = buildPalette(dir, 'cpo');
  const nodeId = liNodeId(source);
  const suggestion = buildWrapSuggestion(dir, pageFile, source, nodeId, palette, 'expr', { includeFiles: true });
  assert.equal(suggestion.files, null);
  assert.match(suggestion.nameError, /generic/);
});

test('applyWrapConfirm: writes the page, the Expression and the hoisted Component for real', () => {
  const { dir, pageFile } = project();
  const source = fs.readFileSync(pageFile, 'utf8');
  const nodeId = liNodeId(source);

  const result = applyWrapConfirm(dir, pageFile, source, nodeId, 'ItemList');
  assert.equal(result.expression.name, 'ItemList');
  assert.equal(fs.existsSync(path.join(dir, result.expression.file)), true);
  assert.equal(fs.existsSync(path.join(dir, result.component.file)), true);
  const pageAfter = fs.readFileSync(pageFile, 'utf8');
  assert.match(pageAfter, /import \{ ItemList \} from '\.\.\/expressions\/ItemList';/);
  assert.doesNotMatch(pageAfter, /\.map\(/);
});

test('applyWrapConfirm: a stale nodeId (no such node) is a clear PagesEditorError, not a crash', () => {
  const { dir, pageFile } = project();
  const source = fs.readFileSync(pageFile, 'utf8');
  assert.throws(() => applyWrapConfirm(dir, pageFile, source, 'not-a-real-node-id', 'ItemList'), /No such node/);
});
