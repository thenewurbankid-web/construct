// Pure (DOMAIN-001: no external effects anywhere in this file, even in a
// comment — no React import either) — byte-size and pull-progress
// formatting for the Ollama status/model-list screens.

export function formatBytes(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Percent complete for one pull-progress event, or null when the event
 * doesn't carry byte counts yet (e.g. an early "pulling manifest" status
 * line, or a terminal "success" line with no total). */
export function pullPercent(progress: { completed?: number; total?: number } | null | undefined): number | null {
  if (!progress || !progress.total || !progress.completed) return null;
  return Math.min(100, Math.round((progress.completed / progress.total) * 100));
}
