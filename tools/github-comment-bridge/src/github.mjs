// Minimal GitHub REST client built on the global fetch (Node 20+). No
// dependency on Octokit or any other package, to keep this tool's
// dependency graph empty and separate from the rest of the repo.

const GITHUB_API = 'https://api.github.com';

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

/**
 * @param {{ token: string, owner: string, repo: string }} opts
 */
export function createGitHubClient({ token, owner, repo }) {
  const baseHeaders = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'github-comment-bridge',
  };

  async function raw(url, options = {}) {
    const res = await fetch(url, { ...options, headers: { ...baseHeaders, ...(options.headers || {}) } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(
        `GitHub API ${options.method || 'GET'} ${url} failed: ${res.status} ${res.statusText} ${body}`.trim()
      );
      err.status = res.status;
      throw err;
    }
    return res;
  }

  async function requestJson(pathAndQuery, options = {}) {
    const url = pathAndQuery.startsWith('http') ? pathAndQuery : `${GITHUB_API}${pathAndQuery}`;
    const res = await raw(url, options);
    if (res.status === 204) return null;
    return res.json();
  }

  async function paginatedGet(pathAndQuery) {
    let url = pathAndQuery.startsWith('http') ? pathAndQuery : `${GITHUB_API}${pathAndQuery}`;
    const results = [];
    while (url) {
      const res = await raw(url);
      const data = await res.json();
      results.push(...data);
      url = parseNextLink(res.headers.get('link'));
    }
    return results;
  }

  return {
    owner,
    repo,

    /** Identify which login this token belongs to, so the bridge never reacts to its own comments. */
    async getAuthenticatedUser() {
      return requestJson('/user');
    },

    /** All new/updated issue+PR comments across the whole repo since the given ISO timestamp. */
    async listIssueCommentsSince(sinceIso) {
      const params = new URLSearchParams({
        since: sinceIso,
        sort: 'created',
        direction: 'asc',
        per_page: '100',
      });
      return paginatedGet(`/repos/${owner}/${repo}/issues/comments?${params}`);
    },

    /** Highest existing comment id right now, used to establish a baseline on first run. */
    async getLatestCommentId() {
      const params = new URLSearchParams({ sort: 'created', direction: 'desc', per_page: '1' });
      const comments = await requestJson(`/repos/${owner}/${repo}/issues/comments?${params}`);
      return comments && comments.length > 0 ? comments[0].id : 0;
    },

    async getIssue(issueNumber) {
      return requestJson(`/repos/${owner}/${repo}/issues/${issueNumber}`);
    },

    async postIssueComment(issueNumber, body) {
      return requestJson(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
    },
  };
}
