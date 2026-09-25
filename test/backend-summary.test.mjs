// #634: `construct summarize --backend <dir>`: the route map, roles, import graph, environment reads and effects of a
// Node.js / Express backend, read-only and deterministic. Fixtures are written to a temp directory; the last tests run
// the real thing on ui/server/src and check it against a grep of the source.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { EXIT_CODES } from '../packages/core/diagnostics.mjs';
import { summarizeBackend, renderBackendText, resolveBackendDir, BACKEND_LIMITS } from '../packages/core/backend-summary.mjs';
import { BACKEND_ROLES, classifyBackendFile, isBackendTestPath, readBackendConfig } from '../packages/core/backend-roles.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(REPO, 'packages', 'cli', 'construct.mjs');
const schema = JSON.parse(fs.readFileSync(path.join(REPO, 'schemas', 'backend-summary.v1.json'), 'utf8'));
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
const assertValid = (doc) => assert.ok(validate(doc), JSON.stringify(validate.errors?.slice(0, 3)));

/** A temp project holding `files` (project-relative path to text). */
function project(files) {
  const dir = makeTempDir('construct-backend-');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}
const hashTree = (dir) => {
  const h = crypto.createHash('sha256');
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) h.update(`L ${p} ${fs.readlinkSync(p)}`);
      else if (e.isDirectory()) { h.update(`D ${p}`); walk(p); } else h.update(`F ${p}${fs.readFileSync(p)}`);
    }
  };
  walk(dir);
  return h.digest('hex');
};
const routeKeys = (s) => s.routes.map((r) => `${r.method} ${r.path}`);
const run = (args, cwd) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd });

// ---------------------------------------------------------------------------------------------- the route map

const APP = {
  'server.mjs': `import express from 'express';
import notesRouter from './notesApi.mjs';
import { createUsersRouter } from './usersApi.mjs';
import { mountHealth } from './health.mjs';
import { requireAuth } from './auth.mjs';
import * as reports from './reports.mjs';

const app = express();
app.use(express.json());
app.get('/api/ping', (req, res) => res.json({ ok: true }));
app.use('/api/notes', notesRouter);
app.use('/api/users', requireAuth, createUsersRouter({ db: null }));
mountHealth(app);
app.post('/api/reports', requireAuth, reports.create);
app.put('/api/reports/:id', reports.update, reports.finish);
app.patch('/api/reports/:id', function patchReport(req, res) { res.end(); });
app.delete('/api/reports/:id', reports.remove);
app.all('/api/echo', (req, res) => res.end());
app.use((err, req, res, next) => res.status(500).end());
app.listen(3000);
`,
  'notesApi.mjs': `import express from 'express';
const router = express.Router();
function listNotes(req, res) { res.json([]); }
router.use((req, res, next) => next());
router.get('/', listNotes);
router.get('/:id', (req, res) => res.json({}));
router.route('/:id/tags').get(listNotes).post((req, res) => res.end());
router.use((req, res) => res.status(404).end());
export default router;
`,
  'usersApi.mjs': `import { Router } from 'express';
import { getUser } from './users.mjs';
export function createUsersRouter(deps) {
  const router = Router();
  const admin = Router();
  admin.get('/stats', getUser);
  router.use('/admin', admin);
  router.get('/me', getUser);
  return router;
}
`,
  'users.mjs': 'export function getUser(req, res) { res.end(); }\n',
  'health.mjs': `export function mountHealth(app) {
  app.get('/healthz', (req, res) => res.end('ok'));
}
`,
  'auth.mjs': 'export function requireAuth(req, res, next) { next(); }\n',
  'reports.mjs': 'export function create() {}\nexport function update() {}\nexport function finish() {}\nexport function remove() {}\n',
};

