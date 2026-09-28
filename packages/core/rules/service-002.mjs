// #545 -- SERVICE-002, migrated from architecture-enforcer.mjs's detectLayerViolations (the
// `layer === 'service'` React-import check). Buffer-scope: only this file's own static imports.
import { parseToAst, staticImportEntries } from '../../ast/index.mjs';
import { isReactSpecifier } from './shared.mjs';

/** @type {import('./types.mjs').Rule} */
export const rule = {
  id: 'SERVICE-002',
  module: 'architecture',
  layers: ['service'],
  scope: 'buffer',
  defaultSeverity: 'error',
  why: 'Services own external effects, not rendering.',
  expected: ['api', 'domain', 'types'],
  detect(ctx) {
    const ast = parseToAst(ctx.source);
    if (!staticImportEntries(ast).some((e) => isReactSpecifier(e.value))) return [];
    return [{ line: 1, message: 'Service imports React/UI.' }];
  },
};
