// Pure (DOMAIN-001): what the clone form shows for the text typed so far, and the rows of the recent list.
import type { ClonePreview, PullResult, RecentClone, RecentCloneRow } from '../types.ts';
import { describeSource, normalizeCloneInput } from './CloneInput.ts';

export type CloneFormReading = {
  /** A plain problem with the pasted text, or null. */
  inputProblem: string | null;
  preview: ClonePreview | null;
  /** The branch as it will be used: typed by the person, else read from the address, else ''. */
  branch: string;
};

/** Read the pasted text (and a hand-typed branch, or null when not edited) for the form. */
export function readCloneForm(input: string, typedBranch: string | null): CloneFormReading {
  const read = input.trim() === '' ? null : normalizeCloneInput(input);
  const parsed = read && read.ok ? read : null;
  return {
    inputProblem: read && !read.ok ? read.problem : null,
    preview: parsed ? { url: parsed.url, folder: parsed.slug, branch: parsed.branch, how: describeSource(parsed.source), note: parsed.note } : null,
    branch: typedBranch ?? parsed?.branch ?? '',
  };
}

const whenOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

/** The recent clones, each with what its last update said. */
export function buildRecentRows(items: RecentClone[], pulls: Record<string, { busy: boolean; result: PullResult | null }>): RecentCloneRow[] {
  return items.map((r) => {
    const pull = pulls[r.name];
    const res = pull?.result ?? null;
    return {
      id: r.id, name: r.name, url: r.url, when: whenOf(r.at), isPrivate: r.private,
      pulling: !!pull?.busy,
      pullMessage: res ? (res.ok ? `${res.message}${res.detail.length ? ` ${res.detail.join(' ')}` : ''}` : res.error) : null,
      pullOk: !!res && res.ok,
    };
  });
}
