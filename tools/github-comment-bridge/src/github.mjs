// GitHub REST client — a thin wrapper over @octokit/rest (the official
// GitHub SDK, #94): Octokit owns the HTTP/auth/pagination/rate-limit/retry
// mechanics, this module only decides *what* to call and returns plain
// data (never an Octokit response envelope), so every caller in
// poller.mjs/trigger.mjs/index.mjs keeps working against the exact same
// method names and return shapes as the previous hand-rolled fetch()
// client — a hybrid swap of the HTTP layer underneath, not a rewrite of
// this tool's own logic.
import { Octokit } from '@octokit/rest';

/**
 * @param {{ token: string, owner: string, repo: string, octokit?: Octokit }} opts
 *   `octokit` is an injection seam for tests (a pre-built Octokit instance,
 *   e.g. one constructed with a mocked `request.fetch`) — real callers
 *   never pass it, and a fresh Octokit authenticated with `token` is built
 *   otherwise.
 */
export function createGitHubClient({ token, owner, repo, octokit }) {
  const client = octokit || new Octokit({ auth: token, userAgent: 'github-comment-bridge' });

  return {
    owner,
    repo,

    /** Identify which login this token belongs to, so the bridge never reacts to its own comments. */
    async getAuthenticatedUser() {
      const { data } = await client.rest.users.getAuthenticated();
      return data;
    },

    /** All new/updated issue+PR comments across the whole repo since the given ISO timestamp. */
    async listIssueCommentsSince(sinceIso) {
      return client.paginate(client.rest.issues.listCommentsForRepo, {
        owner,
        repo,
        since: sinceIso,
        sort: 'created',
        direction: 'asc',
        per_page: 100,
      });
    },

    /** Highest existing comment id right now, used to establish a baseline on first run. */
    async getLatestCommentId() {
      const { data } = await client.rest.issues.listCommentsForRepo({
        owner,
        repo,
        sort: 'created',
        direction: 'desc',
        per_page: 1,
      });
      return data.length > 0 ? data[0].id : 0;
    },

    async getIssue(issueNumber) {
      const { data } = await client.rest.issues.get({ owner, repo, issue_number: issueNumber });
      return data;
    },

    async postIssueComment(issueNumber, body) {
      const { data } = await client.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });
      return data;
    },
  };
}
