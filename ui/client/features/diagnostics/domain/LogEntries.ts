// Pure (DOMAIN-001): merging polled log entries into the list the tab shows.
import type { LogEntry } from '../types.ts';

export function lastId(entries: LogEntry[]): number {
  return entries.length ? entries[entries.length - 1].id : 0;
}

/** Appends entries newer than the last one shown and keeps only the latest `max`. */
export function mergeEntries(current: LogEntry[], incoming: LogEntry[], max = 300): LogEntry[] {
  const last = lastId(current);
  const fresh = incoming.filter((e) => e.id > last);
  if (!fresh.length) return current;
  const all = [...current, ...fresh];
  return all.length > max ? all.slice(all.length - max) : all;
}
