/**
 * Regression tests for the shared temp-dir helper (#254).
 *
 * The bug these guard against is a leak, not a wrong return value: tests used
 * to create directories under a tmpfs /tmp and never remove them (58k dirs /
 * 1.1 GB of RAM at its worst). So the interesting assertions all run a *child*
 * node process, let it end in one of the ways a real test run can end, and then
 * check from the parent that nothing survived.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeTempDir, withTempDir, tempRoot } from '../test-utils/tmpdir.mjs';

const HELPER_URL = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-utils', 'tmpdir.mjs'),
).href;

/**
 * Run a child node process that creates a temp dir via the helper, records the
 * path where the parent can read it, and then ends in `ending`.
 * @returns {{ dir: string, status: number|null, signal: string|null }}
 */
function runChild(ending) {
  const report = path.join(makeTempDir('report-'), 'path.txt');
  const script = `
    import fs from 'node:fs';
    const { makeTempDir } = await import(${JSON.stringify(HELPER_URL)});
    const dir = makeTempDir('construct-leakcheck-');
    fs.writeFileSync(${JSON.stringify(report)}, dir);
    fs.writeFileSync(dir + '/payload.txt', 'x'.repeat(1024));
    ${ending}
  `;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
  });
  const dir = fs.readFileSync(report, 'utf8');
  return { dir, status: res.status, signal: res.signal, stderr: res.stderr };
}

test('makeTempDir returns a fresh, empty, real directory under one per-process root', () => {
  const a = makeTempDir('construct-helper-a-');
  const b = makeTempDir('construct-helper-b-');

  assert.ok(fs.statSync(a).isDirectory());
  assert.ok(fs.statSync(b).isDirectory());
  assert.notEqual(a, b);
  assert.deepEqual(fs.readdirSync(a), []);

  // Both live inside the single root this process will delete on exit, and that
  // root lives in the OS temp dir.
  assert.equal(path.dirname(a), tempRoot());
  assert.equal(path.dirname(b), tempRoot());
  assert.equal(path.dirname(tempRoot()), fs.realpathSync(os.tmpdir()));

  // Symlink-resolved, so path comparisons in tests are stable.
  assert.equal(a, fs.realpathSync(a));
});

test('makeTempDir cannot be talked out of the root by a prefix containing a path', () => {
  const escaped = makeTempDir('../../escape-');
  assert.equal(path.dirname(escaped), tempRoot());
});

test('the temp root is removed when the process exits normally', () => {
  const { dir, status } = runChild('');
  assert.equal(status, 0);
  assert.equal(fs.existsSync(dir), false, `leaked ${dir}`);
  assert.equal(fs.existsSync(path.dirname(dir)), false, 'leaked the root');
});

test('the temp root is removed when a test throws (the failure path that used to leak)', () => {
  const { dir, status } = runChild("throw new Error('assertion failed');");
  assert.notEqual(status, 0);
  assert.equal(fs.existsSync(dir), false, `leaked ${dir}`);
});

test('the temp root is removed when the process exits non-zero without unwinding', () => {
  const { dir, status } = runChild('process.exit(3);');
  assert.equal(status, 3);
  assert.equal(fs.existsSync(dir), false, `leaked ${dir}`);
});

test('the temp root is removed when an interrupted run is signalled (SIGINT/SIGTERM)', () => {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const { dir, signal: got } = runChild(
      `process.kill(process.pid, '${signal}'); await new Promise(r => setTimeout(r, 5000));`,
    );
    assert.equal(got, signal, `expected the child to die from ${signal}`);
    assert.equal(fs.existsSync(dir), false, `leaked ${dir} on ${signal}`);
  }
});

test('withTempDir removes its directory immediately, pass or throw', () => {
  let seen;
  const value = withTempDir('construct-helper-with-', (dir) => {
    seen = dir;
    fs.writeFileSync(path.join(dir, 'f.txt'), 'x');
    return 42;
  });
  assert.equal(value, 42);
  assert.equal(fs.existsSync(seen), false);

  let thrown;
  assert.throws(() => withTempDir('construct-helper-with-', (dir) => {
    thrown = dir;
    throw new Error('boom');
  }), /boom/);
  assert.equal(fs.existsSync(thrown), false);
});
