// #643 -- the `decision-trace.v1` record: built with a deterministic id, validated by named code, refused when it holds a path
// or a secret, serialised with sorted keys, outcomes as separate records, and the modules import nothing that can reach the
// network. The worked example in docs/DECISION-TRACES.md is executed here so it cannot go stale.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { DECISION_SOURCES, EXIT_ANSWER } from '../packages/core/chooser.mjs';
import { hidePaths, hidePathsDeep, looksLikePath, looksLikeSecret } from '../packages/core/redaction.mjs';
import {
  TRACE_VERSION, TRACE_SOURCES, TRACE_EXIT_ANSWER, TRACE_ERROR_CODES, OUTCOME_FIELDS, buildTrace, buildOutcomeRecord, canonicalize,
  isGoodOutcome, mergeOutcomes, parseTraceLine, redactionProblems, serializeTrace, traceId, validateOutcomeRecord, validateTrace,
} from '../packages/core/decision-trace.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const AT = '2026-09-24T10:00:00.000Z';
const codes = (r) => r.errors.map((e) => e.code);
const opt = (id) => ({ id, label: id.toUpperCase(), enabled: true, why: `Because ${id}.` });
const summary = (over = {}) => ({ id: 'app.unit', question: 'What is the first unit?', options: [opt('domain'), opt('page'), opt('hook')], chosen: null, ...over });
const input = (over = {}) => ({ summary: summary(), chosen: 'page', by: 'person', ...over });
const good = (over = {}) => {
  const b = buildTrace(input(over), { at: AT });
  assert.equal(b.ok, true, JSON.stringify(b.errors));
  return b.trace;
};

test('the closed sets and the error codes: a frozen name-to-name map, the same sources as a chooser', () => {
  assert.equal(TRACE_VERSION, 'decision-trace.v1');
  assert.equal(Object.isFrozen(TRACE_ERROR_CODES), true);
  for (const [k, v] of Object.entries(TRACE_ERROR_CODES)) assert.equal(k, v);
  assert.deepEqual([...TRACE_SOURCES], [...DECISION_SOURCES]);
  assert.equal(TRACE_EXIT_ANSWER, EXIT_ANSWER);
  assert.deepEqual([...OUTCOME_FIELDS], ['planValidated', 'testsPassed', 'reverted', 'accepted']);
});

test('buildTrace derives chooser and options from the summary, forces the offered summary, and the trace validates', () => {
  const t = good({ summary: summary({ chosen: 'domain' }) });
  assert.equal(t.version, 'decision-trace.v1');
  assert.deepEqual(t.chooser, { id: 'app.unit', question: 'What is the first unit?' });
  assert.deepEqual(t.options, ['domain', 'page', 'hook']);
  assert.equal(t.summary.chosen, null, 'the summary is what was offered, not what was chosen');
  assert.equal(t.at, AT);
  assert.equal(t.by, 'person');
  assert.deepEqual(validateTrace(t), { valid: true, errors: [] });
  assert.ok(!('provider' in t) && !('suggestion' in t) && !('outcome' in t));
});

test('the id is a deterministic hash of the identifying fields: same decision, same id; a different choice, chooser or chooser summary, another', () => {
  const a = good();
  assert.match(a.id, /^dt-[0-9a-f]{24}$/);
  assert.equal(good().id, a.id);
  assert.equal(good({ suggestion: { option: 'domain', reason: 'first' }, outcome: { accepted: false } }).id, a.id, 'what a provider suggested is not part of the identity');
  assert.equal(buildTrace(input(), { at: '2030-01-01T00:00:00.000Z' }).trace.id, a.id, 'nor is the time');
  assert.notEqual(good({ chosen: 'hook' }).id, a.id);
  assert.notEqual(good({ by: 'llm' }).id, a.id);
  assert.notEqual(good({ summary: summary({ question: 'Another question?' }) }).id, a.id);
  assert.equal(traceId({ chooser: a.chooser, summary: a.summary, chosen: a.chosen, by: a.by }), a.id);
});

