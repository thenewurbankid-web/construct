// Line fixes (ca2, contract.mjs LineFix): every LINE-* finding carries typed fixes an agent or Cockpit applies as
// one plan step, so an agent corrects itself from the finding alone. Static rules only: the fixes are re-derived
// from the files on disk (never from the message text), ranked recommended first, and each step names a Line tool
// whose planner is pure (ops.mjs). Applying goes through planFix -> applyChange, the one writer.
//
//   rule          case                                   recommended fix (step)
//   LINE-BASE     no / broken / wrong-kind base          line.setBase to the library item it already imports (else each library item of its kind), then line.promote
//                 several bases                          line.setBase keeping one of the valid links
//                 fixture is not valid JSON              none (step null): fix the JSON by hand
//   LINE-OWNER    page in a feature outside pages/       line.moveFile into the feature's pages/ with a page base
//                 page in the library outside pages/     line.moveFile into <library>/pages/
//                 page outside every feature             line.moveFile into the only feature's pages/ (with a base), else <library>/pages/
//                 framework route file (app/../page.tsx) none: keep it a thin route that renders a feature page
//                 one route claimed by two features      none: give one of the pages its own route
//   LINE-DIR      feature or library imports a feature   line.promote the imported item
//                 (past another feature's index)
//                 a missing export / stale index line    none: export it from that feature's index.ts / remove the line
//   LINE-WRITER   direct fs write                        none: route the write through Construct's writer, or declare a writer
//   LINE-SHARED   own copy of a shared concern           none: import the shared module
//   LINE-ATOM     hand-written copy of a logic atom      none ("use atom X", typed with the atom and its import): call the atom
//                 an atom imported outside usecases/services  none: call it from a usecase
//   LINE-LAYOUT   no library/ or features/               line.createLayout
//                 a file at the top of the library       line.moveFile into the kind it looks like
//                 a code file at the top of a feature    line.moveFile into the feature's kind folder (with a base) or the library
//                 a stray folder / a file in features/   none: say where its files belong
//                 a source file outside library/, features/ and the app/config folders
//                                                        line.moveFile into the owning feature's kind folder (the feature that imports it), else the library
//   COMPONENT-005/006, PAGE-008  inline conditional or loop  line.extractExpression into a new expression (expressions.mjs)
//
// A refused change's fix that names a file only that change creates cannot run on its own: amendFixes turns it into
// one `line.amend` step {change, fix} (planAmended: both planned in order, merged, applied atomically by applyChange).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '@line/construct-core/config';
import { normalizeLineConfig, ITEM_KINDS, CODE_EXTENSIONS, NON_ITEM_FILE } from '@line/construct-core/profiles/line/contract';
import {
  resolveLayout, loadProject, classify, isItemFile, baseLinks, resolveBase, moduleEdges, resolveSpecifier,
} from '@line/construct-core/profiles/line/checks';
import { validateLine } from '@line/construct-core/profiles/line';
import { findAtomCopies } from '@line/atoms/check';
import { LineOpError } from './contract.mjs';
import { rerankFixes } from './fixRanking.mjs';
import { toFinding } from './model.mjs';
import { planBaseOn, planPromote, planSetBase, planMoveFile, planCreateLayout, applyChange } from './ops.mjs';
import { planUseViaUsecase } from './build.mjs';
import { EXPRESSION_RULES, expressionFixes, planExtractExpression } from './expressions.mjs';

const posix = path.posix;
const SINGULAR = { components: 'component', pages: 'page', workflows: 'workflow', fixtures: 'fixture' };
const stripExt = (rel) => rel.slice(0, rel.length - posix.extname(rel).length);
const itemName = (rel) => { const b = stripExt(posix.basename(rel)); return b === 'index' ? posix.basename(posix.dirname(rel)) : b; };
const exists = (root, rel) => fs.existsSync(path.join(root, rel));

/**
 * The stable handle of a finding for a line.fix plan step.
 * @param {{rule: string, file: string, line: number}} f
 * @returns {string} "<rule>|<file>|<line>"
 */
export const findingKey = (f) => `${f.rule}|${f.file}|${f.line}`;

/**
 * What fixesFor reads, loaded once per batch of findings.
 * @param {string} root Project root.
 * @returns {any} The project facts fixesFor needs.
 */
