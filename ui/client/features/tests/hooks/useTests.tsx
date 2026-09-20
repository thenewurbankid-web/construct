'use client';

import { useCallback } from 'react';
import { FAILURE_KINDS } from '../domain/FailureKinds';
import { cloneTag, staleOverview } from '../domain/Freshness';
import { cloneDialogView, selectedTest, summaryOf } from '../domain/TestsView';
import { generateTests } from '../services/TestsWrites';
import { useCloneActions } from './useCloneActions';
import { useCloneComparison } from './useCloneComparison';
import { useTestCode } from './useTestCode';
import { useTestsListing } from './useTestsListing';

/** The Tests screen: the listing, the selection, the code view, the clone dialog and a generate run, plus what is
 * derived for drawing. Every rule about what may be written lives on the server (and in core), not here. */
export function useTests() {
  const { state, dispatch, data, features, reload, pickFeature, select } = useTestsListing();
  const { feature } = state;
  const code = useTestCode(feature, state.selected, dispatch);
  const shown = selectedTest(data, state.selected);
  const comparison = useCloneComparison(feature, state.selected, shown.test?.area === 'yours' ? shown.test : null);
  const clone = useCloneActions({ feature, data, dialog: state.dialog, dispatch, reload, showCode: code.showCode });

  const generate = useCallback(async () => {
    if (!feature) return;
    dispatch({ type: 'GENERATE_START' });
    const r = await generateTests(feature);
    if (!r.ok) return dispatch({ type: 'GENERATE_FAILED', message: r.error });
    dispatch({ type: 'GENERATE_DONE', written: r.written.length });
    await reload(feature);
  }, [feature, dispatch, reload]);

  return {
    state,
    features,
    ...shown,
    comparison,
    stale: staleOverview(data),
    failureKinds: FAILURE_KINDS,
    cloneTag,
    data,
    summary: summaryOf(data),
    dialogView: state.dialog ? cloneDialogView(feature, state.dialog) : null,
    pickFeature,
    select,
    ...code,
    ...clone,
    generate,
    dismissNotice: () => dispatch({ type: 'DISMISS_NOTICE' }),
  };
}
