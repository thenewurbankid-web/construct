// #545 -- ROUTE-002, migrated from architecture-enforcer.mjs's detectLayerViolations (the
// `layer === 'route'` branch's second check). Buffer-scope: only this file's own AST.
import { parseToAst, collectBareIdentifierUsages } from '../../ast/index.mjs';

const BANNED_NAMES = new Set(['fetch', 'useMachine', 'useActor', 'localStorage', 'sessionStorage']);

/** @type {import('./types.mjs').Rule} */
export const rule = {
  id: 'ROUTE-002',
  module: 'architecture',
  layers: ['route'],
  scope: 'buffer',
  defaultSeverity: 'error',
  why: 'Routes must remain thin.',
  expected: ['controller'],
  detect(ctx) {
    const ast = parseToAst(ctx.source);
    if (!collectBareIdentifierUsages(ast, BANNED_NAMES).length) return [];
    return [{ line: 1, message: 'Route contains application logic or effects.' }];
  },
};
