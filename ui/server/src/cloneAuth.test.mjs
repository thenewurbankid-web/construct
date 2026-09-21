// #330 slice B -- the access-token handling, attacked. Pure checks first (validation, redaction, the helper script),
// then a REAL git talking to a REAL local HTTP server that demands a password, to prove the mechanism end to end:
// the token reaches git only through the askpass helper's descriptor 3, and appears in no argv, no environment, no
// stored configuration and no output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { ASKPASS_SCRIPT, AUTH_MESSAGE, createAskpass, feedToken, looksLikeAuthFailure, makeRedactor, MAX_TOKEN_LENGTH, parseToken, scrubGitConfig, wipe } from './cloneAuth.mjs';
import { cloneEnv } from './cloneJobs.mjs';
import { CloneInputError } from './gitUrl.mjs';

const SECRET = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

test('a token is a closed set: visible ASCII, no whitespace or control characters, bounded', () => {
  assert.equal(parseToken(undefined), null);
  assert.equal(parseToken(null), null);
  assert.equal(parseToken(''), null);
  const ok = parseToken(SECRET);
  assert.ok(Buffer.isBuffer(ok));
  assert.equal(ok.toString('latin1'), SECRET);
  const hostile = [
    'has space', ' lead', 'trail ', 'tab\there', 'new\nline', 'cr\rreturn', 'nul\0byte', 'bell\x07', 'del\x7f', 'ünïcode', '日本語',
    'x'.repeat(MAX_TOKEN_LENGTH + 1), 5, {}, [], ['abc'], true,
  ];
  for (const bad of hostile) {
    assert.throws(() => parseToken(bad), (e) => e instanceof CloneInputError && e.code === 'BAD_TOKEN' && e.status === 400, JSON.stringify(bad));
  }
  // The refusal never repeats what was sent.
  try { parseToken(`${SECRET} with a space`); } catch (e) { assert.ok(!e.message.includes(SECRET), e.message); }
  assert.equal(parseToken('x'.repeat(MAX_TOKEN_LENGTH)).length, MAX_TOKEN_LENGTH);
});

test('wipe zeroes the buffer it is given', () => {
  const b = parseToken(SECRET);
  wipe(b);
  assert.ok(b.every((x) => x === 0));
  wipe(null);
  wipe('not a buffer');
});

test('anything token-shaped is redacted from output, the token itself and its common encodings included', () => {
  const tok = parseToken(SECRET);
  const r = makeRedactor(tok);
  const basic = Buffer.from(`x-access-token:${SECRET}`).toString('base64');
  for (const line of [
    `fatal: Authentication failed for 'https://x-access-token:${SECRET}@github.com/o/r.git/'`,
    `remote: token ${SECRET} rejected`,
    `Authorization: Basic ${basic}`,
    `> Authorization: Bearer ${SECRET}`,
    `url-encoded ${encodeURIComponent(SECRET)}`,
    `fatal: unable to access 'https://user:hunter2@github.com/o/r.git/'`,
  ]) {
    const out = r(line);
    assert.ok(!out.includes(SECRET), out);
    assert.ok(!out.includes(basic), out);
    assert.ok(!out.includes('hunter2'), out);
  }
  // Token-looking strings are removed even when this job holds no token at all.
  const bare = makeRedactor(null);
  for (const t of ['ghp_0123456789abcdefghij0123', 'github_pat_11ABCDEFG0123456789_abcdefghijk', 'glpat-abcdefghij1234567890', 'gho_0123456789abcdefghijkl']) assert.equal(bare(`x ${t} y`), 'x *** y');
  assert.equal(bare('Receiving objects:  42% (4/10)'), 'Receiving objects:  42% (4/10)');
  // After the buffer is zeroed the redactor does not turn every NUL into a match.
  wipe(tok);
  assert.equal(r('plain text'), 'plain text');
});

test('the auth-failure wording covers what git and hosts say', () => {
  for (const t of ["fatal: Authentication failed for 'https://github.com/o/r.git/'", "fatal: could not read Username for 'https://github.com': terminal prompts disabled", 'remote: Repository not found.', "fatal: repository 'https://github.com/o/r.git/' not found", 'The requested URL returned error: 403', 'remote: Invalid username or password.'.replace('Invalid username or password', 'Invalid credentials')]) {
    assert.ok(looksLikeAuthFailure(t), t);
  }
  assert.ok(!looksLikeAuthFailure('fatal: destination path already exists'));
  assert.match(AUTH_MESSAGE, /^Private or misspelled/);
});

