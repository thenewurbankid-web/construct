// cl1 -- every plan session leaves a local typed trace: append-only JSONL at `<state>/traces/<traceId>.jsonl` (Line's
// state folder, `line/` by default), each line a TraceEvent (contract.mjs), written through the writer's atomic
// Line-state path (transactionalWriter.mjs writeLineState). Construct's refusal plus its typed fixes is the feedback for
// every step, so the trace records each refusal with the fixes it offered, which fix was picked and whether it passed.
// planService.mjs records into it; missDetector.mjs and contextPicker.mjs read it. A trace that cannot be written never
// stops the plan: the sink keeps the reason in one sentence (`problem`) and carries on.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertTraceEvent, PLAN_REFUSAL_CODES } from './contract.mjs';
import { writeLineState } from '../transactionalWriter.mjs';
import { lineStateDir } from './workspace.mjs';

const CUT = 200;
/** The request as the trace keeps it: long strings cut, plan-only fields (expect, retry) dropped. */
export function traceArgs(args) {
  const out = {};
  for (const [k, v] of Object.entries(args && typeof args === 'object' ? args : {})) {
    if (k === 'expect' || k === 'retry') continue;
    out[k] = typeof v === 'string' && v.length > CUT ? `${v.slice(0, CUT - 3)}...` : v;
  }
  return out;
}

/** A new trace id: the session, the start time and a short random part, safe as a file name. */
export function newTraceId(sessionId = 'ses', now = new Date()) {
  return `${sessionId}-${now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * The common sink: stamps v/trace/seq/at, checks the shape, hands the line to `put`.
 * @param {string} id @param {(e: import('./contract.mjs').TraceEvent) => void} put @param {() => Date} now
 */
function sink(id, put, now) {
  let seq = 0;
  const self = {
    id,
    /** @type {string|null} why the last write failed, in one sentence, or null */
    problem: /** @type {string|null} */ (null),
    /** @param {Omit<import('./contract.mjs').TraceEvent, 'v'|'trace'|'seq'|'at'>} e */
    record(e) {
      seq += 1;
      const event = /** @type {import('./contract.mjs').TraceEvent} */ ({ v: 1, trace: id, seq, at: now().toISOString(), ...e });
      try {
        assertTraceEvent(event);
        put(event);
        self.problem = null;
      } catch (err) {
        self.problem = `The session trace could not be written, so this step is not in it: ${String(/** @type {any} */ (err)?.message ?? err)}`;
      }
      return event;
    },
  };
  return self;
}

/**
 * The project's session trace for one plan-service lifetime.
 * @param {string} root
 * @param {{id?: string, sessionId?: string, now?: () => Date}} [o]
 */
export function createSessionTrace(root, { id, sessionId = 'ses', now = () => new Date() } = {}) {
  const stateDir = lineStateDir(root);
  const traceId = id ?? newTraceId(sessionId, now());
  const file = `${stateDir}/traces/${traceId}.jsonl`;
  const s = sink(traceId, (e) => { writeLineState(root, file, `${JSON.stringify(e)}\n`, { append: true, stateDir }); }, now);
  return Object.assign(s, { file });
}

/** A trace kept in memory (the mock; tests and a disabled trace). */
export function createMemoryTrace({ id = 'mem', now = () => new Date() } = {}) {
  /** @type {import('./contract.mjs').TraceEvent[]} */
  const events = [];
  return Object.assign(sink(id, (e) => { events.push(e); }, now), { events, file: null });
}

/**
 * Every trace event of a project, oldest trace first. Lines that do not parse or do not fit the contract are skipped
 * and counted (`skipped`), never fatal.
 * @param {string} root
 * @returns {{events: import('./contract.mjs').TraceEvent[], files: string[], skipped: number}}
 */
export function readTraces(root) {
  const rel = `${lineStateDir(root)}/traces`;
  const dir = path.join(root, rel);
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort(); } catch { return { events: [], files: [], skipped: 0 }; }
  const events = []; let skipped = 0;
  for (const n of names) {
    for (const line of fs.readFileSync(path.join(dir, n), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const e = JSON.parse(line); assertTraceEvent(e); events.push(e); } catch { skipped += 1; }
    }
  }
  return { events, files: names.map((n) => `${rel}/${n}`), skipped };
}

// ------------------------------------------------------------------------------------------------- from plan results
const asSentence = (s) => { const t = String(s ?? '').trim().replace(/\s+/g, ' '); const c = t.charAt(0).toUpperCase() + t.slice(1); return /[.?!]$/.test(c) ? c : `${c || 'Refused'}.`; };

/** Which source a refusal code belongs to. */
export const sourceOf = (code) => (PLAN_REFUSAL_CODES.includes(String(code)) ? 'plan' : 'construct');

/**
 * The refusal event for a step whose run Construct refused (a needs-fix / needs-you step result).
 * @param {any} step A PlanStepView that ran.
 */
export function refusalOfStep(step) {
  const r = step.result ?? {};
  const findings = (r.apply?.findings ?? []).filter((f) => f.severity === 'error');
  const options = Array.isArray(r.options) ? r.options : [];
  return {
    kind: /** @type {const} */ ('refusal'), tool: step.tool, stepId: step.id, args: traceArgs(step.args), source: /** @type {const} */ ('construct'),
    code: r.apply && r.apply.ok === false ? (r.apply.code ?? (findings.length ? 'NEEDS_FIX' : 'REFUSED')) : 'CHECKS_FAILED',
    sentence: asSentence(r.sentence ?? step.sentence),
    rules: [...new Set(findings.map((f) => f.rule))].sort(),
    files: [...new Set(findings.map((f) => f.file))].sort(),
    fixes: options.filter((o) => o.id === 'fix').map((o) => ({ fixId: o.fixId ?? null, tool: o.step?.tool ?? null, recommended: o.recommended === true })),
  };
}

/** Which offered fix a new step is (same tool and args as one of the refused step's fix options), or null. */
export function matchFix(refused, tool, args) {
  const req = traceArgs(args); delete req.fixOf;
  for (const o of refused?.result?.options ?? []) {
    if (o.id !== 'fix' || !o.step || o.step.tool !== tool) continue;
    if (JSON.stringify(traceArgs(o.step.args)) === JSON.stringify(req)) return o.fixId ?? null;
  }
  return null;
}