test('serialisation is deterministic: sorted keys at every depth, one line, whatever order the keys were built in', () => {
  const a = good();
  const shuffled = { chosen: a.chosen, summary: { options: a.summary.options.map((o) => ({ why: o.why, id: o.id, enabled: o.enabled, label: o.label })), chosen: null, question: a.summary.question, id: a.summary.id }, by: a.by, at: a.at, options: a.options, chooser: { question: a.chooser.question, id: a.chooser.id }, id: a.id, version: a.version };
  assert.equal(serializeTrace(shuffled), serializeTrace(a));
  assert.equal(serializeTrace(a).includes('\n'), false);
  const keys = Object.keys(JSON.parse(serializeTrace(a)));
  assert.deepEqual(keys, [...keys].sort());
  assert.equal(JSON.stringify(canonicalize({ b: 1, a: { d: 1, c: undefined } })), '{"a":{"d":1},"b":1}');
  assert.deepEqual(parseTraceLine(serializeTrace(a)), { ok: true, kind: 'decision', record: a });
});

test('validation: every error code, by name', () => {
  const t = good();
  const bad = (over) => validateTrace({ ...t, ...over });
  assert.deepEqual(codes(validateTrace(null)), ['TRACE_NOT_OBJECT']);
  assert.ok(codes(bad({ extra: 1 })).includes('TRACE_FIELD_UNKNOWN'));
  assert.ok(codes(bad({ version: 'decision-trace.v0' })).includes('TRACE_VERSION_INVALID'));
  assert.ok(codes(bad({ id: 'nope' })).includes('TRACE_ID_INVALID'));
  assert.ok(codes(bad({ id: `dt-${'0'.repeat(24)}` })).includes('TRACE_ID_MISMATCH'));
  assert.ok(codes(bad({ chosen: 'hook' })).includes('TRACE_ID_MISMATCH'), 'changing a field without its id is detected');
  assert.ok(codes(bad({ at: 'yesterday' })).includes('TRACE_AT_INVALID'));
  assert.ok(codes(bad({ at: '2026-13-45T99:00:00Z' })).includes('TRACE_AT_INVALID'));
  assert.ok(codes(bad({ chooser: { id: 'has space', question: 'q' } })).includes('TRACE_CHOOSER_INVALID'));
  assert.ok(codes(bad({ chooser: { id: 'a.b' } })).includes('TRACE_CHOOSER_INVALID'));
  assert.ok(codes(bad({ summary: 'nope' })).includes('TRACE_SUMMARY_INVALID'));
  assert.ok(codes(bad({ summary: { ...t.summary, chosen: 'page' } })).includes('TRACE_SUMMARY_INVALID'), 'a summary that already names the choice is not what was offered');
  assert.ok(codes(bad({ summary: { ...t.summary, note: 'x'.repeat(20000) } })).includes('TRACE_SUMMARY_TOO_LARGE'));
  assert.ok(codes(bad({ options: ['domain'] })).includes('TRACE_OPTIONS_INVALID'));
  assert.ok(codes(bad({ options: ['a', 'b', 'c', 'd', 'e', 'f'] })).includes('TRACE_OPTIONS_INVALID'));
  assert.ok(codes(bad({ options: ['domain', 'domain'] })).includes('TRACE_OPTIONS_INVALID'));
  assert.ok(codes(bad({ options: ['domain', 'page', 'other'] })).includes('TRACE_OPTIONS_MISMATCH'));
  assert.ok(codes(bad({ chosen: 'teleport' })).includes('TRACE_CHOSEN_INVALID'));
  assert.ok(codes(bad({ by: 'robot' })).includes('TRACE_BY_INVALID'));
  assert.ok(codes(bad({ provider: { name: 'x' } })).includes('TRACE_PROVIDER_INVALID'));
  assert.ok(codes(bad({ suggestion: { option: 'teleport', reason: 'r' } })).includes('TRACE_SUGGESTION_INVALID'));
  assert.ok(codes(bad({ suggestion: { option: 'page', reason: '' } })).includes('TRACE_SUGGESTION_INVALID'));
  assert.ok(codes(bad({ suggestion: { option: 'page', reason: 'r', score: 2 } })).includes('TRACE_SUGGESTION_INVALID'));
  assert.ok(codes(bad({ outcome: { planValidated: 'yes' } })).includes('TRACE_OUTCOME_INVALID'));
  assert.ok(codes(bad({ outcome: { happy: true } })).includes('TRACE_OUTCOME_INVALID'));
  const disabled = good({ summary: summary({ options: [opt('domain'), { ...opt('page'), enabled: false }, opt('hook')] }), chosen: 'domain' });
  assert.ok(codes(validateTrace({ ...disabled, chosen: 'page' })).includes('TRACE_CHOSEN_INVALID'), 'a disabled option was not on offer');
  assert.deepEqual(validateTrace(good({ chosen: TRACE_EXIT_ANSWER })), { valid: true, errors: [] }, 'the exit is a valid answer');
  assert.deepEqual(validateTrace(good({ provider: { name: 'jev', version: '1.2' }, suggestion: { option: 'domain', reason: 'first', score: 0.6 }, outcome: { accepted: false, planValidated: true } })), { valid: true, errors: [] });
});

