// #643 (epic #616) -- `decision-trace.v1`: every choice made in a chain, recorded as ONE clean classification example.
//
//   { version, id, at, chooser: { id, question }, summary, options: [ids], chosen, by, provider?, suggestion?, outcome? }
//
//   - `id` is a hash of what identifies the decision (chooser, the summary as offered, what was chosen, who chose), never a
//     random value, so recording the same decision twice is one record and a trace file can be diffed and deduplicated.
//   - `at` is injected by the caller: nothing in this file reads a clock, a file or the network.
//   - `summary` is the fixed-size, path-free object the person/LLM/decision model was OFFERED (`chooserSummary`, an open
//     question of a card, an offer of `placeCard`), with `chosen` null. Replaying it through a provider is therefore exactly
//     "what would this provider have said with the same input".
//   - a record is REFUSED (never repaired) when any string in it holds an absolute path, `~/`, `./`, `../` or a secret shape
//     (`redaction.mjs`, the same pattern `chooserSummary` hides), so a trace file can leave the machine later without a scrub.
//   - outcomes arrive later as separate `kind: 'outcome'` records that reference the decision id; history is never rewritten.
//
// Pure: no filesystem (see decision-trace-store.mjs), no clock, no network. Decision record: docs/DECISION-TRACES.md.
import crypto from 'node:crypto';
import { looksLikePath, looksLikeSecret } from './redaction.mjs';

/** The record format's version string, written into every record. */
export const TRACE_VERSION = 'decision-trace.v1';

/** Who can make a choice (the same closed set as `DECISION_SOURCES` in chooser.mjs; a test keeps them equal). */
export const TRACE_SOURCES = Object.freeze(['person', 'llm', 'decision-model']);

/** The reserved answer that takes a chooser's exit (`EXIT_ANSWER` in chooser.mjs): valid as `chosen` though it is not an option. */
export const TRACE_EXIT_ANSWER = 'exit';

/** The outcome labels a decision can collect, all booleans. `accepted`: the suggestion was taken (true) or overridden (false). */
export const OUTCOME_FIELDS = Object.freeze(['planValidated', 'testsPassed', 'reverted', 'accepted']);

/** Sizes: 2-5 options as in a chooser, a bounded summary, capped text. */
export const TRACE_LIMITS = Object.freeze({ minOptions: 2, maxOptions: 5, summaryBytes: 16 * 1024, text: 400, name: 80 });

/** Every rejection a trace or an outcome record can produce, by name, so callers and tests match on a code, not on text. */
export const TRACE_ERROR_CODES = Object.freeze({
  TRACE_NOT_OBJECT: 'TRACE_NOT_OBJECT',
  TRACE_VERSION_INVALID: 'TRACE_VERSION_INVALID',
  TRACE_FIELD_UNKNOWN: 'TRACE_FIELD_UNKNOWN',
  TRACE_ID_INVALID: 'TRACE_ID_INVALID',
  TRACE_ID_MISMATCH: 'TRACE_ID_MISMATCH',
  TRACE_AT_INVALID: 'TRACE_AT_INVALID',
  TRACE_CHOOSER_INVALID: 'TRACE_CHOOSER_INVALID',
  TRACE_SUMMARY_INVALID: 'TRACE_SUMMARY_INVALID',
  TRACE_SUMMARY_TOO_LARGE: 'TRACE_SUMMARY_TOO_LARGE',
  TRACE_OPTIONS_INVALID: 'TRACE_OPTIONS_INVALID',
  TRACE_OPTIONS_MISMATCH: 'TRACE_OPTIONS_MISMATCH',
  TRACE_CHOSEN_INVALID: 'TRACE_CHOSEN_INVALID',
  TRACE_BY_INVALID: 'TRACE_BY_INVALID',
  TRACE_PROVIDER_INVALID: 'TRACE_PROVIDER_INVALID',
  TRACE_SUGGESTION_INVALID: 'TRACE_SUGGESTION_INVALID',
  TRACE_OUTCOME_INVALID: 'TRACE_OUTCOME_INVALID',
  TRACE_REDACTION_PATH: 'TRACE_REDACTION_PATH',
  TRACE_REDACTION_SECRET: 'TRACE_REDACTION_SECRET',
  TRACE_KIND_INVALID: 'TRACE_KIND_INVALID',
  TRACE_OUTCOME_REF_INVALID: 'TRACE_OUTCOME_REF_INVALID',
  TRACE_LINE_INVALID: 'TRACE_LINE_INVALID',
});

