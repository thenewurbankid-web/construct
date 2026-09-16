import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  listFeatures,
  listPages,
  resolvePageFile,
  serializeTree,
  getNodeSnippet,
  patchNode,
  getNodeProps,
  buildAttributeSnippet,
  findUnmappedProps,
  applyAutoMap,
  checkEnforcement,
  hashOf,
  PagesEditorError,
} from './pagesEditor.mjs';

const SOURCE = `import React from 'react';
import { Card } from '../components/Card.jsx';

export function Home({ title, count }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="home">
      <h1>{title}</h1>
      <Card>
        <p>Count: {count}</p>
        <button onClick={() => setOpen(!open)}>Toggle</button>
      </Card>
    </div>
  );
}
`;

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-pages-editor-'));
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'version: 1\npreset: strict-nextjs\nfeatures:\n  root: features\n');
  fs.mkdirSync(path.join(root, 'features/demo/pages'), { recursive: true });
  fs.mkdirSync(path.join(root, 'features/demo/components'), { recursive: true });
  fs.writeFileSync(path.join(root, 'features/demo/pages/Home.jsx'), SOURCE);
  fs.writeFileSync(
    path.join(root, 'features/demo/components/Card.jsx'),
    'export function Card({ children }) {\n  return <div className="card">{children}</div>;\n}\n',
  );
  return root;
}

test('listFeatures / listPages find the fixture feature and page', () => {
  const root = makeFixture();
  assert.deepEqual(listFeatures(root), ['demo']);
  assert.deepEqual(listPages(root, 'demo'), ['Home.jsx']);
});

test('resolvePageFile rejects path traversal out of pages/', () => {
  const root = makeFixture();
  const { relPath } = resolvePageFile(root, 'demo', 'Home.jsx');
  assert.equal(relPath, 'features/demo/pages/Home.jsx');
  assert.throws(() => resolvePageFile(root, 'demo', '../../../etc/passwd'), PagesEditorError);
  assert.throws(() => resolvePageFile(root, 'demo', '../components/Card.jsx'), PagesEditorError);
  assert.throws(() => resolvePageFile(root, '../escape', 'Home.jsx'), PagesEditorError);
});

test('serializeTree produces the expected element hierarchy (#50)', () => {
  const { roots, contentHash } = serializeTree(SOURCE);
  assert.equal(contentHash, hashOf(SOURCE));
  assert.equal(roots.length, 1);
  const div = roots[0];
  assert.equal(div.tag, 'div');
  assert.equal(div.isCustomComponent, false);
  // div > h1, Card (p/button are inside Card, nested one level deeper)
  assert.equal(div.children.length, 2);
  const [h1, card] = div.children;
  assert.equal(h1.tag, 'h1');
  assert.equal(card.tag, 'Card');
  assert.equal(card.isCustomComponent, true);
  assert.equal(card.children.map((c) => c.tag).join(','), 'p,button');
});

test('getNodeSnippet returns exactly one node\'s JSX, not the whole file (#52)', () => {
  const { roots } = serializeTree(SOURCE);
  const cardId = roots[0].children[1].id;
  const { snippet } = getNodeSnippet(SOURCE, cardId);
  assert.ok(snippet.startsWith('<Card>'));
  assert.ok(snippet.trim().endsWith('</Card>'));
  assert.ok(!snippet.includes('import React'));
});

test('patchNode splices only the target node, leaving the rest of the file untouched (#52)', () => {
  const { roots, contentHash } = serializeTree(SOURCE);
  const h1Id = roots[0].children[0].id;
  const patched = patchNode(SOURCE, h1Id, '<h1>{title}!!!</h1>', contentHash);
  assert.ok(patched.includes('<h1>{title} !!!'.replace(' !!!', '!!!'))); // sanity: new text present
  assert.ok(patched.includes("import { Card } from '../components/Card.jsx';")); // untouched
  assert.equal(patched.split('\n').length, SOURCE.split('\n').length); // same line count, single-line edit
});

test('patchNode rejects a stale contentHash (optimistic concurrency)', () => {
  const { roots } = serializeTree(SOURCE);
  const h1Id = roots[0].children[0].id;
  assert.throws(() => patchNode(SOURCE, h1Id, '<h1>x</h1>', 'not-the-real-hash'), PagesEditorError);
});

test('patchNode rejects a replacement that is not valid JSX', () => {
  const { roots, contentHash } = serializeTree(SOURCE);
  const h1Id = roots[0].children[0].id;
  assert.throws(() => patchNode(SOURCE, h1Id, 'this is not jsx {{{', contentHash), PagesEditorError);
});

test('getNodeProps + buildAttributeSnippet + patchNode round-trip a prop edit (#53)', () => {
  const { roots, contentHash } = serializeTree(SOURCE);
  const buttonId = roots[0].children[1].children[1].id; // Card > button
  const props = getNodeProps(SOURCE, buttonId);
  assert.equal(props.props[0].name, 'onClick');
  assert.ok(props.scopeNames.includes('title'));
  assert.ok(props.scopeNames.includes('count'));
  assert.ok(props.scopeNames.includes('open'));

  const snippet = buildAttributeSnippet(SOURCE, buttonId, 'disabled', 'boolean', true);
  const patched = patchNode(SOURCE, buttonId, snippet, contentHash);
  // New attributes are appended at the end of the tag's attribute list.
  assert.match(patched, /<button onClick=\{[^}]*\} disabled>/);
});

test('findUnmappedProps flags parent scope names not passed to a child component (#54)', () => {
  const { roots } = serializeTree(SOURCE);
  const cardId = roots[0].children[1].id;
  const { candidates } = findUnmappedProps(SOURCE, cardId);
  // Includes both the useState value and its setter — a setter is a
  // perfectly normal thing to drill down as a callback prop too (e.g.
  // `onToggle={setOpen}`); see #54's decision-point comment on the issue.
  assert.deepEqual([...candidates].sort(), ['count', 'open', 'setOpen', 'title']);
});

test('applyAutoMap wires the chosen props onto the child as shorthand attributes (#54)', () => {
  const { roots } = serializeTree(SOURCE);
  const cardId = roots[0].children[1].id;
  const patched = applyAutoMap(SOURCE, cardId, ['title', 'count']);
  // Each new attribute is inserted at the end of the tag's attribute list
  // (not re-derived positionally each time), so requesting title then
  // count lands them in that same requested order.
  assert.match(patched, /<Card title=\{title\} count=\{count\}>/);
  assert.ok(patched.includes("import { Card } from '../components/Card.jsx';"));
});

test('checkEnforcement flags a PAGE-004 violation (fetch()) and leaves the file untouched on rejection (#56)', () => {
  const root = makeFixture();
  const relPath = 'features/demo/pages/Home.jsx';
  const badSource = SOURCE.replace('const [open, setOpen] = React.useState(false);', 'fetch("/api/x");');
  const result = checkEnforcement(root, relPath, badSource);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((v) => v.rule === 'PAGE-004'));
  // the temp write/revert inside checkEnforcement must leave the real file exactly as it was
  assert.equal(fs.readFileSync(path.join(root, relPath), 'utf8'), SOURCE);
});

test('checkEnforcement allows a clean structural/prop edit through (#56)', () => {
  const root = makeFixture();
  const relPath = 'features/demo/pages/Home.jsx';
  const okSource = SOURCE.replace('<h1>{title}</h1>', '<h1>{title} (v2)</h1>');
  const result = checkEnforcement(root, relPath, okSource);
  assert.equal(result.ok, true);
});