test('routes: every Express form, with mount prefixes resolved across files', () => {
  const s = summarizeBackend(project(APP));
  assertValid(s);
  assert.equal(s.detection.framework, 'express');
  assert.deepEqual(routeKeys(s).sort(), [
    'ALL /api/echo', 'DELETE /api/reports/:id',
    'GET /api/notes', 'GET /api/notes/:id', 'GET /api/notes/:id/tags', 'GET /api/ping',
    'GET /api/users/admin/stats', 'GET /api/users/me', 'GET /healthz',
    'PATCH /api/reports/:id', 'POST /api/notes/:id/tags', 'POST /api/reports', 'PUT /api/reports/:id',
  ]);
  assert.equal(s.unmounted.length, 0);
  assert.deepEqual(s.mounts.map((m) => [m.path, path.basename(m.target.file)]), [
    ['/api/notes', 'notesApi.mjs'], ['/api/users', 'usersApi.mjs'], ['/api/users/admin', 'usersApi.mjs'],
  ]);
});

test('routes: handler file and name for named, imported and inline handlers; source file:line', () => {
  const s = summarizeBackend(project(APP));
  const by = (key) => s.routes.find((r) => `${r.method} ${r.path}` === key);
  assert.deepEqual(by('GET /api/notes').handler, { name: 'listNotes', inline: false, file: 'notesApi.mjs', line: 3 });
  assert.deepEqual(by('GET /api/notes/:id').handler, { name: null, inline: true });
  assert.deepEqual(by('POST /api/reports').handler, { file: 'reports.mjs', name: 'create', inline: false });
  assert.deepEqual(by('PATCH /api/reports/:id').handler, { name: 'patchReport', inline: true });
  assert.deepEqual(by('GET /api/users/me').handler, { file: 'users.mjs', name: 'getUser', inline: false });
  assert.equal(by('GET /api/ping').file, 'server.mjs');
  assert.equal(by('GET /api/ping').line, 10);
  assert.equal(by('GET /api/notes/:id/tags').line, 7, 'a chained route is positioned at its own .get(');
  assert.equal(by('POST /api/notes/:id/tags').line, 7);
});

test('routes: middleware in order, inherited middleware by registration order and path, error handlers excluded', () => {
  const s = summarizeBackend(project(APP));
  const by = (key) => s.routes.find((r) => `${r.method} ${r.path}` === key);
  assert.deepEqual(by('POST /api/reports').middleware, ['requireAuth']);
  assert.deepEqual(by('PUT /api/reports/:id').middleware, ['reports.update']);
  assert.deepEqual(by('PUT /api/reports/:id').handler.name, 'finish');
  const names = (route) => route.inherited.map((id) => s.middleware.find((m) => m.id === id).names.join('|'));
  // express.json() is registered before every route; the per-router use() only applies inside that router
  assert.deepEqual(names(by('GET /api/ping')), ['express.json(...)']);
  assert.deepEqual(names(by('GET /api/notes')), ['express.json(...)', '(inline)']);
  assert.deepEqual(names(by('GET /api/users/me')), ['express.json(...)', 'requireAuth']);
  assert.deepEqual(names(by('ALL /api/echo')), ['express.json(...)'], 'a route registered after the router mounts does not inherit their per-router middleware');
  assert.ok(!s.middleware.some((m) => m.errorHandler && s.routes.some((r) => r.inherited.includes(m.id))), 'an error handler is never inherited');
  assert.ok(s.middleware.some((m) => m.errorHandler), 'but it is listed');
  // the 404 fallback registered after the routes does not apply to them
  assert.ok(!names(by('GET /api/notes')).includes('(inline)|(inline)'));
});

test('routes: a registrar (mountRoutes(app)) and a factory object member are followed; an unmounted router is reported, not guessed', () => {
  const s = summarizeBackend(project({
    'app.mjs': `import express from 'express';
import { createAuth } from './auth.mjs';
import { orphan } from './orphan.mjs';
const app = express();
let auth;
auth = createAuth({});
auth.mountRoutes(app);
export { app, orphan };
`,
    'auth.mjs': `export function createAuth() {
  function login(req, res) {}
  function mountRoutes(app) { app.get('/auth/login', login); app.post('/auth/logout', (req, res) => {}); }
  return { mountRoutes, login };
}
`,
    'orphan.mjs': `import { Router } from 'express';
export const orphan = Router();
orphan.get('/lonely', (req, res) => {});
`,
  }));
  assert.deepEqual(routeKeys(s), ['GET /auth/login', 'POST /auth/logout']);
  assert.equal(s.routes[0].handler.name, 'login');
  assert.deepEqual(s.unmounted.map((r) => `${r.method} ${r.path}`), ['GET /lonely']);
  assert.equal(s.unmounted[0].mounted, false);
  assert.match(renderBackendText(s), /NO APP MOUNTS/);
});

