'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_SETTINGS, isActive, pauseRun, resumeRun, startRun, stepRun, stopRun, withHistory } from '../domain/AutoRun';
import { idleSentence, lightsFor, stepsForTrace } from '../domain/TraceLights';
import { lineTraceApi } from '../services/LineTraceApi';
import { applyLights, clearLights } from '../workflows/AutoActions';
import type { LineTraceApi, PlanStepView, TraceMatch, TraceScreen, TraceView } from '../types';
import { useAutoPlayer } from './useAutoPlayer';
import { updateTraceSettings, useTraceSettings } from './useTraceSettings';

const NO_STEPS: PlanStepView[] = [];
const newId = () => `run-${Date.now().toString(36)}`;

/** Trace and Auto on one screen: the request and the plan's open steps become lit controls here (and links to other
 * screens), and Auto plays the request's script on the real controls. `steps`: the screen's plan steps, if it has a
 * Plan panel. */
export function useLineTrace(screen: TraceScreen, steps: PlanStepView[] = NO_STEPS, api: LineTraceApi = lineTraceApi): TraceView {
  const settings = useTraceSettings();
  const on = settings.trace || settings.auto;
  const [match, setMatch] = useState<TraceMatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = useMemo(() => stepsForTrace(steps), [steps]);
  const openKey = JSON.stringify(open);
  const request = settings.request.trim();

  useEffect(() => {
    if (!on || (!request && !open.length)) {
      setMatch(null);
      setError(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      void api.trace({ request, steps: open }).then((a) => {
        if (!live) return;
        if (a.ok) {
          setMatch(a.match);
          setError(null);
        } else setError(a.sentence);
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // openKey stands for `open`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, request, openKey, api]);

  const lights = useMemo(() => (settings.trace ? lightsFor(match, screen) : { here: [], elsewhere: [] }), [settings.trace, match, screen]);

  // Light the controls in place, again whenever the screen's content changes (a form opens, parts load).
  useEffect(() => {
    if (!lights.here.length) {
      clearLights();
      return;
    }
    let frame = 0;
    const paint = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => applyLights(lights.here));
    };
    paint();
    const watch = new MutationObserver(paint);
    watch.observe(document.body, { childList: true, subtree: true });
    return () => {
      watch.disconnect();
      cancelAnimationFrame(frame);
      clearLights();
    };
  }, [lights]);

  const cursor = useAutoPlayer(screen, settings);

  const setTrace = useCallback((v: boolean) => updateTraceSettings((s) => ({ ...s, trace: v })), []);
  const setAuto = useCallback(
    (v: boolean) =>
      updateTraceSettings((s) => ({
        ...s,
        auto: v,
        ...(v ? {} : { run: s.run && isActive(s.run) ? stopRun(s.run) : s.run }),
      })),
    [],
  );
  const setRequest = useCallback((text: string) => updateTraceSettings((s) => ({ ...s, request: text.slice(0, 300) })), []);
  const setAutoApprove = useCallback((v: boolean) => updateTraceSettings((s) => ({ ...s, autoApprove: v })), []);
  const setSpeed = useCallback((v: number) => updateTraceSettings((s) => ({ ...s, speed: v })), []);
  const script = match?.tools[0]?.script ?? null;
  const run = useCallback(() => {
    if (!script?.length) return;
    const id = newId();
    updateTraceSettings((s) => ({
      ...s,
      run: startRun(id, s.request.trim(), script, s.trace),
      history: withHistory(s.history, {
        id,
        request: s.request.trim(),
        script,
        at: new Date().toISOString(),
      }),
    }));
  }, [script]);
  const pause = useCallback(() => updateTraceSettings((s) => (s.run ? { ...s, run: pauseRun(s.run) } : s)), []);
  const resume = useCallback(() => updateTraceSettings((s) => (s.run ? { ...s, run: resumeRun(s.run) } : s)), []);
  const step = useCallback(() => updateTraceSettings((s) => (s.run ? { ...s, run: stepRun(s.run) } : s)), []);
  const stop = useCallback(() => updateTraceSettings((s) => (s.run && isActive(s.run) ? { ...s, run: stopRun(s.run) } : s)), []);
  const replay = useCallback(
    (runId: string) =>
      updateTraceSettings((s) => {
        const h = s.history.find((x) => x.id === runId);
        return h ? { ...s, run: startRun(newId(), h.request, h.script, true, true) } : s;
      }),
    [],
  );

  const sentence = error ?? match?.sentence ?? idleSentence(settings.trace, settings.auto);
  return {
    settings: settings ?? DEFAULT_SETTINGS,
    match: on ? match : null,
    lights,
    error,
    sentence,
    cursor,
    setTrace,
    setAuto,
    setRequest,
    setAutoApprove,
    setSpeed,
    run,
    pause,
    resume,
    step,
    stop,
    replay,
  };
}
