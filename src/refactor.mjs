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
import { folderFor, layerFileBaseName } from './generators.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';

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
function rewriteImportersOf(root, oldAbsPath, newAbsPath) {
  let updated = 0;
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
    if (changed) {
      fs.writeFileSync(abs, rewritten);
      updated++;
    }
  }
  return updated;
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

function relocate(root, feature, fromLayer, fromName, toLayer, toName) {
  const config = loadConfig(root);
  const fromCap = fromName[0].toUpperCase() + fromName.slice(1);
  const toCap = toName[0].toUpperCase() + toName.slice(1);
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

  // Find every other file's import of the old path while it still exists on
  // disk (resolution depends on the target actually being there) — the
  // rename itself must come after, or nothing would resolve to `oldAbs` any
  // more and every one of these would look like it was never importing it.
  const importersUpdated = rewriteImportersOf(root, oldAbs, newAbs);

  fs.mkdirSync(toDir, { recursive: true });
  fs.renameSync(oldAbs, newAbs);

  // Layer folders are siblings at the same depth under the feature root, so
  // a same-layer relative import inside the moved file itself (e.g. domain's
  // `./OtherHelper`) now points at the wrong directory — re-resolve each of
  // the moved file's own relative imports against where it used to live, and
  // rewrite to a fresh specifier from its new home to that same target.
  rewriteOwnImportsAfterMove(oldAbs, newAbs);

  return { from: rel(root, oldAbs), to: rel(root, newAbs), importersUpdated };
}

/** Move a file from one layer to another within the same feature, keeping
 * its base name. Naming convention (e.g. a hook's `use` prefix) is applied
 * for the target layer — whether the result still makes sense (does the
 * export name match? is the content still pure enough for its new layer?) is
 * for `construct validate` to say, not this function. */
export function moveLayerFile(root, feature, name, fromLayer, toLayer) {
  if (fromLayer === toLayer) {
    throw new ConstructError(
      '--from and --to must be different layers (use "construct refactor rename" to rename within a layer).',
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  return relocate(root, feature, fromLayer, name, toLayer, name);
}

/** Rename a file within the same layer, keeping its layer. */
export function renameLayerFile(root, feature, name, newName, layer) {
  return relocate(root, feature, layer, name, layer, newName);
}
