// Line primitives (roadmap item 1), the per-release metric: the share of held-out library components that map onto a
// Line primitive with no loss. The held-out sources (survey.json `heldOut`, chakra and mantine) are never used to
// define the clusters' states and events; each of their top-level components is mapped by name to a cluster
// (clusters.mjs) and from there to the primitive that covers it (contract.mjs `covers`). A mapped component has no
// loss when every canonical state and event it has is one the primitive has too. Pure: survey and contract in,
// report out.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRIMITIVES } from './contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Clusters that render no widget (portals, transitions, CSS resets): reported apart as "plumbing". */
export const PLUMBING_CLUSTERS = Object.freeze(['utility', 'transition']);

/**
 * @typedef {{ lib: string, name: string, cluster: string|null, primitive: string|null, status: 'no-loss'|'loss'|'unmapped', missingStates: string[], missingEvents: string[] }} CoverageRow
 * @typedef {{ total: number, noLoss: number, loss: number, unmapped: number, percent: number }} CoverageCount
 * @typedef {{ heldOut: string[], overall: CoverageCount, widgets: CoverageCount, byLib: Record<string, CoverageCount>, rows: CoverageRow[], topMisses: {cluster: string, count: number}[], topLosses: {id: string, count: number}[] }} CoverageReport
 */

/**
 * Read survey.json from the package folder.
 * @param {string} [file] Path to a survey file.
 * @returns {any} The parsed survey.
 */
export function loadSurvey(file = path.join(HERE, 'survey.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * The primitives whose component is in the library (library/components/<Name>.tsx): the ones the metric counts.
 * @param {string} [dir] The components folder.
 * @returns {import('./contract.mjs').PrimitiveContract[]} The built primitives, in contract order.
 */
export function builtPrimitives(dir = path.join(HERE, 'library', 'components')) {
  return PRIMITIVES.filter((p) => fs.existsSync(path.join(dir, `${p.name}.tsx`)));
}

/**
 * Count rows into a coverage figure.
 * @param {CoverageRow[]} rows The rows.
 * @returns {CoverageCount} Totals and the no-loss percentage (one decimal).
 */
function count(rows) {
  const noLoss = rows.filter((r) => r.status === 'no-loss').length;
  const loss = rows.filter((r) => r.status === 'loss').length;
  const total = rows.length;
  return { total, noLoss, loss, unmapped: total - noLoss - loss, percent: total ? Math.round((noLoss / total) * 1000) / 10 : 0 };
}

/**
 * The coverage of held-out components by the primitives.
 * @param {any} survey The survey document (survey.json).
 * @param {readonly import('./contract.mjs').PrimitiveContract[]} [primitives] The contracts measured (default: the built ones).
 * @returns {CoverageReport} The report.
 */
export function coverage(survey, primitives = builtPrimitives()) {
  const heldOut = survey.sources.filter((s) => s.heldOut).map((s) => s.id);
  const rows = survey.components.filter((c) => heldOut.includes(c.lib)).map((c) => {
    const p = c.cluster ? primitives.find((x) => x.covers.includes(c.cluster)) : null;
    if (!p) return { lib: c.lib, name: c.name, cluster: c.cluster, primitive: null, status: 'unmapped', missingStates: [], missingEvents: [] };
    const states = new Set(p.states.map((s) => s.id));
    const events = new Set(p.events.map((e) => e.id));
    const missingStates = c.states.filter((s) => s !== 'default' && !states.has(s));
    const missingEvents = c.events.filter((e) => !events.has(e));
    const status = missingStates.length || missingEvents.length ? 'loss' : 'no-loss';
    return { lib: c.lib, name: c.name, cluster: c.cluster, primitive: p.name, status, missingStates, missingEvents };
  });
  const byLib = {};
  for (const lib of heldOut) byLib[lib] = count(rows.filter((r) => r.lib === lib));
  const tally = (items) => Object.entries(items.reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {})).map(([id, n]) => ({ id, count: n })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  return {
    heldOut,
    overall: count(rows),
    widgets: count(rows.filter((r) => !PLUMBING_CLUSTERS.includes(r.cluster ?? ''))),
    byLib,
    rows,
    topMisses: tally(rows.filter((r) => r.status === 'unmapped').map((r) => r.cluster ?? '(no cluster)')).slice(0, 10).map(({ id, count: n }) => ({ cluster: id, count: n })),
    topLosses: tally(rows.filter((r) => r.status === 'loss').flatMap((r) => [...r.missingStates.map((s) => `state ${s}`), ...r.missingEvents.map((e) => `event ${e}`)])).slice(0, 10),
  };
}

/**
 * The report as plain-English lines for the CLI.
 * @param {CoverageReport} report The report.
 * @returns {string[]} The lines.
 */
export function coverageLines(report) {
  const o = report.overall;
  const w = report.widgets;
  const lines = [
    `${o.percent}% of held-out components map onto a Line primitive with no loss (${o.noLoss} of ${o.total}, held out: ${report.heldOut.join(', ')}).`,
    `Widgets only (portals, transitions and resets left out): ${w.percent}% (${w.noLoss} of ${w.total}).`,
    `${o.loss} map with some loss and ${o.unmapped} have no primitive yet.`,
  ];
  for (const [lib, c] of Object.entries(report.byLib)) lines.push(`- ${lib}: ${c.percent}% (${c.noLoss} of ${c.total}; ${c.loss} with loss, ${c.unmapped} unmapped)`);
  if (report.topLosses.length) lines.push(`Most common losses: ${report.topLosses.map((l) => `${l.id} (${l.count})`).join(', ')}.`);
  if (report.topMisses.length) lines.push(`Most common clusters with no primitive: ${report.topMisses.map((m) => `${m.cluster} (${m.count})`).join(', ')}.`);
  return lines;
}
