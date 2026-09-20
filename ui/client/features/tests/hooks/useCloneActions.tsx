'use client';

import { useCallback, type Dispatch } from 'react';
import { cloneDialogFor, editStepReason, LOCK_REASON } from '../domain/CloneDialog';
import { slugify } from '../domain/TestNames';
import { cloneTest } from '../services/TestsWrites';
import type { CloneDialog, TestSelection, TestsAction, TestsListing } from '../types';

type CloneInput = {
  feature: string;
  data: TestsListing | null;
  dialog: CloneDialog | null;
  dispatch: Dispatch<TestsAction>;
  reload: (feature: string) => Promise<void>;
  showCode: (target?: TestSelection) => Promise<void>;
};

/** The clone dialog: opened by Clone to edit or by trying to edit a step, filled, submitted, or swapped for the
 * read-only code. The server decides what is allowed; a refusal (a taken name) is shown in the dialog. */
export function useCloneActions({ feature, data, dialog, dispatch, reload, showCode }: CloneInput) {
  const openClone = useCallback(
    (file: string, reason: string = LOCK_REASON) => {
      const d = data ? cloneDialogFor(data, file, reason) : null;
      if (d) dispatch({ type: 'OPEN_DIALOG', dialog: d });
    },
    [data, dispatch],
  );
  const editStep = useCallback((file: string, step: number) => openClone(file, editStepReason(step)), [openClone]);

  const submitClone = useCallback(async () => {
    const name = dialog ? slugify(dialog.name) : '';
    if (!dialog || !feature || !name) return;
    dispatch({ type: 'CLONE_START' });
    const r = await cloneTest(feature, dialog.source, name);
    if (!r.ok) return dispatch({ type: 'CLONE_FAILED', error: r.error, suggested: r.suggested });
    dispatch({ type: 'CLONE_DONE', name: r.name, path: r.path });
    await reload(feature);
  }, [dialog, feature, dispatch, reload]);

  const showCodeFromDialog = useCallback(() => {
    const file = dialog?.source;
    dispatch({ type: 'CLOSE_DIALOG' });
    if (file) void showCode({ area: 'generated', name: file });
  }, [dialog, dispatch, showCode]);

  return {
    openClone,
    editStep,
    submitClone,
    showCodeFromDialog,
    editName: (name: string) => dispatch({ type: 'EDIT_NAME', name }),
    closeDialog: () => dispatch({ type: 'CLOSE_DIALOG' }),
  };
}
