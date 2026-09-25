// Module roles for `construct summarize --backend` (#634): each backend file is classified as route, store, service, auth,
// job, util, config, test or other, by naming convention and content signals, with the reason for each verdict, and
// overridable through a `backend:` section of architecture.yml (globs to role). Deterministic, no model. This is a
// label for reading, not a rule: nothing here restricts what may import what.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { matchGlob } from './glob.mjs';

/**
 * The roles a backend file can have, in the order overrides are tried and reports are grouped. `other` is what no
 * signal claims (never a guess).
 *
 * @type {readonly string[]}
 */
export const BACKEND_ROLES = Object.freeze(['route', 'store', 'service', 'auth', 'job', 'util', 'config', 'test', 'other']);

// Words (a file name split at camelCase, dots, dashes and underscores) that name a role.
const NAME_WORDS = [
  ['auth', ['auth', 'authn', 'authz', 'session', 'sessions', 'login', 'oauth', 'jwt', 'passport', 'token', 'tokens', 'csrf', 'acl', 'rbac', 'credentials']],
  ['job', ['job', 'jobs', 'worker', 'workers', 'queue', 'queues', 'cron', 'scheduler', 'schedule', 'runner', 'runners', 'daemon']],
  ['store', ['store', 'stores', 'repo', 'repository', 'repositories', 'db', 'database', 'storage', 'cache', 'persist', 'persistence', 'model', 'models', 'dao']],
  ['service', ['service', 'services', 'client', 'provider', 'adapter', 'gateway', 'integration', 'mailer', 'notifier']],
  ['config', ['config', 'configuration', 'settings', 'env', 'constants', 'options']],
  ['util', ['util', 'utils', 'helper', 'helpers', 'lib', 'common', 'shared']],
];
// A file named like this is the API surface, whatever else its name says (`authRoutes.js` is a route file, `auth.js` is auth).
const ROUTE_WORDS = ['api', 'route', 'routes', 'router', 'routers', 'controller', 'controllers', 'handler', 'handlers'];
// Folder names (any ancestor folder below the scanned directory) that name a role.
const DIR_WORDS = {
  route: ['routes', 'routers', 'controllers', 'handlers', 'api'],
  store: ['stores', 'models', 'db', 'repositories', 'persistence'],
  service: ['services', 'clients', 'providers', 'adapters'],
  auth: ['auth'],
  job: ['jobs', 'workers', 'queues', 'tasks'],
  util: ['utils', 'helpers', 'lib', 'middleware', 'middlewares'],
  config: ['config', 'configs'],
};
const TEST_FILE = /(^|[.\-_])(test|spec|cases|fixture|fixtures|golden)([.\-_]|$)/i;
const TEST_DIRS = new Set(['test', 'tests', '__tests__', '__mocks__', 'e2e', 'fixtures']);

