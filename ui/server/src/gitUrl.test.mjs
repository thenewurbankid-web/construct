// #330 -- the clone URL / folder-name / address rules, with hostile input. Pure functions, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CloneInputError, isPublicAddress, parseCloneUrl, resolveCloneHosts, validateSlug } from './gitUrl.mjs';

const refuses = (input, code, opts) => {
  assert.throws(() => parseCloneUrl(input, opts), (e) => e instanceof CloneInputError && (code === undefined || e.code === code), `should refuse ${JSON.stringify(input)}`);
};

test('accepts a plain github https URL and normalises it', () => {
  const p = parseCloneUrl('https://github.com/octocat/Hello-World');
  assert.deepEqual([p.kind, p.host, p.owner, p.repo, p.slug, p.url], ['https', 'github.com', 'octocat', 'Hello-World', 'Hello-World', 'https://github.com/octocat/Hello-World.git']);
  assert.equal(parseCloneUrl('https://GitHub.com/octocat/hello.git').url, 'https://github.com/octocat/hello.git');
  assert.equal(parseCloneUrl('https://github.com/octocat/hello/').slug, 'hello');
  assert.equal(parseCloneUrl('https://github.com/a/b.c_d-e').slug, 'b.c_d-e');
});

test('refuses every scheme except https', () => {
  for (const u of ['http://github.com/o/r', 'ssh://git@github.com/o/r', 'git://github.com/o/r', 'file:///etc/passwd', 'ext::sh -c id', 'ext::sh%20-c%20id', 'git@github.com:o/r.git', 'github.com/o/r', 'ftp://github.com/o/r', 'javascript:alert(1)', '/etc/passwd', '../x', 'fd::17/foo']) refuses(u);
  refuses('file:///etc/passwd', 'BAD_SCHEME');
});

test('refuses userinfo in every spelling', () => {
  for (const u of ['https://user:pass@github.com/o/r', 'https://user@github.com/o/r', 'https://:@github.com/o/r', 'https://github.com@evil.com/o/r', 'https://github.com:pw@evil.com/o/r', 'https://evil.com%40github.com/o/r', 'https://evil.com\\@github.com/o/r']) refuses(u);
  refuses('https://user:pass@github.com/o/r', 'BAD_URL');
});

test('refuses option smuggling and git transport tricks', () => {
  for (const u of ['--upload-pack=touch /tmp/x', '--upload-pack=x', '-oProxyCommand=x', '-u', 'https://github.com/o/r --upload-pack=x', 'https://github.com/o/r\n--upload-pack=x', 'https://github.com/o/r\t', ' https://github.com/o/r', 'https://github.com/o/r ', 'https://github.com/--upload-pack=x/r', 'https://github.com/o/--upload-pack=x']) refuses(u);
});

test('refuses hosts that are not allowlisted, including look-alikes', () => {
  for (const u of ['https://evil.com/o/r', 'https://github.com.evil.com/o/r', 'https://evilgithub.com/o/r', 'https://gist.github.com/o/r', 'https://github.com./o/r', 'https://127.0.0.1/o/r', 'https://localhost/o/r', 'https://[::1]/o/r', 'https://169.254.169.254/o/r', 'https://2130706433/o/r', 'https://0x7f.1/o/r', 'https://github.com:8443/o/r']) refuses(u);
  refuses('https://evil.com/o/r', 'HOST_NOT_ALLOWED');
});

test('refuses unicode and lookalike characters anywhere', () => {
  for (const u of ['https://gıthub.com/o/r', 'https://github.com/o/répo', 'https://github.com/о/r', 'https://github.com/o/r‮', 'https://github.com/o/r\u0000', 'https://github.com/o/r%00', 'https://github.com/%2e%2e/r', 'https://github.com/o/%2e%2e']) refuses(u);
});

