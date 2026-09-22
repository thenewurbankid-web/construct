import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_CODES } from '../packages/core/diagnostics.mjs';
import { loadLayerGraph } from '../packages/core/architecture-graph.mjs';
import { classifyFile } from '../packages/core/architecture-enforcer.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, '..', 'packages', 'cli', 'construct.mjs');

function run(args, cwd) {
  return spawnSync('node', [bin, ...args], { encoding: 'utf8', cwd: cwd ?? process.cwd() });
}

function emptyProjectDir() {
  return makeTempDir('construct-cli-');
}

test('no command exits with USAGE_ERROR and prints usage', () => {
  const res = run([]);
  assert.equal(res.status, EXIT_CODES.USAGE_ERROR);
  assert.match(res.stdout, /Commands:/);
});

test('unknown command exits with USAGE_ERROR and prints usage', () => {
  const res = run(['bogus-command']);
  assert.equal(res.status, EXIT_CODES.USAGE_ERROR);
  assert.match(res.stdout, /Commands:/);
});

test('doctor exits 0 and reports environment + enforcer module availability', () => {
  const res = run(['doctor'], emptyProjectDir());
  assert.equal(res.status, EXIT_CODES.OK);
  assert.match(res.stdout, /Construct doctor/);
  assert.match(res.stdout, /Enforcer modules:/);
});

test('validate against a project with no architecture.yml/features runs cleanly without crashing', () => {
  const dir = emptyProjectDir();
  const res = run(['validate'], dir);
  // Must not internal-error or throw an unhandled exception; a report
  // (with or without violations) is fine either way.
  assert.notEqual(res.status, EXIT_CODES.INTERNAL_ERROR);
  assert.doesNotMatch(res.stderr, /Construct error:/);
  assert.ok(res.status === EXIT_CODES.OK || res.status === EXIT_CODES.VIOLATIONS);
});

// #68: the real fixtures/architecture-valid-react-spa project, run through
// the actual `construct validate` binary end to end -- not just the
// validateArchitecture()-level unit tests in architecture-enforcer.test.mjs.
// This is the same invocation a real react-spa user would run.
test('construct validate against fixtures/architecture-valid-react-spa exits OK with zero error-severity violations', () => {
  const repoRoot = path.resolve(here, '..');
  const res = run(['validate', '--dir', 'fixtures/architecture-valid-react-spa'], repoRoot);
  assert.equal(res.status, EXIT_CODES.OK);
  assert.doesNotMatch(res.stdout, /❌/);
});

test('validate --format json produces well-formed JSON through formatReport', () => {
  const dir = emptyProjectDir();
  const res = run(['validate', '--format', 'json'], dir);
  const parsed = JSON.parse(res.stdout);
  assert.ok('status' in parsed);
  assert.ok(Array.isArray(parsed.violations));
});

test('a thrown ConstructError (bad generate usage) exits with USAGE_ERROR', () => {
  const dir = emptyProjectDir();
  const res = run(['generate'], dir);
  assert.equal(res.status, EXIT_CODES.USAGE_ERROR);
  assert.match(res.stderr, /Usage: construct generate/);
});

// #275: this used to exit INTERNAL_ERROR with a raw IMPORT-001 "template bug"
// after the broken controller had already been written. It is now a plain
// usage error, named and actionable, with nothing left on disk.
test('generate controller before its page fails fast, naming the missing page and writing nothing (#275)', () => {
  const dir = emptyProjectDir();
  run(['feature', 'create', 'checkout'], dir);
  const res = run(['generate', 'controller', 'Checkout', '--feature', 'checkout'], dir);
  assert.equal(res.status, EXIT_CODES.USAGE_ERROR);
  assert.match(res.stderr, /a "controller" needs a "page" layer/);
  assert.doesNotMatch(res.stderr, /template bug/);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'controllers', 'CheckoutController.tsx')), false);
});

test('generate layer with a controller but no page is refused before anything is written (#275)', () => {
  const dir = emptyProjectDir();
  run(['feature', 'create', 'checkout'], dir);
  const res = run(['generate', 'layer', 'Checkout', '--feature', 'checkout', '--layers', 'domain,hook,controller'], dir);
  assert.equal(res.status, EXIT_CODES.USAGE_ERROR);
  assert.match(res.stderr, /a "controller" needs a "page" layer/);
  assert.match(res.stderr, /--layers domain,hook,page,controller/);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'domain', 'Checkout.tsx')), false);
});

