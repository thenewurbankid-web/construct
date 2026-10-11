'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUrlSelection } from '@/features/list-browser';
import { suggestName, workflowCards } from '../domain/WorkflowCards';
import { workflowDiagram } from '../domain/WorkflowDiagram';
import { workflowSteps } from '../domain/WorkflowSteps';
import { draftProblem, emptyDraft } from '../domain/WhenDoDraft';
import { lineWorkflowsApi } from '../services/LineWorkflowsApi';
import { loadWorkflows } from '../workflows/LoadWorkflows';
import type { AddStep, LineWorkflowsApi, LineWorkflowsView, ListState, Notice, PlanStepRequest, WhenDoDraft } from '../types';

/** One feature's Workflows tab: its workflows (the chosen one kept in the URL as ?workflow=), the library's, and the
 * person's changes, each added to the project's plan as a step (`addStep`) that waits for their approval in the Plan
 * panel. `revision` changes after a step landed, which re-reads the list. */
export function useLineWorkflows(feature: string, addStep: AddStep, revision: number, api: LineWorkflowsApi = lineWorkflowsApi): LineWorkflowsView {
  const [state, setState] = useState<ListState>({ phase: 'loading' });
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const selection = useUrlSelection('workflow');

  useEffect(() => {
    let live = true;
    void loadWorkflows(api, feature).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [api, feature, revision]);

  const list = state.phase === 'ready' ? state.list : null;
  const cards = useMemo(() => (list ? workflowCards(list) : []), [list]);
  const chosen = useMemo(() => {
    if (!list) return null;
    return list.workflows.find((w) => w.id === selection.value) ?? list.workflows[list.workflows.length - 1] ?? null;
  }, [list, selection.value]);
  const diagram = useMemo(() => (chosen ? workflowDiagram(chosen) : null), [chosen]);
  const library = useMemo(
    () => (list ? list.library.map((w) => ({ id: w.id, name: w.name, summary: w.summary.join(' '), lines: w.transitions.map((t) => `${t.when} ${t.do}`), suggested: suggestName(list, w.name) })) : []),
    [list],
  );
  const newDraft = useMemo(() => emptyDraft(chosen), [chosen]);

  const ask = useCallback(
    (req: PlanStepRequest) => {
      setBusy(true);
      void addStep(req).then((answer) => {
        setNotice(answer);
        setBusy(false);
      });
    },
    [addStep],
  );

  const startFrom = useCallback((libraryId: string, name: string) => ask(workflowSteps.baseOn(feature, libraryId, name)), [ask, feature]);
  const setRole = useCallback((role: string, page: string) => chosen && ask(workflowSteps.role(chosen, role, page)), [ask, chosen]);
  const addWhenDo = useCallback((draft: WhenDoDraft) => chosen && ask(workflowSteps.whenDo(chosen, draft)), [ask, chosen]);
  const remove = useCallback((id: string) => chosen && ask(workflowSteps.remove(chosen, id)), [ask, chosen]);
  const promote = useCallback(() => chosen && ask(workflowSteps.promote(chosen)), [ask, chosen]);

  return { feature, state, cards, chosen, diagram, library, newDraft, checkDraft: draftProblem, choose: selection.select, notice, busy, startFrom, setRole, addWhenDo, remove, promote };
}