test('routes: CommonJS require, module.exports routers, array and constant paths, a computed path is flagged not guessed', () => {
  const s = summarizeBackend(project({
    'index.js': `const express = require('express');
const items = require('./items');
const app = express();
const BASE = '/v1';
app.use(BASE + '/items', items);
app.get(['/a', '/b'], (req, res) => {});
for (const name of ['x', 'y']) app.post(\`/proof/\${name}\`, (req, res) => {});
app.get(computePath(), (req, res) => {});
`,
    'items.js': `const router = require('express').Router();
router.get('/:id', (req, res) => {});
module.exports = router;
`,
  }));
  assert.deepEqual(routeKeys(s).sort(), ['GET /a', 'GET /b', 'GET /v1/items/:id', 'POST /proof/${name}', 'GET computePath()'].sort());
  const dyn = s.routes.filter((r) => r.dynamicPath);
  assert.deepEqual(dyn.map((r) => r.path).sort(), ['POST /proof/${name}', 'GET computePath()'].map((x) => x.split(' ')[1]).sort());
  assert.ok(s.detection.notDetected.filter((n) => n.what === 'route-path').length === 2);
});

test('routes: things that only look like routes are not routes', () => {
  const s = summarizeBackend(project({
    'app.mjs': `import express from 'express';
const app = express();
const cache = new Map();
const title = app.get('title');
cache.get('/x', () => 1);
function read(params) { return params.get('id'); }
app.get('/real', (req, res) => {});
`,
  }));
  assert.deepEqual(routeKeys(s), ['GET /real']);
});

test('routes: a mount it cannot resolve is listed as not detected', () => {
  const s = summarizeBackend(project({
    'app.mjs': `import express from 'express';
import { pick } from './pick.mjs';
const app = express();
app.use('/dyn', pick(process.argv[2]));
app.use('/plain', (req, res, next) => next());
`,
    'pick.mjs': 'export function pick(x) { return x; }\n',
  }));
  assert.equal(s.routes.length, 0);
  assert.deepEqual(s.detection.notDetected.map((n) => [n.what, n.file, n.line]), []);
  // pick(...) is not named like a router: it is listed as middleware, never as a guessed mount
  assert.ok(s.middleware.some((m) => m.names[0] === 'pick(...)'));
});

test('http.createServer: only `url === "/x"` style routes, with the method when the condition names it; anything else is "not detected"', () => {
  const s = summarizeBackend(project({
    'server.js': `const http = require('http');
const server = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') { res.end('ok'); return; }
  if (req.method === 'POST' && req.url === '/echo') { res.end(); return; }
  if (req.url.startsWith('/static/')) { res.end(); return; }
  switch (req.url) { case '/a': break; case '/b': break; }
  res.statusCode = 404; res.end();
});
server.listen(8080);
`,
    'plain.js': `const http = require('http');
function handler(req, res) { res.end(); }
http.createServer(handler).listen(1);
`,
    'dyn.js': `const http = require('http');
http.createServer(makeHandler()).listen(2);
function makeHandler() { return () => {}; }
`,
  }));
  assertValid(s);
  assert.equal(s.detection.framework, 'node-http');
  const by = Object.fromEntries(s.httpServers.map((h) => [h.file, h]));
  assert.deepEqual(by['server.js'].routes.map((r) => `${r.method} ${r.path}`), ['GET /health', 'POST /echo', 'ANY /a', 'ANY /b']);
  assert.equal(by['server.js'].otherBranches, 1);
  assert.match(by['server.js'].note, /1 other path condition/);
  assert.equal(by['plain.js'].detected, false);
  assert.match(by['plain.js'].note, /not detected/);
  assert.match(by['dyn.js'].note, /not statically visible/);
  assert.equal(s.routes.length, 0, 'these are not express routes');
  assert.ok(s.detection.notDetected.some((n) => n.what === 'http-server' && n.file === 'plain.js'));
});

