// Line Import v2: does every import still resolve after a step? The logic map counts units, so a move that leaves its
// importers pointing at a deleted file can still read "all kept" (found on max-ai-ui /opportunity, iv2-mocks: 9
// importers named a file the step had deleted). This check reads every relative and tsconfig-alias specifier (imports,
// re-exports, import(), require() and jest's module calls) of the project's code files and resolves it the way the
// bundler would; a specifier that resolved before the import and resolves to nothing now is a broken import.
//
//   unresolvedImports(root, files)        every relative/alias specifier in `files` that names no file, with its line
//   brokenImports(root, files, baseline)  the ones that are new since `baseline` (an earlier unresolvedImports)
//
// Resolution is route-resolver.mjs's (readPathAliases + the same candidates) widened to every extension a Next.js or
// Vite app imports (.mjs, .cjs, .json, index.js, a `.js` specifier naming a `.ts` file). Pure read: nothing is written.
import fs from 'node:fs';
import path from 'node:path';
import { readPathAliases } from '@line/construct-core/route-resolver';

const CODE = /\.[cm]?[jt]sx?$/;
const EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.d.ts'];
/** Module specifiers: from, import(), require(), side-effect imports and jest's module calls. [whole, lead, quote, spec] */
const SPECIFIER = /(\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\bjest\.(?:mock|doMock|unmock|dontMock|setMock|requireActual|requireMock|createMockFromModule)\s*\(\s*|^\s*import\s+)(['"])([^'"\n]+)\2/gm;

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/** Block and line comments blanked out (same length, newlines kept), so a commented-out import is not read. */
function withoutComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

/**
 * Whether an absolute base path (as a specifier names it, maybe without its extension) is a file.
 * @param {string} base
 * @returns {boolean}
 */
function exists(base) {
  if (isFile(base)) return true;
  if (EXTS.some((x) => isFile(`${base}${x}`))) return true;
  if (EXTS.some((x) => isFile(path.join(base, `index${x}`)))) return true;
  // TypeScript ESM: `./x.js` names `./x.ts`.
  const m = /\.(m|c)?jsx?$/.exec(base);
  if (m) { const stem = base.slice(0, -m[0].length); if (['.ts', '.tsx', '.mts', '.cts'].some((x) => isFile(`${stem}${x}`))) return true; }
  return false;
}

/**
 * Every relative or alias specifier in `files` that resolves to no file.
 * @param {string} root The app (absolute).
 * @param {string[]} files App-relative files (non-code files are skipped).
 * @returns {{file: string, spec: string, line: number}[]}
 */
export function unresolvedImports(root, files) {
  const abs = path.resolve(root);
  const { aliases } = readPathAliases(abs);
  const out = [];
  for (const rel of files) {
    if (!CODE.test(rel) || rel.endsWith('.d.ts')) continue;
    let src;
    try { src = fs.readFileSync(path.join(abs, rel), 'utf8'); } catch { continue; }
    const text = withoutComments(src);
    for (const m of text.matchAll(SPECIFIER)) {
      const spec = m[3];
      let base = null;
      if (spec.startsWith('.')) base = path.resolve(path.dirname(path.join(abs, rel)), spec);
      else {
        const hit = aliases.find((a) => spec.startsWith(a.prefix));
        if (hit) base = path.join(hit.target, spec.slice(hit.prefix.length));
      }
      if (base === null || exists(base.replace(/[?#].*$/, ''))) continue;
      out.push({ file: rel, spec, line: text.slice(0, /** @type {number} */ (m.index) + m[1].length).split('\n').length });
    }
  }
  return out;
}

/**
 * The unresolved imports that are new since `baseline`: one that was already broken before the import (the same
 * specifier in a file of the same name) is the app's own, not the import's.
 * @param {string} root
 * @param {string[]} files
 * @param {{file: string, spec: string}[]} [baseline]
 * @returns {{file: string, spec: string, line: number}[]}
 */
export function brokenImports(root, files, baseline = []) {
  const had = new Set(baseline.map((b) => `${path.posix.basename(b.file)}|${b.spec}`));
  return unresolvedImports(root, files).filter((b) => !had.has(`${path.posix.basename(b.file)}|${b.spec}`));
}