/**
 * @typedef {{ id: string, question: string }} TraceChooser
 * @typedef {{ name: string, version: string }} TraceProvider
 * @typedef {{ option: string, reason: string, score?: number }} TraceSuggestion
 * @typedef {{ planValidated?: boolean, testsPassed?: boolean, reverted?: boolean, accepted?: boolean }} TraceOutcome
 *
 * @typedef {{ version: 'decision-trace.v1', id: string, at: string, chooser: TraceChooser, summary: object, options: string[], chosen: string, by: 'person'|'llm'|'decision-model', provider?: TraceProvider, suggestion?: TraceSuggestion, outcome?: TraceOutcome }} DecisionTrace
 * One decision. `summary` is what was offered (its `chosen` is null); `provider` is the decision provider that suggested or
 * chose; `outcome` is what is known so far (later outcome records are merged over it by `mergeOutcomes`).
 *
 * @typedef {{ version: 'decision-trace.v1', kind: 'outcome', of: string, at: string, outcome: TraceOutcome }} OutcomeRecord
 * A separate record that says what happened to the decision `of` afterwards.
 *
 * @typedef {{ code: string, path: string, message: string }} TraceError
 */

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const ID_RE = /^dt-[0-9a-f]{24}$/;
const CHOOSER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const OPTION_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const TRACE_KEYS = ['version', 'id', 'at', 'chooser', 'summary', 'options', 'chosen', 'by', 'provider', 'suggestion', 'outcome'];
const OUTCOME_RECORD_KEYS = ['version', 'kind', 'of', 'at', 'outcome'];

/**
 * A copy of the value with object keys in sorted order at every depth and `undefined` members dropped, so its JSON text is
 * one exact string whatever order the keys were built in.
 *
 * @param {any} value A JSON-like value.
 * @returns {any} The canonical copy.
 *
 * @example
 * JSON.stringify(canonicalize({ b: 1, a: { d: 1, c: undefined } })); // => '{"a":{"d":1},"b":1}'
 */
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map((v) => canonicalize(v === undefined ? null : v));
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) if (value[key] !== undefined) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

/**
 * The deterministic single-line JSON text of a record: sorted keys, no whitespace. The same record always serialises to the
 * same bytes, so a trace file diffs cleanly and a hash of it is stable.
 *
 * @param {object} record A decision trace or an outcome record.
 * @returns {string} One line of JSON, without the trailing newline.
 *
 * @example
 * serializeTrace({ b: 1, a: 2 }); // => '{"a":2,"b":1}'
 */
export function serializeTrace(record) {
  return JSON.stringify(canonicalize(record));
}

/**
 * The deterministic id of a decision: a hash of what identifies it (the chooser, the summary as offered, what was chosen, who
 * chose and which provider), never a random value and never the time. What a provider merely suggested is not part of it.
 *
 * @param {{ chooser: TraceChooser, summary: object, chosen: string, by: string, provider?: { name: string } }} fields The identifying fields.
 * @returns {string} `dt-` and 24 hex characters.
 *
 * @example
 * traceId({ chooser: { id: 'c', question: 'q' }, summary: { id: 'c' }, chosen: 'a', by: 'person' }); // => 'dt-…' (same input, same id)
 */
export function traceId({ chooser, summary, chosen, by, provider }) {
  const text = serializeTrace({ chooser, summary, chosen, by, provider: provider?.name ?? null });
  return `dt-${crypto.createHash('sha256').update(text).digest('hex').slice(0, 24)}`;
}

/**
 * Everything in a record that must not be there: a string (a value OR a key) holding an absolute path, `~/`, `./`, `../` or a
 * secret shape. `id` and `at`, which the format itself fixes, are not scanned.
 *
 * @param {any} record A record, a summary or any JSON-like value.
 * @returns {TraceError[]} One entry per offending string, with its path and a code (`TRACE_REDACTION_PATH` or `TRACE_REDACTION_SECRET`); the text itself is never echoed.
 *
 * @example
 * redactionProblems({ summary: { question: 'open ~/notes' } })[0].code; // => 'TRACE_REDACTION_PATH'
 */
