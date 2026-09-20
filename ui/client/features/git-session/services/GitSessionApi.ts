// Reading and configuring the commit-on-save session (#283). Thin wrappers: no policy here — the
// server decides when a save commits; this layer only asks and reports.
import { getJson, postJson } from '@/lib/http';
import type { CommitConfig, GitSessionStatus } from '../types';

/** #365: with no project open the server answers 409 `{ ok: false, code: 'NO_PROJECT' }`. That is "no session",
 * not a status, so it is thrown (the hook turns it into a failed load) instead of being passed on as one. */
export async function fetchGitSession(): Promise<GitSessionStatus> {
  const body = await getJson<GitSessionStatus & { ok?: boolean; error?: string }>('/api/git/session');
  if (body.ok === false) throw new Error(body.error ?? 'No git session.');
  return body;
}

export const saveCommitConfig = (patch: Partial<CommitConfig>) =>
  postJson<{ ok: boolean; config?: CommitConfig; error?: string }>('/api/git/config', patch);
