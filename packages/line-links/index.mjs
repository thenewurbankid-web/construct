// cu1 -- Line links: Construct uses @mx/reason, @mx/plan, @mx/gatelm and Morpheus's render straight from their own git
// repo (vision-architect-pipeline, "linked first, moved later"). Nothing is copied and nothing is installed:
//
//   links.json     package name -> folder and entry file inside the source repo, plus the pinned source commit.
//   linkStatus()   finds the source folder ($LINE_SOURCE_DIR, else links.json's default), reads its HEAD from the git
//                  files (no git process), and says per package whether it can be loaded, in one plain-English sentence.
//   importLinked() loads one package through in-process module hooks (./hooks.mjs): `@mx/<name>` resolves to the
//                  entry file, `./x.js` inside the source resolves to `./x.ts`, and the TypeScript is transformed by
//                  Node's own `module.stripTypeScriptTypes`. Third-party imports resolve from the source repo's own
//                  node_modules, exactly as they do there.
//
// No single point of failure: nothing here throws for a missing or moved source. `importLinked` answers
// `{ ok: false, reason }` and every caller keeps its static path (see packages/core/line-decide.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Where the link table lives. */
export const LINKS_FILE = path.join(HERE, 'links.json');

/**
 * @typedef {{ path: string, entry: string, what?: string, watch?: string[] }} LinkEntry
 * @typedef {{ source: { repo: string, branch?: string, env: string, default: string, commit: string }, links: Record<string, LinkEntry> }} LinkTable
 * @typedef {'ok' | 'missing-source' | 'not-a-repo' | 'wrong-commit' | 'missing-entry'} LinkState
 * @typedef {{ name: string, state: LinkState, ok: boolean, entryFile: string | null, message: string }} PackageLink
 * @typedef {{ ok: boolean, sourceDir: string, head: string | null, pinned: string, drift: boolean, packages: PackageLink[], message: string }} LinkStatus
 */

/**
 * Read the link table.
 * @param {string} [file] Defaults to this package's links.json.
 * @returns {LinkTable}
 */
export function readLinks(file = LINKS_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const expandHome = (p) => (p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);

/**
 * The source repo folder: the env var named in links.json when set, else its default, `~` expanded.
 * @param {LinkTable} table
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} An absolute path (it may not exist).
 */
export function sourceDirOf(table, env = process.env) {
  const given = env[table.source.env];
  return path.resolve(expandHome(given && given.trim() ? given.trim() : table.source.default));
}

const readText = (file) => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; } };
const SHA = /^[0-9a-f]{40}$/;

/**
 * The commit checked out in `dir`, read from its git files (a plain clone or a worktree), or null when `dir` is not a
 * git checkout. No git process runs.
 * @param {string} dir
 * @returns {string | null} A 40-character sha.
 */
export function readHeadCommit(dir) {
  let gitDir = path.join(dir, '.git');
  const pointer = readText(gitDir);
  if (pointer !== null && pointer.startsWith('gitdir:')) gitDir = path.resolve(dir, pointer.slice('gitdir:'.length).trim());
  const head = readText(path.join(gitDir, 'HEAD'));
  if (head === null) return null;
  if (SHA.test(head)) return head;
  const ref = /^ref:\s*(.+)$/.exec(head)?.[1];
  if (!ref) return null;
  const common = readText(path.join(gitDir, 'commondir'));
  const dirs = [gitDir, ...(common ? [path.resolve(gitDir, common)] : [])];
  for (const d of dirs) {
    const loose = readText(path.join(d, ref));
    if (loose && SHA.test(loose)) return loose;
  }
  for (const d of dirs) {
    const packed = readText(path.join(d, 'packed-refs'));
    const line = packed?.split('\n').find((l) => l.endsWith(` ${ref}`));
    if (line && SHA.test(line.slice(0, 40))) return line.slice(0, 40);
  }
  return null;
}

const short = (sha) => (sha ? sha.slice(0, 7) : 'unknown');

/**
 * Where each linked package stands, in plain English. Never throws.
 * @param {{ table?: LinkTable, env?: NodeJS.ProcessEnv }} [options]
 * @returns {LinkStatus}
 */
