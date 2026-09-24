// #643 (epic #616) -- where `decision-trace.v1` records live: an append-only JSONL file in the per-user STATE directory, keyed by
// project, the same place and convention as process records (`resolveStateDir` + `projectKey` of engine/processStore.mjs):
//
//   <stateDir>/traces/<projectKey>/decisions.jsonl            (+ decisions.1.jsonl ... older, rotated)
//
// Never inside the user's source tree: it would show up in `git status`, get committed by accident and be walked by the
// enforcers. Nothing here opens a socket: the module imports the filesystem, the path helpers and pure blocks only (a test
// walks the import graph). A trace leaves the machine only by an explicit export, which is #647 and is not built here.
//
//   - append-only: one `fs.appendFileSync` of whole lines (O_APPEND), so a killed process leaves whole lines or one torn last
//     line that readers skip; nothing is ever rewritten, an outcome is a separate record that references the decision id;
//   - bounded: when the active file would pass `maxBytes` it is rotated (`decisions.1.jsonl`, oldest dropped past `maxFiles`);
//   - per-project switch: `traces: on|off` in architecture.yml (default on, because traces stay local); off writes nothing;
//   - FAILURE-SAFE: every write path returns `{ ok: false, error }` and never throws, so a full disk, a read-only or missing
//     state directory or a bad config never breaks the chain that called it.
// Decision record: docs/DECISION-TRACES.md.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { resolveStateDir, projectKey } from '../engine/processStore.mjs';
import { getDecisionProvider, suggest } from './decision-provider.mjs';
import { buildTrace, buildOutcomeRecord, parseTraceLine, mergeOutcomes, serializeTrace } from './decision-trace.mjs';

/** The active trace file's name inside a project's trace directory. */
export const TRACE_FILE = 'decisions.jsonl';

/** Defaults: rotate at 2 MiB, keep 5 files (10 MiB per project at most). */
export const TRACE_STORE_LIMITS = Object.freeze({ maxBytes: 2 * 1024 * 1024, maxFiles: 5 });

/**
 * @typedef {{ now?: () => string, env?: Record<string, string|undefined>, stateDir?: string, maxBytes?: number, maxFiles?: number, fsImpl?: typeof fs }} StoreOptions
 * `now` is the clock (ISO string, default the system clock; tests inject one), `stateDir` overrides the state directory
 * (default `resolveStateDir(env)`), `maxBytes` / `maxFiles` bound the store, `fsImpl` is a test seam (full disk, read-only).
 *
 * @typedef {{ ok: boolean, enabled: boolean, recorded: number, duplicates: number, ids: string[], refused: { index: number, errors: import('./decision-trace.mjs').TraceError[] }[], error?: string }} RecordResult
 * `recorded` new lines were appended, `duplicates` were already there (same id); `refused` lists records that failed
 * validation (a path or secret in them included); `ok` is false only when the write itself failed (`error` says why).
 */

const clock = () => new Date().toISOString();
const errText = (e) => `${e?.code ? `${e.code}: ` : ''}${String(e?.message ?? e).split('\n')[0]}`.slice(0, 200);

/**
 * The directory holding one project's traces: `<stateDir>/traces/<projectKey>`.
 *
 * @param {string} root The project root.
 * @param {StoreOptions} [options] `stateDir` or `env`.
 * @returns {string} Absolute path (outside the project).
 *
 * @example
 * traceDir('/work/web', { stateDir: '/var/state' }); // => '/var/state/traces/web-<hash>'
 */
export function traceDir(root, options = {}) {
  return path.join(options.stateDir ?? resolveStateDir(options.env ?? process.env), 'traces', projectKey(root));
}

/**
 * Is recording on for this project? `traces: on|off` in architecture.yml, default on. A config that cannot be read counts as
 * OFF: when the switch cannot be read, the privacy choice wins.
 *
 * @param {string} root The project root.
 * @returns {boolean} `true` when traces are recorded.
 *
 * @example
 * tracesEnabled('/work/web'); // => true (no architecture.yml, or `traces: on`)
 */
