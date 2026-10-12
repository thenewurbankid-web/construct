// #892: Mission Control's "Plan / jev" panel data. Reads the owner's intent loop files, never writes:
//   trace/tools/jev/data/ask-log.jsonl        every `ask` (request, labels static vs jev, Trace path, path shadow)
//   <project>/line/drafter/jev-shadow.jsonl   the drafter's intent shadow records (when a project's shadow switch is on)
//   trace/tools/jev/reports/intent-eval.json  the latest eval-intent report (static vs jev per label)
import fs from 'node:fs';
import path from 'node:path';

export const ASK_LOG_REL = 'trace/tools/jev/data/ask-log.jsonl';
export const EVAL_REL = 'trace/tools/jev/reports/intent-eval.json';
export const SHADOW_REL = 'line/drafter/jev-shadow.jsonl';

/**
 * The last `n` parsed records of a JSONL text; bad lines are skipped and counted.
 * @param {string} text @param {number} [n]
 * @returns {{records: any[], bad: number, total: number}}
 */
export function lastJsonl(text, n = 20) {
  const lines = String(text ?? '').split('\n').filter((l) => l.trim());
  const records = []; let bad = 0;
  for (const l of lines.slice(-n)) { try { records.push(JSON.parse(l)); } catch { bad += 1; } }
  return { records, bad, total: lines.length };
}

/** Count forks in an ask (labels + path decisions). @param {any} a */
export const forkCount = (a) => (a?.labels?.forks?.length ?? 0) + (a?.shadow ?? []).filter((x) => x.fork).length;

/**
 * The panel payload from the three files' contents (any may be null).
 * @param {{askLog?: string|null, shadowLog?: string|null, evalJson?: string|null}} files
 */
export function planJevPayload(files) {
  const asks = lastJsonl(files.askLog ?? '', 10);
  const shadow = lastJsonl(files.shadowLog ?? '', 50);
  let evalReport = null;
  try {
    const j = files.evalJson ? JSON.parse(files.evalJson) : null;
    if (j) evalReport = { at: j.at ?? null, seed: j.seed, jev: j.jev, rows: j.rows, uncertain: j.uncertain, tables: j.tables, confusions: (j.confusions ?? []).slice(0, 5) };
  } catch { evalReport = { error: 'intent-eval.json is not JSON' }; }
  const latest = asks.records[asks.records.length - 1] ?? null;
  const sh = shadow.records;
  return {
    ask: latest,
    asks: asks.records.slice(0, -1).reverse().map((a) => ({ at: a.at, request: a.request, intent: a.labels?.static?.intent ?? null, forks: forkCount(a) })),
    askTotal: asks.total,
    shadow: { total: shadow.total, recent: sh.slice(-10).reverse(), forkRate: sh.length ? Math.round((sh.filter((r) => r.forks?.length).length / sh.length) * 100) : null, jevAnswered: sh.filter((r) => r.jev).length },
    eval: evalReport,
  };
}

/**
 * Read the files for a checkout (the one Mission Control runs from).
 * @param {string} root the checkout @param {string} [project] repo-relative Line project whose shadow log is shown
 */
export function readPlanJev(root, project = process.env.MC_JEV_PROJECT ?? 'examples/line-sample') {
  const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
  return { project, ...planJevPayload({ askLog: read(path.join(root, ASK_LOG_REL)), shadowLog: read(path.join(root, project, SHADOW_REL)), evalJson: read(path.join(root, EVAL_REL)) }) };
}
