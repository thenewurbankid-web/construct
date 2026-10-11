'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { advance, approvedByPerson, delayFor, shouldMove, stopRun, waitForApproval } from '../domain/AutoRun';
import { hrefFor, isOnScreen, screenOfControl } from '../domain/TraceLights';
import { centreOf, perform, waitForControl } from '../workflows/AutoActions';
import type { RunState, TraceScreen, TraceSettings } from '../types';
import { updateTraceSettings } from './useTraceSettings';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const setRun = (change: (r: RunState) => RunState) => updateTraceSettings((s) => (s.run ? { ...s, run: change(s.run) } : s));

/** Auto's player: makes the run's current move on the real control (moving the simulated cursor first when the show
 * is on), goes to another screen when the move is there, and stops at Approve for the person unless they let Auto
 * approve in this session. Answers where the cursor is. */
export function useAutoPlayer(screen: TraceScreen, settings: TraceSettings): { x: number; y: number } | null {
  const router = useRouter();
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const { run, autoApprove, speed } = settings;
  const moving = shouldMove(run);
  const key = run ? `${run.runId}:${run.index}:${run.status}:${run.stepping}` : '';

  useEffect(() => {
    if (!run || !moving) return;
    let cancelled = false;
    const action = run.script[run.index];
    void (async () => {
      if (!action) return setRun(advance);
      const where = screenOfControl(action.controlId);
      if (!isOnScreen(where, screen)) {
        router.push(hrefFor(where));
        return;
      }
      const el = await waitForControl(action, 10_000, () => cancelled);
      if (cancelled) return;
      if (!el) {
        if (run.replay) return setRun(advance);
        return setRun((r) =>
          stopRun(
            r,
            `Auto stopped: the next control is not on this screen. Do the rest yourself: ${action.caption.charAt(0).toLowerCase()}${action.caption.slice(1)}`,
          ),
        );
      }
      if (run.show) {
        el.scrollIntoView({
          block: 'center',
          behavior: 'instant' as ScrollBehavior,
        });
        setCursor(centreOf(el));
        await sleep(delayFor(speed, true));
        if (cancelled) return;
      }
      if (run.replay) return setRun(advance);
      if (action.kind === 'approve' && !autoApprove) return setRun(waitForApproval);
      perform(el, action);
      await sleep(delayFor(speed, run.show) / 2);
      if (!cancelled) setRun(advance);
    })();
    return () => {
      cancelled = true;
    };
    // The run's key covers the run, its move and its state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, moving, screen, autoApprove, speed]);

  // Waiting at Approve: when the person clicks it, the run is done (the plan runner runs the change).
  const waiting = run?.status === 'waiting' ? run.script[run.index] : undefined;
  useEffect(() => {
    if (!waiting) return;
    let cancelled = false;
    let el: HTMLElement | null = null;
    const done = () => setRun(approvedByPerson);
    void waitForControl(waiting, 60_000, () => cancelled).then((found) => {
      if (cancelled || !found) return;
      el = found;
      if (run?.show) setCursor(centreOf(found));
      found.addEventListener('click', done, { once: true });
    });
    return () => {
      cancelled = true;
      el?.removeEventListener('click', done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, key]);

  const showing = run !== null && run.show && (run.status === 'playing' || run.status === 'paused' || run.status === 'waiting');
  return showing ? cursor : null;
}