export function redactionProblems(record) {
  const out = [];
  const scan = (value, at) => {
    if (typeof value === 'string') {
      const secret = looksLikeSecret(value);
      if (secret) out.push({ code: TRACE_ERROR_CODES.TRACE_REDACTION_SECRET, path: at, message: `A secret-shaped token (${secret}) may not be recorded.` });
      else if (looksLikePath(value)) out.push({ code: TRACE_ERROR_CODES.TRACE_REDACTION_PATH, path: at, message: 'A path (absolute, ~/, ./ or ../) may not be recorded.' });
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => scan(v, `${at}[${i}]`));
    } else if (isPlainObject(value)) {
      for (const [k, v] of Object.entries(value)) {
        scan(k, `${at}.<key ${JSON.stringify(k.slice(0, 20))}>`);
        if (!(at === '' && (k === 'id' || k === 'at' || k === 'version' || k === 'of'))) scan(v, at ? `${at}.${k}` : k);
      }
    }
  };
  scan(record, '');
  return out;
}

const summaryOptionIds = (summary) => (Array.isArray(summary?.options) && summary.options.every((o) => isPlainObject(o) && typeof o.id === 'string') ? summary.options.map((o) => o.id) : null);

function validateOutcomeFields(outcome, at, push) {
  if (!isPlainObject(outcome)) {
    push('TRACE_OUTCOME_INVALID', at, `"outcome" must be an object of booleans (${OUTCOME_FIELDS.join(', ')}).`);
    return;
  }
  for (const [k, v] of Object.entries(outcome)) {
    if (!OUTCOME_FIELDS.includes(k)) push('TRACE_OUTCOME_INVALID', `${at}.${k}`, `Unknown outcome label "${k}". Known: ${OUTCOME_FIELDS.join(', ')}.`);
    else if (typeof v !== 'boolean') push('TRACE_OUTCOME_INVALID', `${at}.${k}`, `"${k}" must be true or false.`);
  }
}

/**
 * Validate a `decision-trace.v1` record without throwing: shape, closed sets, the id recomputed from the fields, the options
 * against the summary, and the redaction check. Every problem comes back by code.
 *
 * @param {any} record The record (a parsed JSON line).
 * @returns {{ valid: boolean, errors: TraceError[] }} `valid` and every problem found.
 *
 * @example
 * validateTrace({ version: 'decision-trace.v1' }).valid; // => false
 */