export function fixContext(root) {
  const layout = resolveLayout(root, normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line));
  const project = loadProject(root, layout);
  /** @type {Map<string, string[]>} kind -> library ids, sorted */
  const libraryIds = new Map(ITEM_KINDS.map((k) => [k, []]));
  for (const f of project.files) {
    if (f.area === 'library' && isItemFile(f)) libraryIds.get(f.kind)?.push(`${f.kind}/${itemName(f.rel)}`);
  }
  for (const ids of libraryIds.values()) ids.sort();
  const features = (() => {
    try { return fs.readdirSync(path.join(root, layout.features), { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort(); } catch { return []; }
  })();
  return { root, layout, project, libraryIds, features };
}

/** Library items of `kind` that the code file `rel` imports, in import order. */
function importedLibraryIds(ctx, rel, kind) {
  if (!CODE_EXTENSIONS.includes(posix.extname(rel))) return [];
  const ast = ctx.project.ast(rel);
  if (ast instanceof Error) return [];
  const out = [];
  for (const e of moduleEdges(ast)) {
    const target = resolveSpecifier(ctx.layout, rel, e.specifier);
    if (!target) continue;
    const t = classify(target, ctx.layout);
    if (t.area !== 'library' || t.kind !== kind) continue;
    const id = `${kind}/${itemName(target)}`;
    if (resolveBase(ctx.root, ctx.layout, id).file && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Number fixes 1..n in order and drop duplicates. */
function ranked(list) {
  const seen = new Set();
  return list.filter((f) => !seen.has(f.id) && seen.add(f.id)).map((f, i) => ({ ...f, rank: i + 1 }));
}

const none = (id, sentence) => ({ id, sentence, rank: 1, step: null });
const libName = (id) => id.split('/')[1];

/** A promote fix for a feature item, or null when the library already has that name. */
function promoteFix(ctx, id, rel, sentence) {
  const [, kind, name] = id.split('/');
  const taken = ctx.libraryIds.get(kind)?.includes(`${kind}/${name}`);
  return taken ? null : { id, sentence, step: { tool: 'line.promote', args: { featureItemId: `${id.split('/')[0]}/${kind}/${name}` } } };
}

// ---------------------------------------------------------------------------------------------
// Per rule

function baseFixes(ctx, file) {
  const place = classify(file, ctx.layout);
  if (place.area !== 'feature' || !place.feature || !isItemFile({ rel: file, ...place })) return [];
  const { links, invalid } = baseLinks(ctx.project, file);
  const name = posix.basename(file);
  if (invalid) return [none('LINE-BASE/fix-json', `Fix the JSON of ${name} by hand, then keep one "$lineBase" link; Line cannot repair broken JSON safely.`)];
  const kind = /** @type {string} */ (place.kind);
  const all = ctx.libraryIds.get(kind) || [];
  const set = (libraryId, sentence) => ({ id: `LINE-BASE/set-base:${libraryId}`, sentence, step: { tool: 'line.setBase', args: { file, libraryId } } });
  const valid = links.map((l) => l.value).filter((v) => { const r = resolveBase(ctx.root, ctx.layout, v); return r.kind === kind && r.file; })
    .map((v) => `${kind}/${itemName(/** @type {string} */ (resolveBase(ctx.root, ctx.layout, v).file))}`);
  if (links.length > 1 && valid.length) {
    return ranked(valid.map((id) => set(id, `Keep only the base ${libName(id)} on ${name} and remove its other base links.`)));
  }
  const imported = importedLibraryIds(ctx, file, kind);
  if (imported.length === 1) return ranked([set(imported[0], `Base ${name} on the library ${SINGULAR[kind]} ${libName(imported[0])}, which it already uses.`)]);
  const featureItemId = `${place.feature}/${kind}/${itemName(file)}`;
  const list = [
    ...imported.map((id) => set(id, `Base ${name} on the library ${SINGULAR[kind]} ${libName(id)}, which it already uses.`)),
    ...all.filter((id) => !imported.includes(id)).map((id) => set(id, `Base ${name} on the library ${SINGULAR[kind]} ${libName(id)}.`)),
  ];
  const promote = promoteFix(ctx, featureItemId, file, `Move ${name} into the library as a new library ${SINGULAR[kind]}, so it needs no base.`);
  if (promote) list.push({ ...promote, id: 'LINE-BASE/promote' });
  return list.length ? ranked(list) : [none('LINE-BASE/create-library-item', `Create a library ${SINGULAR[kind]} for ${name} to be based on first; the library has none and one with its name already exists.`)];
}

/** The page name a moved page keeps: its own name, or "<Folder>Page" for a framework `page.tsx`. */
function pageFileName(rel) {
  const base = posix.basename(rel);
  if (!/^page\.[cm]?[jt]sx?$/.test(base)) return base.replace(/\.page(\.[cm]?[jt]sx?)$/, '$1');
  const dir = posix.basename(posix.dirname(rel)).replace(/[^A-Za-z0-9]+(.)?/g, (_m, c) => (c ? c.toUpperCase() : ''));
  return `${dir ? dir.charAt(0).toUpperCase() + dir.slice(1) : 'Home'}Page${posix.extname(base)}`;
}

function ownerFixes(ctx, file) {
  const place = classify(file, ctx.layout);
  const name = posix.basename(file);
  if (place.area === 'feature' && place.kind === 'pages') {
    return [none('LINE-OWNER/own-route', `Keep this route in one feature and give ${name} its own "@line-route"; Line cannot choose which feature owns a route.`)];
  }
  const libPages = ctx.libraryIds.get('pages') || [];
  const imported = importedLibraryIds(ctx, file, 'pages');
  const bases = [...imported, ...libPages.filter((id) => !imported.includes(id))];
  const dest = pageFileName(file);
  const toFeature = (feature, base) => {
    const to = `${ctx.layout.features}/${feature}/pages/${dest}`;
    return exists(ctx.root, to) ? null : { id: `LINE-OWNER/move-to-feature:${feature}:${base}`, sentence: `Move ${name} into feature ${feature}'s pages/ folder, based on the library page ${libName(base)}.`, step: { tool: 'line.moveFile', args: { from: file, to, base } } };
  };
  const toLibrary = () => {
    const to = `${ctx.layout.library}/pages/${dest}`;
    return exists(ctx.root, to) ? null : { id: 'LINE-OWNER/move-to-library', sentence: `Move ${name} into the library's pages/ folder as a full library page.`, step: { tool: 'line.moveFile', args: { from: file, to } } };
  };
  if (place.area === 'library') return ranked([toLibrary()].filter(Boolean));
  if (place.area === 'feature' && place.feature) {
    // Imported library pages first; with none, the library page itself is the safe landing (no base needed).
    const list = imported.length ? [...imported.map((b) => toFeature(place.feature, b)), toLibrary()] : [toLibrary(), ...bases.map((b) => toFeature(place.feature, b))];
    return ranked(list.filter(Boolean));
  }
  const segs = file.split('/');
  if (/^page\.[cm]?[jt]sx?$/.test(segs[segs.length - 1]) && segs.slice(0, -1).includes('app')) {
    return [none('LINE-OWNER/thin-route', `Keep ${file} as a thin framework route that renders a page from ${ctx.layout.features}/<feature>/pages/; moving it would change the app's URLs, so Line does not move it.`)];
  }
  const only = ctx.features.length === 1 && imported.length ? ctx.features.map((f) => toFeature(f, imported[0])) : [];
  const rest = ctx.features.flatMap((f) => (imported.length ? imported : bases.slice(0, 1)).map((b) => toFeature(f, b)));
  return ranked([...only, toLibrary(), ...rest].filter(Boolean));
}

/** The feature item a root-relative import target names, or null (a barrel, a folder or a non-item file). */
function featureItemAt(ctx, target) {
  const t = classify(target, ctx.layout);
  if (t.area !== 'feature' || !t.feature || !t.kind) return null;
  const hit = ctx.project.files.find((f) => f.area === 'feature' && isItemFile(f) && (f.rel === target || stripExt(f.rel) === target || stripExt(f.rel) === `${target}/index`));
  if (!hit || NON_ITEM_FILE.test(posix.basename(hit.rel))) return null;
  const rest = hit.rel.slice(`${ctx.layout.features}/${t.feature}/${t.kind}/`.length);
  if (rest.includes('/')) return null; // nested deeper than <kind>/<Name>: not one item planPromote can find
  return { id: `${t.feature}/${t.kind}/${itemName(hit.rel)}`, rel: hit.rel };
}

function dirFixes(ctx, file, line) {
  const ast = CODE_EXTENSIONS.includes(posix.extname(file)) ? ctx.project.ast(file) : null;
  const edges = !ast || ast instanceof Error ? [] : moduleEdges(ast).filter((e) => e.line === line);
  const from = classify(file, ctx.layout);
  for (const e of edges) {
    const target = resolveSpecifier(ctx.layout, file, e.specifier);
    if (!target) continue;
    const t = classify(target, ctx.layout);
    if (t.area === 'feature' && !t.feature) t.feature = target.slice(ctx.layout.features.length + 1).split('/')[0] || undefined;
    if (t.area !== 'feature' || (from.area === 'feature' && t.feature === from.feature)) continue;
    // #935: an import of another feature's public index that names a missing export (or finds no index).
    const folder = `${ctx.layout.features}/${t.feature}`;
    if (from.area === 'feature' && (target === folder || stripExt(target) === `${folder}/index`)) {
      return [none('LINE-DIR/export', `Export what "${e.specifier}" is asked for from ${folder}/index.ts (feature ${t.feature} decides what it exports), or import something that index already exports.`)];
    }
    const item = featureItemAt(ctx, target);
    if (!item) return [none('LINE-DIR/move-by-hand', `Move what "${e.specifier}" provides into ${ctx.layout.library}/ and import it from there; it is not a single feature item Line can promote.`)];
    const fix = promoteFix(ctx, item.id, item.rel, `Move ${posix.basename(item.rel)} from feature ${item.id.split('/')[0]} into the library and point every import at the library copy.`);
    return fix ? ranked([{ ...fix, id: 'LINE-DIR/promote' }])
      : [none('LINE-DIR/rename-first', `Rename ${posix.basename(item.rel)} first: the library already has an item with that name, so it cannot be promoted as is.`)];
  }
  if (from.area === 'feature' && from.feature && /^index\.[cm]?[jt]sx?$/.test(posix.basename(file)) && posix.dirname(file) === `${ctx.layout.features}/${from.feature}`) {
    return [none('LINE-DIR/stale-export', `Remove the export line ${line} of ${file}, or restore the file it names; another feature imports this public index.`)];
  }
  return [none('LINE-DIR/move-by-hand', `Import this from ${ctx.layout.library}/ or through the other feature's public index (its index.ts); Line could not find the imported item to promote.`)];
}

/** The kind a loose library or feature file most likely is. */
function guessKind(rel) {
  const ext = posix.extname(rel);
  if (ext === '.json') return 'fixtures';
  if (posix.basename(rel).match(/(^page\.|\.page\.|Page\.)/)) return 'pages';
  if (ext === '.tsx' || ext === '.jsx') return 'components';
  return CODE_EXTENSIONS.includes(ext) ? 'workflows' : null;
}

/** The features (and whether the library) import the root-relative file `rel`. */
function importersOf(ctx, rel) {
  const features = new Set();
  let library = false;
  for (const f of ctx.project.files) {
    if (f.rel === rel || !CODE_EXTENSIONS.includes(posix.extname(f.rel)) || (f.area !== 'feature' && f.area !== 'library')) continue;
    const ast = ctx.project.ast(f.rel);
    if (ast instanceof Error) continue;
    const hit = moduleEdges(ast).some((e) => { const t = resolveSpecifier(ctx.layout, f.rel, e.specifier); return t && (t === rel || t === stripExt(rel)); });
    if (!hit) continue;
    if (f.area === 'library') library = true;
    else if (f.feature) features.add(f.feature);
  }
  return { features: [...features].sort(), library };
}

/** A source file outside the library and the features: into the feature that alone uses it, else the library. */
function strayFixes(ctx, file) {
  const name = posix.basename(file);
  const kind = guessKind(file) ?? 'workflows';
  const { features, library } = importersOf(ctx, file);
  const owner = features.length === 1 && !library ? features[0] : null;
  const inLibrary = `${ctx.layout.library}/${kind}/${name}`;
  const toLibrary = exists(ctx.root, inLibrary) ? null : { id: `LINE-LAYOUT/stray-to-library:${kind}`, sentence: `Move ${name} into the library's ${kind}/ folder${features.length > 1 ? `, since features ${features.join(' and ')} both use it` : ''}.`, step: { tool: 'line.moveFile', args: { from: file, to: inLibrary } } };
  let toFeature = null;
  if (owner) {
    const inFeature = `${ctx.layout.features}/${owner}/${kind}/${name}`;
    const has = baseLinks(ctx.project, file).links.some((l) => resolveBase(ctx.root, ctx.layout, l.value).kind === kind);
    const base = has ? null : importedLibraryIds(ctx, file, kind)[0] ?? null;
    if (!exists(ctx.root, inFeature) && (has || base)) {
      toFeature = { id: `LINE-LAYOUT/stray-to-feature:${owner}:${kind}`, sentence: `Move ${name} into feature ${owner}'s ${kind}/ folder, the only feature that uses it.`, step: { tool: 'line.moveFile', args: { from: file, to: inFeature, ...(base ? { base } : {}) } } };
    }
  }
  const list = (owner ? [toFeature, toLibrary] : [toLibrary]).filter(Boolean);
  return list.length ? ranked(list) : [none('LINE-LAYOUT/move-by-hand', `Move ${name} into the library or into the feature that uses it; Line cannot move it there because a file with that name is already in place.`)];
}

function layoutFixes(ctx, file) {
  if (file === '.') return [{ id: 'LINE-LAYOUT/create-layout', sentence: `Create the library folder ${ctx.layout.library}/ so this project is laid out as a Line project.`, rank: 1, step: { tool: 'line.createLayout', args: {} } }];
  const isDir = fs.statSync(path.join(ctx.root, file), { throwIfNoEntry: false })?.isDirectory();
  const name = posix.basename(file);
  const kinds = ITEM_KINDS.map((k) => `${k}/`).join(', ');
  if (isDir) return [none('LINE-LAYOUT/move-folder-by-hand', `Move each file in ${file}/ into one of ${kinds} and remove the folder; Line cannot tell which kind each file is.`)];
  if (classify(file, ctx.layout).area === 'other' && CODE_EXTENSIONS.includes(posix.extname(file))) return strayFixes(ctx, file);
  const segs = file.slice(ctx.layout.features.length + 1).split('/');
  const kind = guessKind(file);
  if (file.startsWith(`${ctx.layout.library}/`)) {
    const to = kind && `${ctx.layout.library}/${kind}/${name}`;
    return to && !exists(ctx.root, to) ? [{ id: `LINE-LAYOUT/move-to:${kind}`, sentence: `Move ${name} into the library's ${kind}/ folder.`, rank: 1, step: { tool: 'line.moveFile', args: { from: file, to } } }]
      : [none('LINE-LAYOUT/move-by-hand', `Move ${name} into one of the library's ${kinds} folders, or out of the library if it is not an item.`)];
  }
  if (file.startsWith(`${ctx.layout.features}/`) && segs.length === 2 && kind) {
    const feature = segs[0];
    const imported = importedLibraryIds(ctx, file, kind);
    const inFeature = `${ctx.layout.features}/${feature}/${kind}/${name}`;
    const inLibrary = `${ctx.layout.library}/${kind}/${name}`;
    const list = [
      ...imported.map((base) => (!exists(ctx.root, inFeature) ? { id: `LINE-LAYOUT/move-to-feature:${kind}:${base}`, sentence: `Move ${name} into feature ${feature}'s ${kind}/ folder, based on the library ${SINGULAR[kind]} ${libName(base)}.`, step: { tool: 'line.moveFile', args: { from: file, to: inFeature, base } } } : null)),
      !exists(ctx.root, inLibrary) ? { id: `LINE-LAYOUT/move-to-library:${kind}`, sentence: `Move ${name} into the library's ${kind}/ folder.`, step: { tool: 'line.moveFile', args: { from: file, to: inLibrary } } } : null,
    ].filter(Boolean);
    if (list.length) return ranked(list);
  }
  return [none('LINE-LAYOUT/move-by-hand', `Move ${name} into a feature's ${kinds} folder or into the library; Line cannot tell where it belongs.`)];
}

/**
 * bench-gaps 1: Construct's layer rules a page or component breaks by importing an application layer (pilot H2/H3:
 * PAGE-003 on a page calling the cart service, COMPONENT-003 on a component reading the cart store). The fix is the
 * Line way: reach it through a usecase of the same feature (or a library usecase), one line.useViaUsecase step.
 */
export const LAYER_IMPORT_RULES = Object.freeze(['PAGE-002', 'PAGE-003', 'PAGE-005', 'COMPONENT-003']);

function layerImportFixes(ctx, file, line, rule) {
  const ast = CODE_EXTENSIONS.includes(posix.extname(file)) ? ctx.project.ast(file) : null;
  const edges = !ast || ast instanceof Error ? [] : moduleEdges(ast);
  const re = { 'PAGE-002': /workflows?\//, 'PAGE-003': /services?\//, 'PAGE-005': /domain\//, 'COMPONENT-003': /(?:workflows?|services?|domain)\// }[rule];
  const edge = edges.find((e) => e.line === line && re.test(e.specifier)) ?? edges.find((e) => re.test(e.specifier));
  const isPage = rule.startsWith('PAGE-');
  const props = none(`${rule}/pass-as-props`, `Pass what ${posix.basename(file)} needs from "${edge?.specifier ?? 'that module'}" in as props instead; the ${isPage ? 'page' : 'component'} then only presents it.`);
  if (!edge) return [props];
  const place = classify(file, ctx.layout);
  const where = place.area === 'feature' && place.feature ? `feature ${place.feature}'s usecases/` : 'the library\'s usecases/';
  return ranked([
    { id: `${rule}/use-via-usecase`, sentence: `Import "${edge.specifier}" through a usecase in ${where} instead, since a ${isPage ? 'page' : 'component'} may not import application logic directly.`, step: { tool: 'line.useViaUsecase', args: { file, specifier: edge.specifier } } },
    { ...props, step: null },
  ]);
}

/**
 * The typed fixes for one finding, recommended first (rank 1 is the "likely" one). A finding of a rule with no fixes gets none.
 * @param {string} root Project root.
 * @param {import('./contract.mjs').LineFinding} finding
 * @param {ReturnType<typeof fixContext>} [ctx] Reuse one context across many findings.
 * @returns {import('./contract.mjs').LineFix[]}
 */
export function fixesFor(root, finding, ctx = fixContext(root)) {
  // cs2: reviewed fix-ranking rules (fix-ranking.json, from the static rule factory) may reorder the static ranking.
  return rerankFixes(finding.rule, staticFixesFor(finding, ctx));
}

/** The fixes the static rules derive, ranked, before the reviewed fix-ranking rules. */
function staticFixesFor(finding, ctx) {
  const { rule, file, line } = finding;
  switch (rule) {
    case 'LINE-BASE': return baseFixes(ctx, file);
    case 'LINE-OWNER': return ownerFixes(ctx, file);
    case 'LINE-DIR': return dirFixes(ctx, file, line);
    case 'LINE-LAYOUT': return layoutFixes(ctx, file);
    case 'LINE-WRITER': {
      const fn = (finding.sentence.match(/with (\w+)\(\)/) || [])[1] ?? 'this write';
      return [none('LINE-WRITER/use-writer', `Send the ${fn === 'this write' ? 'write' : `${fn}() call`} in ${posix.basename(file)} through Construct's writer (createTransaction, then commit), or list the file under line.writers in architecture.yml if it is meant to write; Line cannot rewrite file writes safely.`)];
    }
    case 'LINE-SHARED': {
      const mod = (finding.sentence.match(/use the shared module (.+?) instead/) || [])[1] ?? 'the shared module';
      return [none('LINE-SHARED/use-shared', `Replace the copy in ${posix.basename(file)} with a call to ${mod}; Line cannot rewrite that code safely.`)];
    }
    case 'LINE-ATOM': {
      // Re-derived from the file: the atom check's own typed fixes for the finding on this line.
      const ast = ctx.project.ast(file);
      if (ast instanceof Error) return [];
      const kind = classify(file, ctx.layout).kind;
      const hit = findAtomCopies({ file, source: ctx.project.source(file), ast, kind }).find((h) => h.line === line);
      return hit ? hit.fixes : [];
    }
    default:
      if (EXPRESSION_RULES.includes(rule)) return expressionFixes(ctx.root, file, rule);
      return LAYER_IMPORT_RULES.includes(rule) ? layerImportFixes(ctx, file, line, rule) : [];
  }
}

/** Whether fixesFor knows fixes for a rule (LINE-*, the layer import rules and the expression rules). */
const hasFixes = (rule) => String(rule).startsWith('LINE-') || LAYER_IMPORT_RULES.includes(String(rule)) || EXPRESSION_RULES.includes(String(rule));

/**
 * Findings with their key and fixes attached (one context for the batch).
 * @param {string} root
 * @param {import('./contract.mjs').LineFinding[]} findings
 * @returns {import('./contract.mjs').LineFinding[]}
 */
export function withFixes(root, findings) {
  let ctx = null;
  return findings.map((f) => {
    if (!hasFixes(f.rule)) return { ...f, key: findingKey(f) };
    ctx ??= fixContext(root);
    return { ...f, key: findingKey(f), fixes: fixesFor(root, f, ctx) };
  });
}

/**
 * Raw validate violations with each LINE-* one carrying its key and fixes (one context for the batch); others are
 * returned as they are. The one place `construct validate --format json` and Cockpit's GET /api/validate attach them.
 * @template {{rule: string, file?: string, line?: number, message?: string, severity?: string}} V
 * @param {string} root
 * @param {V[]} violations
 * @returns {(V & {key?: string, fixes?: import('./contract.mjs').LineFix[]})[]}
 */
export function withViolationFixes(root, violations) {
  if (!violations.some((v) => hasFixes(v.rule))) return violations;
  const ctx = fixContext(root);
  return violations.map((v) => {
    if (!hasFixes(v.rule)) return v;
    const f = toFinding(/** @type {any} */ (v));
    return { ...v, key: findingKey(f), fixes: fixesFor(root, f, ctx) };
  });
}

/**
 * Plan one fix step (the tool -> planner table). Pure.
 * @param {string} root
 * @param {{tool: string, args: Record<string, any>}} step
 * @returns {import('./contract.mjs').StagedChange}
 */
export function planStep(root, step) {
  switch (step?.tool) {
    case 'line.setBase': return planSetBase(root, /** @type {any} */ (step.args));
    case 'line.promote': return planPromote(root, /** @type {any} */ (step.args));
    case 'line.baseOn': return planBaseOn(root, /** @type {any} */ (step.args));
    case 'line.moveFile': return planMoveFile(root, /** @type {any} */ (step.args));
    case 'line.createLayout': return planCreateLayout(root);
    case 'line.useViaUsecase': return planUseViaUsecase(root, /** @type {any} */ (step.args));
    case 'line.extractExpression': return planExtractExpression(root, /** @type {any} */ (step.args));
    default: throw new LineOpError(`"${step?.tool}" is not a Line tool.`, 'UNKNOWN_TOOL');
  }
}

// ---------------------------------------------------------------------------------------------
// Amended changes: a fix for a refused change that names a file only that change creates

const SCRATCH_SKIP = /[\\/](node_modules|\.git)([\\/]|$)/;

/**
 * Run `fn` on a scratch copy of the project (no node_modules, no .git) with `staged` written into it, then remove the
 * copy. The project itself is never touched; this is how the findings and fixes of a change that was not saved are
 * worked out.
 * @template T
 * @param {string} root @param {import('./contract.mjs').StagedChange} staged @param {(scratch: string) => T} fn
 * @returns {T}
 */
export function onScratch(root, staged, fn) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-line-scratch-'));
  try {
    fs.cpSync(root, scratch, { recursive: true, filter: (src) => { const rel = path.relative(root, src); return !rel || !SCRATCH_SKIP.test(`/${rel}`); } });
    writeInto(scratch, staged);
    return fn(scratch);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/** Write a staged change into a scratch copy (never the project). */
function writeInto(scratch, staged) {
  for (const f of staged.files) {
    const abs = path.join(scratch, f.path);
    if (f.content === null) fs.rmSync(abs, { force: true });
    else { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, f.content); }
  }
}

/** The project files a fix step works on (its `file`, the `from` of a move). */
const stepInputs = (step) => [step?.args?.file, step?.args?.from].filter((v) => typeof v === 'string');
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const noStop = (s) => String(s).replace(/[.?!]$/, '');

/**
 * Plan a refused change and its fix (or a chain of fixes, in order) as ONE change: each fix is planned on a scratch
 * copy that holds the refused change and the fixes before it (where its files exist), and all are merged in order,
 * the later winning per file. A file the refused change created and a fix removed again is left out (it never
 * existed on disk). Pure for the project.
 * @param {string} root
 * @param {import('./contract.mjs').StagedChange} first The refused change, as planned on the project.
 * @param {{tool: string, args: Record<string, any>} | {tool: string, args: Record<string, any>}[]} fix One typed fix step (planStep tools), or several in order.
 * @returns {import('./contract.mjs').StagedChange}
 * @throws {LineOpError} When a fix cannot be planned even with the refused change in place.
 */
export function planAmended(root, first, fix) {
  const steps = Array.isArray(fix) ? fix : [fix];
  if (!steps.length) throw new LineOpError('Name at least one fix to amend the change with.', 'BAD_ARGS');
  const merged = new Map(first.files.map((f) => [f.path, f.content]));
  const summaries = onScratch(root, first, (scratch) => steps.map((step) => {
    const c = planStep(scratch, step);
    writeInto(scratch, c);
    for (const f of c.files) merged.set(f.path, f.content);
    return noStop(c.summary);
  }));
  const files = [...merged].filter(([p, c]) => c !== null || exists(root, p)).map(([p, c]) => ({ path: p, content: c }));
  return { summary: `${noStop(first.summary)}, and in the same step ${summaries.map(lowerFirst).join(', then ')}.`, files };
}

/**
 * Whether Construct's writer would accept `change`: applyChange itself, run on a scratch copy of the project (the
 * project is never touched). The result says why not.
 * @param {string} root @param {import('./contract.mjs').StagedChange} change
 * @returns {import('./contract.mjs').ApplyResult}
 */
export function wouldLand(root, change) {
  return onScratch(root, { summary: 'Nothing.', files: [] }, (scratch) => applyChange(scratch, change));
}

/** How many dependencies a chained promote may pull in first. */
const MAX_CHAIN = 3;

/**
 * The fixes of a refused change's findings, checked and made runnable (cl1 + experiment fix 1):
 *   - a fix whose file only the refused change creates (or that only plans with the change in place) becomes one
 *     `line.amend` step carrying the refused change and the fix together, applied atomically by the writer;
 *   - each fix is tried on a scratch copy through the writer (wouldLand); only fixes that would land keep a step and
 *     come first, so the recommended fix (rank 1) is one that works;
 *   - a promote blocked by the item's own feature dependencies becomes the chained fix: promote the dependencies first,
 *     then the item, with the refused change, as one line.amend step (one approval);
 *   - a fix that would still be refused becomes advice (step null) that says why.
 * Only the first three error findings are worked (the ones Cockpit offers); the rest come back as they are.
 * @param {string} root
 * @param {{tool: string, args: Record<string, any>}} refused The refused change step (its request, without plan fields).
 * @param {import('./contract.mjs').StagedChange} staged The refused change as planned.
 * @param {import('./contract.mjs').LineFinding[]} findings With fixes (worked out on the scratch copy).
 * @returns {import('./contract.mjs').LineFinding[]}
 */
export function amendFixes(root, refused, staged, findings) {
  const created = new Set(staged.files.filter((f) => f.content !== null && !exists(root, f.path)).map((f) => f.path));
  const runsAlone = (step) => { try { planStep(root, step); return true; } catch { return false; } };
  const plan = (fn) => { try { return fn(); } catch { return null; } };
  const carry = { tool: refused.tool, args: { ...refused.args } };
  const amendStep = (fixes) => ({ tool: 'line.amend', args: fixes.length === 1 ? { change: carry, fix: { ...fixes[0] } } : { change: carry, fixes: fixes.map((f) => ({ ...f })) } });
  const together = (sentence) => `${noStop(sentence)}, together with the change Construct refused, in one step.`;

  /** A promote that the writer refuses because the item uses other feature items: promote those first, in one step. */
  function chain(x, attempted, land) {
    const deps = [];
    let change = attempted;
    let result = land;
    for (let i = 0; i < MAX_CHAIN && !result.ok; i += 1) {
      const errors = result.findings.filter((f) => f.severity === 'error');
      if (!errors.length || errors.some((f) => f.rule !== 'LINE-DIR')) return null;
      const next = (plan(() => onScratch(root, change, (s) => withFixes(s, errors))) ?? [])
        .flatMap((f) => f.fixes ?? []).map((f) => f.step)
        .filter((st) => st?.tool === 'line.promote' && st.args.featureItemId !== x.step.args.featureItemId && !deps.some((d) => d.args.featureItemId === st.args.featureItemId));
      if (!next.length) return null;
      deps.unshift(...next);
      change = plan(() => planAmended(root, staged, [...deps, x.step]));
      if (!change) return null;
      result = wouldLand(root, change);
    }
    if (!result.ok) return null;
    const names = deps.map((d) => String(d.args.featureItemId).split('/').at(-1));
    const item = String(x.step.args.featureItemId).split('/').at(-1);
    return {
      step: amendStep([...deps, x.step]),
      sentence: together(`First move ${names.join(' and ')} into the library, because ${item} uses ${names.length === 1 ? 'it' : 'them'}; then ${lowerFirst(noStop(x.sentence))}`),
    };
  }

  /** One fix as it would run: {step, sentence} when the writer would accept it, else {refusedBy}. */
  function work(x) {
    const amend = stepInputs(x.step).some((p) => created.has(p)) || !runsAlone(x.step);
    const change = plan(() => (amend ? planAmended(root, staged, x.step) : planStep(root, x.step)));
    if (!change) return { refusedBy: 'it cannot be planned on the project as it is' };
    const land = wouldLand(root, change);
    if (land.ok) return amend ? { step: amendStep([x.step]), sentence: together(x.sentence) } : { step: x.step, sentence: x.sentence };
    if (x.step.tool === 'line.promote') {
      // The chain carries the refused change too, so its first try is the change plus this promote.
      const withChange = amend ? change : plan(() => planAmended(root, staged, x.step));
      const chained = withChange ? chain(x, withChange, amend ? land : wouldLand(root, withChange)) : null;
      if (chained) return chained;
    }
    const first = land.findings.find((f) => f.severity === 'error');
    return { refusedBy: first ? lowerFirst(noStop(first.sentence)) : lowerFirst(noStop(land.sentence.replace(/^Nothing was saved: /, ''))) };
  }

  let worked = 0;
  return findings.map((f) => {
    if (f.severity !== 'error' || !Array.isArray(f.fixes) || !f.fixes.some((x) => x.step) || worked >= 3) return f;
    worked += 1;
    const out = f.fixes.map((x) => {
      if (!x.step || x.step.tool === 'line.amend') return { fix: x, lands: Boolean(x.step) };
      const w = work(x);
      return w.step ? { fix: { ...x, sentence: w.sentence, step: w.step }, lands: true }
        : { fix: { ...x, sentence: `${noStop(x.sentence)}; Construct would refuse that too, because ${w.refusedBy}.`, step: null }, lands: false };
    });
    const fixes = [...out.filter((o) => o.lands), ...out.filter((o) => !o.lands)].map((o, i) => ({ ...o.fix, rank: i + 1 }));
    return { ...f, fixes };
  });
}

/**
 * Plan the fix `fixId` of `finding`, re-derived from the files as they are now. Pure.
 * @param {string} root
 * @param {import('./contract.mjs').LineFinding} finding
 * @param {string} fixId
 * @returns {import('./contract.mjs').StagedChange}
 * @throws {LineOpError} UNKNOWN_FIX, or NO_STEP (with the fix's sentence) when the fix is advice only.
 */
export function planFix(root, finding, fixId) {
  const fix = fixesFor(root, finding).find((x) => x.id === fixId);
  if (!fix) throw new LineOpError(`That fix no longer applies to this problem; reload the project and pick again.`, 'UNKNOWN_FIX');
  if (!fix.step) throw new LineOpError(fix.sentence, 'NO_STEP');
  return planStep(root, fix.step);
}

/**
 * applyFix (CLI and mock mode; Cockpit uses the line.fix plan step): find the finding by key in the current validate result, plan its fix, apply it through the writer.
 * @param {string} root
 * @param {import('./contract.mjs').FixRequest} req
 * @returns {import('./contract.mjs').ApplyResult}
 * @throws {LineOpError} UNKNOWN_FINDING, UNKNOWN_FIX or NO_STEP.
 */
export function applyFix(root, req = /** @type {any} */ ({})) {
  return applyChange(root, planFixByKey(root, req));
}

/**
 * cp1: the plan half of applyFix (the `line.fix` plan tool): find the finding by key in the current
 * validate result and plan its fix, without writing. Pure.
 * @param {string} root
 * @param {import('./contract.mjs').FixRequest} req
 * @returns {import('./contract.mjs').StagedChange}
 * @throws {LineOpError} UNKNOWN_FINDING, UNKNOWN_FIX or NO_STEP.
 */
export function planFixByKey(root, { findingKey: key, fixId } = /** @type {any} */ ({})) {
  const finding = validateLine(root).violations.map(toFinding).find((f) => findingKey(f) === key);
  if (!finding) throw new LineOpError('That problem is no longer reported; reload the project to see what is left.', 'UNKNOWN_FINDING');
  return planFix(root, finding, String(fixId ?? ''));
}
