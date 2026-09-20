import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJobView } from './CloneJobView.ts';
import { formatBytes, percentOf } from './CloneProgress.ts';
import { suggestFolderName, urlProblem } from './CloneUrl.ts';

test('the folder name comes from the repository in the URL', () => {
  assert.equal(suggestFolderName('https://github.com/octocat/Hello-World'), 'Hello-World');
  assert.equal(suggestFolderName('https://github.com/octocat/hello.git'), 'hello');
  assert.equal(suggestFolderName(' https://github.com/octocat/hello/ '), 'hello');
  assert.equal(suggestFolderName('https://github.com/octocat'), '');
  assert.equal(suggestFolderName('git@github.com:o/r.git'), '');
});

test('a URL problem is explained, and a good one has none', () => {
  assert.equal(urlProblem(''), null);
  assert.equal(urlProblem('https://github.com/o/r'), null);
  assert.match(urlProblem('git@github.com:o/r.git'), /https/);
  assert.match(urlProblem('https://user:pw@github.com/o/r'), /user name/);
  assert.match(urlProblem('https://github.com/o'), /owner\/repository/);
});

test('progress percent is read from the tool text', () => {
  assert.equal(percentOf('Receiving objects:  42% (4/10)'), 42);
  assert.equal(percentOf('Starting'), null);
});

test('sizes read at a glance', () => {
  assert.equal(formatBytes(0), '0 KB');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
});

test('a job view carries the state, the tone and what the user should see', () => {
  const base = { id: 'a', kind: 'clone', title: 'Clone o/r', url: 'u', name: 'r', progress: 'Receiving objects:  50% (5/10)', bytes: 1024, startedAt: 't', finishedAt: null, log: [] };
  const running = buildJobView({ ...base, state: 'running' });
  assert.deepEqual([running.stateLabel, running.tone, running.percent, running.live], ['Cloning', 'live', 50, true]);
  const done = buildJobView({ ...base, state: 'done', dir: '/w/r' });
  assert.deepEqual([done.stateLabel, done.tone, done.percent, done.progress], ['Done', 'done', 100, 'Cloned into r']);
  const failed = buildJobView({ ...base, state: 'failed', error: 'too big' });
  assert.deepEqual([failed.tone, failed.progress, failed.error], ['bad', 'too big', 'too big']);
  assert.equal(buildJobView({ ...base, state: 'cancelled' }).tone, 'idle');
});
