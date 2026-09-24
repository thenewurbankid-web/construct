'use client';

import { useCallback, useEffect, type MutableRefObject } from 'react';
import { proofTargetOf, skipReasonOf } from '../domain/ProofCard';
import type { ScreenAction, ScreenState } from '../domain/RequirementTypes';
import { proofStatusOnServer, runProofOnServer, skipProofOnServer } from '../services/RequirementApi';

/** How often the screen asks whether the plan's files have reached the project, while the plan is approved and they have not. */
export const APPLIED_POLL_MS = 2000;

/**
 * The proof of a generated screen (#653): is the plan applied (asked once when a plan is shown, then every couple of seconds
 * while it is approved and its files are not in yet), run the read-only proof, or skip it with a reason. The chain is complete only
 * when the proof is green or skipped; every rule is the server's, this only asks and reports. Nothing here calls a model.
 *
 * `latest` is the state the reducer holds, so an answer that arrives after a newer read (a different plan) is dropped.
 */
export function useProof(state: ScreenState, latest: MutableRefObject<ScreenState>, send: (a: ScreenAction) => void) {
  const result = state.read.result;
  const plan = result?.plan ?? null;
  const target = proofTargetOf(result);
  const feature = target?.feature ?? null;
  const applied = state.proof.applied;
  const polling = state.approve.status === 'started' && applied !== true;

  const check = useCallback(async () => {
    if (!plan || !feature) return;
    const r = await proofStatusOnServer(feature, plan);
    if (latest.current.read.result?.plan !== plan) return;
    if (r.ok) send({ type: 'PROOF_APPLIED', applied: r.data.applied, options: r.data.options });
  }, [plan, feature, latest, send]);

  useEffect(() => {
    if (feature && applied === null) void check();
  }, [feature, applied, check]);

  useEffect(() => {
    if (!polling) return undefined;
    const timer = setInterval(() => void check(), APPLIED_POLL_MS);
    return () => clearInterval(timer);
  }, [polling, check]);

  const runProof = useCallback(async () => {
    const s = latest.current;
    const shown = s.read.result;
    const t = proofTargetOf(shown);
    if (!t || !shown?.plan || s.proof.run.status === 'running') return;
    send({ type: 'PROOF_RUN_STARTED' });
    const r = await runProofOnServer(t.feature, shown.plan);
    if (latest.current.read.result !== shown) return;
    if (r.ok) send({ type: 'PROOF_RUN_DONE', run: r.data });
    else send({ type: 'PROOF_RUN_FAILED', error: r.error, ...(r.code === 'NOT_APPLIED' ? { applied: false } : {}) });
  }, [latest, send]);

  const openSkip = useCallback(() => send({ type: 'PROOF_SKIP_OPEN' }), [send]);
  const cancelSkip = useCallback(() => send({ type: 'PROOF_SKIP_CANCEL' }), [send]);
  const editSkipReason = useCallback((draft: string) => send({ type: 'PROOF_SKIP_DRAFT', draft }), [send]);
  const confirmSkip = useCallback(async () => {
    const s = latest.current;
    const shown = s.read.result;
    const t = proofTargetOf(shown);
    if (!t || !shown?.plan || s.proof.skip.status === 'saving') return;
    const reason = skipReasonOf(s.proof.skip.draft);
    if (!reason.ok) {
      send({ type: 'PROOF_SKIP_FAILED', error: reason.error });
      return;
    }
    send({ type: 'PROOF_SKIP_SAVING' });
    const r = await skipProofOnServer(t.feature, shown.plan, reason.reason);
    if (latest.current.read.result !== shown) return;
    send(r.ok ? { type: 'PROOF_SKIP_DONE', reason: r.data.reason } : { type: 'PROOF_SKIP_FAILED', error: r.error });
  }, [latest, send]);

  return { runProof, openSkip, cancelSkip, editSkipReason, confirmSkip };
}
