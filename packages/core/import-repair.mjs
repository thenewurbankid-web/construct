// #607 -- deterministic repair of relative imports a model got almost right. The commonest miss in an import run is
// case: the model writes `../services/ordersApi` for a file Construct generated as `OrdersApi.tsx`. That is not a
// judgement call, so it is fixed here (exact-case rewrite of a specifier that matches exactly one existing file
// ignoring case) instead of spending a model retry, and IMPORT-001 never sees it.
import fs from 'node:fs';
import path from 'node:path';

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'];
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"\n]*)\2/g;

function entriesOf(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

const isFile = (abs) => { try { return fs.statSync(abs).isFile(); } catch { return false; } };
const isDir = (abs) => { try { return fs.statSync(abs).isDirectory(); } catch { return false; } };

/**
 * Does `specifier` (relative to `fromDir`) already resolve to a file or a folder's index, spelled with the exact case
 * on disk? existsSync alone says yes to `ordersApi` for `OrdersApi.tsx` on a case-insensitive file system (macOS,
 * Windows), and that import then breaks on Linux and in bundlers, so every segment is matched against the folder's
 * real entries.
 */
function resolves(fromDir, specifier) {
  const parts = specifier.split('/');
  let dir = fromDir;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '.' || part === '..' || part === '') {
      dir = path.resolve(dir, part || '.');
      continue;
    }
    const names = entriesOf(dir);
    if (i === parts.length - 1) {
      if (names.includes(part) && isFile(path.join(dir, part))) return true;
      if (EXTENSIONS.some((e) => names.includes(part + e) && isFile(path.join(dir, part + e)))) return true;
      if (!names.includes(part) || !isDir(path.join(dir, part))) return false;
      const inside = entriesOf(path.join(dir, part));
      return EXTENSIONS.some((e) => inside.includes(`index${e}`));
    }
    if (!names.includes(part)) return false;
    dir = path.join(dir, part);
  }
  // `..`, `./` and other folder-only specifiers: the folder's index.
  return EXTENSIONS.some((e) => entriesOf(dir).includes(`index${e}`));
}

/** Resolve `specifier` one path segment at a time, matching each segment ignoring case, and return the exact-case spelling, or null when nothing (or more than one thing) matches. */
function exactCaseSpecifier(fromDir, specifier) {
  const parts = specifier.split('/');
  let dir = fromDir;
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '.' || part === '..') {
      out.push(part);
      dir = path.resolve(dir, part);
      continue;
    }
    const last = i === parts.length - 1;
    const names = entriesOf(dir);
    const wanted = part.toLowerCase();
    const matches = names.filter((n) => {
      const lower = n.toLowerCase();
      if (lower === wanted) return true;
      return last && EXTENSIONS.some((e) => lower === wanted + e);
    });
    const exact = matches.filter((n) => n === part || EXTENSIONS.some((e) => n === part + e));
    if (exact.length === 1) {
      out.push(part);
      dir = path.join(dir, part);
      continue;
    }
    if (matches.length !== 1) return null;
    const match = matches[0];
    const stem = last && !wanted.match(/\.\w+$/) ? match.replace(/\.(t|j)sx?$|\.mjs$|\.json$/, '') : match;
    out.push(stem);
    dir = path.join(dir, match);
  }
  return out.join('/');
}

/**
 * Rewrite relative imports in the given files whose spelling differs from an existing file only by case.
 * Imports that already resolve, or that match nothing (or several things), are left untouched.
 *
 * @param {string[]} files Absolute paths of the files to repair.
 * @returns {{file:string, from:string, to:string}[]} Every rewrite made, for the wizard to report.
 */
export function repairRelativeImports(files) {
  const repairs = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const fromDir = path.dirname(file);
    const next = source.replace(SPECIFIER, (whole, lead, quote, specifier) => {
      if (resolves(fromDir, specifier)) return whole;
      const fixed = exactCaseSpecifier(fromDir, specifier);
      if (!fixed || fixed === specifier || !resolves(fromDir, fixed)) return whole;
      repairs.push({ file, from: specifier, to: fixed });
      return `${lead}${quote}${fixed}${quote}`;
    });
    if (next !== source) fs.writeFileSync(file, next);
  }
  return repairs;
}