export function validateTrace(record) {
  const errors = [];
  const push = (code, path, message) => errors.push({ code: TRACE_ERROR_CODES[code], path, message });
  if (!isPlainObject(record)) {
    push('TRACE_NOT_OBJECT', '', 'A trace must be an object.');
    return { valid: false, errors };
  }
  for (const key of Object.keys(record)) if (!TRACE_KEYS.includes(key)) push('TRACE_FIELD_UNKNOWN', key, `Unknown field "${key}".`);
  if (record.version !== TRACE_VERSION) push('TRACE_VERSION_INVALID', 'version', `"version" must be "${TRACE_VERSION}".`);
  if (!ISO_RE.test(String(record.at)) || Number.isNaN(Date.parse(record.at))) push('TRACE_AT_INVALID', 'at', '"at" must be an ISO time such as 2026-09-24T10:00:00.000Z.');

  const chooser = record.chooser;
  const chooserOk = isPlainObject(chooser) && typeof chooser.id === 'string' && CHOOSER_ID_RE.test(chooser.id) && isNonEmptyString(chooser.question) && chooser.question.length <= TRACE_LIMITS.text;
  if (!chooserOk) push('TRACE_CHOOSER_INVALID', 'chooser', '"chooser" must be { id, question } with a plain dotted id and a short question.');

  let summaryOk = isPlainObject(record.summary);
  if (!summaryOk) push('TRACE_SUMMARY_INVALID', 'summary', '"summary" must be the summary object as it was offered.');
  else if (record.summary.chosen !== undefined && record.summary.chosen !== null) {
    summaryOk = false;
    push('TRACE_SUMMARY_INVALID', 'summary.chosen', 'The summary is what was OFFERED: its "chosen" must be null.');
  } else if (Buffer.byteLength(serializeTrace(record.summary)) > TRACE_LIMITS.summaryBytes) {
    summaryOk = false;
    push('TRACE_SUMMARY_TOO_LARGE', 'summary', `The summary is larger than ${TRACE_LIMITS.summaryBytes} bytes; a summary has a fixed, small size.`);
  }

  const { minOptions, maxOptions } = TRACE_LIMITS;
  let optionsOk = Array.isArray(record.options) && record.options.length >= minOptions && record.options.length <= maxOptions
    && record.options.every((o) => typeof o === 'string' && OPTION_ID_RE.test(o)) && new Set(record.options).size === record.options.length;
  if (!optionsOk) push('TRACE_OPTIONS_INVALID', 'options', `"options" must list ${minOptions}-${maxOptions} distinct option ids.`);
  const fromSummary = summaryOk ? summaryOptionIds(record.summary) : null;
  if (optionsOk && fromSummary && JSON.stringify(fromSummary) !== JSON.stringify(record.options)) {
    optionsOk = false;
    push('TRACE_OPTIONS_MISMATCH', 'options', '"options" must be the option ids of the summary, in the same order.');
  }

  const options = optionsOk ? record.options : null;
  if (typeof record.chosen !== 'string' || !(record.chosen === TRACE_EXIT_ANSWER || (options && options.includes(record.chosen)))) {
    push('TRACE_CHOSEN_INVALID', 'chosen', `"chosen" must be one of the options (or "${TRACE_EXIT_ANSWER}").`);
  } else if (summaryOk && Array.isArray(record.summary.options) && record.summary.options.some((o) => o?.id === record.chosen && o.enabled === false)) {
    push('TRACE_CHOSEN_INVALID', 'chosen', 'The chosen option was not on offer (disabled) in the summary.');
  }
  if (!TRACE_SOURCES.includes(record.by)) push('TRACE_BY_INVALID', 'by', `"by" must be one of: ${TRACE_SOURCES.join(', ')}.`);

  if ('provider' in record) {
    const p = record.provider;
    if (!isPlainObject(p) || !isNonEmptyString(p.name) || p.name.length > TRACE_LIMITS.name || !isNonEmptyString(p.version) || p.version.length > TRACE_LIMITS.name || Object.keys(p).some((k) => k !== 'name' && k !== 'version')) {
      push('TRACE_PROVIDER_INVALID', 'provider', '"provider" must be { name, version }.');
    }
  }
  if ('suggestion' in record) {
    const s = record.suggestion;
    const ok = isPlainObject(s) && typeof s.option === 'string' && (options ? options.includes(s.option) : true) && isNonEmptyString(s.reason) && s.reason.length <= TRACE_LIMITS.text
      && (s.score === undefined || (typeof s.score === 'number' && Number.isFinite(s.score) && s.score >= 0 && s.score <= 1)) && Object.keys(s).every((k) => ['option', 'reason', 'score'].includes(k));
    if (!ok) push('TRACE_SUGGESTION_INVALID', 'suggestion', '"suggestion" must be { option (one of the options), reason, score? (0 to 1) }.');
  }
  if ('outcome' in record) validateOutcomeFields(record.outcome, 'outcome', push);

  if (ID_RE.test(String(record.id))) {
    if (chooserOk && summaryOk && TRACE_SOURCES.includes(record.by) && typeof record.chosen === 'string'
      && traceId({ chooser: record.chooser, summary: record.summary, chosen: record.chosen, by: record.by, provider: isPlainObject(record.provider) ? record.provider : undefined }) !== record.id) {
      push('TRACE_ID_MISMATCH', 'id', '"id" is not the hash of the fields that identify this decision.');
    }
  } else {
    push('TRACE_ID_INVALID', 'id', '"id" must be dt- followed by 24 hex characters.');
  }

  errors.push(...redactionProblems(record));
  return { valid: errors.length === 0, errors };
}

