// R9 types travel along the chain: the compile-time proof. Runs the real `tsc` on the fixtures
// in test/types/every/ and asserts on the diagnostics it actually produces. valid.ts must compile
// clean; each invalid-*.ts must fail exactly on the lines marked `// error: <code> <message>`,
// with that code and message (for a wrong placeholder, the string literal the sentence reads as).
// Also reports tsc time and instantiation counts, and fails on TypeScript's instantiation-depth
// error (TS2589) anywhere.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TSC = path.join(ROOT, 'node_modules', '.bin', 'tsc');
const DIR = path.join(ROOT, 'test', 'types', 'every');
// test/types/tsconfig.json's options, as flags: `tsc -p` takes no file arguments.
const FLAGS = ['--ignoreConfig', '--noEmit', '--strict', '--target', 'ES2020', '--lib', 'ES2023', '--module', 'commonjs', '--esModuleInterop', '--skipLibCheck'];

/** Compiles one fixture: its diagnostics, tsc's own statistics, and the wall-clock time. */
function tsc(file) {
  const started = performance.now();
  let output;
  try {
    output = execFileSync(TSC, [...FLAGS, '--extendedDiagnostics', file], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  const ms = performance.now() - started;
  const stat = (name) => output.match(new RegExp(`^${name}:\\s+([\\d.]+)`, 'm'))?.[1];
  const diagnostics = [...output.matchAll(/^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/gm)].map(([, f, line, code, message]) => ({ file: f, line: Number(line), code, message }));
  return { diagnostics, ms, instantiations: Number(stat('Instantiations')), check: Number(stat('Check time')), output };
}

/** The `// error: <code> <message>` marks of a fixture, by the line they apply to (the next one). */
function expected(file) {
  const marks = new Map();
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((text, i) => {
      const m = text.match(/^\/\/ error: (TS\d+) (.*)$/);
      if (m) marks.set(i + 2, { code: m[1], message: m[2] });
    });
  return marks;
}

const invalid = readdirSync(DIR).filter((f) => /^invalid-.*\.ts$/.test(f)).sort();
const timings = [];

describe('every() sentence types (R9)', () => {
  test('valid.ts compiles clean', () => {
    const r = tsc(path.join(DIR, 'valid.ts'));
    timings.push(['valid.ts', r]);
    assert.deepEqual(r.diagnostics, [], r.output);
  });

  for (const name of invalid) {
    test(`${name} fails exactly where it says, with the message it names`, () => {
      const file = path.join(DIR, name);
      const r = tsc(file);
      timings.push([name, r]);
      const want = expected(file);
      assert.ok(want.size > 0, `${name} marks no errors`);
      const got = new Map(r.diagnostics.map((d) => [d.line, d]));
      assert.deepEqual([...got.keys()].sort((a, b) => a - b), [...want.keys()].sort((a, b) => a - b), `${name}: the lines with errors\n${r.output}`);
      for (const [line, { code, message }] of want) {
        const d = got.get(line);
        assert.equal(d.code, code, `${name}:${line} ${d.message}`);
        // A string-literal message appears quoted as the parameter or `this` type; any other is tsc's own text.
        assert.ok(message.startsWith('"') ? d.message.includes(`'${message}'`) : d.message === message, `${name}:${line}: want ${message}, got ${d.message}`);
      }
    });
  }

  test('no fixture hits the instantiation-depth limit (TS2589)', () => {
    for (const [name, r] of timings) assert.ok(!r.diagnostics.some((d) => d.code === 'TS2589'), name);
  });

  test('summary', () => {
    for (const [name, r] of timings) {
      console.log(`# tsc ${name}: ${r.ms.toFixed(0)} ms wall, check ${r.check}s, ${r.instantiations} instantiations, ${r.diagnostics.length} errors`);
    }
  });
});