test('http.createServer(app) is the express app, not a second server', () => {
  const s = summarizeBackend(project({
    'a.mjs': `import http from 'node:http';\nimport express from 'express';\nconst app = express();\napp.get('/x', (q, r) => {});\nhttp.createServer(app).listen(1);\n`,
  }));
  assert.equal(s.httpServers.length, 0);
  assert.equal(s.detection.framework, 'express');
});

// ---------------------------------------------------------------------------------------------- roles

test('roles: naming and content, each with its reason; unclassified files are other', () => {
  const s = summarizeBackend(project({
    ...APP,
    'notesStore.mjs': `import fs from 'node:fs';\nexport function save(x) { fs.writeFileSync('a', x); }\n`,
    'outbound.mjs': `export async function send() { return fetch('https://x.example'); }\n`,
    'jobs/cleanup.mjs': `export function run() { setInterval(() => {}, 1000); }\n`,
    'config.mjs': `export const port = process.env.PORT;\n`,
    'format.mjs': `export function money(n) { return n.toFixed(2); }\n`,
    'readOnly.mjs': `import fs from 'node:fs';\nexport function load() { return fs.readFileSync('a', 'utf8'); }\n`,
    'runs.mjs': `import { spawn } from 'node:child_process';\nexport function go() { return spawn('ls'); }\n`,
    'script.mjs': `console.log('hi');\n`,
    'notesApi.test.mjs': `import test from 'node:test';\n`,
    'test/helper.mjs': `export const x = 1;\n`,
  }));
  assertValid(s);
  const role = Object.fromEntries(s.files.list.map((f) => [f.path, f]));
  const expect = {
    'server.mjs': ['route', /creates the express app/], 'notesApi.mjs': ['route', /"api"/], 'usersApi.mjs': ['route', /"api"/],
    'health.mjs': ['other', /no route|default/], 'auth.mjs': ['auth', /"auth"/], 'notesStore.mjs': ['store', /"store"/],
    'outbound.mjs': ['service', /network call/], 'jobs/cleanup.mjs': ['job', /"jobs\/"|folder/], 'config.mjs': ['config', /"config"/],
    'format.mjs': ['util', /touches no/], 'readOnly.mjs': ['service', /reads files/], 'runs.mjs': ['service', /child process/],
    'script.mjs': ['other', /default/], 'notesApi.test.mjs': ['test', /test naming/], 'test/helper.mjs': ['test', /test naming/],
  };
  for (const [file, [r, why]] of Object.entries(expect)) {
    if (file === 'health.mjs') continue; // registers a route through a registrar: judged below
    assert.equal(role[file].role, r, `${file}: ${role[file].role} (${role[file].reason})`);
    assert.match(role[file].reason, why, file);
  }
  assert.equal(role['health.mjs'].role, 'route', 'a registrar that registers routes on a passed-in app is a route file');
  assert.equal(s.files.roles.other, 1);
  assert.equal(s.files.roles.test, 2);
  assert.equal(s.files.roles.route, 4);
});

