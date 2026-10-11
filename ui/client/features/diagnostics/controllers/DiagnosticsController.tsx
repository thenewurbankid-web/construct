'use client';

import { useLineFixNotice } from '@/features/line-fix';
import { buildDiagnosticsView } from '../domain/DiagnosticsView';
import { DiagnosticsPage } from '../pages/DiagnosticsPage';
import type { DiagnosticsApi, PageTarget } from '../types';

/** The Diagnostics tab body. The run state is owned by the caller (the shell
 * also needs it for the tab badge, status bar and palette), so it is passed in
 * (see useDiagnostics). */
export function DiagnosticsController({ diagnostics, onOpenPage }: { diagnostics: DiagnosticsApi; onOpenPage: (target: PageTarget, line: number) => void }) {
  // ca2: a fix applied from a Line row; its sentence stays above the list, and a landed one re-runs validate.
  const { notice, onResult } = useLineFixNotice(diagnostics.run);
  return <DiagnosticsPage view={buildDiagnosticsView(diagnostics.state)} onRun={diagnostics.run} onOpenPage={onOpenPage} fixNotice={notice} onFixed={onResult} />;
}
