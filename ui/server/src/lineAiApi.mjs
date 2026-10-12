// cu2 (Line): GET /api/line/ai-profiles, the read-only list of every AI step's profile (packages/core/ai-profiles.mjs;
// shape AiProfiles in packages/engine/line/contract.mjs). It needs no open project: the profiles are Line's, the same for
// every project. Reads two JSON files and the link status; it never calls a model.
import express from 'express';
import { readAiProfiles } from '../../../packages/core/ai-profiles.mjs';
import { readClassifiedPlanMisses, missReport } from '../../../packages/rule-factory/misses.mjs';
import { readSnapshot } from '../../../packages/rule-factory/eval-misses.mjs';

/**
 * im1: the miss report Settings shows under "AI steps": the open project's plan feedback (where the person's own choice
 * was the right answer) plus the repo's last eval snapshot (Train Line's gold and the drafter eval;
 * `node packages/rule-factory/eval-misses.mjs --write`). Every miss is absent (the right answer was not offered) or
 * picked (offered, another recommended). Slotted: no project name. Never calls a model.
 * @param {string|null} root
 * @param {() => any} snapshot
 * @returns {import('../../../packages/engine/line/contract.mjs').MissReportView}
 */
export function missReportView(root, snapshot = readSnapshot) {
  const plan = root ? readClassifiedPlanMisses(root) : [];
  const snap = snapshot();
  const r = missReport([...plan, ...(snap?.misses ?? [])]);
  const sources = [root ? 'your plan feedback' : null, snap ? `Train Line and the drafter eval (measured ${snap.at})` : null].filter(Boolean);
  return {
    ok: true, ...r,
    from: sources.length ? `From ${sources.join(' and ')}.` : 'No plan feedback or eval has been measured yet.',
    numbers: snap?.numbers ?? null,
  };
}

/**
 * @param {{ read?: typeof readAiProfiles, getRoot?: () => ({ok: true, root: string} | {ok: false, error: string}), snapshot?: () => any }} [deps]
 *   Tests pass their own reader; `getRoot` names the open project (its plan feedback joins the miss report).
 * @returns {import('express').Router}
 */
export function createLineAiRouter({ read = readAiProfiles, getRoot = () => ({ ok: false, error: '' }), snapshot = readSnapshot } = {}) {
  const router = express.Router();
  router.get('/misses', (_req, res) => {
    try {
      const r = getRoot();
      return res.json(missReportView(r.ok ? r.root : null, snapshot));
    } catch {
      return res.status(500).json({ ok: false, sentence: 'Cockpit could not read the miss report.', code: 'INTERNAL' });
    }
  });
  router.get('/ai-profiles', (_req, res) => {
    try {
      return res.json(read());
    } catch {
      return res.status(500).json({ ok: false, sentence: 'Cockpit could not read the AI step settings, so every step uses its static path.', code: 'INTERNAL' });
    }
  });
  return router;
}
