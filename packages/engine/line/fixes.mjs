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
//   LINE-WRITER   direct fs write                        none: route the write through Construct's writer, or declare a writer
//   LINE-SHARED   own copy of a shared concern           none: import the shared module
//   LINE-LAYOUT   no library/ or features/               line.createLayout
//                 a file at the top of the library       line.moveFile into the kind it looks like
//                 a code file at the top of a feature    line.moveFile into the feature's kind folder (with a base) or the library
//                 a stray folder / a file in features/   none: say where its files belong
//                 a source file outside library/, features/ and the app/config folders
//                                                        line.moveFile into the owning feature's kind folder (the feature that imports it), else the library
//
// A refused change's fix that names a file only that change creates cannot run on its own: amendFixes turns it into
// one `line.amend` step {change, fix} (planAmended: both planned in order, merged, applied atomically by applyChange).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../core/config.mjs';
import { normalizeLineConfig, ITEM_KINDS, CODE_EXTENSIONS, NON_ITEM_FILE } from '../../core/profiles/line/contract.mjs';
import {
  resolveLayout, loadProject, classify, isItemFile, baseLinks, resolveBase, moduleEdges, resolveSpecifier,
} from '../../core/profiles/line/checks.mjs';
import { validateLine } from '../../core/profiles/line/index.mjs';
import { LineOpError } from './contract.mjs';
import { toFinding } from './model.mjs';
import { planBaseOn, planPromote, planSetBase, planMoveFile, planCreateLayout, applyChange } from './ops.mjs';

const posix = path.posix;
const SINGULAR = { components: 'component', pages: 'page', workflows: 'workflow', fixtures: 'fixture' };
const stripExt = (rel) => rel.slice(0, rel.length - posix.extname(rel).length);
const itemName = (rel) => { const b = stripExt(posix.basename(rel)); return b === 'index' ? posix.basename(posix.dirname(rel)) : b; };
const exists = (root, rel) => fs.existsSync(path.join(root, rel));

/**
 * The stable handle of a finding for POST /api/line/fix.
 * @param {{rule: string, file: string, line: number}} f
 * @returns {string} "<rule>|<file>|<line>"
 */
export const findingKey = (f) => `${f.rule}|${f.file}|${f.line}`;

/**
 * What fixesFor reads, loaded once per batch of findings.
 * @param {string} root Project root.
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
    if (t.area !== 'feature' || (from.area === 'feature' && t.feature === from.feature)) continue;
    const item = featureItemAt(ctx, target);
    if (!item) return [none('LINE-DIR/move-by-hand', `Move what "${e.specifier}" provides into ${ctx.layout.library}/ and import it from there; it is not a single feature item Line can promote.`)];
    const fix = promoteFix(ctx, item.id, item.rel, `Move ${posix.basename(item.rel)} from feature ${item.id.split('/')[0]} into the library and point every import at the library copy.`);
    return fix ? ranked([{ ...fix, id: 'LINE-DIR/promote' }])
      : [none('LINE-DIR/rename-first', `Rename ${posix.basename(item.rel)} first: the library already has an item with that name, so it cannot be promoted as is.`)];
  }
  return [none('LINE-DIR/move-by-hand', `Import this from ${ctx.layout.library}/ instead of another feature; Line could not find the imported item to promote.`)];
}

/** The kind a loose library or feature file most likely is. */
function guessKind(rel) {
  const ext = posix.extname(rel);
  if (ext === '.json') return 'fixtures';
  if (posix.basename(rel).match(/(^page\.|\.page\.|Page\.)/)) return 'pages';
  if (ext === '.tsx' || ext === '.jsx') return 'components';
  return CODE_EXTENSIONS.includes(ext) ? 'workflows' : null;
}

function layoutFixes(ctx, file) {
  if (file === '.') return [{ id: 'LINE-LAYOUT/create-layout', sentence: `Create the library folder ${ctx.layout.library}/ so this project is laid out as a Line project.`, rank: 1, step: { tool: 'line.createLayout', args: {} } }];
  const isDir = fs.statSync(path.join(ctx.root, file), { throwIfNoEntry: false })?.isDirectory();
  const name = posix.basename(file);
  const kinds = ITEM_KINDS.map((k) => `${k}/`).join(', ');
  if (isDir) return [none('LINE-LAYOUT/move-folder-by-hand', `Move each file in ${file}/ into one of ${kinds} and remove the folder; Line cannot tell which kind each file is.`)];
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
 * The typed fixes for one finding, recommended first (rank 1 is the "likely" one). A non-LINE-* finding gets none.
 * @param {string} root Project root.
 * @param {import('./contract.mjs').LineFinding} finding
 * @param {ReturnType<typeof fixContext>} [ctx] Reuse one context across many findings.
 * @returns {import('./contract.mjs').LineFix[]}
 */
export function fixesFor(root, finding, ctx = fixContext(root)) {
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
    default: return [];
  }
}

