// #949 Trace beam: the facts the beam reads, Line's own (lsp/rules.mjs lineFacts: logic functions by stable id with
// their stub check, modules, index exports) plus the browser-storage stores (features/<f>/store/*.ts, one stable id
// per exported function), which the lending projects use as their contract layer and lineFacts does not list.
import fs from 'node:fs';
import path from 'node:path';
import { lineFacts } from '../../../lsp/rules.mjs';
import { stubProblems } from '../stubs.mjs';
import { moduleScope } from '../../scope/moduleScope.mjs';

/**
 * Line's facts plus the stores' exported functions, by stable id.
 * @param {string} root A Line project root.
 * @returns {{fns: Map<string, any>, modules: Set<string>, exportsBy: Record<string, string[]>}}
 */
export function beamFacts(root) {
  let F;
  try { F = lineFacts(root); } catch { F = { fns: new Map(), modules: new Set(), exportsBy: {} }; }
  let features = [];
  try { features = fs.readdirSync(path.join(root, 'features'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { /* none */ }
  for (const f of features) {
    const dir = path.join(root, 'features', f, 'store');
    let files = [];
    try { files = fs.readdirSync(dir).filter((x) => /\.[cm]?[jt]sx?$/.test(x)).sort(); } catch { continue; }
    F.modules.add(`module:${f}/store`);
    for (const file of files) {
      const rel = `features/${f}/store/${file}`;
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) {
        const id = `${f}/store/${m[1]}`;
        if (!F.fns.has(id)) F.fns.set(id, { id, feature: f, kind: 'store', name: m[1], file: rel, problems: stubProblems(src, m[1]).map((p) => p.code) });
      }
    }
  }
  return F;
}

/**
 * The features `feature` already imports (moduleScope), so a function there is reuse, not add_to_scope.
 * @param {string} root
 * @param {string} feature
 * @returns {Set<string>}
 */
export function inScopeOf(root, feature) {
  try { return new Set(moduleScope(root, feature).imports.features.map((x) => x.feature)); } catch { return new Set(); }
}
