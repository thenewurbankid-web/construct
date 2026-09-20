// #312/#313 -- runs ONE analysis in a child process, so the synchronous PR-health engine (seconds on a
// big change) can never stall the Cockpit server's request thread. Spawned with child_process.fork by
// reviewJobs.mjs; it reads one message, writes one, and exits. Read-only by construction: prHealth reads
// through temporary detached worktrees that are removed before it returns, and so does the head read
// below (src/engine/gitTrees.mjs).
import path from 'node:path';
import { prHealth } from '../../../src/engine/prHealth.mjs';
import { withTrees } from '../../../src/engine/gitTrees.mjs';
import { summarizeUnit } from '../../../src/engine/unitSummary.mjs';

/** How many changed files get a "what it now does" sentence; the rest are one "+N more" row. */
export const MAX_SUMMARIZED = 40;
const SUMMARIZABLE = /\.(tsx?|jsx?|mjs|cjs)$/;

/** What each changed unit does on the HEAD commit, from `summarizeUnit` (deterministic, no model). */
export function summarizeChangedUnits(root, headSha, files) {
  const candidates = files.filter((f) => f.status !== 'D' && SUMMARIZABLE.test(f.path));
  const chosen = candidates.slice(0, MAX_SUMMARIZED);
  const out = withTrees(root, [headSha], ([dir], info) => {
    const headRoot = path.join(dir, info.prefix);
    return chosen.map((f) => {
      const s = summarizeUnit(headRoot, `file:${f.path}`, { detail: 'brief' });
      if (!s.ok) return { path: f.path, summary: null };
      return { path: f.path, summary: s.summary, purpose: s.sections?.file?.purpose ?? null, exports: s.sections?.exports ?? [] };
    });
  });
  if (!Array.isArray(out)) return { units: [], omitted: candidates.length, error: out?.error?.message ?? 'Could not read the head commit.' };
  return { units: out, omitted: candidates.length - chosen.length };
}

/** The whole job. `baseSha`/`headSha` are commit ids the parent took from its validated branch list. */
export function analyse({ root, baseSha, headSha }, deps = { prHealth, summarizeChangedUnits }) {
  const report = deps.prHealth(root, { base: baseSha, head: headSha });
  if (!report.ok) return { ok: false, error: report.error };
  const summaries = deps.summarizeChangedUnits(root, headSha, report.change.files);
  return { ok: true, report, units: summaries.units, unitsOmitted: summaries.omitted, ...(summaries.error ? { unitsError: summaries.error } : {}), worker: { pid: process.pid } };
}

if (process.send) {
  process.once('message', (job) => {
    let result;
    try {
      result = analyse(job);
    } catch (e) {
      result = { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message || e) } };
    }
    process.send(result, () => process.exit(0));
  });
}
