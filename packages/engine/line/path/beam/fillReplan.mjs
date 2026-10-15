// #949 Trace beam in path-first fill (path/fill.mjs), behind lsp.beam (lsp/profile.mjs; default shadow): when a stub
// has failed 3 fills in a row, the beam re-plans its point (the next surviving path without that stub, else
// NEEDS_YOU). Shadow logs what it would do and keeps today's single path; on also returns it in the fill result.
// The point is read back from the path (line/path/path.json): its page, its view-model units and one slot per
// logic unit (examples as the path carries them).
import fs from 'node:fs';
import path from 'node:path';
import { FILLS_FILE } from '../check.mjs';
import { lspMode, shadowLog } from '../../lsp/profile.mjs';
import { beamFacts } from './facts.mjs';
import { shortestPlan, replan } from './shortestPlan.mjs';

export const REPLAN_AFTER = 3;
const SLOT_LAYERS = { service: 'service', contract: 'contract', domain: 'domain' };

/**
 * A path unit's stable id, <feature>/<folder>/<export>.
 * @param {{file: string, export?: string, fn?: string}} u
 * @returns {string}
 */
export function stableIdOf(u) {
  const parts = String(u.file).split('/');
  const f = parts[0] === 'features' ? parts[1] : parts[0];
  return `${f}/${parts.at(-2)}/${u.export ?? u.fn}`;
}

/**
 * One path point as the beam's point.
 * @param {string} root
 * @param {any} p The path.
 * @param {string} id The point id.
 * @returns {any}
 */
export function pointFromPath(root, p, id) {
  const units = p.units.filter((u) => u.point === id);
  const page = units.find((u) => u.layer === 'page') ?? null;
  const feature = page ? stableIdOf(page).split('/')[0] : stableIdOf(units[0]).split('/')[0];
  const slots = units.filter((u) => SLOT_LAYERS[u.layer]).map((u) => {
    const [f, dir, name] = stableIdOf(u).split('/');
    return { id: u.id, kind: u.layer === 'domain' ? 'computed' : 'api', layer: SLOT_LAYERS[u.layer], name, feature: f, dir, examples: (u.examples ?? []).filter((e) => 'expect' in e) };
  });
  return {
    id, feature, slots,
    page: page ? { name: page.export, exists: fs.existsSync(path.join(root, page.file)) } : null,
    traits: { state: units.some((u) => u.layer === 'hook' || u.layer === 'provider'), shared: units.some((u) => u.layer === 'provider'), action: units.some((u) => u.check === 'dom') },
  };
}

/** Failed fills of one stub since its last pass. */
function failsInARow(root, stubId) {
  let n = 0; let last = null;
  try {
    for (const l of fs.readFileSync(path.join(root, FILLS_FILE), 'utf8').split('\n')) {
      if (!l.trim()) continue;
      const f = JSON.parse(l);
      if (f.stubId !== stubId) continue;
      if (f.pass) { n = 0; last = null; } else { n++; last = f.failure ?? null; }
    }
  } catch { /* no fills yet */ }
  return { n, last };
}

/**
 * After a failed fill: re-plan the stub's point when it has failed REPLAN_AFTER fills in a row (and every
 * REPLAN_AFTER after that). Never throws.
 * @param {string} root
 * @param {any} p The path.
 * @param {any} u The stub unit that just failed.
 * @param {{lsp?: Record<string, unknown>|null}} [o]
 * @returns {{mode: string, point: string, stuck: string, fails: number, would: any, plan: {forked: number, survivors: number}}|null}
 */
export function beamOnFail(root, p, u, o = {}) {
  const mode = lspMode(root, 'beam', o.lsp ?? null);
  if (mode === 'off') return null;
  const { n, last } = failsInARow(root, u.id);
  if (n < REPLAN_AFTER || n % REPLAN_AFTER) return null;
  try {
    const point = pointFromPath(root, p, u.point);
    const plan = shortestPlan(root, point, { facts: beamFacts(root) });
    const stuck = stableIdOf(u);
    const current = plan.candidates.find((c) => c.stubs.includes(stuck))?.key ?? null;
    const r = replan(plan, { current, stuckStub: stuck, failure: last });
    const row = { mode, point: u.point, stuck, fails: n, would: r.decision, plan: { forked: plan.forked, survivors: plan.survivors.length } };
    if (mode === 'shadow') shadowLog(root, 'beam', { point: row.point, stuck, fails: n, would: r.decision, plan: row.plan });
    return row;
  } catch (e) {
    return mode === 'shadow' ? (shadowLog(root, 'beam', { point: u.point, error: String(e?.message ?? e).slice(0, 200) }), null) : null;
  }
}
