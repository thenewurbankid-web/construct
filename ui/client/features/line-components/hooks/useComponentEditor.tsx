'use client';

import { useCallback, useEffect, useState } from 'react';
import { useUrlSelection } from '@/features/list-browser';
import { componentSteps } from '../domain/ComponentSteps';
import { noticeOf, tabOf } from '../domain/ComponentView';
import { lineComponentsApi } from '../services/LineComponentsApi';
import type { AddStep, ComponentEventGroup, EditorNotice, EditorState, EditorTab, LineComponentsApi, PlanStepRequest } from '../types';

/** The Components editor: the component being edited (`file`, kept in the URL by the screen), its tab (in the URL as
 * ?tab=), and each change as a plan step (`addStep`) that waits for the person's Approve in the Plan panel. `revision`
 * changes after a step landed, which reads the component again. */
export function useComponentEditor(file: string | null, addStep: AddStep, revision: number, api: LineComponentsApi = lineComponentsApi) {
  const [state, setState] = useState<EditorState>({ phase: 'none' });
  const [notice, setNotice] = useState<EditorNotice>(null);
  const [busy, setBusy] = useState(false);
  const tabSel = useUrlSelection('tab');
  const tab = tabOf(tabSel.value);

  useEffect(() => {
    if (!file) {
      setState({ phase: 'none' });
      return undefined;
    }
    let live = true;
    setState((s) => (s.phase === 'ready' && s.file === file ? s : { phase: 'loading', file }));
    void api
      .getComponent(file)
      .then((r) => {
        if (!live) return;
        if ('ok' in r && r.ok === false) setState({ phase: 'error', file, sentence: r.sentence });
        else setState({ phase: 'ready', file, component: r as Extract<typeof r, { file: string }> });
      })
      .catch(() => live && setState({ phase: 'error', file, sentence: 'The Cockpit server did not answer.' }));
    return () => {
      live = false;
    };
  }, [api, file, revision]);

  useEffect(() => setNotice(null), [file]);

  const ask = useCallback(
    (req: PlanStepRequest | null) => {
      if (!req) return;
      setBusy(true);
      void addStep(req).then((a) => {
        setNotice(noticeOf(a));
        setBusy(false);
      });
    },
    [addStep],
  );

  const component = state.phase === 'ready' ? state.component : null;
  const setTab = useCallback((t: EditorTab) => tabSel.select(t === 'behaviour' ? null : t), [tabSel]);
  const attach = useCallback((primitive: string) => component && ask(componentSteps.attach(component, primitive)), [ask, component]);
  const addWhenDo = useCallback((sourceId: string, actionId: string) => component && ask(componentSteps.whenDo(component, sourceId, actionId)), [ask, component]);
  const change = useCallback((wire: string, actionId: string) => component && ask(componentSteps.change(component, wire, actionId)), [ask, component]);
  const fix = useCallback((g: ComponentEventGroup) => component && ask(componentSteps.fix(component, g)), [ask, component]);
  const setCurrent = useCallback((ref: string, st: string) => component && ask(componentSteps.setState(component, ref, st)), [ask, component]);
  const newComponent = useCallback((libraryId: string, feature: string, name: string) => ask(componentSteps.newComponent(libraryId, feature, name)), [ask]);
  /** A refusal's typed fix: added to the plan as its own step (a person still approves it). */
  const applyFix = useCallback((step: PlanStepRequest) => ask(step), [ask]);

  return { state, tab, setTab, notice, busy, attach, addWhenDo, change, fix, setCurrent, newComponent, applyFix };
}

export type ComponentEditorView = ReturnType<typeof useComponentEditor>;
