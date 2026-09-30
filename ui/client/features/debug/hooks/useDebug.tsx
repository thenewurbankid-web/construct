'use client';

import { useCallback, useReducer, useRef } from 'react';
import { runPlanOnServer } from '@/features/plan';
import type { Answer, ScreenAction, StepId } from '../domain/DebugTypes';
import { shouldReiterate } from '../domain/Verify';
import { readDebug } from '../services/DebugApi';
import { initialScreen, screenReducer } from '../workflows/DebugMachine';

/**
 * The Debug screen: the four choosers of the debug chain (reproduce -> isolate -> fix -> verify) are answered one
 * at a time; once all four are answered the server compiles a plan (debug.fix's ai exit is excluded from it, LIN-82
 * decision a) and Approve hands it to the Plan screen's own run route, unchanged. debug.verify's repeat-until loop
 * (`shouldReiterate`) is UI/CLI state, not a new engine primitive: marking a run "did not pass" clears isolate,
 * fix and verify's answers (keeping reproduce's) and re-reads, so the isolate chooser is re-presented.
 *
 * `latest` mirrors the reducer so an action fired right after another (an answer right after a read) reads state
 * that already reflects it; `seq` drops a read that a newer one overtook, the same pattern as useRequirement.
 */
export function useDebug(onApproved: () => void) {
  const [state, dispatch] = useReducer(screenReducer, initialScreen);
  const latest = useRef(state);
  const seq = useRef(0);
  const send = useCallback((a: ScreenAction) => {
    latest.current = screenReducer(latest.current, a);
    dispatch(a);
  }, []);

  const run = useCallback(async (feature: string, answers: Answer[]) => {
    if (!feature.trim()) return;
    const mine = ++seq.current;
    send({ type: 'READ_LOADING' });
    const r = await readDebug(feature, answers);
    if (mine !== seq.current) return;
    send(r.ok ? { type: 'READ_LOADED', result: r.data } : { type: 'READ_FAILED', error: r.error });
  }, [send]);

  const setFeature = useCallback((feature: string) => send({ type: 'FEATURE', feature }), [send]);
  const start = useCallback(() => run(latest.current.feature, []), [run]);

  const answer = useCallback((chooser: StepId, option: string) => {
    const next = [...latest.current.answers.filter((a) => a.chooser !== chooser), { chooser, option }];
    send({ type: 'ANSWERS', answers: next });
    return run(latest.current.feature, next);
  }, [send, run]);

  const approve = useCallback(async () => {
    const plan = latest.current.read.result?.plan;
    if (!plan) return;
    send({ type: 'APPROVE_LOADING' });
    const r = await runPlanOnServer(plan);
    if (!r.ok) return send({ type: 'APPROVE_FAILED', error: r.error });
    send({ type: 'APPROVE_STARTED', processId: r.data.processId });
    return onApproved();
  }, [send, onApproved]);

  const verifyResult = useCallback((passed: boolean) => {
    send({ type: 'VERIFY_RESULT', passed });
    if (!shouldReiterate({ passed })) return;
    const next = latest.current.answers.filter((a) => a.chooser === 'debug.reproduce');
    send({ type: 'ANSWERS', answers: next });
    return run(latest.current.feature, next);
  }, [send, run]);

  return { state, setFeature, start, answer, approve, verifyResult };
}