test('roles: backend.roles in architecture.yml overrides, with the config reason; an unknown role or glob type fails loudly', () => {
  const dir = project({
    'architecture.yml': `version: 1\nbackend:\n  roles:\n    store: ['src/db/**', 'src/format.mjs']\n    job: src/script.mjs\n`,
    'src/db/pool.mjs': `export const x = 1;\n`,
    'src/format.mjs': `export function money() {}\n`,
    'src/script.mjs': `console.log(1);\n`,
    'src/other.mjs': `console.log(2);\n`,
  });
  const s = summarizeBackend(path.join(dir, 'src'));
  const role = Object.fromEntries(s.files.list.map((f) => [f.path, f]));
  assert.equal(role['src/db/pool.mjs'].role, 'store');
  assert.equal(role['src/db/pool.mjs'].source, 'config');
  assert.match(role['src/db/pool.mjs'].reason, /backend\.roles\.store matches 'src\/db\/\*\*'/);
  assert.equal(role['src/format.mjs'].role, 'store', 'a config override beats a content signal');
  assert.equal(role['src/script.mjs'].role, 'job', 'a single glob string is accepted');
  assert.equal(role['src/other.mjs'].role, 'other');
  assert.deepEqual(s.files.list.map((f) => f.path), ['src/db/pool.mjs', 'src/format.mjs', 'src/other.mjs', 'src/script.mjs'], 'paths are relative to the project root that holds architecture.yml');
  const bad = project({ 'architecture.yml': `backend:\n  roles:\n    wizard: ['a']\n`, 'a.mjs': 'export const a = 1;\n' });
  assert.throws(() => summarizeBackend(bad), /unknown role 'wizard'/);
  const bad2 = project({ 'architecture.yml': `backend:\n  roles:\n    store: [1]\n`, 'a.mjs': 'export const a = 1;\n' });
  assert.throws(() => summarizeBackend(bad2), /must be strings/);
  assert.deepEqual(readBackendConfig(makeTempDir('construct-backend-empty-')), { dir: null, roles: {} });
});

test('roles: the classifier is a pure function of what it is given; test paths follow the naming convention', () => {
  const base = { rel: 'a.mjs', dirRel: 'a.mjs', isTest: false, routing: { routes: 0, isApp: false, exportsRouter: false }, effects: {}, envReads: 0, exportCount: 0 };
  assert.equal(classifyBackendFile({ ...base, exportsRouter: false, routing: { routes: 0, isApp: false, exportsRouter: true } }).role, 'route');
  assert.equal(classifyBackendFile({ ...base, rel: 'x/authRoutes.mjs', dirRel: 'authRoutes.mjs' }).role, 'route', 'a route word in the name beats an auth word');
  assert.equal(classifyBackendFile({ ...base, rel: 'x/auth.mjs', dirRel: 'auth.mjs' }).role, 'auth');
  assert.equal(classifyBackendFile({ ...base, rel: 'svc/x.mjs', dirRel: 'services/x.mjs' }).role, 'service', 'a folder name counts');
  assert.equal(classifyBackendFile({ ...base }, { util: ['*.mjs'] }).role, 'util');
  for (const p of ['a.test.mjs', 'a.spec.ts', 'a.cases.mjs', 'x/a.fixture.mjs', 'a.golden.test.mjs', '__tests__/a.mjs', 'test/a.mjs', 'e2e/a.mjs']) assert.equal(isBackendTestPath(p), true, p);
  for (const p of ['testRuns.mjs', 'testsApi.mjs', 'contest.mjs', 'latest.mjs']) assert.equal(isBackendTestPath(p), false, p);
  assert.ok(BACKEND_ROLES.includes('other'));
});

// ---------------------------------------------------------------------------------------------- imports, env, effects

