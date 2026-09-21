// Refactor capability — mechanical, LLM-free structural moves within a
// Construct project. `moveLayerFile`/`renameLayerFile` relocate a file
// (crossing layers, or just renaming within one), rewrite every other
// file's import of it to the new path, and stop there: they never touch the
// file's own content, its exported identifier, or its logic. Whether the new
// location/name is actually *valid* (READ-001 naming, DOMAIN-001 purity,
// etc.) is left entirely to `construct validate` — this module's job is the
// error-prone, mechanical part (finding every importer across a whole
// project and rewriting its relative path correctly), not judgment calls
// about what the code should say next.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { walk, rel } from './fs.mjs';
import { resolveRelativeImport } from './architecture-enforcer.mjs';
import { folderFor, layerFileBaseName, pascalCase } from './generators.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { assertNotFrozen } from './frozen.mjs';
import { applyEdits, planFileMove } from './engine/tsFileMove.mjs';

const FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
// Matches the specifier in both `import ... from '...'` and
// `export ... from '...'` (re-exports) — intentionally broader than
// architecture-enforcer.mjs's `extractImports`, which only needs the former.
const FROM_SPECIFIER_RE = /\bfrom\s*(['"])(.*?)\1/g;

function featureLayerDir(root, config, feature, layer) {
  return path.join(root, config.features?.root || 'features', feature, folderFor(layer));
}

function findExistingFile(dir, baseName) {
  for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
    const p = path.join(dir, baseName + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Strip the extension and normalize to posix separators — the bare-specifier
 * style every hand-written and generated import in this codebase already uses
 * (e.g. `'../pages/CheckoutPage'`, never `'../pages/CheckoutPage.tsx'`). */
function bareSpecifier(fromDir, targetAbsPath) {
  const relPath = path.relative(fromDir, targetAbsPath).replace(/\.(tsx|ts|jsx|js)$/, '').split(path.sep).join('/');
  return relPath.startsWith('.') ? relPath : `./${relPath}`;
}

/** Rewrite every relative import/re-export across the whole project that
 * currently resolves to `oldAbsPath` so it points at `newAbsPath` instead.
 * Must run while `oldAbsPath` still exists on disk — resolution depends on
 * the target being findable. Returns the number of files updated. Never
 * touches anything else in a rewritten file — only the matched specifier. */
function planRegexImporters(root, oldAbsPath, newAbsPath) {
  const pending = [];
  for (const abs of walk(root)) {
    if (!FILE_EXTENSIONS.has(path.extname(abs)) || abs === oldAbsPath) continue;
    const source = fs.readFileSync(abs, 'utf8');
    let changed = false;
    const rewritten = source.replace(FROM_SPECIFIER_RE, (full, quote, spec) => {
      if (!spec.startsWith('.')) return full;
      const hit = resolveRelativeImport(abs, spec);
      if (!hit || path.resolve(hit) !== path.resolve(oldAbsPath)) return full;
      changed = true;
      return `from ${quote}${bareSpecifier(path.dirname(abs), newAbsPath)}${quote}`;
    });
    if (changed) pending.push([abs, rewritten]);
  }
  return pending;
}

/** Write a planned set of `[file, newContent]` pairs. Two passes so a frozen file (#23) refuses the whole move before ANY
 * file has been rewritten -- never a half-applied refactor. */
function writePlanned(pending) {
  for (const [abs] of pending) assertNotFrozen(abs, 'rewrite an import inside');
  for (const [abs, rewritten] of pending) fs.writeFileSync(abs, rewritten);
}

/** After the moved file has already been renamed to `newAbsPath`, re-resolve
 * every one of ITS OWN relative imports/re-exports against its old location
 * (where the specifiers were originally written relative to) and rewrite
 * each to a fresh specifier from its new location to that same target.
 * A specifier that was already dangling before the move is left alone —
 * that's `construct validate`'s IMPORT-001 to report, not this function's
 * job to guess at. */
function rewriteOwnImportsAfterMove(oldAbsPath, newAbsPath) {
  const source = fs.readFileSync(newAbsPath, 'utf8');
  const rewritten = source.replace(FROM_SPECIFIER_RE, (full, quote, spec) => {
    if (!spec.startsWith('.')) return full;
    const hit = resolveRelativeImport(oldAbsPath, spec);
    if (!hit) return full;
    const newSpec = bareSpecifier(path.dirname(newAbsPath), hit);
    return newSpec === spec ? full : `from ${quote}${newSpec}${quote}`;
  });
  if (rewritten !== source) fs.writeFileSync(newAbsPath, rewritten);
}

/** The TypeScript engine's plan as `[file, newContent]` pairs (moved file excluded) plus the moved file's new content. */
function planWithTypeScript(plan, oldAbs) {
  const byFile = new Map();
  for (const e of plan.edits) { if (!byFile.has(e.file)) byFile.set(e.file, []); byFile.get(e.file).push(e); }
  const pending = [];
  let movedContent = null;
  for (const [file, edits] of byFile) {
    const rewritten = applyEdits(fs.readFileSync(file, 'utf8'), edits);
    if (file === oldAbs) movedContent = rewritten; else pending.push([file, rewritten]);
  }
  return { pending, movedContent };
}

/** `refactor.engine` in architecture.yml: `typescript` (default) or `regex`. */
function engineOf(config) {
  return config.refactor?.engine === 'regex' ? 'regex' : 'typescript';
}

function relocate(root, feature, fromLayer, fromName, toLayer, toName, { dryRun = false } = {}) {
  const config = loadConfig(root);
  // #218: same PascalCase + validation as the generators, so a renamed file
  // never gets an invalid identifier-derived name and a bad name throws
  // before any file is touched.
  // The source name may be a pre-existing file made before this validation
  // existed (e.g. use3d.tsx), so only the DESTINATION name is validated.
  const fromCap = fromName.replace(/(^|[-_]+)([a-zA-Z0-9])/g, (_, __, c) => c.toUpperCase());
  const toCap = pascalCase(toName, 'New name');
  const fromDir = featureLayerDir(root, config, feature, fromLayer);
  const toDir = featureLayerDir(root, config, feature, toLayer);
  const fromBase = layerFileBaseName(fromLayer, fromCap);
  const toBase = layerFileBaseName(toLayer, toCap);

  const oldAbs = findExistingFile(fromDir, fromBase);
  if (!oldAbs) {
    throw new ConstructError(
      `No ${fromLayer} file found for "${fromName}" in feature "${feature}" (expected ${fromBase}.tsx in ${rel(root, fromDir)}).`,
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  const newAbs = path.join(toDir, toBase + path.extname(oldAbs));
  if (fs.existsSync(newAbs)) {
    throw new ConstructError(`${rel(root, newAbs)} already exists.`, { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  assertNotFrozen(oldAbs, 'move');
  assertNotFrozen(newAbs, 'move into');

  // #435: ask the TypeScript language service first (relative imports, tsconfig `paths` aliases, dynamic import(),
  // re-exports, barrels). It writes nothing; when it cannot resolve the project we say why and use the regex engine.
  let note = null;
  if (engineOf(config) === 'typescript') {
    const plan = planFileMove(root, oldAbs, newAbs);
    if (plan.ok) {
      const { pending, movedContent } = planWithTypeScript(plan, oldAbs);
      const touched = [...pending.map(([f]) => rel(root, f)), ...(movedContent !== null ? [rel(root, newAbs)] : [])];
      const result = { from: rel(root, oldAbs), to: rel(root, newAbs), importersUpdated: pending.length, engine: 'typescript', tsVersion: plan.tsVersion, files: touched };
      if (dryRun) return { ...result, dryRun: true };
      writePlanned(pending);
      fs.mkdirSync(toDir, { recursive: true });
      fs.renameSync(oldAbs, newAbs);
      if (movedContent !== null) fs.writeFileSync(newAbs, movedContent);
      return result;
    }
    note = `TypeScript could not resolve this project (${'reason' in plan ? plan.reason : 'unknown'}); used the regex engine, which covers relative imports only.`;
  }

  // Regex engine: find every other file's import of the old path while it still exists on disk (resolution depends on
  // the target actually being there) -- the rename itself must come after.
  const pending = planRegexImporters(root, oldAbs, newAbs);
  const result = { from: rel(root, oldAbs), to: rel(root, newAbs), importersUpdated: pending.length, engine: 'regex', files: pending.map(([f]) => rel(root, f)) };
  if (note) result.note = note;
  if (dryRun) return { ...result, dryRun: true };
  writePlanned(pending);

  fs.mkdirSync(toDir, { recursive: true });
  fs.renameSync(oldAbs, newAbs);

  // Layer folders are siblings at the same depth under the feature root, so
  // a same-layer relative import inside the moved file itself (e.g. domain's
  // `./OtherHelper`) now points at the wrong directory — re-resolve each of
  // the moved file's own relative imports against where it used to live, and
  // rewrite to a fresh specifier from its new home to that same target.
  rewriteOwnImportsAfterMove(oldAbs, newAbs);
  return result;
}

/**
 * Move a file from one layer to another within the same feature, keeping
 * its base name. Naming convention (e.g. a hook's `use` prefix) is applied
 * for the target layer — whether the result still makes sense (does the
 * export name match? is the content still pure enough for its new layer?) is
 * for `construct validate` to say, not this function.
 *
 * @param {string} root Project root.
 * @param {string} feature Feature that owns the file.
 * @param {string} name Base name of the file.
 * @param {string} fromLayer Layer it is in now.
 * @param {string} toLayer Layer to move it to; must differ from `fromLayer`.
 * @param {object} [options] Options for the relocation (for example `dryRun`).
 * @returns {object} The relocation result (files changed, engine used).
 * @throws {ConstructError} Usage error when both layers are the same.
 */
export function moveLayerFile(root, feature, name, fromLayer, toLayer, options = {}) {
  if (fromLayer === toLayer) {
    throw new ConstructError(
      '--from and --to must be different layers (use "construct refactor rename" to rename within a layer).',
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  return relocate(root, feature, fromLayer, name, toLayer, name, options);
}

/**
 * Rename a file within the same layer, keeping its layer.
 *
 * @param {string} root Project root.
 * @param {string} feature Feature that owns the file.
 * @param {string} name Current base name.
 * @param {string} newName New base name.
 * @param {string} layer Layer the file is in.
 * @param {object} [options] Options for the relocation (for example `dryRun`).
 * @returns {object} The relocation result.
 */
export function renameLayerFile(root, feature, name, newName, layer, options = {}) {
  return relocate(root, feature, layer, name, layer, newName, options);
}
