import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spliceFunction } from '../spliceApplier.mjs';

const FILE = `import { X } from './x';

type Row = { id: string };

export function Page({ id }: { id: string }) {
  return <p>{id}</p>;
}

export function Other() {
  return null;
}
`;
const reply = (code) => `Here you go:\n\`\`\`tsx\n${code}\n\`\`\`\n`;

test('replaces the named function and leaves the rest of the file alone', () => {
  const r = spliceFunction(FILE, reply('export function Page({ id }: { id: string }) {\n  return <p>by {id}</p>;\n}'), 'Page', 'a.tsx');
  assert.equal(r.ok, true);
  assert.match(r.body, /by \{id\}/);
  assert.match(r.body, /type Row = \{ id: string \};/);
  assert.match(r.body, /export function Other\(\)/);
  assert.equal((r.body.match(/function Page/g) || []).length, 1);
});

test('keeps the export when the model drops it, and ignores import lines in the reply', () => {
  const r = spliceFunction(FILE, reply("import { useState } from 'react';\nfunction Page({ id }: { id: string }) {\n  return null;\n}"), 'Page', 'a.tsx');
  assert.equal(r.ok, true);
  assert.match(r.body, /export function Page/);
});

test('rejects a different function as fragment', () => {
  const r = spliceFunction(FILE, reply('export function Other() {\n  return 1;\n}'), 'Page', 'a.tsx');
  assert.equal(r.failClass, 'fragment');
});

test('rejects extra declarations, a whole file and an incomplete function as fragment', () => {
  assert.equal(spliceFunction(FILE, reply('const N = 6;\nexport function Page() {\n  return null;\n}'), 'Page', 'a.tsx').failClass, 'fragment');
  assert.equal(spliceFunction(FILE, reply(FILE), 'Page', 'a.tsx').failClass, 'fragment');
  assert.equal(spliceFunction(FILE, reply('export function Page() {\n  return <p>'), 'Page', 'a.tsx').failClass, 'fragment');
  assert.equal(spliceFunction(FILE, reply('<p>{id}</p>'), 'Page', 'a.tsx').failClass, 'fragment');
});

test('no fence is a format failure', () => {
  assert.equal(spliceFunction(FILE, 'export function Page() {}', 'Page', 'a.tsx').failClass, 'format');
});

test('a function the file does not have yet is appended (stub store)', () => {
  const r = spliceFunction('// store\nexport {};\n', reply('export function listX(): string[] {\n  return [];\n}'), 'listX', 'a.ts');
  assert.equal(r.ok, true);
  assert.equal(r.body, '// store\n\nexport function listX(): string[] {\n  return [];\n}\n');
});
