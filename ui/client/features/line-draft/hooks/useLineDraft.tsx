'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { routeCards } from '../domain/RouteCards';
import { lineDraftApi } from '../services/LineDraftApi';
import { answerAndRedraft } from '../workflows/AnswerFlow';
import type { DraftAnswer, DraftControls, DraftView, LineDraftApi } from '../types';

/** The drafter box (flag LINE_DRAFTER=1 on the server): a request becomes every route Construct checked; Add to plan puts
 * a route's steps in the plan (`onAdded` re-reads the Plan panel), where the person approves each write. */
export function useLineDraft(onAdded: () => void, api: LineDraftApi = lineDraftApi): DraftControls {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState('');
  const [view, setView] = useState<DraftView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ routeId: string; from: number } | null>(null);

  useEffect(() => {
    void api.status().then((a) => setOn(a.ok && a.value.on));
  }, [api]);

  const took = useCallback((a: DraftAnswer<DraftView>) => {
    setBusy(false);
    if (!a.ok) { setError(a.sentence); return; }
    setError(null);
    setView(a.value);
  }, []);

  const submit = useCallback(() => {
    const text = request.trim();
    if (!text) { setError('Say what you want to change, for example "add a badge to the orders feature".'); return; }
    setBusy(true); setNotice(null); setPending(null);
    void api.draft(text).then(took);
  }, [api, request, took]);

  const addFrom = useCallback((routeId: string, from?: number) => {
    if (!view) return;
    setBusy(true);
    void api.add(view.request, routeId, from).then((a) => {
      setBusy(false);
      if (!a.ok) { setError(a.sentence); return; }
      setError(null);
      setNotice(a.value.sentence);
      setPending(a.value.next === null ? null : { routeId, from: a.value.next });
      onAdded();
    });
  }, [api, view, onAdded]);

  const answer = useCallback((word: string, key: string) => {
    if (!view) return;
    setBusy(true);
    void answerAndRedraft(api, view.request, word, key).then(took);
  }, [api, view, took]);

  return useMemo(() => ({
    on, busy, request, setRequest, submit,
    cards: routeCards(view), questions: view?.questions ?? [], defer: view && view.defer.to ? view.defer.sentence : null,
    dropped: view?.dropped.map((d) => d.sentence) ?? [], notice, error, pending,
    add: (routeId: string) => addFrom(routeId), addRest: () => { if (pending) addFrom(pending.routeId, pending.from); }, answer,
  }), [on, busy, request, submit, view, notice, error, pending, addFrom, answer]);
}
