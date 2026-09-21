import type { CloneJob, RecentClone } from '../types';

/** Per-browser memory of the clones this browser started (SERVICE-*): kept in localStorage so "Open" and "Pull
 * latest" are still offered after the Cockpit was closed. It holds names, addresses and folders only, never a
 * token. Every read and write is guarded: storage may be blocked, full or empty, and the screen works without it. */
const KEY = 'construct.clone.recent';
const MAX = 10;

export function readRecentClones(): RecentClone[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(list)) return [];
    return list.filter((r): r is RecentClone => !!r && typeof r.id === 'string' && typeof r.name === 'string' && typeof r.dir === 'string' && typeof r.url === 'string').slice(0, MAX);
  } catch {
    return [];
  }
}

function write(list: RecentClone[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* storage unavailable: the list just is not remembered */
  }
}

/** Remember a finished clone (newest first, one entry per folder). */
export function rememberClone(job: CloneJob): RecentClone[] {
  if (job.state !== 'done' || !job.dir) return readRecentClones();
  const entry: RecentClone = { id: job.id, name: job.name, url: job.url, dir: job.dir, at: job.finishedAt ?? new Date().toISOString(), private: job.private };
  const next = [entry, ...readRecentClones().filter((r) => r.dir !== entry.dir)];
  write(next);
  return next.slice(0, MAX);
}

export function forgetClone(id: string): RecentClone[] {
  const next = readRecentClones().filter((r) => r.id !== id);
  write(next);
  return next;
}