export function tracesEnabled(root) {
  try {
    return loadConfig(root).traces !== 'off';
  } catch {
    return false;
  }
}

/** The active file and its rotated older files, oldest first. */
function traceFiles(dir, maxFiles, io) {
  const base = path.basename(TRACE_FILE, '.jsonl');
  const files = [];
  for (let i = maxFiles - 1; i >= 1; i -= 1) {
    const f = path.join(dir, `${base}.${i}.jsonl`);
    if (io.existsSync(f)) files.push(f);
  }
  const active = path.join(dir, TRACE_FILE);
  if (io.existsSync(active)) files.push(active);
  return files;
}

function rotate(dir, maxFiles, io) {
  const base = path.basename(TRACE_FILE, '.jsonl');
  const at = (i) => path.join(dir, i === 0 ? TRACE_FILE : `${base}.${i}.jsonl`);
  io.rmSync(at(maxFiles - 1), { force: true });
  for (let i = maxFiles - 2; i >= 0; i -= 1) if (io.existsSync(at(i))) io.renameSync(at(i), at(i + 1));
}

/** Append whole lines to the active file: create the directory (private), rotate when the cap would be passed, repair a torn last line. */
function appendLines(dir, lines, opts, io) {
  const maxBytes = opts.maxBytes ?? TRACE_STORE_LIMITS.maxBytes;
  const maxFiles = Math.max(1, opts.maxFiles ?? TRACE_STORE_LIMITS.maxFiles);
  const file = path.join(dir, TRACE_FILE);
  io.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const text = `${lines.join('\n')}\n`;
  let size = io.existsSync(file) ? io.statSync(file).size : 0;
  if (size > 0 && size + Buffer.byteLength(text) > maxBytes) {
    rotate(dir, maxFiles, io);
    size = 0;
  }
  let prefix = '';
  if (size > 0) {
    const fd = io.openSync(file, 'r');
    try {
      const last = Buffer.alloc(1);
      io.readSync(fd, last, 0, 1, size - 1);
      if (last[0] !== 0x0a) prefix = '\n';
    } finally {
      io.closeSync(fd);
    }
  }
  io.appendFileSync(file, prefix + text, { mode: 0o600 });
}

const readActive = (dir, io) => {
  const file = path.join(dir, TRACE_FILE);
  return io.existsSync(file) ? io.readFileSync(file, 'utf8') : '';
};

/**
 * Record decisions: build each trace (id, redaction check), skip the ones already in the active file (same id, so replaying a
 * whole request records each choice once), and append the new ones in ONE write. Never throws. Nothing is written when
 * recording is off for the project.
 *
 * @param {string} root The project root (its `architecture.yml` holds the switch).
 * @param {Parameters<typeof buildTrace>[0][]} inputs The decisions: `{ summary, chosen, by?, chooser?, provider?, suggestion?, outcome? }`.
 * @param {StoreOptions} [options] Clock, state directory, size cap, test seam.
 * @returns {RecordResult} What happened; `ids` are the ids of every valid decision, new or already recorded.
 *
 * @example
 * recordDecisions(root, [{ summary, chosen: 'entity' }]); // => { ok: true, enabled: true, recorded: 1, duplicates: 0, ids: ['dt-…'], refused: [] }
 */
export function recordDecisions(root, inputs, options = {}) {
  const result = { ok: true, enabled: true, recorded: 0, duplicates: 0, ids: [], refused: [] };
  try {
    if (!tracesEnabled(root)) return { ...result, enabled: false };
    const io = options.fsImpl ?? fs;
    const at = (options.now ?? clock)();
    const built = [];
    (Array.isArray(inputs) ? inputs : []).forEach((input, index) => {
      const b = buildTrace(input, { at });
      if (b.ok) built.push(b.trace);
      else result.refused.push({ index, errors: b.errors });
    });
    if (!built.length) return result;
    const dir = traceDir(root, options);
    const existing = readActive(dir, io);
    const seen = new Set();
    const fresh = [];
    for (const trace of built) {
      result.ids.push(trace.id);
      if (seen.has(trace.id) || existing.includes(`"id":"${trace.id}"`)) result.duplicates += 1;
      else fresh.push(trace);
      seen.add(trace.id);
    }
    if (fresh.length) appendLines(dir, fresh.map(serializeTrace), options, io);
    result.recorded = fresh.length;
    return result;
  } catch (e) {
    return { ...result, ok: false, error: errText(e) };
  }
}

