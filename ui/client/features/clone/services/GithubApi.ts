import { getJson, postJson } from '@/lib/http';
import type { GithubRepoList, GithubReposResult, GithubStatus, GithubStatusResult } from '../types';

/** Real network I/O for the GitHub connection (#638, SERVICE-*): thin wrappers over ui/server's /api/github and
 * /auth/repo. Failures come back as `{ ok: false, error }`, never thrown. No token is ever sent, received or kept here:
 * the connection lives in the server's memory and this only asks about it. */
type StatusBody = { ok?: boolean; error?: string } & Partial<GithubStatus>;
type ReposBody = { ok?: boolean; error?: string; code?: string } & Partial<GithubRepoList>;
const UNREACHABLE = 'Could not reach the server.';

const statusOf = (body: StatusBody): GithubStatus => ({ enabled: body.enabled === true, connected: body.connected === true, ...(typeof body.login === 'string' ? { login: body.login } : {}) });

export async function readGithubStatus(): Promise<GithubStatusResult> {
  try {
    const body = await getJson<StatusBody>('/api/github/status');
    return body.ok ? { ok: true, status: statusOf(body) } : { ok: false, error: body.error ?? 'Could not read the GitHub connection.' };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

/** The repositories the connection can read (names and visibility only), one page, optionally narrowed by `q`. */
export async function readGithubRepos({ page = 1, perPage = 30, q = '' }: { page?: number; perPage?: number; q?: string } = {}): Promise<GithubReposResult> {
  try {
    const query = new URLSearchParams({ page: String(page), per_page: String(perPage), ...(q.trim() ? { q: q.trim() } : {}) });
    const body = await getJson<ReposBody>(`/api/github/repos?${query.toString()}`);
    if (!body.ok || !Array.isArray(body.repos)) return { ok: false, error: body.error ?? 'Could not list the repositories.', code: body.code };
    return {
      ok: true,
      list: {
        repos: body.repos, page: body.page ?? page, perPage: body.perPage ?? perPage, total: body.total ?? body.repos.length,
        hasMore: body.hasMore === true, truncated: body.truncated === true, source: body.source ?? 'installations', installations: body.installations ?? null,
      },
    };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

/** Disconnect: the server zeroes the token at once and asks GitHub to revoke it. */
export async function disconnectGithub(): Promise<GithubStatusResult> {
  try {
    const body = await postJson<StatusBody>('/api/github/disconnect', {});
    return body.ok ? { ok: true, status: statusOf(body) } : { ok: false, error: body.error ?? 'Could not disconnect.' };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}
