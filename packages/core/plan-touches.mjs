// #470 -- the files a writing plan step will create, worked out from its own arguments, so a plan built in the
// Cockpit can declare them (the approval gate refuses any file a plan did not declare, approvalGate.mjs check 2).
// Deterministic and read-only: it computes the same paths the generators write (`layerTargetFile`, `createFeature`)
// without touching the disk, and never calls a model. A flow it cannot derive exactly answers `null`, never a guess:
// an undeclared file is refused loudly at approval, a wrongly declared one would be trusted silently.
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { LAYER_ORDER, layerTargetFile, pascalCase } from './generators.mjs';
import { shapeTouches } from './shapes.mjs';
import { proofTouches } from './proof.mjs';
import { routeEntryTouches, dependencyTouches } from './wiring.mjs';
import { envTouches } from './env.mjs';
import { wrapProviderTouches } from './provider-wrap.mjs';
import { guardTouches } from './guard.mjs';

const isName = (v) => typeof v === 'string' && v.trim().length > 0;
const asList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => String(x).trim()).filter(Boolean);
const rel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');
const shapeArgs = (args) => ({ shape: args.shape, name: args.name, feature: args.feature, entity: args.entity, fields: args.fields, source: args.source, steps: args.steps, states: args.states });

/** Flows whose written files are derived here. Every other writing flow answers `null` until its output is pinned by a test. */
export const DERIVED_FLOWS = Object.freeze(['create.feature', 'create.unit', 'create.layer', 'create.proof', 'create.route', 'add.dependency', 'add.env', 'wrap.provider', 'guard.route']);

/**
 * The project-relative files a writing plan step will create, derived from its own arguments without touching the disk.
 *
 * @param {string} root Project root (its architecture.yml decides the features folder).
 * @param {string} flowId A plan flow id (`create.unit`, ...).
 * @param {Record<string, unknown>} [args] The step's arguments.
 * @returns {{path: string, change: 'create'|'modify', layer?: string}[] | null} Project-relative POSIX paths the step will create,
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
      // #619: a shaped unit writes every file its shape lists for the layer (and the feature's types.ts for the domain layer).
      if (args.shape !== undefined) return shapeTouches(root, { ...shapeArgs(args), layer: args.layer });
      return [{ path: rel(root, layerTargetFile(root, args.layer, args.name, args.feature, config)), change: 'create', layer: args.layer }];
    }
    if (flowId === 'create.layer') {
      const layers = asList(args.layers);
      if (!isName(args.name) || !isName(args.feature) || !layers.length || !layers.every((l) => LAYER_ORDER.includes(l))) return null;
      if (args.shape !== undefined) {
        const shaped = LAYER_ORDER.filter((l) => layers.includes(l)).map((l) => shapeTouches(root, { ...shapeArgs(args), layer: l }));
        return shaped.every(Boolean) ? shaped.flat() : null;
      }
      // Generated in canonical order, whatever order the step lists them in (generateVertical).
      return LAYER_ORDER.filter((l) => layers.includes(l)).map((l) => ({ path: rel(root, layerTargetFile(root, l, args.name, args.feature, config)), change: 'create', layer: l }));
    }
    // #623: the proof of a shaped screen writes its test file (when its kind applies to this project) and declares the test regions.
    if (flowId === 'create.proof') {
      if (!isName(args.name) || !isName(args.feature)) return null;
      return proofTouches(root, { name: args.name, feature: args.feature, kind: args.kind, shape: args.shape, entity: args.entity, fields: args.fields, source: args.source, steps: args.steps, states: args.states });
    }
    // #654: the route entry a screen is wired into (Next.js creates a page.tsx, react-spa modifies src/App.tsx), and the one line added to package.json.
    if (flowId === 'create.route') return routeEntryTouches(root, { name: args.name, feature: args.feature, route: args.route });
    if (flowId === 'add.dependency') return dependencyTouches(root, { name: args.name, version: args.version });
    // #632: the one file an environment variable is added to. #631: the controller that renders the element a provider wraps (a refusal derives nothing).
    if (flowId === 'add.env') return envTouches(root, { name: args.name, scope: args.scope, value: args.value, comment: args.comment });
    if (flowId === 'wrap.provider') return wrapProviderTouches(root, { name: args.name, feature: args.feature, provider: args.provider });
    // #629: the units of a route guard, the barrel and types it updates, the route entry it edits and its proof (the public access writes nothing).
    if (flowId === 'guard.route') return guardTouches(root, { name: args.name, feature: args.feature, access: args.access, roles: args.roles, redirect: args.redirect, route: args.route });
    return null;
  } catch {
    return null;
  }
}