/**
 * Build a valid trace from what a chain knows: the summary as offered, what was chosen and by whom. Computes the id, sets
 * the summary's `chosen` to null, derives `chooser` and `options` from the summary when not given, and validates the result.
 * The clock is the caller's: pass `at`. Never throws; a record that fails validation (a path or a secret in it included) is
 * returned as errors, never as a trace.
 *
 * @param {{ chooser?: TraceChooser, summary: object, chosen: string, by?: string, provider?: TraceProvider, suggestion?: TraceSuggestion, outcome?: TraceOutcome }} input The decision.
 * @param {{ at: string }} ctx `at`: the ISO time of the decision, supplied by the caller.
 * @returns {{ ok: true, trace: DecisionTrace, errors: [] } | { ok: false, trace: null, errors: TraceError[] }} The trace, or every problem.
 *
 * @example
 * buildTrace({ summary: { id: 'app.unit', question: 'First unit?', options: [{ id: 'a', label: 'A', enabled: true, why: '' }, { id: 'b', label: 'B', enabled: true, why: '' }], chosen: null }, chosen: 'a' }, { at: '2026-09-24T10:00:00.000Z' }).trace.by; // => 'person'
 */
export function buildTrace(input, ctx = {}) {
  const fail = (errors) => ({ ok: false, trace: null, errors });
  if (!isPlainObject(input) || !isPlainObject(input.summary)) return fail([{ code: TRACE_ERROR_CODES.TRACE_SUMMARY_INVALID, path: 'summary', message: 'A trace needs the summary as it was offered.' }]);
  const summary = { ...structuredClone(input.summary) };
  if ('chosen' in summary) summary.chosen = null;
  const chooser = input.chooser ?? { id: summary.id, question: summary.question };
  const ids = summaryOptionIds(summary);
  const trace = {
    version: TRACE_VERSION,
    at: ctx.at,
    chooser,
    summary,
    options: input.options ?? ids ?? [],
    chosen: input.chosen,
    by: input.by ?? 'person',
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.suggestion ? { suggestion: input.suggestion } : {}),
    ...(input.outcome ? { outcome: input.outcome } : {}),
  };
  let id;
  try {
    id = traceId({ chooser, summary, chosen: trace.chosen, by: trace.by, provider: trace.provider });
  } catch {
    return fail([{ code: TRACE_ERROR_CODES.TRACE_SUMMARY_INVALID, path: 'summary', message: 'The summary could not be serialised.' }]);
  }
  const record = { ...trace, id };
  const checked = validateTrace(record);
  return checked.valid ? { ok: true, trace: record, errors: [] } : fail(checked.errors);
}

/**
 * Build an outcome record: a separate line that says what happened to the decision `of` afterwards. History is never
 * rewritten; `mergeOutcomes` folds these over the decisions when they are read.
 *
 * @param {{ of: string, outcome: TraceOutcome }} input The decision id and its outcome labels (at least one).
 * @param {{ at: string }} ctx `at`: the ISO time, supplied by the caller.
 * @returns {{ ok: true, record: OutcomeRecord, errors: [] } | { ok: false, record: null, errors: TraceError[] }} The record, or every problem.
 *
 * @example
 * buildOutcomeRecord({ of: 'dt-000000000000000000000000', outcome: { planValidated: true } }, { at: '2026-09-24T10:05:00.000Z' }).ok; // => true
 */
export function buildOutcomeRecord(input, ctx = {}) {
  const record = { version: TRACE_VERSION, kind: 'outcome', of: input?.of, at: ctx.at, outcome: input?.outcome };
  const checked = validateOutcomeRecord(record);
  return checked.valid ? { ok: true, record, errors: [] } : { ok: false, record: null, errors: checked.errors };
}

/**
 * Validate an outcome record without throwing.
 *
 * @param {any} record The record (a parsed JSON line).
 * @returns {{ valid: boolean, errors: TraceError[] }} `valid` and every problem found.
 *
 * @example
 * validateOutcomeRecord({ version: 'decision-trace.v1', kind: 'outcome', of: 'nope', at: 'x', outcome: {} }).valid; // => false
 */