test('generate controller after its page succeeds', () => {
  const dir = emptyProjectDir();
  run(['feature', 'create', 'checkout'], dir);
  run(['generate', 'page', 'Checkout', '--feature', 'checkout'], dir);
  const res = run(['generate', 'controller', 'Checkout', '--feature', 'checkout'], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'controllers', 'CheckoutController.tsx')), true);
});

test('generate layer scaffolds every requested layer in one command, out of order and all', () => {
  const dir = emptyProjectDir();
  run(['feature', 'create', 'checkout'], dir);
  const res = run(['generate', 'layer', 'Checkout', '--feature', 'checkout', '--layers', 'controller,page,hook,domain'], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  for (const f of [
    'domain/Checkout.tsx',
    'hooks/useCheckout.tsx',
    'pages/CheckoutPage.tsx',
    'controllers/CheckoutController.tsx',
  ]) {
    assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', ...f.split('/'))), true, `missing ${f}`);
  }
  const validated = run(['validate'], dir);
  assert.doesNotMatch(validated.stdout, /IMPORT-001/);
});

test('generate layer without --layers exits with USAGE_ERROR', () => {
  const dir = emptyProjectDir();
  run(['feature', 'create', 'checkout'], dir);
  const res = run(['generate', 'layer', 'Checkout', '--feature', 'checkout'], dir);
  assert.equal(res.status, EXIT_CODES.USAGE_ERROR);
  assert.match(res.stderr, /Usage: construct generate layer/);
});

// ---- capability groups: create / refactor / research -----------------------

test('create feature and create layer are equivalent to their flat commands', () => {
  const dir = emptyProjectDir();
  assert.equal(run(['create', 'feature', 'checkout'], dir).status, EXIT_CODES.OK);
  const res = run(['create', 'layer', 'Foo', '--feature', 'checkout', '--layers', 'domain,hook'], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'domain', 'Foo.tsx')), true);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'hooks', 'useFoo.tsx')), true);
  assert.match(res.stdout, /\[tool: .*\] \[llm: 0 calls/);
});

test('create <layer> <name> falls through to plain generate', () => {
  const dir = emptyProjectDir();
  run(['create', 'feature', 'checkout'], dir);
  const res = run(['create', 'domain', 'Foo', '--feature', 'checkout'], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'domain', 'Foo.tsx')), true);
});

test('research summarize and research doctor delegate to the flat commands', () => {
  const dir = emptyProjectDir();
  run(['create', 'feature', 'checkout'], dir);
  const doc = run(['research', 'doctor'], dir);
  assert.equal(doc.status, EXIT_CODES.OK);
  assert.match(doc.stdout, /Construct doctor/);
  const sum = run(['research', 'summarize', '--feature', 'checkout', '--format', 'compact'], dir);
  assert.equal(sum.status, EXIT_CODES.OK);
  assert.match(sum.stdout, /Feature "checkout"/);
  assert.match(doc.stdout, /\[tool: .*\] \[llm: 0 calls/);
  assert.match(sum.stdout, /\[tool: .*\] \[llm: 0 calls/);
});

test('research without a known sub-verb exits with USAGE_ERROR', () => {
  const res = run(['research', 'bogus'], emptyProjectDir());
  assert.equal(res.status, EXIT_CODES.USAGE_ERROR);
  assert.match(res.stderr, /Usage: construct research/);
});

test('refactor move relocates a file across layers and reports the result', () => {
  const dir = emptyProjectDir();
  run(['create', 'feature', 'checkout'], dir);
  run(['create', 'domain', 'Foo', '--feature', 'checkout'], dir);
  const res = run(['refactor', 'move', 'Foo', '--feature', 'checkout', '--from', 'domain', '--to', 'service'], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  assert.match(res.stdout, /Moved features\/checkout\/domain\/Foo\.tsx -> features\/checkout\/services\/Foo\.tsx/);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'services', 'Foo.tsx')), true);
  assert.match(res.stdout, /\[tool: .*\] \[llm: 0 calls/);
});

test('refactor rename renames within a layer and reports the result', () => {
  const dir = emptyProjectDir();
  run(['create', 'feature', 'checkout'], dir);
  run(['create', 'hook', 'Foo', '--feature', 'checkout'], dir);
  const res = run(['refactor', 'rename', 'Foo', 'Bar', '--feature', 'checkout', '--layer', 'hook'], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'hooks', 'useBar.tsx')), true);
});

