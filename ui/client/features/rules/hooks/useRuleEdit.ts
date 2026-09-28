'use client';

import { useCallback, useReducer, useRef } from 'react';
import { previewRuleSeverity, saveRuleSeverity } from '../services/RulesApi';
import { ruleEditReducer } from '../workflows/RuleEdit';
import type { RuleEditApi, RuleSeverity } from '../types';

/** One rule's severity edit as a reviewable diff (#395 slice B): pick a severity, preview the resulting
 * architecture.yml, then confirm to save (or cancel). `onSaved` re-reads the rules list so the row's own
 * severity and live violation count reflect the change immediately. */
export function useRuleEdit(onSaved: () => void): RuleEditApi {
  const [state, dispatch] = useReducer(ruleEditReducer, null);
  const current = useRef<string | null>(null);

  const start = useCallback((ruleId: string, severity: RuleSeverity) => {
    current.current = ruleId;
    dispatch({ type: 'START', ruleId, severity });
    previewRuleSeverity(ruleId, severity).then((r) => {
      if (current.current !== ruleId) return; // cancelled, or a different row was started meanwhile
      if (r.ok) dispatch({ type: 'PREVIEW_OK', ruleId, before: r.before, after: r.after, contentHash: r.contentHash });
      else dispatch({ type: 'PREVIEW_FAIL', ruleId, error: r.error });
    });
  }, []);

  const cancel = useCallback(() => {
    current.current = null;
    dispatch({ type: 'CANCEL' });
  }, []);

  const confirm = useCallback(() => {
    if (!state || state.status !== 'ready') return;
    const { ruleId, severity, contentHash } = state;
    dispatch({ type: 'SAVE' });
    saveRuleSeverity(ruleId, severity, contentHash).then((r) => {
      if (current.current !== ruleId) return;
      if (r.ok) {
        current.current = null;
        dispatch({ type: 'CANCEL' });
        onSaved();
      } else {
        dispatch({ type: 'SAVE_FAIL', error: r.error });
      }
    });
  }, [state, onSaved]);

  return { state, start, confirm, cancel };
}
