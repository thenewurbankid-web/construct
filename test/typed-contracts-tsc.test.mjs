// #501/#502 step 5(b) -- the compile-error proof. Runs the real `tsc`
// binary (not a hand-rolled parser) against the fixtures in
// packages/core/typed-contracts/examples/ and asserts on the ACTUAL
// diagnostics produced, per the brief: "capture and assert on the actual
// error, don't just claim it."
//
// A `tsc` invocation over even this small a project takes real wall-clock
// time (compiler startup + loading @types/react) -- these are still plain
// `node --test` cases (no heavy.sh needed per-test; the whole suite is
// already run through heavy.sh at the top level).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSC = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsc');
const TYPED_CONTRACTS = path.join(REPO_ROOT, 'packages', 'core', 'typed-contracts');

/** Compile one or more files exactly the way
 * packages/core/typed-contracts/tsconfig.json configures the project
 * (mirrored here as explicit flags, since `tsc -p` cannot be combined with
 * explicit file arguments), and return { ok, output }. */
function tsc(files) {
  try {
    const output = execFileSync(
      TSC,
      [
        '--noEmit', '--strict', '--noImplicitReturns',
        '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'bundler',
        '--jsx', 'react-jsx', '--allowImportingTsExtensions',
        '--typeRoots', path.join(REPO_ROOT, 'node_modules', '@types'),
        '--types', 'react,node',
        ...files,
      ],
      { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { ok: true, output };
  } catch (e) {
    return { ok: false, output: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

test('the real composition example (examples/valid.ts) compiles with zero tsc errors', () => {
  const { ok, output } = tsc([
    path.join(TYPED_CONTRACTS, 'jsx-global.d.ts'),
    path.join(TYPED_CONTRACTS, 'examples', 'valid.ts'),
  ]);
  assert.ok(ok, `expected examples/valid.ts to compile clean; tsc said:\n${output}`);
});

test('wiring a ServiceUnit into definePage\'s Props is a real tsc error (TS2344), not a silent pass', () => {
  const { ok, output } = tsc([
    path.join(TYPED_CONTRACTS, 'jsx-global.d.ts'),
    path.join(TYPED_CONTRACTS, 'examples', 'invalid-wiring.ts'),
  ]);
  assert.equal(ok, false, 'expected examples/invalid-wiring.ts to fail to compile');
  // BadPageProps (definePage <- ServiceUnit)
  assert.match(output, /examples[\\/]invalid-wiring\.ts\(\d+,\d+\): error TS2344:/);
  assert.match(output, /Type 'BadPageProps' does not satisfy the constraint 'Forbid<BadPageProps, ComponentUnitAny>'/);
  // BadComponentProps (defineComponent <- PropRef<ServiceUnit>) -- PropRef
  // changes how a slot is filled, not which layer boundary applies to it.
  assert.match(output, /Type 'BadComponentProps' does not satisfy the constraint 'Forbid<BadComponentProps, ComponentUnitAny>'/);
});

test('a Template with a code path that falls off the end (implicit undefined) is a real tsc error (TS7030)', () => {
  const { ok, output } = tsc([
    path.join(TYPED_CONTRACTS, 'jsx-global.d.ts'),
    path.join(TYPED_CONTRACTS, 'examples', 'implicit-return.ts'),
  ]);
  assert.equal(ok, false, 'expected examples/implicit-return.ts to fail to compile');
  assert.match(output, /examples[\\/]implicit-return\.ts\(\d+,\d+\): error TS7030: Not all code paths return a value\./);
});

test('the whole typed-contracts project (its own tsconfig.json) compiles with zero errors', () => {
  const output = execFileSync(TSC, ['-p', path.join(TYPED_CONTRACTS, 'tsconfig.json')], {
    cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(output.trim(), '');
});
