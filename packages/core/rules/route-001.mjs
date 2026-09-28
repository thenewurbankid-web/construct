// #545 -- ROUTE-001, migrated from architecture-enforcer.mjs's detectLayerViolations (the
// `layer === 'route'` branch's first check). Buffer-scope: only this file's own import list.
import { extractImports } from '../../ast/index.mjs';

/** @type {import('./types.mjs').Rule} */
export const rule = {
  id: 'ROUTE-001',
  module: 'architecture',
  layers: ['route'],
  scope: 'buffer',
  defaultSeverity: 'error',
  why: 'Routes are navigation entry points and must delegate.',
  expected: ['controller'],
  detect(ctx) {
    const imports = extractImports(ctx.source);
    if (imports.some((x) => /controllers?\//.test(x))) return [];
    return [{ line: 1, message: 'Route does not import a controller.' }];
  },
};
