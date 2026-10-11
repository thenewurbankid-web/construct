// cu2 (Line): GET /api/line/ai-profiles, the read-only list of every AI step's profile (packages/core/ai-profiles.mjs;
// shape AiProfiles in packages/engine/line/contract.mjs). It needs no open project: the profiles are Line's, the same for
// every project. Reads two JSON files and the link status; it never calls a model.
import express from 'express';
import { readAiProfiles } from '../../../packages/core/ai-profiles.mjs';

/**
 * @param {{ read?: typeof readAiProfiles }} [deps] Tests pass their own reader.
 * @returns {import('express').Router}
 */
export function createLineAiRouter({ read = readAiProfiles } = {}) {
  const router = express.Router();
  router.get('/ai-profiles', (_req, res) => {
    try {
      return res.json(read());
    } catch {
      return res.status(500).json({ ok: false, sentence: 'Cockpit could not read the AI step settings, so every step uses its static path.', code: 'INTERNAL' });
    }
  });
  return router;
}
