// Pure (DOMAIN-001): the numbers in a clone's progress, in words a person reads at a glance.

/** The percentage in the tool's own progress text ("Receiving objects:  42% (4/10)"), or null. */
export function percentOf(progress: string): number | null {
  const m = /(\d{1,3})%/.exec(progress);
  return m ? Math.min(100, Number(m[1])) : null;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