test('imports: edges between files, cycles named with a concrete loop, type-only imports ignored, outside and unresolved reported', () => {
  const dir = project({
    'architecture.yml': 'version: 1\n',
    'lib/shared.mjs': 'export const shared = 1;\n',
    'src/a.mjs': `import { b } from './b.mjs';\nimport { c } from './c.mjs';\nimport { shared } from '../lib/shared.mjs';\nimport { nope } from './missing.mjs';\nimport x from 'left-pad';\nimport fs from 'node:fs';\nexport const a = () => b + c + shared;\n`,
    'src/b.mjs': `import { c } from './c.mjs';\nexport const b = () => c;\n`,
    'src/c.mjs': `import { a } from './a.mjs';\nexport const c = () => a;\n`,
    'src/types.ts': `import type { Foo } from './a.mjs';\nexport const t = 1;\n`,
    'src/self.mjs': `import { self } from './self.mjs';\nexport const self2 = 1;\n`,
  });
  const s = summarizeBackend(path.join(dir, 'src'));
  assertValid(s);
  const edge = (from, to) => s.imports.edges.some((e) => e.from === `src/${from}` && e.to === `src/${to}`);
  assert.ok(edge('a.mjs', 'b.mjs') && edge('b.mjs', 'c.mjs') && edge('c.mjs', 'a.mjs'));
  assert.ok(!s.imports.edges.some((e) => e.from === 'src/types.ts'), 'a type-only import is erased');
  assert.deepEqual(s.imports.cycles.map((c) => c.files), [['src/a.mjs', 'src/b.mjs', 'src/c.mjs'], ['src/self.mjs']]);
  assert.deepEqual(s.imports.cycles[0].path, ['src/a.mjs', 'src/c.mjs', 'src/a.mjs'], 'the shortest loop through the first file');
  assert.deepEqual(s.imports.outside, [{ from: 'src/a.mjs', to: 'lib/shared.mjs', line: 3 }]);
  assert.deepEqual(s.imports.unresolved, [{ from: 'src/a.mjs', specifier: './missing.mjs', line: 4 }]);
  assert.deepEqual(s.imports.packages.map((p) => [p.name, p.builtin]), [['fs', true], ['left-pad', false]]);
  assert.equal(s.counts.cycles, 2);
});

test('env: names only, never values; process.env forms; NODE_ENV counts on the backend', () => {
  const s = summarizeBackend(project({
    'a.mjs': `const secret = process.env.API_SECRET;\nconst port = process.env['PORT'];\nconst { HOST, DB_URL: url } = process.env;\nconst opt = process.env?.OPTIONAL;\nif (process.env.NODE_ENV === 'production') {}\nconst all = { ...process.env };\nconst dyn = process.env[name];\nconst hardcoded = 'hunter2-not-a-secret-value';\n`,
    'b.mjs': `console.log(process.env.PORT);\nconsole.log(process.env.PORT);\n`,
  }));
  assertValid(s);
  assert.deepEqual(s.env.map((e) => e.name), ['API_SECRET', 'DB_URL', 'HOST', 'NODE_ENV', 'OPTIONAL', 'PORT']);
  const port = s.env.find((e) => e.name === 'PORT');
  assert.equal(port.readCount, 3);
  assert.deepEqual(port.reads.map((r) => `${r.file}:${r.line}`), ['a.mjs:2', 'b.mjs:1', 'b.mjs:2']);
  const secretValueRun = spawnSync(process.execPath, ['-e', 'console.log(process.env.API_SECRET)'], { env: { ...process.env, API_SECRET: 'sk-live-should-never-appear' }, encoding: 'utf8' });
  assert.match(secretValueRun.stdout, /sk-live/);
  const json = JSON.stringify(summarizeBackend(project({ 'a.mjs': 'const k = process.env.API_SECRET;\n' })));
  assert.ok(!json.includes('sk-live'), 'a value is never read');
});

