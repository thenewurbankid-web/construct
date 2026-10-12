'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeCard, ChangeView, KnowsTabProps } from '@/lib/lineKnowsContract';
import { changeCards, changeSentence, type CardProgress } from '../domain/ChangeCards';
import { approveChange, planChange } from '../workflows/PlanChange';
import { mockChangePlan, realChangePlan, type ChangePlanApi } from '../services/ChangePlanApi';

export type KnowsChangeScreen = {
  sentence: string | null;
  error: string | null;
  cards: ChangeCard[];
  busy: string | null;
  plan: (id: string) => void;
  approve: (id: string) => void;
  /** Back to the Map at a change's item. */
  show: (target: string) => void;
};

/** The Change tab: the proposals for the project (the item in focus first), each planned and approved by the person. */
export function useKnowsChange({ http, focus, goTo, mock }: KnowsTabProps, api?: ChangePlanApi): KnowsChangeScreen {
  const [view, setView] = useState<ChangeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, CardProgress>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const stepToChange = useRef(new Map<string, string>());
  const plan = useMemo(() => api ?? (mock ? mockChangePlan((stepId) => { const id = stepToChange.current.get(stepId); if (id) http.mockApplied?.(id); }) : realChangePlan), [api, mock, http]);
  const reload = useCallback(async () => {
    const r = await http.changes(focus ?? undefined).catch(() => null);
    if (r && r.ok) { setView(r); setError(null); } else setError(r?.sentence ?? 'The Cockpit server did not answer.');
  }, [http, focus]);
  useEffect(() => { void reload(); }, [reload]);
  const proposals = useMemo(() => view?.proposals ?? [], [view]);
  // A card that landed stays (done) after its proposal leaves the list, so the person sees what happened.
  const [landed, setLanded] = useState<ChangeView['proposals']>([]);
  const all = useMemo(() => [...proposals, ...landed.filter((l) => !proposals.some((p) => p.id === l.id))], [proposals, landed]);
  const focusName = focus ? focus.replace(/^[a-z]+:/, '').split('/').pop() ?? null : null;
  return {
    sentence: view ? changeSentence(proposals, focusName, view.sentence) : null,
    error,
    cards: changeCards(all, progress, focus),
    busy,
    plan: (id) => {
      const p = proposals.find((x) => x.id === id);
      if (!p || busy) return;
      setBusy(id);
      void planChange(plan, p).then((r) => {
        if (r.stepId) stepToChange.current.set(r.stepId, id);
        setProgress((s) => ({ ...s, [id]: r }));
        setBusy(null);
      });
    },
    approve: (id) => {
      const stepId = progress[id]?.stepId;
      const p = all.find((x) => x.id === id);
      if (!stepId || !p || busy) return;
      setBusy(id);
      void approveChange(plan, stepId).then(async (r) => {
        setProgress((s) => ({ ...s, [id]: r }));
        if (r.state === 'done') { setLanded((l) => [...l, p]); await reload(); }
        setBusy(null);
      });
    },
    show: (target) => goTo('map', target),
  };
}
