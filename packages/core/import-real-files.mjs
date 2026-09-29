// Split out of import.mjs (#787): `existingRealFiles` is a deterministic, read-only collision
// check with no LLM or network dependency of its own, but it used to live in import.mjs
// alongside the LLM-fill code (callLlm et al.), so anything that only needed this check — like
// plan-touches.mjs's plan preview — transitively imported llm.mjs too, tripping decision-trace's
// "no network" invariant (test/decision-trace.test.mjs). This module exists so a caller that only
// needs the collision check never pulls in anything that can reach the network.
import fs from 'node:fs';
import { layerTargetFile } from './generators.mjs';

// Marks a scaffolded-but-unfilled stub (see import.mjs's breadcrumb() and requestFileText's
// per-file writes) — the one signal `existingRealFiles` (#519) trusts to tell "nobody has
// touched this yet, safe to redo" apart from "a human or an earlier LLM fill already wrote
// something real here."
export const IMPORT_TODO_MARKER = 'TODO(import):';

/** Target files (for `layers`) that already exist with real content — i.e.
 * NOT just an earlier, still-unfilled import stub (one that still carries
 * the TODO(import) breadcrumb, which importVertical is always free to
 * rewrite). #519 found that re-running `construct import` for the same
 * name/feature/layer silently overwrote whatever was already there,
 * including a file a human had already hand-ported or an earlier `--llm`
 * fill had already written — real work destroyed with no warning, purely
 * because generateVertical's write() has no existence check. Read-only:
 * never writes, so it's safe to call before anything is scaffolded.
 * Exported for `plan-touches.mjs`: the same collision check `importVertical`
 * runs before writing anything, reused rather than duplicated so a plan
 * preview and the real run can never disagree about whether this refuses.
 * @param {string} root - project root.
 * @param {string} name - the unit name being imported (e.g. a component/page name).
 * @param {string} feature - the feature slice name.
 * @param {string[]} layers - the layers to check.
 * @returns {string[]} absolute paths of target files that already exist with real (non-stub) content.
 */
export function existingRealFiles(root, name, feature, layers) {
  const hits = [];
  for (const layer of layers) {
    const file = layerTargetFile(root, layer, name, feature);
    if (!fs.existsSync(file)) continue;
    if (!fs.readFileSync(file, 'utf8').includes(IMPORT_TODO_MARKER)) hits.push(file);
  }
  return hits;
}
