// #937 (epic #934): the Line arm's read tools, chosen per turn. Each turn the builder is offered its plan tools (read_file only when
// the open step edits a file) and finish, plus only the 3-6 registry reads selectReadTools (packages/engine/line/coder/reads.mjs) picks for the open
// work item (openWork's first item: its kind, its step's tool, its point) and the last refusal. The reads run in-process
// through the same registry read dispatcher construct-mcp registers (packages/engine/line/toolRegistry.mjs createReadDispatcher), so the
// registry stays the one source of names, sentences, fields and argument checks; MCP stdio would add a child process
// and construct-mcp's per-minute rate limit to every builder turn for the same handlers.
//
// A tool the model calls that was not offered this turn is still served, and logged as a miss (logs/read-misses.jsonl,
// and `miss: true` on the call in turns.jsonl) so the selection table can be corrected from real runs.
import fs from 'node:fs';
import path from 'node:path';
import { selectReadTools } from '../../../packages/engine/line/coder/reads.mjs';
import { mcpNameOf, createReadDispatcher } from '../../../packages/engine/line/toolRegistry.mjs';
import { openWork } from '../../../packages/engine/line/openWork.mjs';
import { readSpec } from './spec-slice.mjs';

/** The Line arm's tools offered every turn (by name, from qwen-agent's TOOLS.line); list_dir is served on a miss only. */
export const ALWAYS = Object.freeze(['plan_tools', 'plan_status', 'plan_add', 'plan_run_next', 'plan_findings', 'plan_validate', 'plan_rules', 'finish']);
/**
 * Owner, #937: read_file is offered only when the open step edits a file (its step needs the file's code and
 * contentHash); otherwise it is served on a call and logged as a miss, like list_dir.
 */
export const EDITS_FILE = Object.freeze(['line.setCode', 'line.setFragment']);
/** Argument types of registry reads that are not strings. */
const ARG_TYPES = Object.freeze({ props: { type: 'object' }, steps: { type: 'array', items: { type: 'object' } }, answers: { type: 'object' } });
const ARG_SAYS = Object.freeze({
  name: 'A feature name, e.g. loans', file: 'A project-relative file, e.g. features/loans/pages/LoansPage.tsx', request: 'What you want, in plain words, e.g. "a paginated list"',
  feature: 'A feature name', folder: 'A project-relative folder', route: 'A route, e.g. /loans', focus: 'An item id',
});

/**
 * One registry read as an Ollama function tool: its MCP name, its sentence, its fields.
 * @param {import('../../../packages/engine/line/contract.mjs').ToolEntry} e
 */
export function readFunction(e) {
  const s = /** @type {any} */ (e.inputSchema);
  const properties = Object.fromEntries((s.fields ?? []).map((k) => [k, { ...(ARG_TYPES[k] ?? { type: 'string' }), ...(ARG_SAYS[k] ? { description: ARG_SAYS[k] } : {}) }]));
  return { type: 'function', function: { name: mcpNameOf(e), description: e.sentence, parameters: { type: 'object', properties, required: [...(s.required ?? [])] } } };
}

/**
 * The per-turn read tools of one run.
 * @param {{root: string, spec?: string | null, logDir: string, base: any[], dispatcher?: any, work?: () => any}} o
 *   `base`: the arm's full tool list (TOOLS.line); `spec`: the SPEC.md open work is measured against; `work`: overrides
 *   openWork (tests).
 */
export async function createTurnReads({ root, spec = null, logDir, base, dispatcher, work }) {
  const reads = dispatcher ?? await createReadDispatcher(root);
  const specNow = () => { try { return spec ? readSpec(spec) : null; } catch { return null; } };
  const workNow = work ?? (() => { try { return openWork(root, { spec: specNow() }); } catch { return null; } });
  const missFile = path.join(logDir, 'read-misses.jsonl');
  const known = new Set([...base.map((t) => t.function.name), ...reads.ids.map((id) => mcpNameOf(reads.entry(id)))]);
  return {
    /**
     * This turn's selection: the open item, the read ids, the offered names and the tool list to send.
     * @param {{lastRefusal?: {code?: string|null, sentence?: string} | null}} [o]
     */
    select({ lastRefusal = null } = {}) {
      const w = workNow();
      const first = w?.first ?? null;
      const ids = selectReadTools({ openStep: first, point: first?.point ?? null, kind: first?.kind ?? null, lastRefusal }).filter((id) => reads.has(id));
      const edits = EDITS_FILE.includes(first?.step?.tool);
      const tools = [...base.filter((t) => ALWAYS.includes(t.function.name) || (edits && t.function.name === 'read_file')), ...ids.map((id) => readFunction(reads.entry(id)))];
      return { open: first ? { kind: first.kind, feature: first.feature ?? null, tool: first.step?.tool ?? null } : null, ids, names: tools.map((t) => t.function.name), tools };
    },
    /** Whether `name` is a registry read this run can serve. */
    serves: (name) => reads.byName(name) !== null,
    /**
     * Run a registry read by its name. An answer that is already English (a `sentence`, as the coder reads give) reaches
     * the model as that sentence only; the structured copy behind it is left out, as toModel does for plan-cli.
     */
    async call(name, args) {
      const out = await reads.dispatch(reads.byName(name).id, args && typeof args === 'object' ? args : {});
      return out.ok !== false && typeof out.sentence === 'string' ? { ok: true, sentence: out.sentence } : out;
    },
    /**
     * Log a call to a known tool that was not offered this turn; returns whether it was a miss.
     * @param {number} turn @param {string} name @param {{names: string[], ids: string[], open: any}} sel
     */
    miss(turn, name, sel) {
      if (!known.has(name) || sel.names.includes(name)) return false;
      try { fs.appendFileSync(missFile, `${JSON.stringify({ at: new Date().toISOString(), turn, tool: name, offered: sel.names.filter((n) => !ALWAYS.includes(n)), open: sel.open })}\n`); } catch { /* best effort */ }
      return true;
    },
  };
}

/** Rough token count of a tool list as sent (JSON characters / 4, the usual estimate for English and JSON). */
export const toolTokens = (tools) => Math.ceil(JSON.stringify(tools).length / 4);
