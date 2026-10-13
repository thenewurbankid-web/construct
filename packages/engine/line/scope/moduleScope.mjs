// Line feature modules (#935, part of #934): one feature read as a module, Angular style. A feature owns (declares) its
// items, exports some through its public index (features/<f>/index.ts), and uses another feature only by importing
// what that index exports (LINE-DIR). Its fixtures are scoped to it: the module sees its own fixtures, the fixtures the
// features it imports export, and the library fixtures it uses. Built from the Line profile's own readers
// (loadProject, moduleEdges, resolveSpecifier, indexExports, baseLinks, resolveBase), so it sees exactly what
// `construct validate --profile line` sees. Reads files only; never writes, never runs code, never calls a model.
// This is the block the coder's `scope` tool calls.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '@line/construct-core/config';
import { normalizeLineConfig } from '@line/construct-core/profiles/line/contract';
import {
  resolveLayout, loadProject, classify, isItemFile, moduleEdges, resolveSpecifier, resolveProjectFile, indexExports, baseLinks, resolveBase, fixtureRows,
} from '@line/construct-core/profiles/line/checks';

const posix = path.posix;
const nameOf = (rel) => { const b = posix.basename(rel).replace(/\.[^.]+$/, ''); return b === 'index' ? posix.basename(posix.dirname(rel)) : b; };

/**
 * @typedef {{name: string, file: string, base: string|null}} ScopeItem A declared item: its name, file and library base id.
 * @typedef {{name: string, file: string}} ScopeExport A name the feature's public index exports, and the file it comes from.
 * @typedef {{feature: string, index: string|null, names: string[], by: string[]}} ScopeFeatureImport Another feature this one
 *   imports: that feature's index, the names taken from it, and the importing files.
 * @typedef {{id: string, file: string, by: string[]}} ScopeLibraryImport A library item this feature uses (`<kind>/<Name>`).
 * @typedef {{stem: string, file: string, from: string, export?: string, base: string|null, rows: number|null}} ScopeFixture A
 *   fixture the module may use: `from` is 'own', 'library' or the exporting feature's name (then `export` is the name its
 *   index exports it as, the way to import it); rows is the row count of an array fixture.
 * @typedef {{feature: string, index: string|null, declares: Record<string, ScopeItem[]>, exports: ScopeExport[],
 *   imports: {features: ScopeFeatureImport[], library: ScopeLibraryImport[]}, fixtures: ScopeFixture[]}} ModuleScope
 */