test('effects: fs, child_process, network and timers with file:line, only when bound to the real module', () => {
  const s = summarizeBackend(project({
    'a.mjs': `import fs from 'node:fs';
import { readFileSync } from 'fs';
import { promises as fsp } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import axios from 'axios';
fs.writeFileSync('a', 'b');
readFileSync('c');
await fsp.readFile('d');
spawn('ls');
execFileSync('ls');
http.request('http://x');
await fetch('http://y');
setInterval(() => {}, 5);
setTimeout(() => {}, 5);
new WebSocketServer({});
axios.get('http://z');
`,
    'shadow.mjs': `function f(fs, setTimeout, fetch) { fs.readFileSync('x'); setTimeout(() => {}); fetch('u'); }\nconst spawn = () => {};\nspawn('ls');\n`,
  }));
  assertValid(s);
  const list = s.effects.list.filter((e) => e.file === 'a.mjs').map((e) => `${e.kind}:${e.op}@${e.line}`);
  assert.deepEqual(list, [
    'fs:writeFileSync@8', 'fs:readFileSync@9', 'fs:readFile@10', 'child_process:spawn@11', 'child_process:execFileSync@12',
    'network:http.request@13', 'network:fetch@14', 'timer:setInterval@15', 'timer:setTimeout@16', 'network:websocket-server@17', 'network:axios.get@18',
  ]);
  assert.equal(s.effects.list.filter((e) => e.file === 'shadow.mjs').length, 0, 'a local `fs`, `spawn` or `fetch` is not the module');
  assert.deepEqual(s.effects.counts, { fs: 3, child_process: 2, network: 4, timer: 2 });
  assert.deepEqual(s.files.list.find((f) => f.path === 'a.mjs').effects, { fs: 3, child_process: 2, network: 4, timer: 2 });
});

// ---------------------------------------------------------------------------------------------- guarantees

test('determinism: the same tree gives the same document, wherever it lives; paths are project-relative', () => {
  const a = project(APP);
  const b = project(APP);
  const sa = summarizeBackend(a);
  const sb = summarizeBackend(b);
  assert.deepEqual(sa, summarizeBackend(a));
  assert.equal(JSON.stringify(sa), JSON.stringify(sb), 'independent of the absolute location');
  assert.ok(!JSON.stringify(sa).includes(a), 'no absolute path anywhere');
  assert.ok(!JSON.stringify(sa).includes(path.dirname(a)));
  assert.equal(renderBackendText(sa), renderBackendText(sb));
});

test('read-only: the target tree is byte-identical afterwards, links are not followed', () => {
  const outside = project({ 'leak.mjs': `import express from 'express';\nexport const r = express.Router();\nr.get('/leaked', () => {});\n` });
  const dir = project({ ...APP, 'architecture.yml': 'version: 1\n' });
  fs.symlinkSync(outside, path.join(dir, 'linked'));
  const before = hashTree(dir);
  const s = summarizeBackend(dir);
  summarizeBackend(dir);
  assert.equal(hashTree(dir), before);
  assert.ok(!JSON.stringify(s).includes('leak'), 'a symbolic link that leaves the directory is skipped');
});

test('bounds: lists are cut to their limits, counts stay true and `truncated` says what was left out', () => {
  const many = Array.from({ length: BACKEND_LIMITS.routes + 25 }, (_, i) => `app.get('/r${i}', (q, r) => {});`).join('\n');
  const s = summarizeBackend(project({ 'a.mjs': `import express from 'express';\nconst app = express();\n${many}\n` }));
  assertValid(s);
  assert.equal(s.counts.routes, BACKEND_LIMITS.routes + 25);
  assert.equal(s.routes.length, BACKEND_LIMITS.routes);
  assert.equal(s.truncated.routes, 25);
});

test('errors: a missing directory is a usage error; a backend.dir outside the project is refused', () => {
  assert.throws(() => summarizeBackend(path.join(makeTempDir('construct-backend-'), 'nope')), /not found/);
  const dir = project({ 'architecture.yml': 'backend:\n  dir: ../elsewhere\n' });
  assert.throws(() => resolveBackendDir(dir), /leaves the project root/);
  const ok = project({ 'architecture.yml': 'backend:\n  dir: server\n', 'server/a.mjs': 'export const a = 1;\n' });
  assert.equal(resolveBackendDir(ok), path.join(ok, 'server'));
  assert.equal(resolveBackendDir(project({ 'architecture.yml': 'version: 1\n' })).length > 0, true);
});

test('unparsable files are listed, never fatal', () => {
  const s = summarizeBackend(project({ 'bad.mjs': 'export const = ;;\n', 'ok.mjs': 'export const a = 1;\n' }));
  assert.ok(s.detection.notDetected.some((n) => n.what === 'file' && n.file === 'bad.mjs' && /parse error/.test(n.detail)));
  assert.equal(s.files.list.length, 2);
});