export function linkStatus(options = {}) {
  const env = options.env ?? process.env;
  const table = options.table ?? readLinks();
  const sourceDir = sourceDirOf(table, env);
  const pinned = table.source.commit;
  const names = Object.keys(table.links);
  const allowDrift = env.LINE_LINKS_ALLOW_DRIFT === '1';
  const all = (state, message) => names.map((name) => ({ name, state, ok: false, entryFile: null, message: message(name) }));
  const finish = (packages, head, drift, summary) => ({ ok: packages.every((p) => p.ok), sourceDir, head, pinned, drift, packages, message: summary });
  if (!fs.existsSync(sourceDir)) {
    const why = `the source folder ${sourceDir} is missing (set ${table.source.env} to a ${table.source.repo} checkout)`;
    return finish(all('missing-source', (n) => `${n} is not linked because ${why}, so Construct uses its static path.`), null, false,
      `Line links are off because ${why}; Construct runs on its static path.`);
  }
  const head = readHeadCommit(sourceDir);
  if (head === null) {
    const why = `${sourceDir} is not a git checkout of ${table.source.repo}`;
    return finish(all('not-a-repo', (n) => `${n} is not linked because ${why}, so Construct uses its static path.`), null, false,
      `Line links are off because ${why}; Construct runs on its static path.`);
  }
  // The source repo gets docs-only commits all day; a new HEAD whose linked folders are byte-identical to the pinned
  // commit's is the same code, so it stays linked instead of switching every link off.
  const drift = head !== pinned && !sameLinkedCode(sourceDir, pinned, head, table);
  if (drift && !allowDrift) {
    const why = `the source is at commit ${short(head)} but links.json pins ${short(pinned)} (run "node packages/line-links/link.mjs --pin" after checking the change, or set LINE_LINKS_ALLOW_DRIFT=1)`;
    return finish(all('wrong-commit', (n) => `${n} is not linked because ${why}.`), head, true,
      `Line links are off because ${why}; Construct runs on its static path.`);
  }
  const packages = names.map((name) => {
    const link = table.links[name];
    const entryFile = path.join(sourceDir, link.path, link.entry);
    if (!fs.existsSync(entryFile)) return { name, state: /** @type {LinkState} */ ('missing-entry'), ok: false, entryFile: null, message: `${name} is not linked because ${path.join(link.path, link.entry)} is missing in the source, so Construct uses its static path.` };
    return { name, state: /** @type {LinkState} */ ('ok'), ok: true, entryFile, message: `${name} is linked from ${path.join(link.path, link.entry)} at commit ${short(head)}${drift ? ' (not the pinned commit, allowed by LINE_LINKS_ALLOW_DRIFT)' : ''}.` };
  });
  const linked = packages.filter((p) => p.ok).length;
  return finish(packages, head, drift, linked === packages.length
    ? `${linked === 1 ? `The ${table.source.repo} link is` : `All ${linked} Line links are`} ready from ${sourceDir} at commit ${short(head)}.`
    : `${linked} of ${packages.length} Line links are ready; the others use Construct's static path.`);
}

/**
 * Whether the linked folders (each link's `path`, plus any `watch` folders it imports from) are identical at the
 * pinned commit and at HEAD. One `git diff --quiet` in the source repo; false when git is missing or the pinned
 * commit is unknown there, so an unexplained move is still reported.
 * @param {string} sourceDir @param {string} pinned @param {string} head @param {LinkTable} table
 * @returns {boolean}
 */
export function sameLinkedCode(sourceDir, pinned, head, table) {
  const paths = [...new Set(Object.values(table.links).flatMap((l) => [l.path, ...(l.watch ?? [])]))];
  const r = spawnSync('git', ['-C', sourceDir, 'diff', '--quiet', pinned, head, '--', ...paths], { stdio: 'ignore', timeout: 10000 });
  return r.status === 0;
}

let hooksModule = null;
const loaded = new Map();

/**
 * Load one linked package (e.g. `@mx/plan`). Never throws: a missing source, a wrong commit or a load error answers
 * `{ ok: false, reason }` with one plain-English sentence, and the caller keeps its static path. A successful load is
 * cached per process.
 * @param {string} name A name from links.json.
 * @param {{ table?: LinkTable, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<{ ok: true, module: any, link: PackageLink } | { ok: false, reason: string }>}
 */
export async function importLinked(name, options = {}) {
  let status;
  try { status = linkStatus(options); } catch (e) {
    return { ok: false, reason: `${name} is not linked because links.json could not be read (${String(e?.message ?? e).split('\n')[0]}), so Construct uses its static path.` };
  }
  const link = status.packages.find((p) => p.name === name);
  if (!link) return { ok: false, reason: `${name} is not in packages/line-links/links.json, so it cannot be linked.` };
  if (!link.ok || !link.entryFile) return { ok: false, reason: link.message };
  const key = link.entryFile;
  if (loaded.has(key)) return { ok: true, module: loaded.get(key), link };
  try {
    hooksModule ??= await import('./hooks.mjs');
    hooksModule.installLinkHooks();
    hooksModule.addLinkRoot(status.sourceDir);
    for (const p of status.packages) if (p.ok && p.entryFile) hooksModule.addLinkName(p.name, p.entryFile);
    const mod = await import(pathToFileURL(link.entryFile).href);
    loaded.set(key, mod);
    return { ok: true, module: mod, link };
  } catch (e) {
    const first = String(e?.message ?? e).split('\n')[0].slice(0, 200);
    return { ok: false, reason: `${name} could not be loaded from the source (${first}), so Construct uses its static path.` };
  }
}
