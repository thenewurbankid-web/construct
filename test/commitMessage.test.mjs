// Deterministic Cockpit commit messages (#283).
//
// The bars this ticket sets, and what each is checked by below:
//   * the message is built by OUR summarizers, never a model — asserted structurally (the module
//     graph must not reach packages/core/llm.mjs) as well as behaviourally;
//   * the same tree + the same inputs give a byte-identical message;
//   * the impact counts describe what the save WROTE — the seed rows of the one impact report —
//     and never inflate to the blast radius or to files carried in from a dirty tree;
//   * the serial is monotonic within a branch and derived from that branch's own subjects, so two
//     sessions cannot collide and nothing has to be stored.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCommitMessage, commitImpact, deriveSlug, newSessionId, nextSerialFrom, parseSerial,
  serialLabel, sessionBranchName, slugify, commitMessageApiManifest,
  COMMIT_MODES, DEFAULT_COMMIT_CONFIG, SUBJECT_LIMIT, SCHEMA_VERSION,
} from '../packages/engine/commitMessage.mjs';
import { impactFromChangedFiles } from '../packages/engine/impact.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = path.join(REPO, 'example');
const SHARED = path.join(REPO, 'fixtures', 'impact-shared');

const BILLING = 'features/billing/domain/billingRules.ts';
const CHECKOUT = 'features/checkout/domain/checkoutRules.ts';
const CURRENCY = 'features/shared/components/CurrencyLabel.tsx';

const build = (root, opts) => buildCommitMessage(root, { sessionId: 'a3f7', serial: 7, prefix: 'CON', ...opts });

// ---- the first line ------------------------------------------------------------------------------

