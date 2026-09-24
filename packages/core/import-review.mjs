// #603 -- a read-only review of an import: does what was written still do what the approved plan and the
// source file said? `construct validate` already answers "does it obey the rules"; this answers the question
// it cannot: dropped logic, changed behaviour, a layer that took on the wrong job. One bounded model call gets the
// plan, each unit's source, and the files that were written; it returns findings and never touches a file.
import fs from 'node:fs';
import path from 'node:path';
import { callLlm, stripCodeFence } from './llm.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';

const MAX_FILE_CHARS = 8000;
const MAX_FINDINGS = 30;
const KINDS = new Set(['fix', 'decision']);
const SEVERITIES = new Set(['error', 'warning', 'info']);

const clip = (text) => (text.length > MAX_FILE_CHARS ? `${text.slice(0, MAX_FILE_CHARS)}\n… (cut for length)` : text);

/**
 * The prompt for the review call: the plan, then per unit the source and the written files.
 *
 * @param {string} root Project root (paths are shown relative to it).
 * @param {{feature:string, units:{name:string, layers:string[], from:string}[]}} plan The approved plan.
 * @param {{name:string, source:string, files:string[]}[]} results One entry per unit, from `executeImportPlan`.
 * @returns {string} The prompt text.
 */
export function buildReviewPrompt(root, plan, results) {
  const blocks = [];
  for (const unit of plan.units) {
    const result = results.find((r) => r.name === unit.name);
    if (!result) continue;
    const written = result.files
      .map((f) => `--- written: ${path.relative(root, f)} ---\n${clip(fs.readFileSync(f, 'utf8'))}`)
      .join('\n\n');
    blocks.push(
      `=== unit ${unit.name}: layers ${unit.layers.join(', ')} ===\n--- source: ${path.relative(root, unit.from)} ---\n${clip(fs.readFileSync(unit.from, 'utf8'))}\n\n${written}`,
    );
  }
  return [
    'You are reviewing an automated import of existing code into Construct, a layered architecture (domain = pure functions, service = one external effect, workflow = state machine, hook = React hook, component/page = presentation, controller = composes a page).',
    `The approved plan for feature "${plan.feature}" split each source file into layers. For every unit below you get the original source and the files that were written from it.`,
    'Report ONLY where the written code drifted from the source behaviour or the plan: logic that was dropped or changed, behaviour that was invented, a layer that took on another layer\'s job, an export the source had that is now missing, a stub left unfilled.',
    'Do NOT report style, naming, or architecture-rule violations (`construct validate` checks those separately). Be specific: name the file and what the source did.',
    'Mark a finding "fix" when the correction is mechanical and you can state it in one sentence; mark it "decision" when a person has to choose.',
    '',
    blocks.join('\n\n'),
    '',
    'Respond with ONLY a JSON object, no code fences, no commentary: {"findings":[{"file":"path/relative/to/project","kind":"fix"|"decision","severity":"error"|"warning"|"info","summary":"one sentence","detail":"what the source did and what the written code does instead"}]}. Return {"findings":[]} when nothing drifted.',
  ].join('\n');
}

/** Keep only well-formed findings, with known kinds/severities, capped, so a chatty or sloppy reply cannot flood the UI. */
function cleanFindings(raw) {
  const list = Array.isArray(raw?.findings) ? raw.findings : [];
  return list
    .filter((f) => f && typeof f.summary === 'string' && f.summary.trim())
    .map((f) => ({
      file: typeof f.file === 'string' ? f.file : '',
      kind: KINDS.has(f.kind) ? f.kind : 'decision',
      severity: SEVERITIES.has(f.severity) ? f.severity : 'warning',
      summary: f.summary.trim(),
      detail: typeof f.detail === 'string' ? f.detail.trim() : '',
    }))
    .slice(0, MAX_FINDINGS);
}

/**
 * Review an import against its plan. Read-only: reads files, calls the model once, writes nothing.
 *
 * @param {string} root Project root.
 * @param {{feature:string, units:object[]}} plan The approved plan.
 * @param {object[]} results Per-unit results from `executeImportPlan`.
 * @param {{llm?: string, llmOptions?: object}} [options] Provider and its call options (`signal`, `onChunk`).
 * @returns {Promise<{findings:{file:string, kind:'fix'|'decision', severity:string, summary:string, detail:string}[]}>} The findings, possibly none.
 * @throws {ConstructError} When the model does not return the JSON shape asked for.
 */
export async function reviewImport(root, plan, results, { llm = 'claude', llmOptions } = {}) {
  const raw = await callLlm(llm, buildReviewPrompt(root, plan, results), llmOptions);
  let parsed;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch (e) {
    throw new ConstructError(`"${llm}" did not return valid JSON for the review (${e.message}). Raw response started with: ${String(raw).slice(0, 200)}`, {
      exitCode: EXIT_CODES.INTERNAL_ERROR,
    });
  }
  return { findings: cleanFindings(parsed) };
}