test('the askpass helper holds no secret and lives in a private 0700 directory that cleanup removes', () => {
  assert.ok(!ASKPASS_SCRIPT.includes(SECRET));
  const base = fs.realpathSync(makeTempDir('askpass-'));
  const a = createAskpass({ base });
  assert.ok(a.dir.startsWith(path.join(base, `construct-askpass-${process.pid}-`)));
  assert.equal(fs.statSync(a.dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(a.path).mode & 0o777, 0o700);
  assert.equal(fs.readFileSync(a.path, 'utf8'), ASKPASS_SCRIPT);
  assert.equal(path.dirname(a.path), a.dir);
  a.cleanup();
  assert.equal(fs.existsSync(a.dir), false);
  a.cleanup(); // idempotent
  // two jobs never share a helper
  const x = createAskpass({ base });
  const y = createAskpass({ base });
  assert.notEqual(x.dir, y.dir);
  x.cleanup();
  y.cleanup();
});

test('the helper answers the user name from a constant and the password from descriptor 3 only, once', () => {
  const base = fs.realpathSync(makeTempDir('askpass-run-'));
  const a = createAskpass({ base });
  const env = { PATH: process.env.PATH };
  const u = spawnSync(a.path, ["Username for 'https://github.com': "], { env, encoding: 'utf8' });
  assert.equal(u.stdout, 'x-access-token\n');
  // With nothing on descriptor 3 the password is empty (and the token is nowhere else to be found).
  const none = spawnSync(a.path, ["Password for 'https://x-access-token@github.com': "], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(none.stdout.trim(), '');
  const withFd = spawnSync(a.path, ["Password for 'https://x-access-token@github.com': "], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe', fs.openSync('/dev/null', 'r')] });
  assert.equal(withFd.stdout.trim(), '');
  // Shell metacharacters in a token are data, never code: it is printed back verbatim and nothing runs.
  const tricky = 'a$(touch /tmp/construct-pwned)b`id`"\'\\;&|*';
  const f = path.join(base, 'fd3');
  fs.writeFileSync(f, `${tricky}\n`);
  const fd = fs.openSync(f, 'r');
  const echoed = spawnSync(a.path, ["Password for 'https://x-access-token@github.com': "], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe', fd] });
  assert.equal(echoed.stdout, `${tricky}\n`);
  assert.equal(fs.existsSync('/tmp/construct-pwned'), false);
  a.cleanup();
});

test('scrubGitConfig removes credentials from a remote URL and flags a token that would stay', () => {
  const tok = parseToken(SECRET);
  const cfg = `[remote "origin"]\n\turl = https://x-access-token:${SECRET}@github.com/o/r.git\n`;
  const r = scrubGitConfig(cfg, tok);
  assert.equal(r.changed, true);
  assert.ok(!r.text.includes(SECRET));
  assert.equal(r.stillHasToken, false);
  const other = scrubGitConfig(`[core]\n\tnote = ${SECRET}\n[remote "origin"]\n\turl = https://github.com/o/r.git\n`, tok);
  assert.equal(other.stillHasToken, true);
  assert.equal(scrubGitConfig('[remote "origin"]\n\turl = https://github.com/o/r.git\n', tok).changed, false);
});

// ---- real git against a server that demands a password ------------------------------------------------------------

function gitOut(cwd, ...args) {
  return spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd, encoding: 'utf8' });
}

/** A minimal smart-HTTP git server (git http-backend behind Basic auth). Records every Authorization header. */
async function authServer(projectRoot, wanted) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers.authorization ?? null);
    const want = `Basic ${Buffer.from(`x-access-token:${wanted}`).toString('base64')}`;
    if (req.headers.authorization !== want) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="git"' });
      return res.end('Unauthorized');
    }
    const [pathInfo, query = ''] = req.url.split('?');
    const cgi = spawn('git', ['http-backend'], {
      env: { PATH: process.env.PATH, GIT_PROJECT_ROOT: projectRoot, GIT_HTTP_EXPORT_ALL: '1', PATH_INFO: pathInfo, QUERY_STRING: query, REQUEST_METHOD: req.method, CONTENT_TYPE: req.headers['content-type'] ?? '', CONTENT_LENGTH: req.headers['content-length'] ?? '', REMOTE_USER: 'x-access-token', HTTP_CONTENT_ENCODING: req.headers['content-encoding'] ?? '' },
    });
    req.pipe(cgi.stdin);
    let head = Buffer.alloc(0);
    let sent = false;
    cgi.stdout.on('data', (chunk) => {
      if (sent) return void res.write(chunk);
      head = Buffer.concat([head, chunk]);
      const i = head.indexOf('\r\n\r\n');
      if (i < 0) return;
      const lines = head.subarray(0, i).toString().split('\r\n');
      const headers = {};
      let status = 200;
      for (const l of lines) {
        const [k, ...v] = l.split(': ');
        if (k.toLowerCase() === 'status') status = Number(v.join(': ').split(' ')[0]);
        else headers[k] = v.join(': ');
      }
      res.writeHead(status, headers);
      sent = true;
      res.write(head.subarray(i + 4));
    });
    cgi.stdout.on('end', () => res.end());
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, seen, close: () => new Promise((r) => server.close(r)) };
}

