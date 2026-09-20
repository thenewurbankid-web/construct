'use client';

import { useEffect, useState } from 'react';
import { resultCell, runPanelView, testRunView } from '../domain/RunView';
import type { GeneratedTest, RunPanelProps, TestRunProps, TestSelection, YourTest } from '../types';
import { useCopyText } from './useCopyText';
import { useRunActions } from './useRunActions';
import { useRunSnapshot } from './useRunSnapshot';

/** Running the selected feature's tests (#305): the panel's view, the result of any one test, the address the app runs
 * at, and the actions. A run is a Process in the Processes drawer; this only starts it and watches it. Every rule
 * (what may run, where) lives on the server. */
export function useTestRuns(feature: string, ready: boolean, select: (selection: TestSelection) => void) {
  const { snap, setSnap, refresh } = useRunSnapshot(feature);
  const [address, setAddress] = useState('');
  // the server's default address is only a starting point; what the person typed is never overwritten
  useEffect(() => {
    if (snap && address === '') setAddress(snap.defaultBaseUrl);
  }, [snap, address]);
  const { refused, start, cancel } = useRunActions({ feature, address, setSnap, refresh });
  const { copied, copy } = useCopyText(feature);
  const busy = !!snap?.live;

  const panel: RunPanelProps = {
    view: runPanelView(snap, feature),
    address,
    refused,
    copied,
    canRun: !!feature && ready,
    onAddress: setAddress,
    onRunAll: () => void start(null),
    onCancel: () => void cancel(),
    onCopy: copy,
    onOpenTest: (area, name) => select({ area, name }),
  };

  return {
    /** The run panel's props. */
    panel,
    /** The "Last result" cell of a generated test's file. */
    resultOf: (file: string) => resultCell(snap, 'generated', file),
    /** What a test's detail draws and does about running that one test (nothing selected: an inert one). */
    forTest: (test: GeneratedTest | YourTest | null): TestRunProps => ({
      view: test ? testRunView(snap, test.area, test.name) : null,
      busy,
      copied,
      onRun: () => void (test && start({ name: test.name, area: test.area })),
      onCopy: copy,
    }),
  };
}
