// R3 (#576, sibling of R1/#584, R2/#593, R4/#672, R5/#673) -- the one fuzzy step: turn plain English
// into a machine-spec.v1 draft, with a real feedback loop instead of a blind retry (#496 is the
// cautionary tale: identical retries regressed correct output to wrong). The prompt is the schema
// plus the checked-in worked example, never prose instructions (docs/machine-spec.md). A drafted spec
// only ever reaches a caller after it has been run through `validateMachineSpec` here; a spec that
// still fails after the retry budget is returned as `rejected` with the violations that would show
// `construct research spec` -- nothing is ever generated from a spec a person has not seen pass.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callLlm, stripCodeFence } from '../llm.mjs';
import { validateMachineSpec, renderMachineSpecReport } from './machine-spec.mjs';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_TEXT = fs.readFileSync(path.join(THIS_DIR, 'machine-spec.v1.schema.json'), 'utf8');
const EXAMPLE_TEXT = fs.readFileSync(path.join(THIS_DIR, 'examples', 'machine-spec.v1.example.json'), 'utf8');

const OUTPUT_CONTRACT = [
  'How your reply is used: it is captured from stdout and parsed as JSON, byte for byte. You have no file or tool access and never need any.',
  'Reply with ONLY the machine-spec.v1 JSON object, no markdown code fences, no prose before or after.',
].join('\n');

/**
 * Split plain English requirement text into `machine-spec.v1` `requirement[]` entries. Deterministic,
 * not the fuzzy step: one non-blank line is one sentence, ids assigned in reading order (`s1`, `s2`, ...).
 * A requirement already broken into sentences (one per line, as a person or a Note/story would write it,
 * #373/#383) needs no model to reach this shape.
 *
 * @param {string} text Raw requirement text, one sentence per line.
 * @returns {{id: string, text: string}[]}
 */
export function splitRequirement(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((sentenceText, i) => ({ id: `s${i + 1}`, text: sentenceText }));
}

/**
 * Build the prompt for one drafting attempt: the schema, the worked example, and the requirement
 * sentences to break down. On a retry (`previous` set), it also carries the previous attempt's raw
 * reply and the concrete violations it failed on, so the model corrects rather than re-guesses (#496).
 *
 * @param {{id: string, text: string}[]} requirement
 * @param {{feature?: string, previous?: {raw: string, report: string}}} [options]
 * @returns {string}
 */
export function buildDraftPrompt(requirement, { feature, previous } = {}) {
  const parts = [
    'You are drafting a machine-spec.v1 document: an English requirement broken down into states, events, transitions and typed functions, each item carrying a `req` reference to the sentence id(s) it came from.',
    'Below is the JSON Schema, then one worked example ("sign-in with retry") showing the shape in full, including how `req` links every item back to a sentence and how a sentence that produces no machine behaviour is listed under `outOfScope` with a reason instead of being ignored.',
    '--- schema (machine-spec.v1.schema.json) ---',
    SCHEMA_TEXT,
    '--- worked example ---',
    EXAMPLE_TEXT,
    '--- requirement to break down ---',
    JSON.stringify(requirement, null, 2),
    feature ? `Set "feature" to "${feature}".` : 'Omit "feature", or pick one word describing the area.',
    'Every sentence id above must be claimed by at least one item\'s `req`, or listed in `outOfScope` with a reason -- never neither, never both.',
  ];
  if (previous) {
    parts.push(
      '--- your previous attempt (rejected) ---',
      previous.raw,
      '--- why it was rejected ---',
      previous.report,
      'Correct these specific problems. Do not repeat them.',
    );
  }
  parts.push(OUTPUT_CONTRACT);
  return parts.join('\n\n');
}

/**
 * The decision-trace choice behind one drafting run (`docs/BLOCK-CONTRACT.md`, "AI-ready by design"): a closed
 * accept/reject chooser, not the spec's free-form content -- the fixed-size summary an outside reader (or a future
 * decision model) can replay is "did this draft pass the deterministic check", never the draft text itself. Never
 * called for a `failed` result: a provider failure is not a decision anyone made.
 *
 * @param {{id: string, text: string}[]} requirement
 * @param {{feature?: string}} options
 * @param {{status: 'accepted'|'rejected', attempts: number}} result
 * @returns {{chooser: {id: string, question: string}, summary: object, chosen: string, by: 'llm'}} A choice for `recordDecisions`.
 */
export function traceChoiceFromDraft(requirement, { feature } = {}, result) {
  const question = 'Does the machine-spec drafted from this requirement pass validateMachineSpec?';
  const summary = {
    id: 'research.spec.draft',
    question,
    options: [
      { id: 'accepted', label: 'Accepted -- passed validateMachineSpec', enabled: true, why: '' },
      { id: 'rejected', label: 'Rejected -- failed validateMachineSpec after the retry budget', enabled: true, why: '' },
    ],
    chosen: null,
    requirementSentences: requirement.length,
    feature: feature ?? null,
    attempts: result.attempts,
  };
  return { chooser: { id: 'research.spec.draft', question }, summary, chosen: result.status, by: 'llm' };
}

/**
 * Draft a `machine-spec.v1` from plain English via an LLM, with `validateMachineSpec` as the check and
 * up to one corrected retry when the draft fails it (never a blind identical retry, #496).
 *
 * @param {string} llm Provider name (`llm.mjs`'s `PROVIDERS`).
 * @param {{id: string, text: string}[]} requirement
 * @param {{feature?: string, llmOptions?: object, maxAttempts?: number}} [options] `maxAttempts` defaults to 2 (one retry).
 * @returns {Promise<
 *   {status: 'accepted', spec: object, attempts: number} |
 *   {status: 'rejected', violations: object[], report: string, attempts: number} |
 *   {status: 'failed', reason: string, attempts: number}
 * >}
 */
export async function draftMachineSpec(llm, requirement, { feature, llmOptions, maxAttempts = 2 } = {}) {
  let previous;
  let attempts = 0;
  for (;;) {
    attempts++;
    let raw;
    try {
      raw = await callLlm(llm, buildDraftPrompt(requirement, { feature, previous }), llmOptions);
    } catch (e) {
      if (e?.exitCode === 2) throw e; // a usage/config mistake, not a per-attempt failure
      return { status: 'failed', reason: e?.message || String(e), attempts };
    }
    let spec;
    let report;
    try {
      spec = JSON.parse(stripCodeFence(raw));
    } catch (e) {
      report = `The reply did not parse as JSON: ${e.message}`;
    }
    if (spec) {
      const result = validateMachineSpec(spec, { file: '<draft>' });
      if (result.status === 'passed') return { status: 'accepted', spec, attempts };
      report = renderMachineSpecReport(result, { format: 'text' });
      if (attempts >= maxAttempts) return { status: 'rejected', violations: result.violations, report, attempts };
    } else if (attempts >= maxAttempts) {
      return { status: 'rejected', violations: [], report, attempts };
    }
    previous = { raw: String(raw ?? '').trim().slice(0, 4000), report };
  }
}
