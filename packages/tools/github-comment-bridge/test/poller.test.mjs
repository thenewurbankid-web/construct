import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pollOnce, extractIssueNumber, summarizeRun } from '../src/poller.mjs';

function createMemoryStore(initial) {
  let value = structuredClone(initial);
  return {
    async load() {
      return structuredClone(value);
    },
    async save(next) {
      value = structuredClone(next);
    },
    _get() {
      return value;
    },
  };
}

function createFakeGithub({ comments, issues, botLogin }) {
  const posted = [];
  return {
    posted,
    async getAuthenticatedUser() {
      return { login: botLogin };
    },
    async getLatestCommentId() {
      return comments.length ? Math.max(...comments.map((c) => c.id)) : 0;
    },
    async listIssueCommentsSince(_sinceIso) {
      // Simplified fake: ignore the timestamp filter and just return
      // everything; pollOnce's id-based de-dup is what's under test.
      return comments;
    },
    async getIssue(issueNumber) {
      return issues[issueNumber];
    },
    async postIssueComment(issueNumber, body) {
      posted.push({ issueNumber, body });
      return { id: Math.random() };
    },
  };
}

test('extractIssueNumber pulls the number out of an issue_url', () => {
  assert.equal(extractIssueNumber('https://api.github.com/repos/o/r/issues/37'), 37);
  assert.equal(extractIssueNumber('https://api.github.com/repos/o/r/pulls/9'), null);
  assert.equal(extractIssueNumber(null), null);
});

test('summarizeRun prefers the parsed JSON result text', () => {
  const text = summarizeRun({ parsed: { result: 'Did the thing.', total_cost_usd: 0.5, num_turns: 3 } });
  assert.match(text, /Did the thing\./);
  assert.match(text, /\$0\.5000/);
});

test('summarizeRun surfaces is_error', () => {
  const text = summarizeRun({ parsed: { is_error: true, result: 'boom' } });
  assert.match(text, /error/i);
  assert.match(text, /boom/);
});

test('summarizeRun falls back to raw output when JSON parsing failed', () => {
  const text = summarizeRun({ parsed: null, stdout: 'some raw text' });
  assert.match(text, /could not be parsed/);
  assert.match(text, /some raw text/);
});

test('first poll only establishes a baseline and triggers nothing', async () => {
  const comments = [
    { id: 1, user: { login: 'someone' }, body: '/claude do the thing', issue_url: 'https://api.github.com/repos/o/r/issues/5' },
  ];
  const github = createFakeGithub({ comments, issues: {}, botLogin: 'bot-user' });
  const stateStore = createMemoryStore({ initialized: false, lastSeenCommentId: 0, lastPollIso: null, botLogin: null });
  const sessionStore = createMemoryStore({});
  let claudeCalls = 0;

  await pollOnce({
    github,
    sessionStore,
    stateStore,
    runClaudeFn: async () => {
      claudeCalls += 1;
      return { parsed: { session_id: 'abc', result: 'done' } };
    },
    buildPromptFn: () => 'prompt',
    config: { claudeBin: 'claude', repoDir: '/tmp', runTimeoutMs: 1000, maxBudgetUsd: null, allowedLogins: ['human'] },
    log: () => {},
  });

  assert.equal(claudeCalls, 0);
  assert.equal(github.posted.length, 0);
  const state = stateStore._get();
  assert.equal(state.initialized, true);
  assert.equal(state.lastSeenCommentId, 1);
  assert.equal(state.botLogin, 'bot-user');
});

test('a new triggering comment after baseline dispatches a claude run and posts ack + summary', async () => {
  const comments = [
    { id: 5, user: { login: 'human' }, body: '/claude look into #12', issue_url: 'https://api.github.com/repos/o/r/issues/12' },
  ];
  const issues = { 12: { title: 'Something broke', body: 'details here' } };
  const github = createFakeGithub({ comments, issues, botLogin: 'bot-user' });
  const stateStore = createMemoryStore({ initialized: true, lastSeenCommentId: 4, lastPollIso: '2020-01-01T00:00:00.000Z', botLogin: 'bot-user' });
  const sessionStore = createMemoryStore({});

  const claudeArgs = [];
  await pollOnce({
    github,
    sessionStore,
    stateStore,
    runClaudeFn: async (args) => {
      claudeArgs.push(args);
      return { parsed: { session_id: 'session-1', result: 'Fixed it.' } };
    },
    buildPromptFn: (args) => `PROMPT:${args.issueNumber}:${args.instruction}`,
    config: { claudeBin: 'claude', repoDir: '/tmp', runTimeoutMs: 1000, maxBudgetUsd: null, allowedLogins: ['human'] },
    log: () => {},
  });

  assert.equal(claudeArgs.length, 1);
  assert.equal(claudeArgs[0].sessionId, undefined); // no prior session for issue 12
  assert.equal(github.posted.length, 2); // ack + summary
  assert.match(github.posted[0].body, /Working on it/);
  assert.match(github.posted[1].body, /Fixed it\./);

  const sessions = sessionStore._get();
  assert.equal(sessions['12'], 'session-1');

  const state = stateStore._get();
  assert.equal(state.lastSeenCommentId, 5);
});

