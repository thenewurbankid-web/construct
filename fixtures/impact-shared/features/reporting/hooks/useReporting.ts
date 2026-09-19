import { useCallback } from 'react';
import { runReporting } from '../workflows/ReportingWorkflow';

export function useReporting() {
  return { start: useCallback(() => runReporting(), []) };
}