/**
 * Findings with their key and fixes attached (one context for the batch).
 * @param {string} root
 * @param {import('./contract.mjs').LineFinding[]} findings
 * @returns {import('./contract.mjs').LineFinding[]}
 */
export function withFixes(root, findings) {
  let ctx = null;
  return findings.map((f) => {
    if (!f.rule.startsWith('LINE-')) return { ...f, key: findingKey(f) };
    ctx ??= fixContext(root);
    return { ...f, key: findingKey(f), fixes: fixesFor(root, f, ctx) };
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
    for (const f of staged.files) {
      const abs = path.join(scratch, f.path);
      if (f.content === null) fs.rmSync(abs, { force: true });
      else { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, f.content); }
    }
    return fn(scratch);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/** The project files a fix step works on (its `file`, the `from` of a move). */
const stepInputs = (step) => [step?.args?.file, step?.args?.from].filter((v) => typeof v === 'string');

/**
 * Plan a refused change and one fix of it as ONE change: the fix is planned on a scratch copy that holds the refused
 * change (where the fix's file exists), and both are merged in order, the fix winning per file. A file the refused
 * change created and the fix removed again is left out (it never existed on disk). Pure for the project.
 * @param {string} root
 * @param {import('./contract.mjs').StagedChange} first The refused change, as planned on the project.
 * @param {{tool: string, args: Record<string, any>}} fixStep A typed fix step (planStep tools).
 * @returns {import('./contract.mjs').StagedChange}
 * @throws {LineOpError} When the fix cannot be planned even with the refused change in place.
 */
export function planAmended(root, first, fixStep) {
  const second = onScratch(root, first, (scratch) => planStep(scratch, fixStep));
  const merged = new Map(first.files.map((f) => [f.path, f.content]));
  for (const f of second.files) merged.set(f.path, f.content);
  const files = [...merged].filter(([p, c]) => c !== null || exists(root, p)).map(([p, c]) => ({ path: p, content: c }));
  const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  return { summary: `${first.summary.replace(/[.?!]$/, '')}, and in the same step ${lowerFirst(second.summary)}`, files };
}

/**
 * The fixes of a refused change's findings, made runnable: a fix whose file only the refused change creates (or that
 * cannot be planned on the project as it is, but can with the change in place) becomes one `line.amend` step that
 * carries the refused change and the fix together, applied atomically by the writer. Other fixes stay as they are.
 * @param {string} root
 * @param {{tool: string, args: Record<string, any>}} refused The refused change step (its request, without plan fields).
 * @param {import('./contract.mjs').StagedChange} staged The refused change as planned.
 * @param {import('./contract.mjs').LineFinding[]} findings With fixes (worked out on the scratch copy).
 * @returns {import('./contract.mjs').LineFinding[]}
 */
export function amendFixes(root, refused, staged, findings) {
  const created = new Set(staged.files.filter((f) => f.content !== null && !exists(root, f.path)).map((f) => f.path));
  const runsAlone = (step) => { try { planStep(root, step); return true; } catch { return false; } };
  const amendable = (step) => { try { planAmended(root, staged, step); return true; } catch { return false; } };
  return findings.map((f) => {
    if (!Array.isArray(f.fixes) || !f.fixes.some((x) => x.step)) return f;
    const fixes = f.fixes.map((x) => {
      if (!x.step || x.step.tool === 'line.amend') return x;
      const needs = stepInputs(x.step).some((p) => created.has(p)) || !runsAlone(x.step);
      if (!needs || !amendable(x.step)) return x;
      return {
        ...x,
        sentence: `${x.sentence.replace(/[.?!]$/, '')}, together with the change Construct refused, in one step.`,
        step: { tool: 'line.amend', args: { change: { tool: refused.tool, args: { ...refused.args } }, fix: { tool: x.step.tool, args: { ...x.step.args } } } },
      };
    });
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
 * POST /api/line/fix: find the finding by key in the current validate result, plan its fix, apply it through the writer.
 * @param {string} root
 * @param {import('./contract.mjs').FixRequest} req
 * @returns {import('./contract.mjs').ApplyResult}
 * @throws {LineOpError} UNKNOWN_FINDING, UNKNOWN_FIX or NO_STEP.
 */
export function applyFix(root, req = /** @type {any} */ ({})) {
  return applyChange(root, planFixByKey(root, req));
}

/**
 * cp1: the plan half of POST /api/line/fix (the `line.fix` plan tool): find the finding by key in the current
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