export function validateOutcomeRecord(record) {
  const errors = [];
  const push = (code, path, message) => errors.push({ code: TRACE_ERROR_CODES[code], path, message });
  if (!isPlainObject(record)) {
    push('TRACE_NOT_OBJECT', '', 'An outcome record must be an object.');
    return { valid: false, errors };
  }
  for (const key of Object.keys(record)) if (!OUTCOME_RECORD_KEYS.includes(key)) push('TRACE_FIELD_UNKNOWN', key, `Unknown field "${key}".`);
  if (record.version !== TRACE_VERSION) push('TRACE_VERSION_INVALID', 'version', `"version" must be "${TRACE_VERSION}".`);
  if (record.kind !== 'outcome') push('TRACE_KIND_INVALID', 'kind', '"kind" must be "outcome".');
  if (!ID_RE.test(String(record.of))) push('TRACE_OUTCOME_REF_INVALID', 'of', '"of" must be the id of a decision (dt- and 24 hex characters).');
  if (!ISO_RE.test(String(record.at)) || Number.isNaN(Date.parse(record.at))) push('TRACE_AT_INVALID', 'at', '"at" must be an ISO time such as 2026-09-24T10:00:00.000Z.');
  validateOutcomeFields(record.outcome, 'outcome', push);
  if (isPlainObject(record.outcome) && Object.keys(record.outcome).length === 0) push('TRACE_OUTCOME_INVALID', 'outcome', 'An outcome record must carry at least one label.');
  errors.push(...redactionProblems(record));
  return { valid: errors.length === 0, errors };
}

/**
 * Parse and validate one line of a trace file.
 *
 * @param {string} line One JSONL line.
 * @returns {{ ok: true, kind: 'decision'|'outcome', record: DecisionTrace | OutcomeRecord } | { ok: false, errors: TraceError[] }} The record and its kind, or why the line is not one.
 *
 * @example
 * parseTraceLine('not json').ok; // => false
 */
export function parseTraceLine(line) {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return { ok: false, errors: [{ code: TRACE_ERROR_CODES.TRACE_LINE_INVALID, path: '', message: 'The line is not JSON.' }] };
  }
  const kind = isPlainObject(record) && record.kind === 'outcome' ? 'outcome' : 'decision';
  const checked = kind === 'outcome' ? validateOutcomeRecord(record) : validateTrace(record);
  return checked.valid ? { ok: true, kind, record } : { ok: false, errors: checked.errors };
}

/**
 * Fold outcome records over decisions: the decision's own `outcome` first, then each outcome record for its id in the order
 * given (later wins per label). Inputs are not changed.
 *
 * @param {DecisionTrace[]} decisions The decisions.
 * @param {OutcomeRecord[]} outcomes The outcome records, oldest first.
 * @returns {DecisionTrace[]} Copies of the decisions with `outcome` set where anything is known.
 *
 * @example
 * mergeOutcomes([trace], [{ of: trace.id, outcome: { planValidated: true } }])[0].outcome; // => { planValidated: true }
 */
export function mergeOutcomes(decisions, outcomes) {
  const byId = new Map();
  for (const o of outcomes) byId.set(o.of, { ...(byId.get(o.of) ?? {}), ...o.outcome });
  return decisions.map((d) => {
    const extra = byId.get(d.id);
    return extra || d.outcome ? { ...d, outcome: { ...(d.outcome ?? {}), ...(extra ?? {}) } } : { ...d };
  });
}

/**
 * Is this a decision whose outcome vouches for it? At least one positive label (`accepted`, `planValidated`, `testsPassed`
 * true) and no negative one (`planValidated` or `testsPassed` false, `reverted` true). `accepted: false` is not negative: a
 * person who overrode a suggestion is the ground truth, not a failure. Replay scores agreement with these.
 *
 * @param {TraceOutcome | undefined} outcome The merged outcome of a decision.
 * @returns {boolean} `true` for a vouched-for decision.
 *
 * @example
 * isGoodOutcome({ planValidated: true, reverted: false }); // => true
 */
export function isGoodOutcome(outcome) {
  if (!isPlainObject(outcome)) return false;
  if (outcome.reverted === true || outcome.planValidated === false || outcome.testsPassed === false) return false;
  return outcome.accepted === true || outcome.planValidated === true || outcome.testsPassed === true;
}
