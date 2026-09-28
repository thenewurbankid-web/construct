// #545 -- WORKFLOW-001, migrated from architecture-enforcer.mjs's detectLayerViolations (the
// `layer === 'workflow'` React-import check). Buffer-scope: only this file's own static imports.
import { parseToAst, staticImportEntries } from '../../ast/index.mjs';
import { isReactSpecifier } from './shared.mjs';

/** @type {import('./types.mjs').Rule} */
export const rule = {
  id: 'WORKFLOW-001',
  module: 'architecture',
  layers: ['workflow'],
  scope: 'buffer',
  defaultSeverity: 'error',
  why: 'Workflow logic must be UI-independent.',
  expected: ['service', 'domain', 'types'],
  detect(ctx) {
    const ast = parseToAst(ctx.source);
    if (!staticImportEntries(ast).some((e) => isReactSpecifier(e.value))) return [];
    return [{ line: 1, message: 'Workflow imports React/UI.' }];
  },
};