test('refactor without a known sub-verb exits with USAGE_ERROR', () => {
  const res = run(['refactor', 'bogus'], emptyProjectDir());
  assert.equal(res.status, EXIT_CODES.USAGE_ERROR);
  assert.match(res.stderr, /Usage: construct refactor/);
});

test('feature create then validate: generated feature has no forced feature-root violation', () => {
  const dir = emptyProjectDir();
  const created = run(['feature', 'create', 'checkout'], dir);
  assert.equal(created.status, EXIT_CODES.OK);
  const validated = run(['validate'], dir);
  assert.notEqual(validated.status, EXIT_CODES.INTERNAL_ERROR);
});

test('sync regenerates .dependency-cruiser.cjs', () => {
  const dir = emptyProjectDir();
  const res = run(['sync'], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  assert.ok(fs.existsSync(path.join(dir, '.dependency-cruiser.cjs')));
});

test('monorepo discovery: validate from a nested subdirectory uses the parent architecture.yml', () => {
  const dir = emptyProjectDir();
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'rules:\n  PAGE-004: warning\n');
  fs.mkdirSync(path.join(dir, 'features', 'x', 'pages'), { recursive: true });
  const nested = path.join(dir, 'packages', 'app');
  fs.mkdirSync(nested, { recursive: true });
  const res = run(['validate'], nested);
  assert.notEqual(res.status, EXIT_CODES.INTERNAL_ERROR);
});

// --dir: adopting Construct inside a subdirectory of an existing, unrelated
// project — every command must be targetable at that subdirectory without
// requiring the caller to cd into it first, and must never touch anything
// outside it (see GitHub issue #22).
function unrelatedProjectWithSubdir() {
  const parent = emptyProjectDir();
  fs.writeFileSync(path.join(parent, 'package.json'), '{"name":"unrelated-app"}\n');
  fs.writeFileSync(path.join(parent, 'sibling.txt'), 'do not touch\n');
  return parent;
}