test('a second trigger on the same issue resumes the stored session id', async () => {
  const comments = [
    { id: 10, user: { login: 'human' }, body: '/claude keep going', issue_url: 'https://api.github.com/repos/o/r/issues/12' },
  ];
  const issues = { 12: { title: 'Something broke', body: 'details here' } };
  const github = createFakeGithub({ comments, issues, botLogin: 'bot-user' });
  const stateStore = createMemoryStore({ initialized: true, lastSeenCommentId: 5, lastPollIso: '2020-01-01T00:00:00.000Z', botLogin: 'bot-user' });
  const sessionStore = createMemoryStore({ 12: 'session-1' });

  const claudeArgs = [];
  await pollOnce({
    github,
    sessionStore,
    stateStore,
    runClaudeFn: async (args) => {
      claudeArgs.push(args);
      return { parsed: { session_id: 'session-1', result: 'Continued.' } };
    },
    buildPromptFn: (args) => `PROMPT:${args.issueNumber}:${args.instruction}`,
    config: { claudeBin: 'claude', repoDir: '/tmp', runTimeoutMs: 1000, maxBudgetUsd: null, allowedLogins: ['human'] },
    log: () => {},
  });

  assert.equal(claudeArgs[0].sessionId, 'session-1');
});

test('comments from the bridge\'s own login are never treated as triggers', async () => {
  const comments = [
    { id: 20, user: { login: 'bot-user' }, body: '/claude do something', issue_url: 'https://api.github.com/repos/o/r/issues/1' },
  ];
  const github = createFakeGithub({ comments, issues: {}, botLogin: 'bot-user' });
  const stateStore = createMemoryStore({ initialized: true, lastSeenCommentId: 5, lastPollIso: '2020-01-01T00:00:00.000Z', botLogin: 'bot-user' });
  const sessionStore = createMemoryStore({});

  let claudeCalls = 0;
  await pollOnce({
    github,
    sessionStore,
    stateStore,
    runClaudeFn: async () => {
      claudeCalls += 1;
      return { parsed: { session_id: 'x', result: 'x' } };
    },
    buildPromptFn: () => 'prompt',
    config: { claudeBin: 'claude', repoDir: '/tmp', runTimeoutMs: 1000, maxBudgetUsd: null, allowedLogins: ['human'] },
    log: () => {},
  });

  assert.equal(claudeCalls, 0);
  assert.equal(github.posted.length, 0);
  assert.equal(stateStore._get().lastSeenCommentId, 20);
});

test('pollOnce refuses to run at all without a non-empty allowedLogins list (fails closed)', async () => {
  const github = createFakeGithub({ comments: [], issues: {}, botLogin: 'bot-user' });
  const stateStore = createMemoryStore({ initialized: true, lastSeenCommentId: 0, lastPollIso: '2020-01-01T00:00:00.000Z', botLogin: 'bot-user' });
  const sessionStore = createMemoryStore({});

  await assert.rejects(
    () =>
      pollOnce({
        github,
        sessionStore,
        stateStore,
        runClaudeFn: async () => ({ parsed: {} }),
        buildPromptFn: () => 'prompt',
        config: { claudeBin: 'claude', repoDir: '/tmp', runTimeoutMs: 1000, maxBudgetUsd: null, allowedLogins: [] },
        log: () => {},
      }),
    /allowedLogins/,
  );
});

test('a trigger from someone NOT on the allowlist is ignored even though they are not the bot', async () => {
  const comments = [
    { id: 30, user: { login: 'random-stranger' }, body: '/claude do something', issue_url: 'https://api.github.com/repos/o/r/issues/1' },
  ];
  const github = createFakeGithub({ comments, issues: { 1: { title: 't', body: 'b' } }, botLogin: 'bot-user' });
  const stateStore = createMemoryStore({ initialized: true, lastSeenCommentId: 5, lastPollIso: '2020-01-01T00:00:00.000Z', botLogin: 'bot-user' });
  const sessionStore = createMemoryStore({});

  let claudeCalls = 0;
  await pollOnce({
    github,
    sessionStore,
    stateStore,
    runClaudeFn: async () => {
      claudeCalls += 1;
      return { parsed: { session_id: 'x', result: 'x' } };
    },
    buildPromptFn: () => 'prompt',
    // Only "human" is allowed -- "random-stranger" is a real, distinct
    // GitHub user, not the bot itself, and must still be rejected.
    config: { claudeBin: 'claude', repoDir: '/tmp', runTimeoutMs: 1000, maxBudgetUsd: null, allowedLogins: ['human'] },
    log: () => {},
  });

  assert.equal(claudeCalls, 0);
  assert.equal(github.posted.length, 0);
  // The comment is still marked seen so it's never retried -- rejection,
  // not a stuck retry loop.
  assert.equal(stateStore._get().lastSeenCommentId, 30);
});

test('a comment at or below the last-seen id is never reprocessed, even if returned again', async () => {
  const comments = [
    { id: 5, user: { login: 'human' }, body: '/claude already handled', issue_url: 'https://api.github.com/repos/o/r/issues/1' },
  ];
  const github = createFakeGithub({ comments, issues: { 1: { title: 't', body: 'b' } }, botLogin: 'bot-user' });
  // lastSeenCommentId already >= 5, simulating an edited old comment
  // reappearing because GitHub's `since` filter matches on updated_at.
  const stateStore = createMemoryStore({ initialized: true, lastSeenCommentId: 5, lastPollIso: '2020-01-01T00:00:00.000Z', botLogin: 'bot-user' });
  const sessionStore = createMemoryStore({});

  let claudeCalls = 0;
  await pollOnce({
    github,
    sessionStore,
    stateStore,
    runClaudeFn: async () => {
      claudeCalls += 1;
      return { parsed: {} };
    },
    buildPromptFn: () => 'prompt',
    config: { claudeBin: 'claude', repoDir: '/tmp', runTimeoutMs: 1000, maxBudgetUsd: null, allowedLogins: ['human'] },
    log: () => {},
  });

  assert.equal(claudeCalls, 0);
});
