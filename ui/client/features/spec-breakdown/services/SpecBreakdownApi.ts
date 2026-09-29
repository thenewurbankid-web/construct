// #748 (R6) -- talks to `POST /api/research` (action `spec`, researchApi.mjs) and `POST /api/create` (a function
// row's "Fill with AI", the same `create.unit` block every other Cockpit screen uses, #514/#541). `--format json`
// prints exactly one line, the JSON (see readBack.mjs's `renderReadBack`), so `output[0]` is parsed directly;
// a command that threw, or printed nothing, is reported as `error` rather than crashing on `undefined`.
import { sendJson } from '@/lib/http';
import type { GenerateResult, LoadReadBack, LoadReport, MachineSpecReport, ReadBack, RunGenerate } from '../types';

const UNREACHABLE = 'The Cockpit server could not be reached.';

type ResearchBody = { ok?: boolean; output?: string[]; error?: string };

async function callResearch(payload: Record<string, unknown>): Promise<{ ok: true; parsed: unknown } | { ok: false; error: string }> {
  try {
    const { status, body } = await sendJson<ResearchBody>('POST', '/api/research', payload);
    if (status !== 200 || body.ok === false) return { ok: false, error: body.error ?? `The spec could not be read (status ${status}).` };
    const line = body.output?.[0];
    if (!line) return { ok: false, error: 'The spec command printed nothing.' };
    try {
      return { ok: true, parsed: JSON.parse(line) };
    } catch {
      return { ok: false, error: 'The spec command did not print JSON.' };
    }
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

/** The validation report (`{status, counts, violations}`) for a machine-spec.v1 file, project-relative to the open project. */
export async function loadSpecReport(file: string): Promise<LoadReport> {
  const r = await callResearch({ action: 'spec', file, format: 'json' });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, report: r.parsed as MachineSpecReport };
}

/** The read-back (plain English per requirement sentence, #672) of an ACCEPTED spec. Refused, with the report's
 * own reason, when the spec has violations -- same as the CLI's `--read-back`. */
export async function loadReadBack(file: string): Promise<LoadReadBack> {
  const r = await callResearch({ action: 'spec', file, format: 'json', readBack: true });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, readBack: r.parsed as ReadBack };
}

/** Mechanical generation (#593): the state union, machine, function stubs and locked test, written once, never
 * overwriting an existing file. Refused, with the violation report, when the spec is not accepted. */
export async function generateSpec(file: string, feature?: string): Promise<RunGenerate> {
  const r = await callResearch({ action: 'spec', file, format: 'json', generate: true, ...(feature ? { feature } : {}) });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, result: r.parsed as GenerateResult };
}

type NavOpenBody = { ok?: boolean; source?: string; error?: string };

/** A function row's "View/edit code": the generated stub at `features/<feature>/services/<name>.ts`
 * (research/specToCode.mjs's own naming), read through `/api/nav/open` (#558) -- the same contained,
 * generic "open a bare file at a known position" path every other Cockpit screen uses, so a file outside
 * the project, or one that does not exist yet, is refused the same way there. */
export async function viewFunctionCode(feature: string, name: string): Promise<{ ok: true; source: string } | { ok: false; error: string }> {
  try {
    const { status, body } = await sendJson<NavOpenBody>('POST', '/api/nav/open', { file: `features/${feature}/services/${name}.ts` });
    if (status !== 200 || body.ok === false || typeof body.source !== 'string') return { ok: false, error: body.error ?? 'That file could not be opened.' };
    return { ok: true, source: body.source };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

type CreateBody = { ok?: boolean; output?: string[]; error?: string; attribution?: { tool: string; llm: string | null } | null; mode?: string; note?: string };

/** A function row's "Fill with AI": `construct create service <name> --feature <feature> --llm <provider>`
 * (create.unit, docs/BLOCK-CONTRACT.md) -- the same generic, already-shipped path the Dashboard's Create form
 * uses, scoped to the one function this row is about. Refused (never overwritten) when the file already exists,
 * e.g. because "Generate" (mechanical) already wrote it. */
export async function fillFunctionWithAi(name: string, feature: string): Promise<CreateBody & { ok: boolean }> {
  try {
    const { body } = await sendJson<CreateBody>('POST', '/api/create', { kind: 'single', layer: 'service', name, feature, useLlm: true });
    return { ok: body.ok !== false, ...body };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}
