// Impact analysis (#288): the deterministic blast radius of a change.
//
// The bar the ticket sets: the computation must run with no LLM at all, everything downstream of
// "here are the candidate units" must be marked `derived`, and the depth limit must keep the output
// from becoming "the whole app". These tests run over two real trees with known structure —
// `example/` (features core/login/signup, full layer chains) and `fixtures/impact-shared` (a shared
// component consumed by three features through a public barrel).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import Ajv from 'ajv';
import {
  analyzeImpact, impactFromChangedFiles, proposeSeedsFromText, impactFromTicketText,
  impactApiManifest, renderImpactMarkdown, DEFAULT_DEPTH, SCHEMA_VERSION,
} from '../src/engine/impact.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = path.join(REPO, 'example');
const SHARED = path.join(REPO, 'fixtures', 'impact-shared');
const INVALID = path.join(REPO, 'fixtures', 'architecture-invalid');
const GOLDEN_DIR = path.join(REPO, 'test', 'golden', 'impact');
const CLI = path.join(REPO, 'bin', 'construct.mjs');

const schema = JSON.parse(fs.readFileSync(path.join(REPO, 'schemas', 'impact-report.v1.json'), 'utf8'));
const validateSchema = new Ajv({ allErrors: true }).compile(schema);
const assertSchema = (v, label = '') => assert.ok(validateSchema(v), `${label} schema errors: ${JSON.stringify(validateSchema.errors)}`);
const pathsOf = (r) => r.files.map((f) => f.path);
const fileRow = (r, p) => r.files.find((f) => f.path === p);

// ---- goldens: the whole report, byte for byte, on real trees ------------------------------------

const CASES = [
  ['domain-seed', EXAMPLE, { seeds: ['features/login/domain/Login.tsx'] }],
  ['feature-seed', EXAMPLE, { seeds: ['feature:signup'] }],
  ['route-seed', EXAMPLE, { seeds: ['/login'] }],
  ['shared-component', SHARED, { seeds: ['features/shared/components/CurrencyLabel.tsx'] }],
  ['changed-files', SHARED, { files: ['features/billing/domain/billingRules.ts', 'features/checkout/domain/checkoutRules.ts'] }],
  ['mixed-provenance', SHARED, {
    seeds: [
      'features/billing/domain/billingRules.ts',
      { ref: 'feature:checkout', provenance: 'inferred', method: 'model', confidence: 0.4, why: 'the ticket mentions checkout' },
    ],
  }],
  ['rule-seed', INVALID, { seeds: ['rule:PAGE-003'] }],
];

for (const [name, root, request] of CASES) {
  test(`golden: ${name}`, () => {
    const r = analyzeImpact(root, request);
    assert.equal(r.ok, true, JSON.stringify(r));
    assertSchema(r, name);
    const text = JSON.stringify(r, null, 2) + '\n';
    const file = path.join(GOLDEN_DIR, `${name}.json`);
    if (process.env.UPDATE_GOLDEN) { fs.mkdirSync(GOLDEN_DIR, { recursive: true }); fs.writeFileSync(file, text); }
    assert.equal(text, fs.readFileSync(file, 'utf8'), `${name} drifted; run UPDATE_GOLDEN=1 node --test test/impact.test.mjs if intended`);
  });
}

