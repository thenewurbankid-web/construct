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

// #510 -- both legitimate Provider patterns from #499 ((a) self-contained internal wiring, (b) the
// same Provider imported and wired into a different feature's own component with a different data
// source) compile and type-check as one real composition, same bar as examples/valid.ts above.
test('the Provider usage examples (examples/providers.ts) compile with zero tsc errors', () => {
  const { ok, output } = tsc([
    path.join(TYPED_CONTRACTS, 'jsx-global.d.ts'),
    path.join(TYPED_CONTRACTS, 'examples', 'providers.ts'),
  ]);
  assert.ok(ok, `expected examples/providers.ts to compile clean; tsc said:\n${output}`);
});

// #503 -- the Expression usage example (a real defineExpression composing a component and
// consuming `children`) compiles with zero tsc errors, same bar as examples/valid.ts.
test('the Expression usage example (examples/expression.ts) compiles with zero tsc errors', () => {
  const { ok, output } = tsc([
    path.join(TYPED_CONTRACTS, 'jsx-global.d.ts'),
    path.join(TYPED_CONTRACTS, 'examples', 'expression.ts'),
  ]);
  assert.ok(ok, `expected examples/expression.ts to compile clean; tsc said:\n${output}`);
});

// #504 -- the useTrackedState usage example (a real use<Name>State hook built through it)
// compiles with zero tsc errors.
test('the tracked-state usage example (examples/tracked-state.ts) compiles with zero tsc errors', () => {
  const { ok, output } = tsc([
    path.join(TYPED_CONTRACTS, 'jsx-global.d.ts'),
    path.join(TYPED_CONTRACTS, 'examples', 'tracked-state.ts'),
  ]);
  assert.ok(ok, `expected examples/tracked-state.ts to compile clean; tsc said:\n${output}`);
});

// #658 -- a workflow unit is callable, as its type says (defineWorkflow returns a function at runtime;
// WorkflowUnit used to be typed as a config object, so calling one was TS2349). The fixture calls a
// config-shaped unit and a real-XState-machine unit and pins what comes back.
test('#658: a workflow unit is callable and returns its machine (examples/workflow.ts compiles with zero tsc errors)', () => {
  const { ok, output } = tsc([
    path.join(TYPED_CONTRACTS, 'jsx-global.d.ts'),
    path.join(TYPED_CONTRACTS, 'examples', 'workflow.ts'),
  ]);
  assert.ok(ok, `expected examples/workflow.ts to compile clean; tsc said:\n${output}`);
});

// #585 -- defineService's optional `{ schema }`: a hand-written Standard Schema object (no
// library at all) and a real zod schema both compile, and the fixtures' own type-level
// assertions pin the narrowing (ok.value is the schema's OUTPUT type, sync stays sync, the
// two-argument form is untouched).
test('the service-schema examples (hand-written Standard Schema, and real zod) compile with zero tsc errors', () => {
  const { ok, output } = tsc([
    path.join(TYPED_CONTRACTS, 'jsx-global.d.ts'),
    path.join(TYPED_CONTRACTS, 'examples', 'service-schema.ts'),
    path.join(TYPED_CONTRACTS, 'examples', 'service-schema-zod.ts'),
  ]);
  assert.ok(ok, `expected examples/service-schema*.ts to compile clean; tsc said:\n${output}`);
});

test('#585: using a schema-checked service\'s .value/.issues before narrowing on status is a real tsc error (TS2339)', () => {
  const { ok, output } = tsc([
    path.join(TYPED_CONTRACTS, 'jsx-global.d.ts'),
    path.join(TYPED_CONTRACTS, 'examples', 'service-schema-invalid.ts'),
  ]);
  assert.equal(ok, false, 'expected examples/service-schema-invalid.ts to fail to compile');
  assert.match(output, /examples[\\/]service-schema-invalid\.ts\(\d+,\d+\): error TS2339: Property 'value' does not exist on type 'ServiceResult<User>'/);
  assert.match(output, /Property 'value' does not exist on type '\{ readonly status: "error"; readonly kind: "schema"; readonly issues: readonly SchemaIssue\[\]; \}'/);
  assert.match(output, /examples[\\/]service-schema-invalid\.ts\(\d+,\d+\): error TS2339: Property 'issues' does not exist on type 'ServiceResult<User>'/);
  // Exactly the two intended errors -- nothing else in the fixture is wrong.
  assert.equal((output.match(/error TS\d+/g) || []).length, 2, output);
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
  // #510 -- BadProviderProps (defineProvider <- an arbitrary other hook, not workflow/service/domain)
  assert.match(output, /Type 'BadProviderProps' does not satisfy the constraint 'Forbid<BadProviderProps, ProviderAllowed>'/);
  // #503 -- BadExpressionProps (defineExpression <- ServiceUnit, same forbidden set as
  // definePage's -- Forbid<Props, ComponentUnitAny>, mirroring component's own canImport).
  assert.match(output, /Type 'BadExpressionProps' does not satisfy the constraint 'Forbid<BadExpressionProps, ComponentUnitAny>'/);
});

test('a Template with a code path that falls off the end (implicit undefined) is a real tsc error (TS7030)', () => {
  const { ok, output } = tsc([
    path.join(TYPED_CONTRACTS, 'jsx-global.d.ts'),
    path.join(TYPED_CONTRACTS, 'examples', 'implicit-return.ts'),
  ]);
  assert.equal(ok, false, 'expected examples/implicit-return.ts to fail to compile');
  assert.match(output, /examples[\\/]implicit-return\.ts\(\d+,\d+\): error TS7030: Not all code paths return a value\./);
});

// #503 -- EXPR-006's "must satisfy the shared Template<Props> type" as a real tsc error, the
// same TS7030 proof as above, now for defineExpression's own Template shape (Props &
// {children?: ReactNode}).
test('EXPR-006: an Expression with a code path that falls off the end is a real tsc error (TS7030), not just claimed', () => {
  const { ok, output } = tsc([
    path.join(TYPED_CONTRACTS, 'jsx-global.d.ts'),
    path.join(TYPED_CONTRACTS, 'examples', 'expression-implicit-return.ts'),
  ]);
  assert.equal(ok, false, 'expected examples/expression-implicit-return.ts to fail to compile');
  assert.match(output, /examples[\\/]expression-implicit-return\.ts\(\d+,\d+\): error TS7030: Not all code paths return a value\./);
});

test('the whole typed-contracts project (its own tsconfig.json) compiles with zero errors', () => {
  const output = execFileSync(TSC, ['-p', path.join(TYPED_CONTRACTS, 'tsconfig.json')], {
    cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(output.trim(), '');
});
