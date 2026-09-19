'use client';

import { buildLogRows } from '../domain/LogView';
import { useLogs } from '../hooks/useLogs';
import { LogsPage } from '../pages/LogsPage';

/** The Logs tab body: polls only while mounted (i.e. while the tab is open). */
export function LogsController() {
  const { entries, error, refresh, clear } = useLogs();
  return <LogsPage rows={buildLogRows(entries)} error={error} onRefresh={refresh} onClear={clear} />;
}