test('same input on the same tree produces byte-identical output', () => {
  const a = analyzeImpact(SHARED, { seeds: ['features/shared/components/CurrencyLabel.tsx'] });
  const b = analyzeImpact(SHARED, { seeds: ['features/shared/components/CurrencyLabel.tsx'] });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

// ---- the deterministic core --------------------------------------------------------------------

test('the blast radius follows the layer chain upwards from a domain change', () => {
  const r = analyzeImpact(SHARED, { seeds: ['features/billing/domain/billingRules.ts'], depth: 4 });
  const byPath = Object.fromEntries(r.files.map((f) => [f.path, f]));
  assert.equal(byPath['features/billing/domain/billingRules.ts'].distance, 0);
  assert.equal(byPath['features/billing/services/billingService.ts'].distance, 1);
  assert.equal(byPath['features/billing/workflows/BillingWorkflow.ts'].distance, 2);
  assert.equal(byPath['features/billing/hooks/useBilling.ts'].distance, 3);
  assert.equal(byPath['features/billing/controllers/BillingController.tsx'].distance, 4);
  // ... and every one of them says why, naming the file it was reached from
  assert.equal(byPath['features/billing/services/billingService.ts'].reasons[0].code, 'imports-changed-file');
  assert.equal(byPath['features/billing/services/billingService.ts'].reasons[0].from, 'features/billing/domain/billingRules.ts');
});

test('depth bounds the traversal, and what it cuts is counted, not dropped', () => {
  const seeds = ['features/billing/domain/billingRules.ts'];
  const d0 = analyzeImpact(SHARED, { seeds, depth: 0 });
  assert.deepEqual(pathsOf(d0), seeds);
  assert.equal(d0.stats.beyondDepth.files, 1, 'the service is one hop past depth 0');

  const d1 = analyzeImpact(SHARED, { seeds, depth: 1 });
  assert.ok(pathsOf(d1).includes('features/billing/services/billingService.ts'));
  assert.ok(!pathsOf(d1).includes('features/billing/workflows/BillingWorkflow.ts'));
  assert.equal(d1.stats.beyondDepth.files, 1);

  const dDefault = analyzeImpact(SHARED, { seeds });
  assert.equal(dDefault.request.depth, DEFAULT_DEPTH);
  assert.equal(Math.max(...dDefault.files.map((f) => f.distance)), DEFAULT_DEPTH);

  const unbounded = analyzeImpact(SHARED, { seeds, depth: -1 });
  assert.equal(unbounded.request.unbounded, true);
  assert.equal(unbounded.request.depth, null);
  assert.ok(pathsOf(unbounded).includes('features/billing/controllers/BillingController.tsx'));
  assert.equal(unbounded.stats.beyondDepth.files, 0, 'nothing is left over when the traversal is unbounded');
});

test('dependencies of a seed are context (distance 1, direction down) and are never expanded', () => {
  const r = analyzeImpact(SHARED, { seeds: ['features/billing/hooks/useBilling.ts'], depth: 1 });
  const dep = fileRow(r, 'features/billing/workflows/BillingWorkflow.ts');
  assert.equal(dep.direction, 'down');
  assert.equal(dep.reasons.some((x) => x.code === 'dependency-of-seed'), true);
  // the workflow's own dependency (the service) is NOT pulled in: downstream is not expanded
  assert.equal(fileRow(r, 'features/billing/services/billingService.ts'), undefined);
});

test('ranking is deterministic and pushes cross-feature, far and test files down', () => {
  const r = analyzeImpact(SHARED, { seeds: ['features/shared/components/CurrencyLabel.tsx'] });
  assert.equal(fileRow(r, 'features/shared/components/CurrencyLabel.tsx').score, 1);
  assert.equal(fileRow(r, 'features/shared/index.ts').score, 0.5);
  // distance 2 (1/3) across a feature boundary (x0.6) -> 0.2
  assert.equal(fileRow(r, 'features/billing/components/BillingView.tsx').score, 0.2);
  const scores = r.files.map((f) => f.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'files come back ranked');
});

test('features are rolled up with their layers, and directories outside features/ are kept separate', () => {
  const r = analyzeImpact(EXAMPLE, { seeds: ['feature:login'] });
  const login = r.features.find((f) => f.name === 'login');
  assert.equal(login.kind, 'feature');
  assert.equal(login.seeded, true);
  assert.deepEqual(login.layers.map((l) => l.layer).sort(), ['component', 'controller', 'domain', 'hook', 'page', 'service', 'unclassified', 'workflow']);
  assert.ok(login.layers.find((l) => l.layer === 'page').canImport.length, 'each layer carries what the project graph lets it import');
  const app = r.features.find((f) => f.name === 'app');
  assert.equal(app.kind, 'directory', 'the route file is not pretended to be a feature');
});

// ---- provenance: the point of the ticket ---------------------------------------------------------

test('explicit seeds produce derived entries only — the graph, no judgement', () => {
  const r = analyzeImpact(SHARED, { seeds: ['features/shared/components/CurrencyLabel.tsx'] });
  assert.ok(r.files.every((f) => f.provenance === 'derived' && f.confidence === 1));
  assert.equal(r.stats.inferred, 0);
  assert.match(r.summary, /every entry derived deterministically/);
});

test('an inferred seed taints everything only it reaches, and confidence propagates', () => {
  const r = analyzeImpact(SHARED, {
    seeds: [
      'features/billing/domain/billingRules.ts',
      { ref: 'feature:checkout', provenance: 'inferred', method: 'model', confidence: 0.4 },
    ],
  });
  assert.equal(fileRow(r, 'features/billing/domain/billingRules.ts').provenance, 'derived');
  assert.equal(fileRow(r, 'features/checkout/domain/checkoutRules.ts').provenance, 'inferred');
  assert.equal(fileRow(r, 'features/checkout/domain/checkoutRules.ts').confidence, 0.4);
  assert.equal(r.features.find((f) => f.name === 'billing').provenance, 'derived');
  assert.equal(r.features.find((f) => f.name === 'checkout').provenance, 'inferred');
  assert.equal(r.stats.derived + r.stats.inferred, r.files.length);
  assert.ok(r.files.every((f) => f.derivedFrom.length), 'every entry names the seed(s) it came from');
});

test('a file reached from both an explicit and an inferred seed counts as derived', () => {
  const r = analyzeImpact(SHARED, {
    seeds: [
      'features/shared/components/CurrencyLabel.tsx',
      { ref: 'feature:billing', provenance: 'inferred', method: 'text-match', confidence: 0.7 },
    ],
    depth: 2,
  });
  const view = fileRow(r, 'features/billing/components/BillingView.tsx');
  assert.equal(view.provenance, 'derived', 'reachable from the explicit seed, so no judgement is involved');
  assert.equal(view.derivedFrom.length, 2);
});

// ---- shared-component and the other warnings ------------------------------------------------------

test('a component used by other features is flagged, even when they reach it through a barrel', () => {
  const r = analyzeImpact(SHARED, { seeds: ['features/shared/components/CurrencyLabel.tsx'] });
  const w = r.warnings.find((x) => x.code === 'SHARED-COMPONENT' && x.file === 'features/shared/components/CurrencyLabel.tsx');
  assert.ok(w, 'the shared component warning fires');
  assert.deepEqual(w.usedBy, ['billing', 'checkout', 'reporting']);
  assert.match(w.message, /used by 3 other feature\(s\)/);
});

test('a blast radius that leaves the seeded feature is called out', () => {
  const r = analyzeImpact(SHARED, { seeds: ['features/shared/components/CurrencyLabel.tsx'] });
  const w = r.warnings.find((x) => x.code === 'CROSS-FEATURE');
  assert.deepEqual(w.usedBy, ['billing', 'checkout', 'reporting']);
  const local = analyzeImpact(SHARED, { seeds: ['features/billing/domain/billingRules.ts'] });
  assert.equal(local.warnings.find((x) => x.code === 'CROSS-FEATURE'), undefined, 'a feature-local change gets no cross-feature warning');
});

test('touching a file behind a public API is flagged', () => {
  const r = analyzeImpact(EXAMPLE, { seeds: ['features/login/hooks/useLogin.tsx'] });
  const w = r.warnings.find((x) => x.code === 'PUBLIC-API');
  assert.equal(w.feature, 'login');
  assert.ok(w.files.includes('features/login/hooks/useLogin.tsx'));
});

test('the cap degrades gracefully instead of emitting an unreadable report', () => {
  const r = analyzeImpact(SHARED, { seeds: ['feature:billing', 'feature:checkout'], limits: { maxFiles: 5 } });
  assert.equal(r.files.length, 5);
  assert.equal(r.stats.truncated, true);
  assert.ok(r.warnings.some((x) => x.code === 'TRUNCATED'));
});

// ---- rules: what the project already forbids ------------------------------------------------------

test('existing rule findings on the implicated files come along, with the layer constraints', () => {
  const r = analyzeImpact(INVALID, { seeds: ['rule:PAGE-003'] });
  assert.ok(r.seeds[0].resolved);
  assert.ok(r.seeds[0].files > 0, 'a rule seed implicates the files currently violating it');
  assert.ok(r.rules.counts.error > 0);
  assert.ok(r.rules.violations.every((v) => pathsOf(r).includes(v.file)), 'only findings on implicated files');
  assert.ok(r.rules.layerConstraints.length, 'the report says what each touched layer may import');
  assert.ok(r.next.some((n) => n.cli === 'construct validate'));
});

// ---- the PR-health entry point (#285) --------------------------------------------------------------

test('impactFromChangedFiles is the same computation, seeded from a diff', () => {
  const files = ['features/billing/domain/billingRules.ts', 'features/checkout/domain/checkoutRules.ts'];
  const viaFiles = impactFromChangedFiles(SHARED, files);
  const viaSeeds = analyzeImpact(SHARED, { files });
  assert.equal(JSON.stringify(viaFiles), JSON.stringify(viaSeeds), 'one implementation, not two');
  assert.ok(viaFiles.seeds.every((s) => s.method === 'changed-files' && s.provenance === 'explicit'));
  assert.equal(viaFiles.stats.inferred, 0, 'git is deterministic, so every row of a PR-health report is derived');
  assert.deepEqual(viaFiles.features.filter((f) => f.kind === 'feature').map((f) => f.name).sort(), ['billing', 'checkout']);
});

test('a changed file that is not project source is reported as an unresolved seed, not an error', () => {
  const r = impactFromChangedFiles(SHARED, ['README.md', 'features/billing/domain/billingRules.ts']);
  assert.equal(r.ok, true);
  assert.equal(r.stats.seedsUnresolved, 1);
  assert.equal(r.stats.seedsResolved, 1);
  assert.equal(r.seeds.find((s) => s.ref === 'README.md').resolved, false);
});

// ---- the optional, still LLM-free, ticket-text layer ------------------------------------------------

test('ticket text proposes candidate units, always inferred, always with evidence', () => {
  const p = proposeSeedsFromText(SHARED, 'The checkout total is wrong in EUR. Look at `CurrencyLabel` and the /billing screen; totalBilling double-counts.');
  assert.equal(p.ok, true);
  assertSchema(p, 'proposal');
  assert.ok(p.seeds.every((s) => s.provenance === 'inferred' && s.method === 'text-match' && s.evidence));
  const refs = p.seeds.map((s) => s.ref);
  assert.ok(refs.includes('feature:checkout'), 'a feature named in prose');
  assert.ok(refs.includes('route:/billing'), 'a route named in prose');
  assert.ok(refs.includes('file:features/shared/components/CurrencyLabel.tsx'), 'an exported identifier named in prose');
  assert.ok(refs.includes('file:features/billing/domain/billingRules.ts'), 'a function named in prose');
  const scores = p.seeds.map((s) => s.confidence);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'candidates come back ranked by confidence');
});

test('a ticket that matches nothing says so rather than guessing', () => {
  const r = impactFromTicketText(SHARED, 'Please make the thing faster and nicer.');
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'NO_SEEDS_RESOLVED');
});

