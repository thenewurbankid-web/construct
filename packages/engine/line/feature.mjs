// Line Cockpit feature detail (contract.mjs LineFeatureDetail, GET /api/line/feature): one feature's items by kind,
// a static Auto summary, its spec with static coverage, and its findings. Built on readLineProject (model.mjs), so
// the Features screen sees exactly what `construct validate` sees. Reads files only; never writes, never runs code,
// never calls a model.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '@line/construct-core/config';
import { normalizeLineConfig } from '@line/construct-core/profiles/line/contract';
import { resolveLayout, loadProject, moduleEdges, resolveSpecifier, classify } from '@line/construct-core/profiles/line/checks';
import { LineOpError } from './contract.mjs';
import { readLineProject, itemName } from './model.mjs';
import { groupItems, summarySentences, parseSpec, coverSpec, testTitles } from './featureText.mjs';

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/**
 * What each feature item imports, other than its own base (library, this feature, or another feature).
 * @param {string} root
 * @param {string} name Feature name.
 * @param {import('./contract.mjs').FeatureItem[]} items
 * @returns {{uses: Map<string, import('./featureText.mjs').ItemUse[]>, tests: string[]}}
 */
function itemUses(root, name, items) {
  const layout = resolveLayout(root, normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line));
  const project = loadProject(root, layout);
  /** @type {Map<string, import('./featureText.mjs').ItemUse[]>} */
  const uses = new Map();
  for (const it of items) {
    if (it.file.endsWith('.json')) continue;
    const ast = project.ast(it.file);
    if (ast instanceof Error) continue;
    const seen = new Set();
    const list = [];
    for (const e of moduleEdges(ast)) {
      const target = resolveSpecifier(layout, it.file, e.specifier);
      if (!target) continue;
      const where = classify(target, layout);
      const used = itemName(target);
      if (used === it.name || seen.has(`${where.area}/${where.feature ?? ''}/${used}`)) continue;
      if (where.area === 'library') {
        const libraryId = where.kind ? `${where.kind}/${used}` : null;
        if (libraryId && libraryId === it.base.libraryId) continue;
        list.push({ name: used, area: 'library', libraryId });
      } else if (where.area === 'feature' && where.feature) {
        list.push(where.feature === name ? { name: used, area: 'same' } : { name: used, area: 'feature', feature: where.feature });
      } else continue;
      seen.add(`${where.area}/${where.feature ?? ''}/${used}`);
    }
    uses.set(it.id, /** @type {any} */ (list));
  }
  const prefix = `${layout.features}/${name}/`;
  const tests = project.files.filter((f) => f.rel.startsWith(prefix) && TEST_FILE.test(f.rel)).flatMap((f) => testTitles(project.source(f.rel)));
  return { uses, tests };
}

/**
 * One feature of a Line project, as the Features screen shows it.
 * @param {string} root Project root.
 * @param {string} name Feature name.
 * @returns {import('./contract.mjs').LineFeatureDetail}
 */
export function readLineFeature(root, name) {
  const p = readLineProject(root);
  if (!p.isLine) throw new LineOpError('This project is not a Line project, so it has no Line features.', 'NOT_LINE');
  const feature = p.features.find((f) => f.name === name);
  if (!feature) throw new LineOpError(`There is no feature "${name}"; pick one from the list.`, 'UNKNOWN_ITEM');
  const { uses, tests } = itemUses(root, name, feature.items);
  const libraryNames = new Map(p.library.map((l) => [l.id, l.name]));
  let spec = null;
  if (feature.spec) {
    let text = '';
    try { text = fs.readFileSync(path.join(root, feature.spec), 'utf8'); } catch { /* unreadable reads as empty */ }
    spec = { file: feature.spec, stories: coverSpec(parseSpec(text), { itemNames: feature.items.map((i) => i.name), testTitles: tests }) };
  }
  const prefix = `${p.layout.features}/${name}/`;
  return {
    name,
    items: groupItems(feature.items),
    summary: { sentences: summarySentences(name, feature.items, libraryNames, uses), via: 'static' },
    spec,
    findings: p.findings.filter((f) => f.file.startsWith(prefix)),
  };
}
