import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEnglish, commands } from './english.mjs';

const fixture = fileURLToPath(new URL('./fixtures/three.js', import.meta.url));

function run(args) {
  let out = '';
  let err = '';
  const code = runEnglish(args, {
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}

test('text output: one `name: english` line per top-level function, non-functions skipped', () => {
  const { code, out, err } = run([fixture]);
  assert.equal(code, 0);
  assert.equal(err, '');
  const lines = out.trimEnd().split('\n');
  assert.deepEqual(lines.map((l) => l.split(':')[0]), ['add', 'double', 'clamp']);
  assert.equal(lines[0], 'add: add using a and b: return a + b.');
  assert.equal(lines[1], 'double: double using x: return x * 2.');
  assert.match(lines[2], /^clamp: clamp using v and min and max: if v is less than min, return min;/);
});

test('--json output: [{name, line, english}]', () => {
  const { code, out } = run([fixture, '--json']);
  assert.equal(code, 0);
  const view = JSON.parse(out);
  assert.deepEqual(view.map(({ name, line }) => ({ name, line })), [
    { name: 'add', line: 2 },
    { name: 'double', line: 6 },
    { name: 'clamp', line: 8 },
  ]);
  for (const v of view) assert.deepEqual(Object.keys(v), ['name', 'line', 'english']);
  assert.equal(view[1].english, 'double using x: return x * 2.');
});

test('missing file: one sentence on stderr, exit 1', () => {
  const { code, out, err } = run(['/no/such/file.js']);
  assert.equal(code, 1);
  assert.equal(out, '');
  assert.equal(err, 'Cannot read /no/such/file.js.\n');
});

test('parse error: one sentence on stderr, exit 1', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'english-')), 'broken.js');
  writeFileSync(file, 'function oops( {\n');
  const { code, out, err } = run([file]);
  assert.equal(code, 1);
  assert.equal(out, '');
  assert.match(err, /^Cannot parse .*broken\.js at line \d+\.\n$/);
});

test('registered through construct.commands in package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.construct.commands, './cli/english.mjs');
  assert.equal(commands.length, 1);
  assert.equal(commands[0].name, 'english');
  assert.equal(typeof commands[0].handler, 'function');
});