test('an impact report built from ticket text marks every entry inferred', () => {
  const r = impactFromTicketText(SHARED, 'The `CurrencyLabel` shows the wrong currency.');
  assert.equal(r.ok, true);
  assertSchema(r, 'ticket-impact');
  assert.equal(r.stats.derived, 0);
  assert.ok(r.files.every((f) => f.provenance === 'inferred'));
  assert.equal(r.proposal.method, 'text-match');
});

test('no LLM is reachable from the impact module', () => {
  const src = fs.readFileSync(path.join(REPO, 'src', 'engine', 'impact.mjs'), 'utf8');
  assert.equal(/llm|ollama|openai|anthropic|fetch\(/i.test(src.replace(/no LLM|an LLM|LLM-free|a model|model proposed|method: "model"/g, '')), false, 'the deterministic core stays offline');
});

// ---- errors, contracts, rendering -------------------------------------------------------------------

test('errors are structured, never thrown', () => {
  assert.equal(analyzeImpact('/nope/not/here', { seeds: ['x'] }).error.code, 'ROOT_NOT_FOUND');
  assert.equal(analyzeImpact(EXAMPLE, {}).error.code, 'INVALID_ARGUMENT');
  assert.equal(analyzeImpact(EXAMPLE, { seeds: ['feature:login'], depth: 'deep' }).error.code, 'INVALID_ARGUMENT');
  assert.equal(analyzeImpact(EXAMPLE, { seeds: ['../../etc/passwd'] }).error.code, 'NO_SEEDS_RESOLVED');
  const tooMany = analyzeImpact(EXAMPLE, { seeds: ['feature:login', 'feature:signup'], limits: { maxSeeds: 1 } });
  assert.equal(tooMany.error.code, 'INVALID_ARGUMENT');
  for (const e of [analyzeImpact(EXAMPLE, {}), analyzeImpact(EXAMPLE, { seeds: ['nope'] })]) assertSchema(e, 'error');
});

test('the manifest describes the API it actually exposes', () => {
  const m = impactApiManifest();
  assert.equal(m.schemaVersion, SCHEMA_VERSION);
  assert.equal(m.schema, 'schemas/impact-report.v1.json');
  assert.deepEqual(Object.keys(m.calls).sort(), ['analyzeImpact', 'impactFromChangedFiles', 'impactFromTicketText', 'proposeSeedsFromText']);
  assert.ok(m.provenance.seed && m.provenance.entry);
});

test('markdown rendering covers seeds, features, files, warnings and the beyond-depth tail', () => {
  const md = renderImpactMarkdown(analyzeImpact(SHARED, { seeds: ['features/shared/components/CurrencyLabel.tsx'] }));
  assert.match(md, /# Impact: impact-shared/);
  assert.match(md, /## Features touched/);
  assert.match(md, /SHARED-COMPONENT/);
  assert.match(md, /one hop beyond the depth limit/);
  assert.match(renderImpactMarkdown(analyzeImpact(EXAMPLE, {})), /# Impact error: INVALID_ARGUMENT/);
});

// ---- the CLI surface --------------------------------------------------------------------------------

test('construct research impact prints a JSON report', () => {
  const r = spawnSync('node', [CLI, 'research', 'impact', 'features/shared/components/CurrencyLabel.tsx', '--dir', SHARED], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.ok, true);
  assertSchema(json, 'cli');
  assert.equal(json.warnings.some((w) => w.code === 'SHARED-COMPONENT'), true);
  assert.equal(r.stdout.includes('[tool:'), false, 'JSON output stays machine-readable');
});

test('construct research impact --format markdown, --depth and --ticket work end to end', () => {
  const md = spawnSync('node', [CLI, 'research', 'impact', 'features/billing/domain/billingRules.ts', '--depth', '1', '--format', 'markdown', '--dir', SHARED], { encoding: 'utf8' });
  assert.equal(md.status, 0, md.stderr);
  assert.match(md.stdout, /# Impact: impact-shared/);
  assert.match(md.stdout, /\[tool: produced the read-only report above\] \[llm: 0 calls\]/);
  assert.equal(md.stdout.includes('features/billing/workflows/BillingWorkflow.ts'), false, '--depth 1 stops before the workflow');

  const ticket = spawnSync('node', [CLI, 'research', 'impact', '--ticket', 'The `CurrencyLabel` is wrong on /billing', '--dir', SHARED], { encoding: 'utf8' });
  assert.equal(ticket.status, 0, ticket.stderr);
  const json = JSON.parse(ticket.stdout);
  assert.ok(json.seeds.every((s) => s.provenance === 'inferred'));
  assert.ok(json.files.every((f) => f.provenance === 'inferred'));
});

test('construct research impact --usage documents the API, and a bad invocation explains itself', () => {
  const usage = spawnSync('node', [CLI, 'research', 'impact', '--usage', '--dir', SHARED], { encoding: 'utf8' });
  assert.equal(usage.status, 0, usage.stderr);
  assert.equal(JSON.parse(usage.stdout).schema, 'schemas/impact-report.v1.json');
  const bad = spawnSync('node', [CLI, 'research', 'impact', '--dir', SHARED], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Usage: construct research impact/);
});