/**
 * Record what happened to decisions afterwards, as SEPARATE outcome records that reference each decision id (history is never
 * rewritten). A label already recorded with the same value is skipped, so repeating the check that produced it adds nothing.
 * Never throws; nothing is written when recording is off.
 *
 * @param {string} root The project root.
 * @param {{ id: string, outcome: import('./decision-trace.mjs').TraceOutcome }[]} items Decision ids and their outcome labels.
 * @param {StoreOptions} [options] Clock, state directory, size cap, test seam.
 * @returns {RecordResult} `recorded` counts new outcome lines; `refused` holds invalid ones.
 *
 * @example
 * recordOutcomes(root, [{ id: 'dt-…', outcome: { planValidated: true } }]); // => { ok: true, enabled: true, recorded: 1, … }
 */
export function recordOutcomes(root, items, options = {}) {
  const result = { ok: true, enabled: true, recorded: 0, duplicates: 0, ids: [], refused: [] };
  try {
    if (!tracesEnabled(root)) return { ...result, enabled: false };
    const io = options.fsImpl ?? fs;
    const at = (options.now ?? clock)();
    const dir = traceDir(root, options);
    const known = new Map();
    for (const line of readActive(dir, io).split('\n')) {
      if (!line.includes('"kind":"outcome"')) continue;
      const p = parseTraceLine(line);
      if (p.ok && p.kind === 'outcome') known.set(p.record.of, { ...(known.get(p.record.of) ?? {}), ...p.record.outcome });
    }
    const lines = [];
    (Array.isArray(items) ? items : []).forEach((item, index) => {
      const b = buildOutcomeRecord({ of: item?.id, outcome: item?.outcome }, { at });
      if (!b.ok) {
        result.refused.push({ index, errors: b.errors });
        return;
      }
      result.ids.push(b.record.of);
      const have = known.get(b.record.of) ?? {};
      if (Object.entries(b.record.outcome).every(([k, v]) => have[k] === v)) {
        result.duplicates += 1;
        return;
      }
      known.set(b.record.of, { ...have, ...b.record.outcome });
      lines.push(serializeTrace(b.record));
    });
    if (lines.length) appendLines(dir, lines, options, io);
    result.recorded = lines.length;
    return result;
  } catch (e) {
    return { ...result, ok: false, error: errText(e) };
  }
}

/**
 * Record the outcome of ONE decision (see `recordOutcomes`).
 *
 * @param {string} root The project root.
 * @param {string} id The decision id (`dt-…`).
 * @param {import('./decision-trace.mjs').TraceOutcome} outcome One or more labels: `planValidated`, `testsPassed`, `reverted`, `accepted`.
 * @param {StoreOptions} [options] Clock, state directory, size cap, test seam.
 * @returns {RecordResult} What happened.
 *
 * @example
 * recordOutcome(root, id, { testsPassed: true });
 */
export function recordOutcome(root, id, outcome, options = {}) {
  return recordOutcomes(root, [{ id, outcome }], options);
}

/**
 * Read a project's traces: every rotated file, oldest first, malformed or torn lines skipped (counted, never fatal), decisions
 * deduplicated by id, outcome records folded over them. Reading is not gated by the switch: switching recording off keeps what
 * was recorded until you delete the directory. Never throws.
 *
 * @param {string} root The project root.
 * @param {StoreOptions} [options] State directory (and test seam).
 * @returns {{ dir: string, enabled: boolean, decisions: import('./decision-trace.mjs').DecisionTrace[], outcomes: import('./decision-trace.mjs').OutcomeRecord[], skipped: number, orphanOutcomes: number, error?: string }} The traces read.
 *
 * @example
 * readTraces(root).decisions.length; // => 42
 */