// ---------------------------------------------------------------------------------------------- the CLI

test('cli: summarize --backend prints the human view, --format json the schema-valid document, no write', () => {
  const dir = project({ ...APP, 'architecture.yml': 'version: 1\n' });
  const before = hashTree(dir);
  const text = run(['summarize', '--backend', dir], REPO);
  assert.equal(text.status, EXIT_CODES.OK, text.stderr);
  assert.match(text.stdout, /^Backend summary: \./);
  assert.match(text.stdout, /GET\s+\/api\/notes\/:id\/tags/);
  assert.match(text.stdout, /ROLES \(/);
  assert.match(text.stdout, /EFFECTS/);
  const json = run(['summarize', '--backend', dir, '--format', 'json'], REPO);
  assert.equal(json.status, EXIT_CODES.OK, json.stderr);
  const doc = JSON.parse(json.stdout);
  assert.equal(doc.schema, 'backend-summary.v1');
  assertValid(doc);
  assert.equal(doc.counts.routes, 13);
  assert.equal(hashTree(dir), before);
});

test('cli: --backend without a directory reads backend.dir from architecture.yml; a missing directory exits with a usage error', () => {
  const dir = project({ 'architecture.yml': 'backend:\n  dir: server\n', 'server/a.mjs': `import express from 'express';\nconst app = express();\napp.get('/x', () => {});\n` });
  const r = run(['summarize', '--backend', '--format', 'json'], dir);
  assert.equal(r.status, EXIT_CODES.OK, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.dir, 'server');
  assert.deepEqual(doc.routes.map((x) => x.file), ['server/a.mjs']);
  const missing = run(['summarize', '--backend', path.join(dir, 'nope')], REPO);
  assert.equal(missing.status, EXIT_CODES.USAGE_ERROR);
  assert.match(missing.stderr + missing.stdout, /not found/);
});

// ---------------------------------------------------------------------------------------------- the real thing

test('dogfood: ui/server/src, every registration line in the source is a detected route or middleware, none invented', () => {
  const dir = path.join(REPO, 'ui', 'server', 'src');
  const s = summarizeBackend(dir);
  assertValid(s);
  assert.equal(s.detection.framework, 'express');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs') && !/\.(test|cases|fixture|golden)\./.test(f));
  const re = /\b(app|router)\.(get|post|put|patch|delete|all|use)\(/;
  const methodSites = new Set();
  const useSites = new Set();
  for (const f of files) {
    fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
      const m = re.exec(line);
      if (m && !/^\s*(\/\/|\*)/.test(line)) (m[2] === 'use' ? useSites : methodSites).add(`ui/server/src/${f}:${i + 1}`);
    });
  }
  const detectedRoutes = new Set(s.routes.map((r) => `${r.file}:${r.line}`));
  const detectedUse = new Set([...s.middleware.map((m) => `${m.file}:${m.line}`), ...s.mounts.map((m) => `${m.from.file}:${m.from.line}`)]);
  assert.deepEqual([...methodSites].filter((k) => !detectedRoutes.has(k)), [], 'route registrations the summary missed');
  assert.deepEqual([...detectedRoutes].filter((k) => !methodSites.has(k)), [], 'routes the summary invented');
  assert.deepEqual([...useSites].filter((k) => !detectedUse.has(k)), [], 'use() registrations the summary missed');
  assert.ok(s.routes.length >= 100 && s.mounts.length >= 10);
  assert.equal(s.unmounted.length, 0, 'every router is mounted by the app');
  const health = s.routes.find((r) => r.path === '/api/health');
  assert.equal(health.file, 'ui/server/src/index.mjs');
  assert.ok(s.routes.some((r) => r.path === '/api/notes/:id' && r.method === 'PUT' && r.file.endsWith('notesApi.mjs')), 'a router mounted with a prefix resolves to its full path');
  assert.ok(s.routes.some((r) => r.path === '/auth/login' && r.file.endsWith('auth.mjs')), 'auth.mountRoutes(app) is followed through the factory object');
});
