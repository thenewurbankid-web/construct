'use client';

import { useCallback, useReducer, useRef } from 'react';
import { createNote } from '@/features/notes';
import { runPlanOnServer } from '@/features/plan';
import { withAnswer } from '../domain/Examples';
import { noteDraftOf } from '../domain/NoteDraft';
import type { Answer, ScreenAction } from '../domain/RequirementTypes';
import type { AnswerTarget } from '../types';
import { readRequirement } from '../services/RequirementApi';
import { initialScreen, screenReducer } from '../workflows/RequirementMachine';

/**
 * The Requirement screen: a sentence is read into a card, a placement, a plan and a timeline by the server's deterministic
 * blocks; a person answers the closed questions, then approves the plan. Approving hands the plan to the Plan screen's own
 * run route (per-file approval, containment and the session gate are that route's, unchanged). Nothing here calls a model.
 *
 * `latest` is the state the reducer holds, advanced in the same order as `send`, so an action that starts right after another
 * reads the text and answers just set. `seq` drops the answer of a read that a newer one overtook.
 */
export function useRequirement(onApproved: () => void) {
  const [state, dispatch] = useReducer(screenReducer, initialScreen);
  const latest = useRef(state);
  const seq = useRef(0);
  const send = useCallback((a: ScreenAction) => {
    latest.current = screenReducer(latest.current, a);
    dispatch(a);
  }, []);

  const run = useCallback(async (text: string, answers: Answer[]) => {
    const mine = ++seq.current;
    send({ type: 'READ_LOADING' });
    const r = await readRequirement(text, answers);
    if (mine !== seq.current) return;
    send(r.ok ? { type: 'READ_LOADED', result: r.data } : { type: 'READ_FAILED', error: r.error });
  }, [send]);

  const setText = useCallback((text: string) => send({ type: 'TEXT', text }), [send]);
  const read = useCallback(() => run(latest.current.text, latest.current.answers), [run]);
  const pickExample = useCallback((text: string) => {
    send({ type: 'TEXT', text });
    return run(text, []);
  }, [send, run]);
  const answer = useCallback((question: AnswerTarget, option: string) => {
    const next = withAnswer(latest.current.answers, question, option);
    send({ type: 'ANSWERS', answers: next });
    return run(latest.current.text, next);
  }, [send, run]);

  const approve = useCallback(async () => {
    const plan = latest.current.read.status === 'loading' ? null : latest.current.read.result?.plan;
    if (!plan) return;
    send({ type: 'APPROVE_RUNNING' });
    const r = await runPlanOnServer(plan);
    if (!r.ok) return send({ type: 'APPROVE_FAILED', error: r.error });
    send({ type: 'APPROVE_STARTED', processId: r.data.processId });
    return onApproved();
  }, [send, onApproved]);

  const saveNote = useCallback(async () => {
    const result = latest.current.read.result;
    if (!result) return;
    send({ type: 'NOTE_SAVING' });
    const r = await createNote(noteDraftOf(latest.current.text, result));
    send(r.ok ? { type: 'NOTE_SAVED' } : { type: 'NOTE_FAILED', error: r.error });
  }, [send]);

  return { state, setText, read, pickExample, answer, approve, saveNote };
}
