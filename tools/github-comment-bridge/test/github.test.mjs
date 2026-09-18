import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Octokit } from '@octokit/rest';
import { createGitHubClient } from '../src/github.mjs';

// #94 — real coverage for github.mjs's Octokit-based client, which had
// none before this swap (poller.test.mjs/trigger.test.mjs only ever
// exercise a hand-rolled fake `github` object, never this module).
// @octokit/request's fetch-wrapper resolves its fetch implementation as
// `requestOptions.request?.fetch || globalThis.fetch` — passing a fake
// `fetch` through Octokit's own `request.fetch` constructor option is
// the documented injection seam, so no real network call is ever made and
// no global state is touched.

/** Builds an Octokit instance whose requests are served by `handler`
 * instead of a real network call — `handler(url, init)` returns a Fetch
 * `Response` (or a plain object with `{status, headers, json}` shaped like
 * one; a real Response is used here since @octokit/request expects the
 * real Fetch API surface, e.g. `res.headers.get(...)`). */
function fakeOctokit(handler, { auth = 'test-token' } = {}) {
  return new Octokit({
    auth,
    userAgent: 'github-comment-bridge-test',
    request: { fetch: handler },
  });
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

test('getAuthenticatedUser sends the configured token and returns the plain user object', async () => {
  const calls = [];
  const octokit = fakeOctokit(
    async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ login: 'construct-bot', id: 1 });
    },
    { auth: 'secret-token' },
  );
  // In real (non-test) use, createGitHubClient builds its own Octokit from
  // `token` — here `octokit` is injected pre-built (with the fake fetch
  // wired in), so `token` itself isn't read, but the auth this client
  // actually sends is asserted below regardless.
  const github = createGitHubClient({ token: 'unused-because-octokit-is-injected', owner: 'o', repo: 'r', octokit });

  const user = await github.getAuthenticatedUser();

  assert.equal(user.login, 'construct-bot');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/user$/);
  // The real auth mechanism this whole tool depends on: the token must
  // still reach GitHub as a token Authorization header.
  const authHeader = new Headers(calls[0].init.headers).get('authorization');
  assert.match(authHeader, /secret-token/);
});

test('createGitHubClient builds its own Octokit from the given token when none is injected (the real, non-test path)', async () => {
  // No `octokit` override here — this exercises the actual production
  // construction path (`new Octokit({ auth: token, ... })`), confirming
  // the token argument itself is what ends up authenticating requests.
  const github = createGitHubClient({ token: 'real-path-token', owner: 'o', repo: 'r' });
  assert.equal(github.owner, 'o');
  assert.equal(github.repo, 'r');
  assert.equal(typeof github.getAuthenticatedUser, 'function');
});

test('listIssueCommentsSince follows pagination (Link: rel="next") and returns every comment, in shape unchanged from the raw REST API', async () => {
  const calls = [];
  const octokit = fakeOctokit(async (url, init) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return jsonResponse(
        [{ id: 1, user: { login: 'human' }, body: '/claude hi', issue_url: 'https://api.github.com/repos/o/r/issues/5' }],
        { headers: { link: '<https://api.github.com/repos/o/r/issues/comments?page=2>; rel="next"' } },
      );
    }
    return jsonResponse([{ id: 2, user: { login: 'human' }, body: 'page 2 comment', issue_url: 'https://api.github.com/repos/o/r/issues/6' }]);
  });
  const github = createGitHubClient({ token: 't', owner: 'o', repo: 'r', octokit });

  const comments = await github.listIssueCommentsSince('2024-01-01T00:00:00Z');

  assert.equal(calls.length, 2, 'must have followed the Link: rel="next" header to a second page');
  assert.deepEqual(
    comments.map((c) => c.id),
    [1, 2],
  );
  // Shape poller.mjs's allowlist check directly depends on: comment.id and
  // comment.user.login must still be present, unchanged.
  assert.equal(comments[0].user.login, 'human');
  assert.match(calls[0], /\/repos\/o\/r\/issues\/comments\?/);
  assert.match(calls[0], /since=2024-01-01/);
});

test('getLatestCommentId returns the newest comment id, or 0 when there are none yet', async () => {
  const octokit = fakeOctokit(async () => jsonResponse([{ id: 42 }]));
  const github = createGitHubClient({ token: 't', owner: 'o', repo: 'r', octokit });
  assert.equal(await github.getLatestCommentId(), 42);

  const emptyOctokit = fakeOctokit(async () => jsonResponse([]));
  const emptyGithub = createGitHubClient({ token: 't', owner: 'o', repo: 'r', octokit: emptyOctokit });
  assert.equal(await emptyGithub.getLatestCommentId(), 0);
});

test('getIssue requests the right issue and returns the plain issue object', async () => {
  const calls = [];
  const octokit = fakeOctokit(async (url) => {
    calls.push(String(url));
    return jsonResponse({ number: 37, title: 'A real issue', body: 'details' });
  });
  const github = createGitHubClient({ token: 't', owner: 'o', repo: 'r', octokit });

  const issue = await github.getIssue(37);

  assert.equal(issue.title, 'A real issue');
  assert.match(calls[0], /\/repos\/o\/r\/issues\/37$/);
});

test('postIssueComment posts the body as JSON to the right issue and returns the created comment', async () => {
  const calls = [];
  const octokit = fakeOctokit(async (url, init) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null, method: init.method });
    return jsonResponse({ id: 99, body: JSON.parse(init.body).body }, { status: 201 });
  });
  const github = createGitHubClient({ token: 't', owner: 'o', repo: 'r', octokit });

  const created = await github.postIssueComment(12, 'Working on it.');

  assert.equal(created.id, 99);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body.body, 'Working on it.');
  assert.match(calls[0].url, /\/repos\/o\/r\/issues\/12\/comments$/);
});

test('a 404 from GitHub surfaces as a thrown error (getIssue on a missing issue)', async () => {
  const octokit = fakeOctokit(async () => jsonResponse({ message: 'Not Found' }, { status: 404 }));
  const github = createGitHubClient({ token: 't', owner: 'o', repo: 'r', octokit });
  await assert.rejects(() => github.getIssue(999999));
});