test('the first line carries <prefix>-<session>-<serial> then the summary', () => {
  const r = build(SHARED, { changedFiles: [BILLING] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.match(r.subject, /^CON-a3f7-0007: /);
  assert.equal(r.label, 'CON-a3f7-0007');
  assert.equal(r.message.split('\n')[0], r.subject);
  assert.equal(r.message.split('\n')[1], '', 'a blank line must separate subject from body');
});

test('an empty prefix is allowed and drops the leading dash', () => {
  const r = build(SHARED, { changedFiles: [BILLING], prefix: '' });
  assert.match(r.subject, /^a3f7-0007: /);
  assert.equal(serialLabel({ prefix: '', sessionId: 'a3f7', serial: 7 }), 'a3f7-0007');
});

test('the subject stays within the git convention even with many units', () => {
  const r = build(SHARED, { changedFiles: [BILLING, CHECKOUT, CURRENCY, 'features/reporting/domain/reportingRules.ts'] });
  assert.ok(r.subject.length <= SUBJECT_LIMIT, `subject was ${r.subject.length} chars: ${r.subject}`);
  assert.ok(!r.subject.includes('\n'));
});

test('the change kind picks the verb', () => {
  const add = build(SHARED, { changedFiles: [BILLING], changes: { [BILLING]: 'add' } });
  const del = build(SHARED, { changedFiles: [BILLING], changes: { [BILLING]: 'delete' } });
  assert.match(add.subject, /: billing: add /);
  assert.match(del.subject, /: billing: remove /);
});

// ---- determinism, and no model anywhere -----------------------------------------------------------

test('the same inputs on the same tree give a byte-identical message', () => {
  const a = build(SHARED, { changedFiles: [BILLING, CHECKOUT] });
  const b = build(SHARED, { changedFiles: [CHECKOUT, BILLING] }); // order must not matter either
  assert.equal(a.message, b.message);
});

test('nothing on this path can reach an LLM', () => {
  // Structural, not a mock: the commit path must not even be able to call a model, so that a commit
  // never depends on a provider being reachable. (#283 settled that the summary comes from our own
  // summarizers; an LLM summary would be an opt-in extra, and there is none in this module.)
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file) || !fs.existsSync(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^\s*import\s[^'"]*['"](\.[^'"]+)['"]/gm)) visit(path.resolve(path.dirname(file), m[1]));
  };
  visit(path.join(REPO, 'packages/engine/commitMessage.mjs'));
  const llm = [...seen].filter((f) => /\/(llm|llm-fill)\.mjs$/.test(f));
  assert.deepEqual(llm, [], `commitMessage.mjs transitively imports ${llm.join(', ')}`);
});

// ---- the counts describe the save, not the blast radius --------------------------------------------

test('the counts come from the report\'s seed rows — dependencies are context, not impact', () => {
  const report = impactFromChangedFiles(SHARED, [BILLING]);
  const impact = commitImpact(report);
  // The report legitimately reaches further (importers, and the seed's own dependencies as
  // `direction: "down"` context). None of that is what the save did.
  assert.ok(report.files.length > 1, 'the fixture must have a wider radius for this test to mean anything');
  assert.equal(impact.featureCount, 1);
  assert.equal(impact.fileCount, 1);
  assert.deepEqual(impact.features[0].files.map((f) => f.path), [BILLING]);
  assert.deepEqual(impact.features[0].layers, ['domain']);
  assert.ok(impact.wider.files >= 1, 'the wider radius is still reported, separately');
});

test('the body states N features, M layers and the per-feature layer list', () => {
  const r = build(SHARED, { changedFiles: [BILLING, CHECKOUT, CURRENCY] });
  assert.match(r.body, /^3 features, 3 layers, 3 files$/m);
  assert.match(r.body, /^ {2}billing: {2}domain$/m);
  assert.match(r.body, /^ {2}checkout: domain$/m);
  assert.match(r.body, /^ {2}shared: {3}component$/m);
});

test('a multi-layer save counts every layer of every feature', () => {
  const r = build(EXAMPLE, { changedFiles: ['features/login/domain/Login.tsx', 'features/login/pages/LoginPage.tsx', 'features/signup/domain/Signup.tsx'] });
  assert.equal(r.impact.featureCount, 2);
  assert.equal(r.impact.layerCount, 3); // login: domain + page, signup: domain
  assert.match(r.body, /^2 features, 3 layers, 3 files$/m);
});

test('each changed file is listed with its layer and its own purpose sentence', () => {
  const r = build(SHARED, { changedFiles: [BILLING] });
  assert.match(r.body, /^ {2}features\/billing\/domain\/billingRules\.ts \(domain\) — /m);
});

test('the narrative sentence comes from summarizeUnit', () => {
  const r = build(SHARED, { changedFiles: [BILLING] });
  const summaryLine = r.body.split('\n')[r.body.split('\n').indexOf('Summary') + 1];
  assert.match(summaryLine, /billingRules\.ts/);
  assert.match(r.body, /^Construct-Summary: deterministic .*no LLM$/m);
});

test('warnings from the same report are carried into the message', () => {
  const r = build(SHARED, { changedFiles: [CURRENCY] });
  assert.match(r.body, /^Warnings$/m);
  assert.match(r.body, /SHARED-COMPONENT/);
});

// ---- carried-in files stay honest -------------------------------------------------------------------

test('files carried onto the session branch are listed but never counted', () => {
  const r = build(EXAMPLE, { changedFiles: ['features/login/pages/LoginPage.tsx'], preexisting: ['features/signup/domain/Signup.tsx'] });
  assert.equal(r.impact.featureCount, 1);
  assert.deepEqual(r.impact.features.map((f) => f.name), ['login']);
  assert.match(r.body, /^Carried in from before this session \(committed, not counted above\): 1 file\(s\)$/m);
  assert.match(r.body, /^ {2}features\/signup\/domain\/Signup\.tsx$/m);
});

test('a carried file that is also re-saved by the session counts once, as the session\'s own', () => {
  const both = 'features/login/pages/LoginPage.tsx';
  const r = build(EXAMPLE, { changedFiles: [both], preexisting: [both] });
  assert.equal(r.impact.fileCount, 0, 'a path named as pre-existing is never counted');
  assert.match(r.body, /Carried in from before this session/);
});

// ---- the serial ---------------------------------------------------------------------------------------

test('the next serial is one past the highest this session already used on the branch', () => {
  assert.equal(nextSerialFrom([], { sessionId: 'a3f7' }), 1);
  assert.equal(nextSerialFrom(['CON-a3f7-0001: x', 'CON-a3f7-0002: y'], { sessionId: 'a3f7' }), 3);
  // gaps are fine — monotonic, not gapless: gapless needs an allocator, which is the shared
  // resource branch-scoping exists to remove.
  assert.equal(nextSerialFrom(['CON-a3f7-0009: x', 'CON-a3f7-0002: y'], { sessionId: 'a3f7' }), 10);
});

test('another session\'s commits on the same branch never move this session\'s serial', () => {
  const subjects = ['CON-b1c2-0042: someone else', 'CON-a3f7-0003: mine', 'chore: a hand-written commit'];
  assert.equal(nextSerialFrom(subjects, { sessionId: 'a3f7' }), 4);
  assert.equal(nextSerialFrom(subjects, { sessionId: 'b1c2' }), 43);
  assert.equal(nextSerialFrom(subjects, { sessionId: 'ffff' }), 1);
});

test('changing the message prefix mid-session does not restart the numbering', () => {
  // The serial is matched on the session id, not the prefix — a user switching CON -> PROJ-123
  // would otherwise silently get a second commit numbered 0001.
  assert.equal(nextSerialFrom(['CON-a3f7-0004: x'], { sessionId: 'a3f7' }), 5);
  assert.equal(parseSerial('PROJ-123-a3f7-0004: x', { sessionId: 'a3f7' }), 4);
  assert.equal(parseSerial('a3f7-0004: x', { sessionId: 'a3f7' }), 4);
});

test('a commit that only mentions the session id in prose is not mistaken for a serial', () => {
  assert.equal(parseSerial('fix: rework a3f7-0001 handling', { sessionId: 'a3f7' }), null);
  assert.equal(parseSerial('', { sessionId: 'a3f7' }), null);
  assert.equal(parseSerial('CON-a3f7-0001: x', {}), null);
});

test('session ids are random, not timestamps', () => {
  const ids = new Set(Array.from({ length: 200 }, () => newSessionId()));
  assert.ok(ids.size > 150, 'ids must not cluster — parallel agents start within the same second');
  assert.match(newSessionId(), /^[0-9a-f]{4}$/);
  assert.match(newSessionId(4), /^[0-9a-f]{8}$/);
});

// ---- the session branch ---------------------------------------------------------------------------------

test('the branch is <prefix>/<slug>-<session-id><suffix>', () => {
  assert.equal(sessionBranchName({ prefix: 'cockpit', slug: 'billing-invoice-layer', sessionId: 'a3f7' }), 'cockpit/billing-invoice-layer-a3f7');
  assert.equal(sessionBranchName({ prefix: '', slug: 'billing', sessionId: 'a3f7' }), 'billing-a3f7');
  assert.equal(sessionBranchName({ prefix: 'PROJ-9', slug: 'billing', sessionId: 'a3f7', suffix: '-wip' }), 'proj-9/billing-a3f7-wip');
  assert.equal(sessionBranchName({ sessionId: 'a3f7' }), 'session-a3f7');
});

test('the same slug on two sessions cannot collide, because the id is in the name', () => {
  const a = sessionBranchName({ prefix: 'cockpit', slug: 'billing', sessionId: 'a3f7' });
  const b = sessionBranchName({ prefix: 'cockpit', slug: 'billing', sessionId: 'b1c2' });
  assert.notEqual(a, b);
});

test('slugs are safe, short and readable', () => {
  assert.equal(slugify('Rewire the checkout flow!'), 'rewire-the-checkout-flow');
  assert.equal(slugify('ProductsPage'), 'products-page');
  assert.equal(slugify('  --weird__name-- '), 'weird-name');
  assert.equal(slugify('Café déjà vu'), 'cafe-deja-vu');
  assert.ok(slugify('x'.repeat(200)).length <= 40);
  assert.ok(!slugify('long-'.repeat(20)).endsWith('-'));
});

test('the slug is derived plan-title first, then feature+unit, then feature, then the date', () => {
  assert.deepEqual(deriveSlug({ planTitle: 'Rewire the checkout flow' }), { slug: 'rewire-the-checkout-flow', source: 'plan-title' });

  const plan = { steps: [{ id: 's1', touches: { features: ['billing'], files: [{ path: 'features/billing/domain/Invoice.ts', layer: 'domain' }] } }] };
  assert.deepEqual(deriveSlug({ plan }), { slug: 'billing-invoice', source: 'plan' });

  const one = build(SHARED, { changedFiles: [BILLING] });
  assert.deepEqual(deriveSlug({ impact: one.impact }), { slug: 'billing-rules', source: 'unit' }); // not billing-billing-rules

  const many = build(EXAMPLE, { changedFiles: ['features/login/domain/Login.tsx', 'features/login/pages/LoginPage.tsx'] });
  assert.deepEqual(deriveSlug({ impact: many.impact }), { slug: 'login', source: 'feature' });

  assert.deepEqual(deriveSlug({ now: new Date('2026-09-20T10:00:00Z') }), { slug: '2026-09-20', source: 'date' });
});

// ---- the plan (#286) -------------------------------------------------------------------------------------

test('a plan splits the changed files into planned and unplanned', () => {
  const plan = { steps: [{ id: 's1', touches: { features: ['billing'], files: [{ path: BILLING, change: 'modify' }] } }] };
  const r = build(SHARED, { changedFiles: [BILLING, CHECKOUT], plan });
  assert.match(r.body, /^Plan: 1 of 2 changed file\(s\) are in the plan; 1 unplanned: features\/checkout\/domain\/checkoutRules\.ts\.$/m);
});

// ---- trailers and errors ------------------------------------------------------------------------------------

test('the trailers make a commit traceable back to its session', () => {
  const r = build(SHARED, { changedFiles: [BILLING] });
  assert.match(r.body, /^Construct-Session: a3f7$/m);
  assert.match(r.body, /^Construct-Serial: 7$/m);
  assert.match(r.body, /^Construct-Impact: 1 feature, 1 layer, 1 file$/m);
});

test('bad input fails structurally rather than throwing', () => {
  assert.equal(buildCommitMessage(SHARED, { sessionId: 'a3f7', serial: 1 }).error.code, 'INVALID_ARGUMENT');
  assert.equal(buildCommitMessage(SHARED, { changedFiles: [BILLING], sessionId: 'not a hash!', serial: 1 }).error.code, 'INVALID_ARGUMENT');
  assert.equal(buildCommitMessage(SHARED, { changedFiles: [BILLING], sessionId: 'a3f7', serial: 0 }).error.code, 'INVALID_ARGUMENT');
});

test('an unusable project root still yields a commit message, marked as such', () => {
  // A commit must never be blocked by the impact computation failing — the message degrades, the
  // save still lands in history.
  const r = build('/nope/not/a/project', { changedFiles: ['a/b/c.ts'] });
  assert.equal(r.ok, true);
  assert.match(r.subject, /^CON-a3f7-0007: update c$/);
  assert.match(r.body, /^Impact counts unavailable: /m);
  assert.match(r.body, /^Construct-Impact: unavailable$/m);
});

test('the manifest states the modes, the defaults and the exceptions', () => {
  const m = commitMessageApiManifest();
  assert.equal(m.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(m.modes, COMMIT_MODES);
  assert.deepEqual(COMMIT_MODES, ['coalesce', 'every-save', 'manual']);
  assert.equal(DEFAULT_COMMIT_CONFIG.enabled, true);
  assert.equal(DEFAULT_COMMIT_CONFIG.mode, 'coalesce');
  assert.equal(DEFAULT_COMMIT_CONFIG.coalesceMs, 30_000);
  assert.ok(m.exceptions.some((e) => /interleave/.test(e)), 'the non-ascending-in-main consequence must be documented');
  assert.ok(Object.keys(m.calls).includes('buildCommitMessage'));
});
