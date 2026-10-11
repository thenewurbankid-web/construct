'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RUN, startRun } from '../domain/AutoRun';
import { isActive } from '../domain/AutoStatus';
import { SPEED_OPTIONS, runButtons } from '../domain/AutoView';
import { findingsOf } from '../domain/TraceFindings';
import { idleSentence, lightsFor, stepsForTrace } from '../domain/TraceLights';
import { withHistory } from '../domain/TraceSettings';
import { lineTraceApi } from '../services/LineTraceApi';
import { applyLights, clearLights } from '../workflows/TraceLightsDom';
import type { AutoButton, LineTraceApi, PlanStepView, RunState, TraceMatch, TraceScreen, TraceView } from '../types';
import { useAutoPlayer } from './useAutoPlayer';
import { updateTraceSettings, useTraceSettings } from './useTraceSettings';

const NO_STEPS: PlanStepView[] = [];
const newId = () => `run-${Date.now().toString(36)}`;
const onRun = (change: (r: RunState) => RunState) => updateTraceSettings((s) => (s.run ? { ...s, run: change(s.run) } : s));
const PRESS: Record<AutoButton['id'], () => void> = {
  pause: () => onRun(RUN.pause),
  resume: () => onRun(RUN.resume),
  step: () => onRun(RUN.step),
  stop: () => onRun((r) => (isActive(r) ? RUN.stop(r) : r)),
};

/** Light the controls in place, again whenever the screen's content changes (a form opens, parts load). */
function useLightsOnPage(here: TraceView['lights']['here']) {
  useEffect(() => {
    if (!here.length) {
      clearLights();
      return;
    }
    let frame = 0;
    const paint = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => applyLights(here));
    };
    paint();
    const watch = new MutationObserver(paint);
    watch.observe(document.body, { childList: true, subtree: true });
    return () => {
      watch.disconnect();
      cancelAnimationFrame(frame);
      clearLights();
    };
  }, [here]);
}

/** The request and the plan's open steps as a TraceMatch (POST /api/line/trace), asked again when either changes. */
function useTraceMatch(on: boolean, request: string, steps: PlanStepView[], api: LineTraceApi) {
  const [match, setMatch] = useState<TraceMatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = useMemo(() => stepsForTrace(steps), [steps]);
  const openKey = JSON.stringify(open);
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
        setMatch(a.ok ? a.match : null);
        setError(a.ok ? null : a.sentence);
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // openKey stands for `open`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, request, openKey, api]);
  return { match: on ? match : null, error };
}

/** Trace and Auto on one screen: the request and the plan's open steps become lit controls here (and links to other
 * screens), and Auto plays the request's script on the real controls. `steps`: the screen's plan steps, if it has a
 * Plan panel. */
export function useLineTrace(screen: TraceScreen, steps: PlanStepView[] = NO_STEPS, api: LineTraceApi = lineTraceApi): TraceView {
  const settings = useTraceSettings();
  const { match, error } = useTraceMatch(settings.trace || settings.auto, settings.request.trim(), steps, api);
  const lights = useMemo(() => (settings.trace ? lightsFor(match, screen) : { here: [], elsewhere: [] }), [settings.trace, match, screen]);
  useLightsOnPage(lights.here);
  const cursor = useAutoPlayer(screen, settings);

  const setTrace = useCallback((v: boolean) => updateTraceSettings((s) => ({ ...s, trace: v })), []);
  const setAuto = useCallback((v: boolean) => updateTraceSettings((s) => ({ ...s, auto: v, run: !v && s.run && isActive(s.run) ? RUN.stop(s.run) : s.run })), []);
  const setRequest = useCallback((text: string) => updateTraceSettings((s) => ({ ...s, request: text.slice(0, 300) })), []);
  const setAutoApprove = useCallback((v: boolean) => updateTraceSettings((s) => ({ ...s, autoApprove: v })), []);
  const setSpeed = useCallback((v: number) => updateTraceSettings((s) => ({ ...s, speed: v })), []);
  const script = match?.tools[0]?.from === 'request' ? match.tools[0].script : null;
  const run = useCallback(() => {
    if (!script?.length) return;
    const id = newId();
    updateTraceSettings((s) => ({
      ...s,
      run: startRun(id, s.request.trim(), script, s.trace),
      history: withHistory(s.history, { id, request: s.request.trim(), script, at: new Date().toISOString() }),
    }));
  }, [script]);
  const replay = useCallback(
    (runId: string) =>
      updateTraceSettings((s) => {
        const h = s.history.find((x) => x.id === runId);
        return h ? { ...s, run: startRun(newId(), h.request, h.script, true, true) } : s;
      }),
    [],
  );
  const press = useCallback((id: AutoButton['id']) => PRESS[id](), []);

  const active = isActive(settings.run);
  return {
    settings,
    match,
    lights,
    error,
    sentence: error ?? match?.sentence ?? idleSentence(settings.trace, settings.auto),
    cursor,
    findings: findingsOf(match, lights, settings.trace),
    active,
    canRun: !active && Boolean(script?.length),
    runLabel: settings.trace ? 'Show me and do it' : 'Do it',
    speeds: SPEED_OPTIONS,
    buttons: runButtons(settings.run),
    press,
    setTrace,
    setAuto,
    setRequest,
    setAutoApprove,
    setSpeed,
    run,
    replay,
  };
}