test('redaction: a record holding an absolute path, ~/, ./, ../ or a secret-shaped token is REFUSED, never repaired, and the text is not echoed', () => {
  const paths = ['/etc/passwd', '~/notes.txt', '../secrets.env', './local.json', 'C:\\Users\\me\\file', 'see /home/dev/project/src'];
  for (const p of paths) {
    const b = buildTrace(input({ summary: summary({ question: `Open ${p} now?` }) }), { at: AT });
    assert.equal(b.ok, false, p);
    assert.equal(b.trace, null);
    assert.ok(codes(b).includes('TRACE_REDACTION_PATH'), p);
    assert.equal(JSON.stringify(b.errors).includes('passwd'), false, 'the offending text is not echoed');
  }
  const secrets = ['ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'sk-abcdefghijklmnopqrstuvwx', 'AKIAABCDEFGHIJKLMNOP', 'xoxb-1234567890-abcdefghij', '-----BEGIN RSA PRIVATE KEY-----', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig', 'Bearer abcdefghijklmnop1234', 'password: hunter2hunter2', 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'];
  for (const s of secrets) {
    const b = buildTrace(input({ summary: summary({ options: [opt('domain'), { ...opt('page'), why: `Use ${s} here` }, opt('hook')] }) }), { at: AT });
    assert.equal(b.ok, false, s);
    assert.ok(codes(b).includes('TRACE_REDACTION_SECRET'), s);
  }
  const t = good();
  for (const [where, rec] of [['suggestion.reason', { ...t, suggestion: { option: 'page', reason: 'see ../x' } }], ['provider.name', { ...t, provider: { name: '/opt/plugin', version: '1' } }], ['a key', { ...t, summary: { ...t.summary, '/tmp/key': 1 } }]]) {
    assert.ok(codes(validateTrace(rec)).some((c) => c.startsWith('TRACE_REDACTION')), where);
  }
  assert.deepEqual(redactionProblems(t), []);
  assert.equal(redactionProblems({ summary: { question: 'open ~/notes' } })[0].code, 'TRACE_REDACTION_PATH');
  for (const fine of ['read and/or write', 'a 1/2 split', 'Yes / No', 'the cart', 'version 1.2.3', 'https-only']) {
    assert.equal(looksLikePath(fine) || looksLikeSecret(fine) !== null, false, fine);
  }
});

test('redaction helpers: hidePaths is the chooser summary rule, applied deep', () => {
  assert.equal(hidePaths('open ~/notes and /etc/hosts'), 'open [path] and [path]');
  assert.deepEqual(hidePathsDeep({ q: 'What is /x now?', n: 3, options: [{ id: 'a', why: 'see ../y' }] }), { q: 'What is [path] now?', n: 3, options: [{ id: 'a', why: 'see [path]' }] });
  const b = buildTrace(input({ summary: hidePathsDeep(summary({ question: 'What is /admin now?' })) }), { at: AT });
  assert.equal(b.ok, true, 'a summary hidden the way chooserSummary hides it is recordable');
});

test('outcomes are SEPARATE records that reference the decision id; merging never rewrites the decision', () => {
  const t = good({ suggestion: { option: 'domain', reason: 'first' }, provider: { name: 'rules', version: '1' }, outcome: { accepted: false } });
  const o1 = buildOutcomeRecord({ of: t.id, outcome: { planValidated: true } }, { at: '2026-09-24T10:05:00.000Z' });
  const o2 = buildOutcomeRecord({ of: t.id, outcome: { testsPassed: false, planValidated: false } }, { at: '2026-09-24T10:06:00.000Z' });
  assert.equal(o1.ok, true);
  assert.deepEqual(o1.record, { version: 'decision-trace.v1', kind: 'outcome', of: t.id, at: '2026-09-24T10:05:00.000Z', outcome: { planValidated: true } });
  const before = structuredClone(t);
  const merged = mergeOutcomes([t], [o1.record, o2.record])[0];
  assert.deepEqual(merged.outcome, { accepted: false, planValidated: false, testsPassed: false }, 'later records win per label');
  assert.deepEqual(t, before, 'the decision is untouched');
  assert.deepEqual(mergeOutcomes([good({ chosen: 'hook' })], [])[0].outcome, undefined);
  assert.deepEqual(parseTraceLine(serializeTrace(o1.record)), { ok: true, kind: 'outcome', record: o1.record });
  // its validation codes
  const rec = o1.record;
  assert.ok(codes(validateOutcomeRecord({ ...rec, of: 'x' })).includes('TRACE_OUTCOME_REF_INVALID'));
  assert.ok(codes(validateOutcomeRecord({ ...rec, kind: 'decision' })).includes('TRACE_KIND_INVALID'));
  assert.ok(codes(validateOutcomeRecord({ ...rec, at: 'x' })).includes('TRACE_AT_INVALID'));
  assert.ok(codes(validateOutcomeRecord({ ...rec, outcome: {} })).includes('TRACE_OUTCOME_INVALID'));
  assert.ok(codes(validateOutcomeRecord({ ...rec, outcome: { planValidated: 1 } })).includes('TRACE_OUTCOME_INVALID'));
  assert.ok(codes(validateOutcomeRecord({ ...rec, extra: 1 })).includes('TRACE_FIELD_UNKNOWN'));
  assert.ok(codes(validateOutcomeRecord({ ...rec, version: 'v0' })).includes('TRACE_VERSION_INVALID'));
  assert.deepEqual(codes(validateOutcomeRecord(7)), ['TRACE_NOT_OBJECT']);
  assert.equal(buildOutcomeRecord({ of: t.id, outcome: {} }, { at: AT }).ok, false);
  assert.deepEqual(codes(parseTraceLine('{nope')), ['TRACE_LINE_INVALID']);
});

test('a good outcome: one positive label and no negative one; overriding a suggestion is not a failure', () => {
  assert.equal(isGoodOutcome({ planValidated: true }), true);
  assert.equal(isGoodOutcome({ accepted: true }), true);
  assert.equal(isGoodOutcome({ planValidated: true, reverted: true }), false);
  assert.equal(isGoodOutcome({ testsPassed: false, accepted: true }), false);
  assert.equal(isGoodOutcome({ accepted: false }), false, 'no positive label');
  assert.equal(isGoodOutcome({ accepted: false, planValidated: true }), true);
  assert.equal(isGoodOutcome(undefined), false);
});

/** The relative modules a file imports, transitively, and every bare/builtin specifier on the way. */
function importClosure(entry) {
  const seen = new Set();
  const external = new Set();
  const sources = new Map();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = fs.readFileSync(file, 'utf8');
    sources.set(file, text);
    for (const m of text.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec.startsWith('.')) {
        const next = path.resolve(path.dirname(file), spec);
        if (fs.existsSync(next)) walk(next);
      } else external.add(spec);
    }
  };
  walk(entry);
  return { files: [...seen], external: [...external].sort(), sources };
}

