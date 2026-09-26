import test from 'node:test';
import assert from 'node:assert/strict';
import { componentName, handlerName, serializeToTsx } from './TsxExport.ts';

const node = (resolvedName, props = {}, nodes = [], extra = {}) => ({ type: { resolvedName }, props, nodes, isCanvas: resolvedName === 'Container', linkedNodes: {}, ...extra });

test('a basic tree becomes one default-exported function, one element per node, children in order', () => {
  const tsx = serializeToTsx(
    {
      ROOT: node('Container', { direction: 'column', gap: 12, padding: 24 }, ['h', 't', 'i']),
      h: node('Heading', { text: 'Categories', level: 1 }),
      t: node('Text', { text: 'Pick one' }),
      i: node('Image', { src: '/logo.png', alt: 'Logo' }),
    },
    { name: 'my categories' },
  );
  assert.equal(
    tsx,
    [
      'export default function MyCategories() {',
      '  return (',
      "    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 24 }}>",
      '      <h1>Categories</h1>',
      '      <p>Pick one</p>',
      '      <img src="/logo.png" alt="Logo" />',
      '    </div>',
      '  );',
      '}',
      '',
    ].join('\n'),
  );
});

test('nested containers indent and keep their own direction; hidden nodes and missing ids are left out', () => {
  const tsx = serializeToTsx(
    {
      ROOT: node('Container', {}, ['row', 'gone', 'nope']),
      row: node('Container', { direction: 'row', gap: 4, padding: 0 }, ['a', 'b']),
      a: node('Text', { text: 'A' }),
      b: node('Container', { direction: 'column' }),
      gone: node('Text', { text: 'hidden' }, [], { hidden: true }),
    },
    { name: 'Nested' },
  );
  assert.match(tsx, /^ {4}<div style=\{\{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 \}\}>$/m);
  assert.match(tsx, /^ {6}<div style=\{\{ display: 'flex', flexDirection: 'row', gap: 4, padding: 0 \}\}>$/m);
  assert.match(tsx, /^ {8}<p>A<\/p>$/m);
  assert.match(tsx, /^ {8}<div style=\{\{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 \}\} \/>$/m);
  assert.doesNotMatch(tsx, /hidden/);
});

test('every button gets its own handler named from its label, de-duplicated with a numeric suffix', () => {
  const tsx = serializeToTsx(
    {
      ROOT: node('Container', {}, ['b1', 'b2', 'b3', 'b4']),
      b1: node('Button', { label: 'Add category', variant: 'primary' }),
      b2: node('Button', { label: 'add  category!', variant: 'secondary' }),
      b3: node('Button', { label: 'Delete' }),
      b4: node('Button', { label: '' }),
    },
    { name: 'Categories' },
  );
  assert.match(tsx, /^type CategoriesProps = \{\n {2}onAddCategory: \(\) => void;\n {2}onAddCategory2: \(\) => void;\n {2}onDelete: \(\) => void;\n {2}onButton: \(\) => void;\n\};\n\n/);
  assert.match(tsx, /export default function Categories\(\{ onAddCategory, onAddCategory2, onDelete, onButton \}: CategoriesProps\) \{/);
  assert.match(tsx, /<button type="button" data-variant="primary" onClick=\{onAddCategory\}>Add category<\/button>/);
  assert.match(tsx, /data-variant="secondary" onClick=\{onAddCategory2\}>add {2}category!<\/button>/);
  assert.equal(handlerName('Add category'), 'onAddCategory');
  assert.equal(handlerName('  '), 'onButton');
  assert.equal(componentName('2nd page'), 'Page2ndPage');
});

test('text JSX would misread is emitted as a string expression', () => {
  const tsx = serializeToTsx({ ROOT: node('Container', {}, ['t', 'i']), t: node('Text', { text: 'a {b} <c>' }), i: node('Image', { src: 'x"y', alt: '' }) }, { name: 'X' });
  assert.match(tsx, /<p>\{"a \{b\} <c>"\}<\/p>/);
  assert.match(tsx, /<img src=\{"x\\"y"\} alt="" \/>/);
});

test('same input gives byte-identical output, whatever the key order of the node map', () => {
  const a = { ROOT: node('Container', {}, ['x', 'y']), x: node('Button', { label: 'Go' }), y: node('Heading', { text: 'Hi' }) };
  const b = { y: a.y, x: a.x, ROOT: a.ROOT };
  const first = serializeToTsx(a, { name: 'Demo' });
  assert.equal(serializeToTsx(structuredClone(a), { name: 'Demo' }), first);
  assert.equal(serializeToTsx(b, { name: 'Demo' }), first);
  assert.equal(serializeToTsx({}, { name: 'Empty' }), 'export default function Empty() {\n  return (\n    <div />\n  );\n}\n');
});
