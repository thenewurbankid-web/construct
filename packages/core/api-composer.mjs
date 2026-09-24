// Module 2 — Public API Composer (Epic 2.3).
// Keeps each feature's index.ts additively in sync with what it actually
// exposes, and detects drift between index.ts and the files on disk.
// Violations are built through makeViolation() with module: 'separation-of-concerns'.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { write, walk, rel } from './fs.mjs';
import { makeViolation } from './diagnostics.mjs';
import { parseIndexExports } from './soc-enforcer.mjs';

const ext = new Set(['.ts', '.tsx', '.js', '.jsx']);
const PUBLIC_CANDIDATE_FOLDERS = ['controllers', 'hooks'];

function featuresRootOf(config) {
  return config.features?.root || 'features';
}

function listFeatureDirs(root, featuresRoot) {
  const base = path.join(root, featuresRoot);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

// Files/folders that look "intentionally public" by convention: everything in
// controllers/ and hooks/, plus the feature's types.ts. Internal-only folders
// (domain/, services/, workflows/, pages/, components/, shared/) are never
// auto-added — if a human already exported something from there, it is left
// untouched (see isCovered), but the composer will not add new lines for them.
function candidateModules(featureDir) {
  const out = [];
  for (const folder of PUBLIC_CANDIDATE_FOLDERS) {
    const dir = path.join(featureDir, folder);
    if (!fs.existsSync(dir)) continue;
    for (const p of walk(dir)) {
      if (!ext.has(path.extname(p))) continue;
      const relPath = rel(featureDir, p).replace(/\.(tsx|ts|jsx|js)$/, '');
      out.push({ specifier: './' + relPath, typeOnly: false });
    }
  }
  if (fs.existsSync(path.join(featureDir, 'types.ts'))) out.push({ specifier: './types', typeOnly: true });
  return out;
}

function isCovered(existingExports, specifier) {
  const norm = specifier.replace(/^\.\//, '');
  return existingExports.some((e) => {
    const espec = e.specifier.replace(/^\.\//, '');
    if (espec === norm) return true;
    if (e.isWildcard && (norm === espec || norm.startsWith(espec + '/'))) return true;
    return false;
  });
}

const LAYER_SUMMARY = {
  controllers: (n) => `Route controller: ${n}.`,
  hooks: (n) => `Hook: ${n}.`,
  pages: (n) => `Page: ${n}.`,
  components: (n) => `Component: ${n}.`,
  services: (n) => `Service: ${n}.`,
  workflows: (n) => `Workflow: ${n}.`,
  domain: (n) => `Domain logic: ${n}.`,
};

/**
 * A short, deterministic one-line summary for a public export, derived from where it lives
 * (`./controllers/ResetPassword` -> "Route controller: ResetPassword."), so a generated index.ts
 * satisfies READ-003 (every public export has a JSDoc summary) without a model or a placeholder.
 *
 * @param {string} specifier The export's relative module specifier, e.g. `./hooks/useCart`.
 * @returns {string} The one-line summary text (no comment delimiters).
 *
 * @example
 * summaryForSpecifier('./hooks/useCart'); // => 'Hook: useCart.'
 */
export function summaryForSpecifier(specifier) {
  const parts = String(specifier).replace(/^\.\//, '').split('/');
  if (parts.length === 1) return parts[0] === 'types' ? 'Types shared across this feature.' : `Public API: ${parts[0]}.`;
  const summary = LAYER_SUMMARY[parts[0]];
  const name = parts[parts.length - 1].replace(/\.(tsx?|jsx?)$/, '');
  return summary ? summary(name) : `Public API: ${parts.join('/')}.`;
}

function exportLineFor(candidate) {
  const line = candidate.typeOnly ? `export type * from '${candidate.specifier}';` : `export * from '${candidate.specifier}';`;
  return `/** ${summaryForSpecifier(candidate.specifier)} */\n${line}`;
}

function fileExistsForSpecifier(featureDir, specifier) {
  const target = path.join(featureDir, specifier);
  if (['.ts', '.tsx', '.js', '.jsx'].some((e) => fs.existsSync(target + e))) return true;
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) return true;
  return fs.existsSync(target); // extension already included in specifier, or exact dir/file match
}

/**
 * syncPublicApi(root, featureName) -> {changed, path}
 * Additively updates features/<name>/index.ts: appends export lines for
 * anything that looks intentionally public and isn't already covered by an
 * existing export (exact or via a wildcard ancestor). Never removes or
 * reorders lines a human already wrote. Running this twice on an unchanged
 * tree is a no-op (changed: false, file left untouched).
 *
 * @param {string} root Project root.
 * @param {string} featureName Feature whose `index.ts` is updated.
 * @returns {{changed:boolean, path:string}} Whether the index was written, and its project-relative path.
 *
 * @example
 * syncPublicApi(root, 'plan'); // => { changed: true, path: 'features/plan/index.ts' }
 */
export function syncPublicApi(root, featureName) {
  const config = loadConfig(root);
  const featuresRoot = featuresRootOf(config);
  const featureDir = path.join(root, featuresRoot, featureName);
  const indexPath = path.join(featureDir, 'index.ts');
  const relIndexPath = rel(root, indexPath);

  if (!fs.existsSync(featureDir)) return { changed: false, path: relIndexPath };

  const hadIndex = fs.existsSync(indexPath);
  const source = hadIndex ? fs.readFileSync(indexPath, 'utf8') : `// Public API for feature: ${featureName}\n`;
  const existingExports = parseIndexExports(source);
  const linesToAdd = candidateModules(featureDir)
    .filter((c) => !isCovered(existingExports, c.specifier))
    .map(exportLineFor);

  if (!linesToAdd.length) {
    if (!hadIndex) {
      write(indexPath, source);
      return { changed: true, path: relIndexPath };
    }
    return { changed: false, path: relIndexPath };
  }

  const needsNewline = source.length > 0 && !source.endsWith('\n');
  const updated = source + (needsNewline ? '\n' : '') + linesToAdd.join('\n') + '\n';
  write(indexPath, updated);
  return { changed: true, path: relIndexPath };
}

/**
 * checkPublicApiDrift(root) -> {violations}
 * SLICE-003 (warning): index.ts exports a path that no longer exists on
 * disk, or an obviously-public module (controllers/, hooks/, types.ts) is
 * missing from index.ts.
 */
export function checkPublicApiDrift(root) {
  const config = loadConfig(root);
  const featuresRoot = featuresRootOf(config);
  const out = [];
  const severity = (() => {
    const entry = config.rules?.['SLICE-003'];
    if (typeof entry === 'string') return entry;
    return entry?.severity ?? 'warning';
  })();
  const push = (opts) => {
    if (severity === 'off') return;
    out.push(makeViolation({ module: 'separation-of-concerns', severity, ...opts }));
  };

  for (const featureName of listFeatureDirs(root, featuresRoot)) {
    const featureDir = path.join(root, featuresRoot, featureName);
    const indexPath = path.join(featureDir, 'index.ts');
    const relIndexPath = rel(root, indexPath);
    if (!fs.existsSync(indexPath)) continue; // SLICE-001 already covers a missing skeleton/index

    const source = fs.readFileSync(indexPath, 'utf8');
    const existingExports = parseIndexExports(source);

    for (const e of existingExports) {
      if (fileExistsForSpecifier(featureDir, e.specifier)) continue;
      push({
        rule: 'SLICE-003',
        file: relIndexPath,
        line: e.line,
        message: `Exported module "${e.specifier}" no longer exists on disk.`,
        why: 'A stale export in the public API misleads consumers and breaks at import time.',
        expected: ['a real file/directory, or removal of the export line'],
        suggestedFix: `Remove the line: ${e.raw}`,
      });
    }

    for (const c of candidateModules(featureDir)) {
      if (isCovered(existingExports, c.specifier)) continue;
      push({
        rule: 'SLICE-003',
        file: relIndexPath,
        line: source.split('\n').length,
        message: `"${c.specifier}" looks like a public module but is not exported from index.ts.`,
        why: 'The public API should stay in sync with what the feature actually exposes.',
        expected: [c.specifier],
        suggestedFix: `Add: ${exportLineFor(c)}`,
      });
    }
  }
  return { violations: out };
}