test('no network: the trace modules and everything they import reach no socket, no HTTP client and no subprocess', () => {
  const NETWORK = /^(?:node:)?(?:http|https|http2|net|tls|dns|dgram|cluster|inspector)(?:\/.*)?$/;
  // The adapters wrap the chooser, card and placement blocks, whose own closure (block-flows -> the process engine) already spawns
  // local commands; every OTHER trace module must also import no subprocess or worker.
  const SUBPROCESS = /^(?:node:)?(?:child_process|worker_threads|vm|repl)(?:\/.*)?$/;
  const THIRD_PARTY = /^(?:axios|node-fetch|undici|got|ws|socket\.io|superagent|request|ky|cross-fetch)$/;
  const CALLS = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*[(.]|\bnew\s+(?:WebSocket|EventSource)\b/;
  for (const name of ['decision-trace.mjs', 'redaction.mjs', 'decision-trace-store.mjs', 'decision-trace-adapters.mjs', 'decision-trace-replay.mjs']) {
    const { files, external, sources } = importClosure(path.join(here, '..', 'packages', 'core', name));
    for (const spec of external) {
      assert.equal(NETWORK.test(spec) || THIRD_PARTY.test(spec) || (name !== 'decision-trace-adapters.mjs' && SUBPROCESS.test(spec)), false, `${name} imports ${spec}`);
    }
    for (const file of files) {
      // comments and string or template literals are not calls (a rule description says "fetch()", a generator template writes it)
      const text = sources.get(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, "''");
      assert.equal(CALLS.test(text), false, `${path.relative(path.join(here, '..'), file)} (imported by ${name}) calls a network API`);
    }
  }
  // the format module is a leaf: a person, a plugin or a browser can use it with nothing else loaded
  assert.deepEqual(importClosure(path.join(here, '..', 'packages', 'core', 'decision-trace.mjs')).external, ['node:crypto']);
  assert.equal(importClosure(path.join(here, '..', 'packages', 'core', 'decision-trace.mjs')).files.length, 2);
});

test('the pure functions read no clock: `at` comes from the caller', () => {
  const source = fs.readFileSync(path.join(here, '..', 'packages', 'core', 'decision-trace.mjs'), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/Date\.now|new Date|performance\.now|Math\.random|randomUUID|randomBytes/.test(source), false);
  assert.equal(/\bfs\b|readFile|writeFile/.test(source), false);
});

test('the worked example in docs/DECISION-TRACES.md runs and produces exactly the record the doc shows', async () => {
  const doc = fs.readFileSync(path.join(here, '..', 'docs', 'DECISION-TRACES.md'), 'utf8');
  const code = /<!-- trace-example:code -->\n```js\n([\s\S]*?)```/.exec(doc)?.[1];
  const shown = /<!-- trace-example:result -->\n```json\n([\s\S]*?)```/.exec(doc)?.[1];
  assert.ok(code && shown, 'the doc carries both example blocks');
  const url = (f) => pathToFileURL(path.join(here, '..', 'packages', 'core', f)).href;
  assert.match(code, /'@line\/construct-core\/decision-trace'/);
  const dir = makeTempDir('og643-doc-');
  const file = path.join(dir, 'example.mjs');
  fs.writeFileSync(file, code.replace("'@line/construct-core/decision-trace'", `'${url('decision-trace.mjs')}'`));
  const { result } = await import(pathToFileURL(file).href);
  assert.deepEqual(JSON.parse(shown), JSON.parse(JSON.stringify(result)));
});
