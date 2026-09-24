import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveAuthMode, githubPanelView } from './GithubConnection.ts';
import { pickedRepo, repoAddress, repoOptions } from './GithubRepoPick.ts';
import { mergeRepoPages, reposHint } from './GithubRepoPages.ts';
import { buildJobView } from './CloneJobView.ts';

const on = { enabled: true, connected: true, login: 'octo' };
const repos = [{ fullName: 'octo/a', owner: 'octo', name: 'a', private: true }, { fullName: 'octo/b', owner: 'octo', name: 'b', private: false }];
const list = (o = {}) => ({ repos, page: 1, perPage: 30, total: 2, hasMore: false, truncated: false, source: 'installations', installations: 1, ...o });

test('the login is the default when connected; the pasted token is the fallback and the only way otherwise', () => {
  assert.equal(effectiveAuthMode(on, null), 'login');
  assert.equal(effectiveAuthMode(on, 'login'), 'login');
  assert.equal(effectiveAuthMode(on, 'token'), 'token');
  assert.equal(effectiveAuthMode({ enabled: true, connected: false }, null), 'token');
  assert.equal(effectiveAuthMode({ enabled: true, connected: false }, 'login'), 'token', 'a stale choice of the login with no connection');
  assert.equal(effectiveAuthMode({ enabled: false, connected: false }, 'login'), 'token');
  assert.equal(effectiveAuthMode(null, null), 'token');
});

test('when the feature is off (or unknown) nothing is visible; otherwise the connection is one line', () => {
  assert.equal(githubPanelView(null).visible, false);
  assert.equal(githubPanelView({ enabled: false, connected: false }).visible, false);
  assert.deepEqual(githubPanelView({ enabled: true, connected: false }), { visible: true, connected: false, summary: 'Not connected', login: null });
  assert.deepEqual(githubPanelView(on), { visible: true, connected: true, summary: 'Connected as octo', login: 'octo' });
  assert.equal(githubPanelView({ enabled: true, connected: true }).summary, 'Connected');
});

test('picker entries say private, an address is the https one, and the picker shows what is typed', () => {
  assert.deepEqual(repoOptions(repos), [{ value: 'octo/a', label: 'octo/a (private)' }, { value: 'octo/b', label: 'octo/b' }]);
  assert.equal(repoAddress('octo/a'), 'https://github.com/octo/a');
  assert.equal(pickedRepo('https://github.com/octo/a', repos), 'octo/a');
  assert.equal(pickedRepo(' https://github.com/octo/b.git/ ', repos), 'octo/b');
  assert.equal(pickedRepo('octo/a', repos), 'octo/a');
  assert.equal(pickedRepo('https://github.com/octo/zzz', repos), '');
  assert.equal(pickedRepo('', repos), '');
});

test('an empty picker explains what is missing (the app is not installed), a failure is shown as is', () => {
  assert.equal(reposHint(list(), '', null), null);
  assert.match(reposHint(list({ repos: [], total: 0, installations: 0 }), '', null), /not installed on any repository/);
  assert.match(reposHint(list({ repos: [], total: 0, installations: 1 }), '', null), /cannot see any repository/);
  assert.equal(reposHint(list({ repos: [], total: 0 }), 'zzz', null), 'No repository matches that.');
  assert.match(reposHint(list({ truncated: true }), '', null), /Only the first/);
  assert.equal(reposHint(null, '', 'GitHub did not answer in time.'), 'GitHub did not answer in time.');
  assert.equal(reposHint(null, '', null), null);
});

test('more pages are appended without duplicates; page 1 replaces', () => {
  const more = list({ page: 2, repos: [repos[1], { fullName: 'octo/c', owner: 'octo', name: 'c', private: true }] });
  assert.deepEqual(mergeRepoPages(repos, more).map((r) => r.fullName), ['octo/a', 'octo/b', 'octo/c']);
  assert.deepEqual(mergeRepoPages(repos, list({ page: 1, repos: [repos[0]] })).map((r) => r.fullName), ['octo/a']);
});

test('a clone the connection cannot see is flagged apart from "private or misspelled"', () => {
  const job = (code) => ({ id: 'j', kind: 'clone', title: 't', url: 'u', name: 'n', state: 'failed', progress: '', bytes: 0, startedAt: '', finishedAt: '', error: 'x', code, private: true, log: [] });
  assert.equal(buildJobView(job('NOT_VISIBLE_TO_CONNECTION')).notVisible, true);
  assert.equal(buildJobView(job('NOT_VISIBLE_TO_CONNECTION')).authFailed, false);
  assert.equal(buildJobView(job('AUTH')).authFailed, true);
  assert.equal(buildJobView(job('AUTH')).notVisible, false);
});
