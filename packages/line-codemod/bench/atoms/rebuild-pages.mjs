// Rebuilds the two published bench pages (the Atoms page and the JavaScript reference) and checks them, in one command.
//
//   node bench/atoms/rebuild-pages.mjs           build Smith if stale, run both builders, check, print the paths to publish
//   node bench/atoms/rebuild-pages.mjs --check   only check the existing outputs; exit 1 with one sentence on a mismatch
//
// The check: both index.html files exist, and the JSON each embeds (`<script id="data">`) holds as many atoms as
// Smith's catalog.json and as many entries as js-reference/reference.json. Both outputs are git-ignored (site/ folders).
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../..');
const smithDir = process.env.SMITH_DIR ?? join(repoRoot, 'packages/line-smith');

/** The default inputs and outputs, all absolute. */
export const PATHS = {
  catalog: join(smithDir, 'src/atoms/catalog.json'),
  reference: join(here, 'js-reference/reference.json'),
  atomsPage: join(here, 'atoms-page/site/index.html'),
  referencePage: join(here, 'js-reference/site/index.html'),
};

/**
 * The JSON a page embeds in its `<script type="application/json" id="data">` element.
 * @param {string} html
 * @returns {any}
 */
export function embeddedData(html) {
  const m = html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no embedded data');
  return JSON.parse(m[1]);
}

/**
 * Checks both pages against their sources. Returns the counts and, on a mismatch, one sentence saying what is wrong.
 * @param {{ catalog: string, reference: string, atomsPage: string, referencePage: string }} [paths]
 * @returns {{ ok: boolean, message: string, counts: { catalog: number, atomsPage: number|null, reference: number, referencePage: number|null } }}
 */
export function checkPages(paths = PATHS) {
  const catalog = JSON.parse(readFileSync(paths.catalog, 'utf8')).atoms.length;
  const reference = JSON.parse(readFileSync(paths.reference, 'utf8')).entries.length;
  const counts = { catalog, atomsPage: null, reference, referencePage: null };
  const read = (file, pick) => {
    if (!existsSync(file)) return { error: `${file} does not exist` };
    try { return { n: pick(embeddedData(readFileSync(file, 'utf8'))) }; } catch (e) { return { error: `${file} has no readable embedded data (${e.message})` }; }
  };
  const atoms = read(paths.atomsPage, (d) => d.atoms.length);
  const ref = read(paths.referencePage, (d) => d.items.length);
  counts.atomsPage = atoms.n ?? null;
  counts.referencePage = ref.n ?? null;
  const problems = [
    atoms.error ?? (atoms.n !== catalog ? `the Atoms page has ${atoms.n} atoms but the catalog has ${catalog}` : null),
    ref.error ?? (ref.n !== reference ? `the JavaScript reference page has ${ref.n} entries but reference.json has ${reference}` : null),
  ].filter(Boolean);
  const message = problems.length
    ? `${problems.join('; and ')}; run node bench/atoms/rebuild-pages.mjs.`.replace(/^./, (c) => c.toUpperCase())
    : `Atoms page: ${catalog} atoms; JavaScript reference: ${reference} entries.`;
  return { ok: problems.length === 0, message, counts };
}

/** Newest modification time under a folder, in ms (0 if missing). */
function newest(dir) {
  if (!existsSync(dir)) return 0;
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
}

/** True when Smith's dist/ is missing or older than its src/. */
export function smithStale(dir = smithDir) {
  const index = join(dir, 'dist/index.js');
  return !existsSync(index) || newest(join(dir, 'src')) > statSync(index).mtimeMs;
}

function main(argv) {
  if (!argv.includes('--check')) {
    if (smithStale()) {
      console.log('Building Smith (dist/ missing or older than src/)...');
      execFileSync('npm', ['run', 'build'], { cwd: smithDir, stdio: 'inherit' });
    }
    execFileSync(process.execPath, [join(here, 'atoms-page/build.mjs')], { stdio: 'inherit' });
    execFileSync(process.execPath, [join(here, 'js-reference/site.mjs')], { stdio: 'inherit' });
  }
  const result = checkPages();
  console.log(result.message);
  if (!result.ok) return 1;
  if (!argv.includes('--check')) console.log(`Publish:\n  ${PATHS.atomsPage}\n  ${PATHS.referencePage}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
