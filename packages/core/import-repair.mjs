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

/** Does `specifier` (relative to `fromDir`) already resolve to a file or a folder's index? */
function resolves(fromDir, specifier) {
  const abs = path.resolve(fromDir, specifier);
  if (EXTENSIONS.some((e) => fs.existsSync(abs + e)) || fs.existsSync(abs) && fs.statSync(abs).isFile()) return true;
  return EXTENSIONS.some((e) => fs.existsSync(path.join(abs, `index${e}`)));
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
