// Reading and configuring the commit-on-save session (#283). Thin wrappers: no policy here — the
// server decides when a save commits; this layer only asks and reports.
import { getJson, postJson } from '@/lib/http';
import type { CommitConfig, GitSessionStatus } from '../types';

export const fetchGitSession = () => getJson<GitSessionStatus>('/api/git/session');

export const saveCommitConfig = (patch: Partial<CommitConfig>) =>
  postJson<{ ok: boolean; config?: CommitConfig; error?: string }>('/api/git/config', patch);