export function readTraces(root, options = {}) {
  const dir = traceDir(root, options);
  const out = { dir, enabled: tracesEnabled(root), decisions: [], outcomes: [], skipped: 0, orphanOutcomes: 0 };
  try {
    const io = options.fsImpl ?? fs;
    const decisions = new Map();
    for (const file of traceFiles(dir, Math.max(1, options.maxFiles ?? TRACE_STORE_LIMITS.maxFiles), io)) {
      for (const line of io.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const p = parseTraceLine(line);
        if (!p.ok) out.skipped += 1;
        else if (p.kind === 'outcome') out.outcomes.push(p.record);
        else if (!decisions.has(p.record.id)) decisions.set(p.record.id, p.record);
      }
    }
    out.orphanOutcomes = out.outcomes.filter((o) => !decisions.has(o.of)).length;
    out.decisions = mergeOutcomes([...decisions.values()], out.outcomes);
  } catch (e) {
    out.error = errText(e);
  }
  return out;
}

const providerVersion = (name) => {
  const v = getDecisionProvider(name)?.version;
  return typeof v === 'string' && v ? v : 'unversioned';
};

/**
 * Record the choices of a chain, with what a provider would have suggested. Each choice is
 * `{ summary, chosen, by?, chooser?, provider?, suggestion? }` (see `decision-trace-adapters.mjs` for the ones a card, a
 * placement and `compileChain` produce). For a PERSON's choice with no suggestion attached, the provider named by
 * `suggestWith` (default `rules`; `null` to skip) is asked through the decision seam, and the record carries what it suggested
 * and `outcome.accepted` (the suggestion was taken or overridden). `options.outcome`, when given (for example
 * `{ planValidated: true }` after the plan validated), is then recorded as a separate outcome record for every choice.
 * Never throws and asks nothing when recording is off.
 *
 * @param {string} root The project root.
 * @param {Array<Parameters<typeof buildTrace>[0] & { provider?: { name: string, version?: string } | string }>} choices The choices, in chain order.
 * @param {StoreOptions & { suggestWith?: string | null, outcome?: import('./decision-trace.mjs').TraceOutcome }} [options] Provider to compare with, the outcome to attach, clock, state directory.
 * @returns {Promise<RecordResult>} What happened to the decisions.
 *
 * @example
 * await recordChoices(root, [{ summary: questionSummary, chosen: 'entity', by: 'person' }], { outcome: { planValidated: true } });
 */
export async function recordChoices(root, choices, options = {}) {
  try {
    if (!tracesEnabled(root)) return { ok: true, enabled: false, recorded: 0, duplicates: 0, ids: [], refused: [] };
    const suggestWith = options.suggestWith === undefined ? 'rules' : options.suggestWith;
    const inputs = [];
    for (const choice of Array.isArray(choices) ? choices : []) {
      const input = { ...choice };
      if (typeof input.provider === 'string') input.provider = { name: input.provider, version: providerVersion(input.provider) };
      else if (input.provider && !input.provider.version) input.provider = { name: input.provider.name, version: providerVersion(input.provider.name) };
      if (!input.suggestion && suggestWith && (input.by ?? 'person') === 'person') {
        const s = await suggest(input.summary, { provider: suggestWith, timeoutMs: 1000 });
        if (s) {
          input.suggestion = { option: s.option, reason: s.reason };
          input.provider = { name: suggestWith, version: providerVersion(suggestWith) };
          input.outcome = { ...(input.outcome ?? {}), accepted: s.option === input.chosen };
        }
      }
      inputs.push(input);
    }
    const result = recordDecisions(root, inputs, options);
    if (options.outcome && result.ok && result.ids.length) {
      const o = recordOutcomes(root, result.ids.map((id) => ({ id, outcome: options.outcome })), options);
      if (!o.ok) return { ...result, ok: false, error: o.error };
    }
    return result;
  } catch (e) {
    return { ok: false, enabled: true, recorded: 0, duplicates: 0, ids: [], refused: [], error: errText(e) };
  }
}