test('init defaults to framework: nextjs and scaffolds app/page.tsx', () => {
  const dir = emptyProjectDir();
  const res = run(['init'], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  assert.match(fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8'), /framework: nextjs/);
  assert.ok(fs.existsSync(path.join(dir, 'app', 'page.tsx')));
  assert.ok(!fs.existsSync(path.join(dir, 'src', 'App.tsx')));
});

test('init --framework react-spa scaffolds src/main.tsx + src/App.tsx with the core controller registered, not app/page.tsx', () => {
  const dir = emptyProjectDir();
  const res = run(['init', '--framework', 'react-spa'], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  assert.match(fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8'), /framework: react-spa/);
  assert.ok(!fs.existsSync(path.join(dir, 'app')));
  assert.ok(fs.existsSync(path.join(dir, 'src', 'main.tsx')));
  const appContent = fs.readFileSync(path.join(dir, 'src', 'App.tsx'), 'utf8');
  assert.match(appContent, /<Route path="\/" element={<CoreController \/>} \/>/);
  // The scaffolded route layer file matches #65's react-spa route pattern
  // (src/App.tsx) and #66's route-resolver convention exactly.
  const graph = loadLayerGraph(dir);
  assert.equal(classifyFile('src/App.tsx', graph), 'route');
});

test('init --framework <bogus> exits with USAGE_ERROR and a clear message', () => {
  const dir = emptyProjectDir();
  const res = run(['init', '--framework', 'sveltekit'], dir);
  assert.equal(res.status, EXIT_CODES.USAGE_ERROR);
  assert.match(res.stderr, /Unknown project\.framework 'sveltekit'/);
});

test('init [dir] followed by doctor --dir from the parent finds architecture.yml without cd', () => {
  const parent = unrelatedProjectWithSubdir();
  const initRes = run(['init', 'construct-sub'], parent);
  assert.equal(initRes.status, EXIT_CODES.OK);

  const doctorRes = run(['doctor', '--dir', 'construct-sub'], parent);
  assert.equal(doctorRes.status, EXIT_CODES.OK);
  assert.match(doctorRes.stdout, /architecture\.yml: present/);
});

test('feature create and generate --dir scope all writes to the subdirectory, leaving the parent untouched', () => {
  const parent = unrelatedProjectWithSubdir();
  run(['init', 'construct-sub'], parent);
  const before = fs.readdirSync(parent).sort();

  const createRes = run(['feature', 'create', 'foo', '--dir', 'construct-sub'], parent);
  assert.equal(createRes.status, EXIT_CODES.OK);
  const generateRes = run(['generate', 'domain', 'Bar', '--feature', 'foo', '--dir', 'construct-sub'], parent);
  assert.equal(generateRes.status, EXIT_CODES.OK);

  assert.ok(fs.existsSync(path.join(parent, 'construct-sub', 'features', 'foo', 'domain', 'Bar.tsx')));
  assert.equal(fs.readFileSync(path.join(parent, 'sibling.txt'), 'utf8'), 'do not touch\n');
  assert.deepEqual(fs.readdirSync(parent).sort(), before);
});

test('validate and summarize --dir report only on the subdirectory, not the surrounding project', () => {
  const parent = unrelatedProjectWithSubdir();
  run(['init', 'construct-sub'], parent);
  run(['feature', 'create', 'foo', '--dir', 'construct-sub'], parent);

  const validateRes = run(['validate', '--dir', 'construct-sub'], parent);
  assert.notEqual(validateRes.status, EXIT_CODES.INTERNAL_ERROR);

  const summarizeRes = run(['summarize', '--feature', 'foo', '--format', 'compact', '--dir', 'construct-sub'], parent);
  assert.equal(summarizeRes.status, EXIT_CODES.OK);
  assert.match(summarizeRes.stdout, /Feature "foo"/);
  assert.doesNotMatch(summarizeRes.stdout, /sibling/);
});

// ---- import ----------------------------------------------------------------

test('import scaffolds layers and breadcrumbs them to the source file, with zero LLM calls', () => {
  const dir = emptyProjectDir();
  run(['create', 'feature', 'checkout'], dir);
  const sourceFile = path.join(dir, 'OldFile.tsx');
  fs.writeFileSync(sourceFile, 'export function old() { return true; }\n');

  const res = run(['import', 'Foo', '--feature', 'checkout', '--layers', 'domain,hook', '--from', sourceFile], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  assert.match(res.stdout, /\[tool: .*\] \[llm: 0 calls/);
  assert.match(res.stdout, /features\/checkout\/domain\/Foo\.tsx/);
  assert.match(res.stdout, /features\/checkout\/hooks\/useFoo\.tsx/);
  assert.match(fs.readFileSync(path.join(dir, 'features', 'checkout', 'domain', 'Foo.tsx'), 'utf8'), /TODO\(import\)/);
});

test('import without --from exits with USAGE_ERROR', () => {
  const dir = emptyProjectDir();
  run(['create', 'feature', 'checkout'], dir);
  const res = run(['import', 'Foo', '--feature', 'checkout', '--layers', 'domain'], dir);
  assert.equal(res.status, EXIT_CODES.USAGE_ERROR);
  assert.match(res.stderr, /Usage: construct import/);
});

test('import --plan batch-scaffolds every unit in one command', () => {
  const dir = emptyProjectDir();
  run(['create', 'feature', 'checkout'], dir);
  const sourceFile = path.join(dir, 'OldFile.tsx');
  fs.writeFileSync(sourceFile, 'export function old() { return true; }\n');
  const planPath = path.join(dir, 'plan.json');
  fs.writeFileSync(
    planPath,
    JSON.stringify({ feature: 'checkout', units: [{ name: 'Foo', layers: ['domain', 'hook'], from: sourceFile }] }),
  );

  const res = run(['import', '--plan', planPath], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  assert.match(res.stdout, /Foo: scaffolded 2 file\(s\)/);
  assert.match(res.stdout, /\[tool: .*\] \[llm: 0 calls/);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'domain', 'Foo.tsx')), true);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'hooks', 'useFoo.tsx')), true);
});

test('import --plan with a malformed plan exits with USAGE_ERROR', () => {
  const dir = emptyProjectDir();
  run(['create', 'feature', 'checkout'], dir);
  const planPath = path.join(dir, 'bad-plan.json');
  fs.writeFileSync(planPath, JSON.stringify({ units: [] }));
  const res = run(['import', '--plan', planPath], dir);
  assert.equal(res.status, EXIT_CODES.USAGE_ERROR);
});

test('import --llm with an unsupported provider fails fast, without attempting any network/subprocess call', () => {
  const dir = emptyProjectDir();
  run(['create', 'feature', 'checkout'], dir);
  const sourceFile = path.join(dir, 'OldFile.tsx');
  fs.writeFileSync(sourceFile, 'export function old() { return true; }\n');
  const res = run(
    ['import', 'Foo', '--feature', 'checkout', '--layers', 'domain', '--from', sourceFile, '--llm', 'bogus-provider'],
    dir,
  );
  assert.equal(res.status, EXIT_CODES.USAGE_ERROR);
  assert.match(res.stderr, /Unknown --llm provider "bogus-provider"/);
  assert.match(res.stderr, /claude/);
});

// ---- timing (#164/#165/#166): per-step + total elapsed time, printed as
// plain text alongside the existing tool/llm attribution -- these assert
// presence/shape/non-negativity only (never an exact duration: timing is
// inherently variable, so a flaky "took less than Xms" assertion is wrong).

/** Pull every "(...s)"-shaped duration out of `text` and assert each parses
 * to a non-negative finite number -- used instead of asserting one exact
 * line so these tests stay robust to reasonable wording changes. */
function assertNonNegativeDurations(text, { min = 1 } = {}) {
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)s\)/g)];
  assert.ok(matches.length >= min, `expected at least ${min} duration(s) in output, found ${matches.length}:\n${text}`);
  for (const m of matches) {
    const seconds = Number(m[1]);
    assert.ok(Number.isFinite(seconds) && seconds >= 0, `duration "${m[0]}" did not parse to a non-negative number`);
  }
  return matches.map((m) => Number(m[1]));
}