/** Words of a file's base name: `cloneAuth.mjs` is `['clone', 'auth']`, `notes-store.js` is `['notes', 'store']`. */
function wordsOf(base) {
  return base
    .replace(/\.[^.]+$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/**
 * Read the `backend:` section of `<root>/architecture.yml`: `dir` (the default directory for `summarize --backend`, project-relative)
 * and `roles` (a map from a role to one glob or a list of globs, project-relative, `*` and `**` as in every Construct glob).
 * Read on its own so a project with no other Construct configuration works, and validated so a typo fails loudly.
 *
 * @param {string} root Project root (where `architecture.yml` lives, if there is one).
 * @returns {{dir: string|null, roles: Record<string, string[]>}} The section, normalised; empty when the file or the section is absent.
 * @throws {Error} A usage error when the file is not YAML, the section is not a mapping, a role is not one of `BACKEND_ROLES`, or a glob is not a string.
 *
 * @example
 * readBackendConfig('/work/app'); // => { dir: 'server/src', roles: { store: ['server/src/db/**'] } }
 */
export function readBackendConfig(root) {
  const file = path.join(root, 'architecture.yml');
  if (!fs.existsSync(file)) return { dir: null, roles: {} };
  const usage = (message) => new ConstructError(`Invalid 'backend' section in architecture.yml: ${message}`, { exitCode: EXIT_CODES.USAGE_ERROR });
  let doc;
  try {
    doc = yaml.load(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new ConstructError(`Failed to parse architecture.yml: ${e.message}`, { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const section = doc && typeof doc === 'object' ? doc.backend : undefined;
  if (section === undefined || section === null) return { dir: null, roles: {} };
  if (typeof section !== 'object' || Array.isArray(section)) throw usage('it must be a mapping with `dir` and `roles`.');
  if (section.dir !== undefined && (typeof section.dir !== 'string' || !section.dir)) throw usage('`dir` must be a project-relative directory string.');
  const roles = {};
  const rawRoles = section.roles ?? {};
  if (typeof rawRoles !== 'object' || Array.isArray(rawRoles)) throw usage('`roles` must map a role to a glob or a list of globs.');
  for (const [role, globs] of Object.entries(rawRoles)) {
    if (!BACKEND_ROLES.includes(role) || role === 'other') throw usage(`unknown role '${role}' (expected one of: ${BACKEND_ROLES.filter((r) => r !== 'other').join(', ')}).`);
    const list = Array.isArray(globs) ? globs : [globs];
    if (list.some((g) => typeof g !== 'string' || !g)) throw usage(`the globs of '${role}' must be strings.`);
    roles[role] = list;
  }
  return { dir: section.dir ?? null, roles };
}

/**
 * The role of one file, with the reason. Order: a config override, then the test convention, then the express app file,
 * then naming (a route word such as `Api` or `Routes` first, then auth, job, store, service, config, util words), then
 * content that registers routes or exports a router, then folder names, then the remaining content signals (serves
 * WebSockets: route; spawns processes or calls the network: service; writes files: store; only reads files: service;
 * timers: job; only reads environment variables: config; exports and touches nothing: util), else `other`.
 *
 * @param {object} file What is known about the file.
 * @param {string} file.rel Project-relative path.
 * @param {string} file.dirRel Path relative to the scanned directory (folder names are read from this).
 * @param {boolean} file.isTest Whether its name or folder is a test convention.
 * @param {{routes: number, isApp: boolean, exportsRouter: boolean}} file.routing Routes registered in the file, whether it creates the express app, whether it exports a router.
 * @param {Record<string, number>} file.effects Effect counts by kind (`fs`, `child_process`, `network`, `timer`).
 * @param {{fsWrites?: number, wsServer?: boolean}} [file.signals] Finer signals: how many fs calls write, and whether it creates a WebSocket server.
 * @param {number} file.envReads How many `process.env` reads.
 * @param {number} file.exportCount How many names it exports.
 * @param {Record<string, string[]>} overrides The `backend.roles` globs from architecture.yml.
 * @returns {{role: string, reason: string, source: 'config'|'test'|'content'|'name'|'folder'|'default'}} The verdict.
 *
 * @example
 * classifyBackendFile({ rel: 'src/notesStore.mjs', dirRel: 'notesStore.mjs', isTest: false, routing: { routes: 0, isApp: false, exportsRouter: false }, effects: { fs: 3 }, envReads: 0, exportCount: 2 }, {});
 * // => { role: 'store', reason: 'name: "store" in the file name', source: 'name' }
 */
export function classifyBackendFile(file, overrides = {}) {
  for (const role of BACKEND_ROLES) {
    for (const glob of overrides[role] ?? []) {
      if (matchGlob(glob, file.rel)) return { role, reason: `config: backend.roles.${role} matches '${glob}'`, source: 'config' };
    }
  }
  if (file.isTest) return { role: 'test', reason: 'test naming convention (name or folder)', source: 'test' };
  const { routes, isApp, exportsRouter } = file.routing;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (isApp) return { role: 'route', reason: `content: creates the express app${routes ? ` and registers ${plural(routes, 'route')}` : ''}`, source: 'content' };
  const base = path.posix.basename(file.rel);
  const words = wordsOf(base);
  const routeWord = words.find((w) => ROUTE_WORDS.includes(w));
  if (routeWord) return { role: 'route', reason: `name: "${routeWord}" in the file name`, source: 'name' };
  for (const [role, list] of NAME_WORDS) {
    const hit = words.find((w) => list.includes(w));
    if (hit) return { role, reason: `name: "${hit}" in the file name`, source: 'name' };
  }
  if (routes > 0 || exportsRouter) return { role: 'route', reason: `content: ${routes > 0 ? `registers ${plural(routes, 'route')} on an express router` : 'exports an express router'}`, source: 'content' };
  const dirs = path.posix.dirname(file.dirRel).split('/').filter((d) => d && d !== '.').map((d) => d.toLowerCase());
  for (const [role, list] of Object.entries(DIR_WORDS)) {
    const hit = dirs.find((d) => list.includes(d));
    if (hit) return { role, reason: `folder: "${hit}/"`, source: 'folder' };
  }
  if (file.signals?.wsServer) return { role: 'route', reason: 'content: serves WebSocket connections', source: 'content' };
  const { fs: nFs = 0, child_process: nCp = 0, network: nNet = 0 } = file.effects;
  if (nCp > 0) return { role: 'service', reason: `content: spawns ${nCp} child process${nCp === 1 ? '' : 'es'}`, source: 'content' };
  if (nNet > 0) return { role: 'service', reason: `content: makes ${nNet} network call${nNet === 1 ? '' : 's'}`, source: 'content' };
  if (nFs > 0 && (file.signals?.fsWrites ?? 0) > 0) return { role: 'store', reason: `content: writes files (${plural(file.signals.fsWrites, 'write call')} of ${plural(nFs, 'fs call')})`, source: 'content' };
  if (nFs > 0) return { role: 'service', reason: `content: reads files (${plural(nFs, 'fs call')}), writes none`, source: 'content' };
  if ((file.effects.timer ?? 0) > 0 && file.exportCount > 0) return { role: 'job', reason: `content: schedules work with ${plural(file.effects.timer, 'timer')}`, source: 'content' };
  if (file.envReads > 0 && file.exportCount > 0) return { role: 'config', reason: `content: reads ${file.envReads} environment variable${file.envReads === 1 ? '' : 's'} and exports values`, source: 'content' };
  if (file.exportCount > 0 && Object.values(file.effects).every((n) => !n)) return { role: 'util', reason: 'content: exports functions and touches no file, process, network or timer', source: 'content' };
  return { role: 'other', reason: 'default: no route, effect, naming or folder signal', source: 'default' };
}

/**
 * Whether a path follows a test naming convention: `*.test.*`, `*.spec.*`, `*.cases.*`, `*.fixture.*`, `*.golden.*`, or a `test`, `tests`, `__tests__`, `e2e`, `fixtures` folder.
 *
 * @param {string} relToDir Path relative to the scanned directory, `/`-separated.
 * @returns {boolean} `true` for a test file.
 *
 * @example
 * isBackendTestPath('notes/notesStore.test.mjs'); // => true
 */
export function isBackendTestPath(relToDir) {
  const parts = relToDir.split('/');
  const base = parts[parts.length - 1];
  return TEST_FILE.test(base) || parts.slice(0, -1).some((d) => TEST_DIRS.has(d.toLowerCase()));
}