/** The row count of a fixture file when it holds an array (bare, or wrapped with its base), else null. */
function rowCount(root, rel) {
  try { const rows = fixtureRows(JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'))); return rows ? rows.length : null; } catch { return null; }
}

/**
 * One feature of a Line project as a module: what it declares, exports and imports, and the fixtures it may use.
 * Pure read: the same project on disk gives the same result.
 * @param {string} root Project root.
 * @param {string} feature Feature name (a folder under the features folder).
 * @returns {ModuleScope}
 * @throws {Error} When the feature folder does not exist.
 * @example
 * moduleScope(root, 'checkout');
 * // => { feature: 'checkout', index: 'features/checkout/index.ts',
 * //      declares: { pages: [{ name: 'CheckoutPage', file: 'features/checkout/pages/CheckoutPage.tsx', base: 'pages/FormPage' }] },
 * //      exports: [], imports: { features: [{ feature: 'cart', index: 'features/cart/index.ts', names: ['CartLink'], by: [...] }],
 * //      library: [{ id: 'pages/FormPage', ... }] }, fixtures: [{ stem: 'carts', file: 'features/cart/fixtures/carts.json', from: 'cart', ... }] }
 */
export function moduleScope(root, feature) {
  const layout = resolveLayout(root, normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line));
  const folder = `${layout.features}/${feature}`;
  if (!fs.existsSync(path.join(root, folder))) throw new Error(`There is no feature "${feature}" in ${layout.features}/.`);
  const project = loadProject(root, layout);
  const own = project.files.filter((f) => f.area === 'feature' && f.feature === feature);

  /** @type {Record<string, ScopeItem[]>} */
  const declares = {};
  /** @type {ScopeFixture[]} */
  const fixtures = [];
  for (const f of own) {
    if (!isItemFile(f)) continue;
    const kind = /** @type {string} */ (f.kind);
    const link = baseLinks(project, f.rel).links[0];
    const target = link ? resolveBase(root, layout, link.value) : null;
    const base = target?.file ? `${target.kind}/${nameOf(target.file)}` : null;
    (declares[kind] ??= []).push({ name: nameOf(f.rel), file: f.rel, base });
    if (kind === 'fixtures' && f.rel.endsWith('.json')) fixtures.push({ stem: nameOf(f.rel), file: f.rel, from: 'own', base, rows: rowCount(root, f.rel) });
  }

  const mine = indexExports(project, feature);
  const exports = mine ? [...mine.names].map(([name, at]) => ({ name, file: at.from })) : [];

  /** @type {Map<string, ScopeFeatureImport>} */
  const features = new Map();
  /** @type {Map<string, ScopeLibraryImport>} */
  const library = new Map();
  for (const f of own) {
    if (!/\.[cm]?[jt]sx?$/.test(f.rel)) continue;
    const ast = project.ast(f.rel);
    if (ast instanceof Error) continue;
    for (const e of moduleEdges(ast)) {
      const target = resolveSpecifier(layout, f.rel, e.specifier);
      if (!target) continue;
      const t = classify(target, layout);
      if (t.area === 'feature' && !t.feature) t.feature = target.slice(layout.features.length + 1).split('/')[0] || undefined;
      if (t.area === 'feature' && t.feature && t.feature !== feature) {
        const entry = features.get(t.feature) ?? { feature: t.feature, index: indexExports(project, t.feature)?.file ?? null, names: [], by: [] };
        for (const n of e.names ?? []) if (n !== '*' && !entry.names.includes(n)) entry.names.push(n);
        if (!entry.by.includes(f.rel)) entry.by.push(f.rel);
        features.set(t.feature, entry);
      } else if (t.area === 'library') {
        const file = resolveProjectFile(project, target);
        const k = file ? classify(file, layout).kind : undefined;
        if (!file || !k) continue;
        const id = `${k}/${nameOf(file)}`;
        const entry = library.get(id) ?? { id, file, by: [] };
        if (!entry.by.includes(f.rel)) entry.by.push(f.rel);
        library.set(id, entry);
      }
    }
  }

  // Fixtures the imported features export from their index, then the library fixtures this module uses or bases on.
  for (const imp of features.values()) {
    const ex = indexExports(project, imp.feature);
    if (!ex) continue;
    for (const [name, { from: at }] of ex.names) {
      const where = classify(at, layout);
      if (where.kind !== 'fixtures' || !at.endsWith('.json') || fixtures.some((x) => x.file === at)) continue;
      const link = baseLinks(project, at).links[0];
      const target = link ? resolveBase(root, layout, link.value) : null;
      fixtures.push({ stem: nameOf(at), file: at, from: imp.feature, export: name, base: target?.file ? `${target.kind}/${nameOf(target.file)}` : null, rows: rowCount(root, at) });
    }
  }
  const usedLibrary = new Set([...library.keys(), ...Object.values(declares).flat().map((i) => i.base).filter(Boolean)]);
  for (const id of usedLibrary) {
    if (!String(id).startsWith('fixtures/')) continue;
    const file = resolveBase(root, layout, /** @type {string} */ (id)).file;
    if (file && file.endsWith('.json') && !fixtures.some((x) => x.file === file)) fixtures.push({ stem: nameOf(file), file, from: 'library', base: null, rows: rowCount(root, file) });
  }

  return {
    feature,
    index: mine?.file ?? null,
    declares,
    exports,
    imports: { features: [...features.values()], library: [...library.values()] },
    fixtures,
  };
}