function seedBare(dir) {
  const seed = path.join(dir, 'seed');
  fs.mkdirSync(seed);
  gitOut(seed, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(seed, 'README.md'), 'hello\n');
  gitOut(seed, 'add', '-A');
  gitOut(seed, 'commit', '-q', '-m', 'first');
  fs.mkdirSync(path.join(dir, 'srv'));
  gitOut(dir, 'clone', '-q', '--bare', seed, path.join(dir, 'srv', 'private.git'));
  return path.join(dir, 'srv');
}

/** Run git the way cloneJobs does (argv array, scrubbed env, askpass on descriptor 3), against the local server. */
function cloneWithToken({ url, dest, token, askpass, cwd }) {
  const argv = ['-c', 'protocol.allow=never', '-c', 'protocol.http.allow=always', '-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null', 'clone', '--', url, dest];
  const env = { ...cloneEnv({ askpass: token ? askpass.path : null }), GIT_ALLOW_PROTOCOL: 'http' };
  const child = spawn('git', argv, { cwd, env, stdio: token ? ['ignore', 'ignore', 'pipe', 'pipe'] : ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', (c) => { err += c; });
  if (token) feedToken(child, Buffer.from(token));
  return new Promise((resolve) => child.once('close', (code) => resolve({ code, err, argv, env, child })));
}

test('REAL git, REAL password-protected server: the token arrives via the helper and is found nowhere else', async () => {
  const dir = fs.realpathSync(makeTempDir('authclone-'));
  const srv = await authServer(seedBare(dir), SECRET);
  const askpass = createAskpass({ base: dir });
  try {
    const url = `http://127.0.0.1:${srv.port}/private.git`;
    const tok = parseToken(SECRET);
    const dest = path.join(dir, 'out');
    const r = await cloneWithToken({ url, dest, token: tok, askpass, cwd: dir });
    assert.equal(r.code, 0, r.err);
    // It authenticated: the server saw exactly the Basic credentials, and the clone has the files.
    assert.ok(srv.seen.includes(`Basic ${Buffer.from(`x-access-token:${SECRET}`).toString('base64')}`));
    assert.equal(fs.readFileSync(path.join(dest, 'README.md'), 'utf8'), 'hello\n');
    // The token is in no argv, no environment given to the child, no output, and nothing git stored.
    assert.ok(!r.argv.join('\n').includes(SECRET));
    assert.ok(!JSON.stringify(r.env).includes(SECRET));
    assert.ok(!r.err.includes(SECRET));
    assert.ok(!Object.keys(r.env).some((k) => /token|secret|password/i.test(k)));
    for (const f of fs.readdirSync(path.join(dest, '.git'), { recursive: true })) {
      const p = path.join(dest, '.git', f);
      if (fs.statSync(p).isFile()) assert.ok(!fs.readFileSync(p).includes(SECRET), `${f} holds the token`);
    }
    assert.equal(gitOut(dest, 'config', '--get', 'remote.origin.url').stdout.trim(), url);
    assert.ok(!fs.readFileSync(askpass.path, 'utf8').includes(SECRET));
  } finally {
    askpass.cleanup();
    await srv.close();
  }
});

test('REAL git: no token, or a wrong token, fails as an authentication failure (and says so in words we recognise)', async () => {
  const dir = fs.realpathSync(makeTempDir('authclone-bad-'));
  const srv = await authServer(seedBare(dir), SECRET);
  const askpass = createAskpass({ base: dir });
  try {
    const url = `http://127.0.0.1:${srv.port}/private.git`;
    const none = await cloneWithToken({ url, dest: path.join(dir, 'a'), token: null, askpass, cwd: dir });
    assert.notEqual(none.code, 0);
    assert.ok(looksLikeAuthFailure(none.err), none.err);
    const wrongTok = parseToken('ghp_wrongwrongwrongwrongwrongwrongwrong1');
    const wrong = await cloneWithToken({ url, dest: path.join(dir, 'b'), token: wrongTok, askpass, cwd: dir });
    assert.notEqual(wrong.code, 0);
    assert.ok(looksLikeAuthFailure(wrong.err), wrong.err);
    // Whatever git printed, redacting with the wrong token removes it too.
    assert.ok(!makeRedactor(parseToken('ghp_wrongwrongwrongwrongwrongwrongwrong1'))(wrong.err).includes('wrongwrongwrong'));
    assert.equal(fs.existsSync(path.join(dir, 'a')) || fs.existsSync(path.join(dir, 'b')), false);
  } finally {
    askpass.cleanup();
    await srv.close();
  }
});
