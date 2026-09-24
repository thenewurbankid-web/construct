// #470 -- the files a writing plan step will create, worked out from its own arguments, so a plan built in the
// Cockpit can declare them (the approval gate refuses any file a plan did not declare, approvalGate.mjs check 2).
// Deterministic and read-only: it computes the same paths the generators write (`layerTargetFile`, `createFeature`)
// without touching the disk, and never calls a model. A flow it cannot derive exactly answers `null`, never a guess:
// an undeclared file is refused loudly at approval, a wrongly declared one would be trusted silently.
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { LAYER_ORDER, layerTargetFile, pascalCase } from './generators.mjs';

const isName = (v) => typeof v === 'string' && v.trim().length > 0;
const asList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => String(x).trim()).filter(Boolean);
const rel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');

/** Flows whose written files are derived here. Every other writing flow answers `null` until its output is pinned by a test. */
export const DERIVED_FLOWS = Object.freeze(['create.feature', 'create.unit', 'create.layer']);

/**
 * The project-relative files a writing plan step will create, derived from its own arguments without touching the disk.
 *
 * @param {string} root Project root (its architecture.yml decides the features folder).
 * @param {string} flowId A plan flow id (`create.unit`, ...).
 * @param {Record<string, unknown>} [args] The step's arguments.
 * @returns {{path: string, change: 'create', layer?: string}[] | null} Project-relative POSIX paths the step will create,
 *   or `null` when the flow is not derived or the arguments do not name a valid unit yet (the validator says why).
 */
export function expectedFiles(root, flowId, args = {}) {
  try {
    const config = loadConfig(root);
    if (flowId === 'create.feature') {
      if (!isName(args.name)) return null;
      pascalCase(args.name); // the generator's own identifier check: an illegal name writes nothing
      const base = path.join(config.features?.root || 'features', args.name);
      return ['types.ts', 'index.ts'].map((f) => ({ path: rel(root, path.join(root, base, f)), change: 'create' }));
    }
    if (flowId === 'create.unit') {
      if (!isName(args.name) || !isName(args.feature) || !LAYER_ORDER.includes(args.layer)) return null;
      return [{ path: rel(root, layerTargetFile(root, args.layer, args.name, args.feature, config)), change: 'create', layer: args.layer }];
    }
    if (flowId === 'create.layer') {
      const layers = asList(args.layers);
      if (!isName(args.name) || !isName(args.feature) || !layers.length || !layers.every((l) => LAYER_ORDER.includes(l))) return null;
      // Generated in canonical order, whatever order the step lists them in (generateVertical).
      return LAYER_ORDER.filter((l) => layers.includes(l)).map((l) => ({ path: rel(root, layerTargetFile(root, l, args.name, args.feature, config)), change: 'create', layer: l }));
    }
    return null;
  } catch {
    return null;
  }
}
