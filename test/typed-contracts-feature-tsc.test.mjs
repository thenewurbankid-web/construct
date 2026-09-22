// #511 -- the compile-error proof for feature-branded types
// (Brand<T, Layer, Feature>'s equivalent -- see
// packages/core/typed-contracts/brand.ts's FeatureBrand doc comment for why
// it's built as its own symbol channel rather than a literal third type
// parameter grafted onto Brand<T, Layer>). Same technique and same rigor
// bar as test/typed-contracts-tsc.test.mjs: runs the real `tsc` binary
// against the fixtures in packages/core/typed-contracts/examples/ and
// asserts on the ACTUAL diagnostics produced, per the brief: "a real
// captured tsc error output in a test, not just a claim."
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
 * explicit file arguments), and return { ok, output }. Identical to
 * test/typed-contracts-tsc.test.mjs's helper of the same name. */
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

test('the real feature-branded composition example (examples/feature-branded-valid.ts) compiles with zero tsc errors', () => {
  const { ok, output } = tsc([
    path.join(TYPED_CONTRACTS, 'jsx-global.d.ts'),
    path.join(TYPED_CONTRACTS, 'examples', 'feature-branded-valid.ts'),
  ]);
  assert.ok(ok, `expected examples/feature-branded-valid.ts to compile clean; tsc said:\n${output}`);
});

// #511's proof (a): "two same-layer units from different features are NOT
// mutually assignable" -- a real tsc error, not just a claim.
test('assigning a "cart"-feature unit where a "checkout"-feature unit of the same layer/shape is required is a real tsc error (TS2322)', () => {
  const { ok, output } = tsc([
    path.join(TYPED_CONTRACTS, 'jsx-global.d.ts'),
    path.join(TYPED_CONTRACTS, 'examples', 'feature-branded-invalid.ts'),
  ]);
  assert.equal(ok, false, 'expected examples/feature-branded-invalid.ts to fail to compile');
  // Illegal #1: the textbook direct-assignment case.
  assert.match(output, /examples[\\/]feature-branded-invalid\.ts\(\d+,\d+\): error TS2322:/);
  assert.match(
    output,
    /Type 'FeatureBrand<ComponentUnit<BadgeProps>, "cart">' is not assignable to type 'FeatureBrand<ComponentUnit<BadgeProps>, "checkout">'/,
  );
  assert.match(output, /Type '"cart"' is not assignable to type '"checkout"'/);
});

// #511's proof (a), restated as a realistic composition (not just a bare
// type-alias assignment) -- mirrors examples/invalid-wiring.ts's own style
// of proving the rule at a real call site (React.createElement), not an
// isolated type check.
test('wiring a "cart"-feature badge into a controller slot that requires a "checkout"-feature badge is rejected at the composition call site (TS2769)', () => {
  const { output } = tsc([
    path.join(TYPED_CONTRACTS, 'jsx-global.d.ts'),
    path.join(TYPED_CONTRACTS, 'examples', 'feature-branded-invalid.ts'),
  ]);
  assert.match(output, /error TS2769: No overload matches this call\./);
  assert.match(
    output,
    /Type 'PropRef<FeatureBrand<ComponentUnit<BadgeProps>, "cart">>' is not assignable to type 'PropRef<FeatureBrand<ComponentUnit<BadgeProps>, "checkout">>'/,
  );
});

// #511's proof (b): a unit released through a SLICE-004-style wrapper (the
// #509 minimal simulation in examples/feature-branded-valid.ts's
// releaseTotalBadge()) DOES successfully widen for cross-feature use --
// proven simply by the valid example compiling clean above (CartController
// wires in releaseTotalBadge()'s result, a DIFFERENT feature's released
// unit), and restated explicitly here as its own assertion so the release
// path has a named, standalone regression test.
test('the release-point wrapper widens a feature-branded unit for a different feature to consume (no cast, no error)', () => {
  const { ok, output } = tsc([
    path.join(TYPED_CONTRACTS, 'jsx-global.d.ts'),
    path.join(TYPED_CONTRACTS, 'examples', 'feature-branded-valid.ts'),
  ]);
  assert.ok(ok, `expected the release-point composition to compile clean; tsc said:\n${output}`);
});
