// Pure (DOMAIN-001): log entries in display form.
import type { LogEntry, LogRow } from '../types.ts';

/** HH:MM:SS in local time. */
export function clockTime(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function buildLogRows(entries: LogEntry[]): LogRow[] {
  return entries.map((e) => ({ id: e.id, time: clockTime(e.at), source: e.source, level: e.level, text: e.text }));
}