test('refuses paths that are not exactly owner/repo', () => {
  for (const u of ['https://github.com', 'https://github.com/', 'https://github.com/o', 'https://github.com/o/r/tree/main', 'https://github.com//o/r', 'https://github.com/o//r', 'https://github.com/./r', 'https://github.com/o/.', 'https://github.com/o/..', 'https://github.com/../r', 'https://github.com/o/r?x=1', 'https://github.com/o/r#frag', 'https://github.com/o/r.git.git']) refuses(u);
});

test('refuses dotted, trailing-dot, dot-leading and over-long repository names', () => {
  for (const name of ['.', '..', '...', 'a..b', 'repo.', '.hidden', '-flag', '.git']) refuses(`https://github.com/o/${name}`);
  refuses(`https://github.com/o/${'a'.repeat(101)}`);
  refuses(`https://github.com/${'a'.repeat(400)}/r`);
});

test('a local file:// source is refused unless the test harness names a root, and then only under it', () => {
  refuses('file:///tmp/fixtures/r.git');
  const opts = { localRoot: '/tmp/fixtures' };
  assert.equal(parseCloneUrl('file:///tmp/fixtures/r.git', opts).kind, 'file');
  refuses('file:///etc/passwd', 'HOST_NOT_ALLOWED', opts);
  refuses('file:///tmp/fixtures/../etc/passwd', 'HOST_NOT_ALLOWED', opts);
  refuses('file:///tmp/fixtures-evil/r.git', 'HOST_NOT_ALLOWED', opts);
  refuses('file://host/tmp/fixtures/r.git', undefined, opts);
  refuses('file:///tmp/fixtures/%2e%2e/x', undefined, opts);
});

test('non-string input is refused', () => {
  for (const v of [undefined, null, 5, {}, [], ['https://github.com/o/r']]) refuses(v, 'BAD_URL');
});

test('the host allowlist is configurable and cannot be widened by a typo', () => {
  assert.deepEqual(resolveCloneHosts({}), ['github.com']);
  assert.deepEqual(resolveCloneHosts({ CONSTRUCT_CLONE_HOSTS: 'GitHub.com, gitlab.com' }), ['github.com', 'gitlab.com']);
  assert.deepEqual(resolveCloneHosts({ CONSTRUCT_CLONE_HOSTS: '*,localhost,127.0.0.1,ev il.com' }), ['github.com']);
  assert.equal(parseCloneUrl('https://gitlab.com/o/r', { hosts: ['github.com', 'gitlab.com'] }).host, 'gitlab.com');
  refuses('https://gitlab.com/o/r', 'HOST_NOT_ALLOWED');
});

test('validateSlug: names that would escape, hide or confuse are refused', () => {
  for (const s of ['', '.', '..', '../x', 'a/b', 'a\\b', '/abs', '.hidden', 'trailing.', 'dots..inside', 'x.git', 'ü', 'a b', 'a\0b', '-rf', 'a'.repeat(101), 5, null, undefined]) {
    assert.throws(() => validateSlug(s), CloneInputError, `should refuse ${JSON.stringify(s)}`);
  }
  for (const s of ['my-app', 'my_app', 'app.v2', 'A1']) assert.equal(validateSlug(s), s);
});

test('isPublicAddress: only global unicast addresses pass', () => {
  for (const a of ['140.82.112.3', '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2a00:1450:4001:81b::200e']) assert.equal(isPublicAddress(a), true, a);
  for (const a of [
    '127.0.0.1', '127.9.9.9', '0.0.0.0', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '192.0.2.1', '198.51.100.1', '203.0.113.1', '198.18.0.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '64:ff9b::7f00:1', '2002:7f00:1::1',
    'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'ff02::1', '2001:db8::1', '2001::1', 'not-an-ip', '', 'localhost', '1.2.3',
  ]) assert.equal(isPublicAddress(a), false, a);
  assert.equal(isPublicAddress('172.32.0.1'), true);
  assert.equal(isPublicAddress('::ffff:8.8.8.8'), true);
});