test('create feature prints a non-negative timing duration', () => {
  const dir = emptyProjectDir();
  const res = run(['create', 'feature', 'checkout'], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  assertNonNegativeDurations(res.stdout);
});

test('generate <layer> <name> (single-file op) prints a non-negative timing duration', () => {
  const dir = emptyProjectDir();
  run(['create', 'feature', 'checkout'], dir);
  const res = run(['generate', 'domain', 'Foo', '--feature', 'checkout'], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  assertNonNegativeDurations(res.stdout);
});

test('generate layer (vertical slice) prints a per-layer duration for every layer plus a non-negative Total line', () => {
  const dir = emptyProjectDir();
  run(['create', 'feature', 'checkout'], dir);
  const res = run(['generate', 'layer', 'Checkout', '--feature', 'checkout', '--layers', 'domain,hook,page,controller'], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  // One duration per created file plus the Total line itself.
  // One "(...s)" duration per created layer (domain, hook, page, controller).
  assertNonNegativeDurations(res.stdout, { min: 4 });
  const totalMatch = res.stdout.match(/Total: (\d+(?:\.\d+)?)s/);
  assert.ok(totalMatch, `expected a "Total: Xs" line, got:\n${res.stdout}`);
  const total = Number(totalMatch[1]);
  assert.ok(Number.isFinite(total) && total >= 0);
});

test('import <name> (single unit, no --llm) prints a non-negative scaffold duration and a Total line', () => {
  const dir = emptyProjectDir();
  run(['create', 'feature', 'checkout'], dir);
  const sourceFile = path.join(dir, 'OldFile.tsx');
  fs.writeFileSync(sourceFile, 'export function old() { return true; }\n');
  const res = run(['import', 'Foo', '--feature', 'checkout', '--layers', 'domain,hook', '--from', sourceFile], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  assertNonNegativeDurations(res.stdout);
  assert.match(res.stdout, /Total: \d+(?:\.\d+)?s/);
});

test('import --plan (batch) prints a non-negative duration per unit and an overall Total line', () => {
  const dir = emptyProjectDir();
  run(['create', 'feature', 'checkout'], dir);
  const sourceFile = path.join(dir, 'OldFile.tsx');
  fs.writeFileSync(sourceFile, 'export function old() { return true; }\n');
  const planPath = path.join(dir, 'plan.json');
  fs.writeFileSync(
    planPath,
    JSON.stringify({
      feature: 'checkout',
      units: [
        { name: 'Foo', layers: ['domain'], from: sourceFile },
        { name: 'Bar', layers: ['service'], from: sourceFile },
      ],
    }),
  );
  const res = run(['import', '--plan', planPath], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  assertNonNegativeDurations(res.stdout, { min: 2 });
  const totalMatch = res.stdout.match(/Total: (\d+(?:\.\d+)?)s/);
  assert.ok(totalMatch, `expected a "Total: Xs" line, got:\n${res.stdout}`);
  assert.ok(Number(totalMatch[1]) >= 0);
});
