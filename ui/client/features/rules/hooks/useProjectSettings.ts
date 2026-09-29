'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { fetchProjectSettings, previewProjectSetting, saveProjectSetting } from '../services/RulesApi';
import { initialProjectSettings, projectEditReducer, projectSettingsReducer } from '../workflows/ProjectSettings';
import type { ProjectSettingField, ProjectSettingsApi } from '../types';

/** #395 slice 5 -- project.framework (route adapter) + features.root: read on mount (same run-once-and-on-demand
 * shape as useRules/useExceptions), plus one pending single-field edit as a reviewable diff. Only one field can
 * be edited at a time, same as `useRuleEdit`'s one-row-at-a-time editor. */
export function useProjectSettings(): ProjectSettingsApi {
  const [state, dispatch] = useReducer(projectSettingsReducer, initialProjectSettings);
  const [edit, editDispatch] = useReducer(projectEditReducer, null);
  const inFlight = useRef(false);
  const pending = useRef<{ field: ProjectSettingField; value: string } | null>(null);

  const run = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: 'RUN' });
    fetchProjectSettings().then((r) => {
      inFlight.current = false;
      if (r.ok) dispatch({ type: 'RESULT', value: r.value });
      else dispatch({ type: 'FAIL', error: r.error });
    });
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  const start = useCallback((field: ProjectSettingField, value: string) => {
    pending.current = { field, value };
    editDispatch({ type: 'START', field, value });
    previewProjectSetting(field, value).then((r) => {
      if (pending.current?.field !== field || pending.current.value !== value) return; // cancelled, or superseded
      if (r.ok) editDispatch({ type: 'PREVIEW_OK', before: r.before, after: r.after, contentHash: r.contentHash });
      else editDispatch({ type: 'PREVIEW_FAIL', error: r.error });
    });
  }, []);

  const cancel = useCallback(() => {
    pending.current = null;
    editDispatch({ type: 'CANCEL' });
  }, []);

  const confirm = useCallback(() => {
    if (!edit || edit.status !== 'ready' || !pending.current) return;
    const { field, value } = pending.current;
    const { contentHash } = edit;
    editDispatch({ type: 'SAVE' });
    saveProjectSetting(field, value, contentHash).then((r) => {
      if (pending.current?.field !== field || pending.current.value !== value) return;
      if (r.ok) {
        pending.current = null;
        editDispatch({ type: 'CANCEL' });
        run();
      } else {
        editDispatch({ type: 'SAVE_FAIL', error: r.error });
      }
    });
  }, [edit, run]);

  return { state, edit, start, confirm, cancel };
}
