// Line's functional atoms (owner, 2026-10-14, option C): @line/atoms re-exports the plain-function atoms of the pinned
// Smith (smith-functional's src/atoms, the commit packages/line-links/smith-functional.json pins), so an app imports
// `{ plus, join } from '@line/atoms'` and its bundler drops the atoms it does not use. The files under functional/ are
// generated from that commit, never written by hand: each carries a header naming the commit, and PIN.json lists them.
// An app gets them as a copy in its library atoms (Import v2's line.import.writeAtoms), with a tsconfig alias
// `@line/atoms` pointing at the copy; nothing is published.
//
//   FUNCTIONAL_DIR, FUNCTIONAL_PIN    where the snapshot lives and the commit it was taken at
//   functionalFiles()                 every snapshot file, {rel, content}, as an app's copy gets them
//   snapshotFunctional(o)             the snapshot as the pinned commit gives it (git, no write)
//   node packages/line-atoms/runtime.mjs --write    regenerate functional/ from the pinned commit
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Where the generated functional atoms live (an app's copy has the same files). */
export const FUNCTIONAL_DIR = path.join(HERE, 'functional');
/** The link table that pins the atom runtime (the same pin the Import v2 breakdown checks against). */
export const FUNCTIONAL_TABLE = path.join(HERE, '..', 'line-links', 'smith-functional.json');
/** The folder of smith-functional the snapshot is taken from. */
export const FUNCTIONAL_FROM = 'src/atoms';
const PIN_FILE = 'PIN.json';

/**
 * The commit the snapshot was taken at and its files, from functional/PIN.json.
 * @returns {{repo: string, commit: string, from: string, files: string[]}}
 */
export function functionalPin() {
  return JSON.parse(fs.readFileSync(path.join(FUNCTIONAL_DIR, PIN_FILE), 'utf8'));
}

/** The snapshot's commit (functional/PIN.json), or null before the first --write. */
export const FUNCTIONAL_PIN = (() => { try { return functionalPin().commit; } catch { return null; } })();

/**
 * The header every generated file starts with.
 * @param {string} commit
 * @param {string} rel The file's path under src/atoms.
 * @returns {string}
 */
export const functionalHeader = (commit, rel) => `// @line-atoms functional ${commit.slice(0, 7)}: generated from smith-functional ${FUNCTIONAL_FROM}/${rel} by packages/line-atoms/runtime.mjs --write; do not edit.\n`;

/**
 * Every snapshot file, sorted, as an app's copy gets them (PIN.json is the snapshot's own record, not app code).
 * @returns {{rel: string, content: string}[]}
 */
export function functionalFiles() {
  return functionalPin().files.map((rel) => ({ rel, content: fs.readFileSync(path.join(FUNCTIONAL_DIR, rel), 'utf8') }));
}

/**
 * The snapshot as the pinned commit gives it: every .ts file of src/atoms, each under its header. Reads git; writes
 * nothing. Throws when the source folder or the commit is missing.
 * @param {{sourceDir?: string, commit?: string}} [o] Defaults: the link table's source folder (its env override, else
 *   its default folder) and commit.
 * @returns {{repo: string, commit: string, files: {rel: string, content: string}[]}}
 */
export function snapshotFunctional(o = {}) {
  const table = JSON.parse(fs.readFileSync(FUNCTIONAL_TABLE, 'utf8'));
  const commit = o.commit ?? table.source.commit;
  const dir = o.sourceDir ?? process.env[table.source.env] ?? String(table.source.default).replace(/^~(?=\/|$)/, os.homedir());
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const rels = git('ls-tree', '-r', '--name-only', commit, '--', FUNCTIONAL_FROM).split('\n').filter((f) => f.endsWith('.ts')).map((f) => f.slice(FUNCTIONAL_FROM.length + 1)).sort();
  return { repo: table.source.repo, commit, files: rels.map((rel) => ({ rel, content: functionalHeader(commit, rel) + git('show', `${commit}:${FUNCTIONAL_FROM}/${rel}`) })) };
}

/**
 * Regenerate functional/ from the pinned commit: the files, then PIN.json. Files no longer in the commit are removed.
 * @param {{sourceDir?: string, commit?: string}} [o]
 * @returns {{commit: string, files: number}}
 */
export function writeFunctional(o = {}) {
  const snap = snapshotFunctional(o);
  fs.rmSync(FUNCTIONAL_DIR, { recursive: true, force: true });
  for (const f of snap.files) {
    fs.mkdirSync(path.dirname(path.join(FUNCTIONAL_DIR, f.rel)), { recursive: true });
    fs.writeFileSync(path.join(FUNCTIONAL_DIR, f.rel), f.content);
  }
  fs.writeFileSync(path.join(FUNCTIONAL_DIR, PIN_FILE), `${JSON.stringify({ repo: snap.repo, commit: snap.commit, from: FUNCTIONAL_FROM, files: snap.files.map((f) => f.rel) }, null, 2)}\n`);
  return { commit: snap.commit, files: snap.files.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && process.argv.includes('--write')) {
  const r = writeFunctional();
  console.log(`wrote ${r.files} files of smith-functional ${FUNCTIONAL_FROM} at ${r.commit.slice(0, 7)} into packages/line-atoms/functional`);
}
