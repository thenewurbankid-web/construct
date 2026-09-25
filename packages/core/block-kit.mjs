// #629, #630, #625 (part of epic #616) -- the small pieces the guard, store and handler blocks share: where a feature lives, how a block adds its
// declarations to the feature's `types.ts` without touching what is there, and how a set of generated files is written all-or-nothing
// (a file that exists with other content is a refusal, never an overwrite). No model, no network; the same request writes the same bytes.
//
//   featureDirOf(root, feature)                the feature folder (absolute)
//   withDeclarations(root, feature, blocks)    the text of `types.ts` once the blocks' declarations are in it, or the conflicts
//   writeOwned(root, files)                    write generated files all-or-nothing; a differing existing file refuses the whole write
//   assertFeature(root, feature)               the feature must exist
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { write } from './fs.mjs';
import { FEATURE_NAME_RE, UNIT_NAME_RE } from './block-args.mjs';

const usage = (message) => new ConstructError(message, { exitCode: EXIT_CODES.USAGE_ERROR });
const rel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');

export { FEATURE_NAME_RE, UNIT_NAME_RE };

/**
 * The folder of a feature, absolute (the features folder follows architecture.yml).
 *
 * @param {string} root Project root.
 * @param {string} feature The feature name.
 * @returns {string} The absolute folder.
 * @throws {Error} A usage error for an invalid feature name.
 *
 * @example
 * featureDirOf(root, 'shop'); // => '<root>/features/shop'
 */
export function featureDirOf(root, feature) {
  if (typeof feature !== 'string' || !FEATURE_NAME_RE.test(feature)) throw usage(`Invalid feature name ${JSON.stringify(feature ?? '')}: use letters, numbers, "_" and "-" only.`);
  return path.join(root, loadConfig(root).features?.root || 'features', feature);
}

/**
 * Refuse a feature that does not exist, with the command that creates it.
 *
 * @param {string} root Project root.
 * @param {string} feature The feature name.
 * @returns {string} The absolute folder of the feature.
 * @throws {Error} A usage error when the feature folder is not there.
 *
 * @example
 * assertFeature(root, 'shop'); // => '<root>/features/shop'
 */
export function assertFeature(root, feature) {
  const dir = featureDirOf(root, feature);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw usage(`Feature "${feature}" not found (looked in ${rel(root, dir)}). Create it first: construct create feature ${feature}`);
  return dir;
}

/**
 * The text of a feature's `types.ts` once the declarations of a block are in it. A declaration that is already there is kept (running a block twice, or
 * two blocks sharing `Session`, changes nothing); one that is missing is appended. A name that is declared with a DIFFERENT meaning (its `marker` text
 * is nowhere in the file) is a conflict: the block refuses instead of building on a type it does not know.
 *
 * @param {string} root Project root.
 * @param {string} feature The feature.
 * @param {{ declares: string, text: string, marker?: string }[]} blocks The declarations: the exported name, its text, and a text that tells it is this block's own.
 * @returns {{ text: string, current: string, changed: boolean, conflicts: string[] }} The new text, the text as it is, whether they differ and the names that clash.
 *
 * @example
 * withDeclarations(root, 'shop', [{ declares: 'Session', text: 'export type Session = { status: string };', marker: 'Session' }]).changed; // => true
 */
export function withDeclarations(root, feature, blocks) {
  const file = path.join(featureDirOf(root, feature), 'types.ts');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const conflicts = [];
  const missing = [];
  for (const b of blocks) {
    const declared = new RegExp(`export\\s+(?:interface|type|const)\\s+${b.declares}\\b`).test(current);
    if (!declared) missing.push(b);
    else if (b.marker && !current.includes(b.marker)) conflicts.push(b.declares);
  }
  if (!missing.length) return { text: current, current, changed: false, conflicts };
  const text = `${current === '' ? '' : `${current.replace(/\n*$/, '\n')}\n`}${missing.map((b) => b.text.replace(/\n*$/, '\n')).join('\n')}`;
  return { text, current, changed: text !== current, conflicts };
}

/**
 * Write generated files all-or-nothing. A file that does not exist is created, one that has exactly these bytes is left alone, and one that exists with
 * other content refuses the whole write (nothing is changed), naming every such file: a block never overwrites what a person may have edited.
 *
 * @param {string} root Project root.
 * @param {{ path: string, content: string }[]} files Absolute paths and their text.
 * @returns {{ written: string[], unchanged: string[] }} The project-relative files written and left alone.
 * @throws {Error} A usage error listing the files that exist with other content.
 *
 * @example
 * writeOwned(root, [{ path: path.join(root, 'features/shop/domain/A.domain.ts'), content: 'export {};\n' }]).written; // => ['features/shop/domain/A.domain.ts']
 */
export function writeOwned(root, files) {
  const differing = files.filter((f) => fs.existsSync(f.path) && fs.readFileSync(f.path, 'utf8') !== f.content).map((f) => rel(root, f.path));
  if (differing.length) throw usage(`${differing.join(', ')} already exist${differing.length === 1 ? 's' : ''} with other content, so nothing was written. Remove ${differing.length === 1 ? 'it' : 'them'} (or edit ${differing.length === 1 ? 'it' : 'them'} by hand) and run this again.`);
  const written = [];
  const unchanged = [];
  for (const f of files) {
    if (fs.existsSync(f.path)) {
      unchanged.push(rel(root, f.path));
      continue;
    }
    write(f.path, f.content);
    written.push(rel(root, f.path));
  }
  return { written, unchanged };
}
