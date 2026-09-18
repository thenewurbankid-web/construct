'use client';

import type { Dispatch } from 'react';
import { diffSourceLines } from '../domain/SourceDiff';
import { postWorkflowEdit } from '../services/WorkflowEditApi';
import type { WorkflowEditRequest, WorkflowFileMachines, WorkflowsState } from '../types';
import type { WorkflowsAction } from '../workflows/Workflows';

/** #61 - visual edit flow: propose (server computes the patched source, nothing
 * written, diff shown) -> confirm (server re-applies the same edit, checks the
 * file has not changed and the architecture rules still pass, then writes). */
export function useWorkflowEditor(state: WorkflowsState, dispatch: Dispatch<WorkflowsAction>) {
  async function proposeEdit(req: WorkflowEditRequest) {
    dispatch({ type: 'EDIT_BUSY' });
    const r = await postWorkflowEdit({ feature: state.feature, file: state.file, ...req, commit: false });
    if (r.ok === true && 'after' in r) dispatch({ type: 'EDIT_PROPOSED', pending: { req, hunks: diffSourceLines(r.before, r.after) } });
    else dispatch({ type: 'EDIT_ERROR', error: ('error' in r && r.error) || 'That edit is not supported.' });
  }

  async function confirmEdit() {
    if (!state.pending || !state.loaded) return;
    dispatch({ type: 'EDIT_BUSY' });
    const r = await postWorkflowEdit({ feature: state.feature, file: state.file, ...state.pending.req, commit: true, contentHash: state.loaded.contentHash });
    if (r.ok === true && 'machines' in r) {
      dispatch({ type: 'FILE_LOADED', loaded: r as WorkflowFileMachines });
      return;
    }
    const violations = 'violations' in r && Array.isArray(r.violations) ? r.violations.map((v) => `${v.rule ?? ''} ${v.message ?? ''}`.trim()).join('; ') : '';
    dispatch({ type: 'EDIT_ERROR', error: `${('error' in r && r.error) || 'Save failed.'}${violations ? ` ${violations}` : ''}` });
  }

  function cancelEdit() {
    dispatch({ type: 'EDIT_CANCELLED' });
  }

  return { proposeEdit, confirmEdit, cancelEdit };
}
