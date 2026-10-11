// Line Cockpit operations (T2, contract.mjs): base a feature item on a library item, promote a feature
// item into the library, and apply a staged change. Plain functions, no HTTP. planBaseOn and planPromote are
// pure (they read the project and return a StagedChange, or throw a LineOpError); applyChange is the only
// writer, and it writes only through createTransaction().commit(), so the project's own validate profile
// (the Line rules for `preset: line`) gates every change and a refused change leaves the disk untouched.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '@line/construct-core/config';
import { normalizeLineConfig, ITEM_KINDS, CODE_EXTENSIONS, NON_ITEM_FILE } from '@line/construct-core/profiles/line/contract';
import { resolveLayout, listFiles, classify, isItemFile, resolveBase, resolveSpecifier } from '@line/construct-core/profiles/line/checks';
import { createTransaction } from '../transactionalWriter.mjs';
import { aggregateValidation } from '@line/construct-core/registry';
import { enforcersForRoot } from '@line/construct-core/profiles';
import { planFileMove, applyEdits } from '../tsFileMove.mjs';
import { LineOpError, assertStagedChange } from './contract.mjs';
import { readWorkspace, isInsideWorkspace } from './workspace.mjs';

const posix = path.posix;
const SINGULAR = { components: 'component', pages: 'page', workflows: 'workflow', fixtures: 'fixture' };
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const IDENT = /^[A-Za-z][A-Za-z0-9]*$/;
const FEATURE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
/** Module specifiers in import/export-from/import()/require()/side-effect imports: [whole, lead, quote, spec]. */
const SPECIFIER = /(\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(['"])([^'"\n]+)\2/gm;

const stripExt = (rel) => rel.slice(0, rel.length - posix.extname(rel).length);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const asSentence = (s) => { const t = String(s ?? '').trim().replace(/\s+/g, ' ') || 'Something went wrong'; return /[.?!]$/.test(t) ? t : `${t}.`; };

/** The project's Line layout (architecture.yml's `line:` section, resolved against the folders on disk). */
function layoutOf(root) {
  return resolveLayout(root, normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line));
}

/** A relative module specifier from the file `fromRel` to `toRel` (both root-relative). */
function relSpec(fromRel, toRel) {
  const r = posix.relative(posix.dirname(fromRel), toRel);
  return r.startsWith('.') ? r : `./${r}`;
}

/** The import target of a library file: its folder for an index file, else the path without extension. */
const importTarget = (rel) => (/^index\.[cm]?[jt]sx?$/.test(posix.basename(rel)) ? posix.dirname(rel) : stripExt(rel));

/** How a code file exports `name`: 'named', 'default', or null. */
function exportForm(src, name) {
  const n = escapeRe(name);
  if (new RegExp(`export\\s+(?:declare\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|class)\\s+${n}\\b`).test(src)) return 'named';
  if (new RegExp(`export\\s*\\{[^}]*\\b${n}\\b[^}]*\\}`).test(src)) return 'named';
  if (/export\s+default\b/.test(src)) return 'default';
  return null;
}

/** Every item file of one kind in one folder, keyed by its name without extension. */
function itemsIn(root, layout, dir) {
  const out = new Map();
  let entries = [];
  try { entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const rel = `${dir}/${e.name}`;
    if (e.isFile() && isItemFile({ rel, ...classify(rel, layout) })) out.set(stripExt(e.name), rel);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// planBaseOn

/** The new feature item's source: the base link first, then a thin wrapper over the library item. */
function wrapperSource({ libraryId, kind, name, dest, libFile, libName, libSrc }) {
  if (kind === 'fixtures') {
    let data;
    try { data = JSON.parse(libSrc); } catch { throw new LineOpError(`The library fixture "${libraryId}" is not valid JSON, so nothing can be based on it; fix its JSON first.`, 'UNKNOWN_ITEM'); }
    const body = data && typeof data === 'object' && !Array.isArray(data) ? data : { value: data };
    const { $lineBase: _drop, ...rest } = body;
    return `${JSON.stringify({ $lineBase: libraryId, ...rest }, null, 2)}\n`;
  }
  const spec = relSpec(dest, importTarget(libFile));
  const form = exportForm(libSrc, libName);
  const head = `// @line-base ${libraryId}\n`;
  if (kind === 'workflows') {
    if (!form && !/\bexport\b/.test(libSrc)) throw new LineOpError(`The library workflow "${libraryId}" exports nothing, so nothing can be based on it; export its functions first.`, 'UNKNOWN_ITEM');
    return `${head}export * from '${spec}';\n${/export\s+default\b/.test(libSrc) ? `export { default } from '${spec}';\n` : ''}`;
  }
  if (!form) throw new LineOpError(`The library ${SINGULAR[kind]} "${libraryId}" does not export ${libName}, so it cannot be wrapped; export it by that name first.`, 'UNKNOWN_ITEM');
  const local = libName === name ? `Library${libName}` : libName;
  const binding = form === 'default' ? local : local === libName ? `{ ${libName} }` : `{ ${libName} as ${local} }`;
  const typed = ['.tsx', '.ts', '.mts', '.cts'].includes(posix.extname(dest));
  return typed
    ? `${head}import type { ComponentProps } from 'react';\nimport ${binding} from '${spec}';\n\nexport function ${name}(props: ComponentProps<typeof ${local}> & object) {\n  return <${local} {...props} />;\n}\n`
    : `${head}import ${binding} from '${spec}';\n\nexport function ${name}(props) {\n  return <${local} {...props} />;\n}\n`;
}

/**
 * Plan a new feature item based on a library item: `<features>/<feature>/<kind>/<name>.<ext>`, whose first
 * line is `// @line-base <libraryId>` (a fixture carries `"$lineBase"` instead, since JSON has no comments)
 * and which wraps the library item: a component or page renders it and passes every prop through, a
 * workflow re-exports it, a fixture copies its data. Pure: nothing is written.
 * @param {string} root Project root.
 * @param {import('./contract.mjs').BaseOnRequest} req The request.
 * @returns {import('./contract.mjs').StagedChange} The new file.
 * @throws {LineOpError} UNKNOWN_ITEM, UNKNOWN_FEATURE, BAD_NAME or NAME_TAKEN.
 */
export function planBaseOn(root, { libraryId, feature, name } = /** @type {any} */ ({})) {
  const layout = layoutOf(root);
  const id = String(libraryId ?? '');
  const [kind, libName, ...extra] = id.split('/');
  const resolved = ITEM_KINDS.includes(kind) && libName && !extra.length ? resolveBase(root, layout, id) : { file: undefined };
  if (!resolved.file || NON_ITEM_FILE.test(posix.basename(resolved.file))) {
    throw new LineOpError(`There is no library item "${id}"; pick one from the library.`, 'UNKNOWN_ITEM');
  }
  const libFile = resolved.file;
  const f = String(feature ?? '');
  if (!FEATURE_NAME.test(f) || !fs.statSync(path.join(root, layout.features, f), { throwIfNoEntry: false })?.isDirectory()) {
    throw new LineOpError(`There is no feature "${f}"; pick an existing feature or create its folder under ${layout.features}/ first.`, 'UNKNOWN_FEATURE');
  }
  const n = String(name ?? '');
  const pascal = kind === 'components' || kind === 'pages';
  if (!(pascal ? PASCAL : IDENT).test(n)) {
    throw new LineOpError(pascal
      ? `"${n}" is not a ${SINGULAR[kind]} name; use a capitalised name of letters and digits such as Order${libName}.`
      : `"${n}" is not a ${SINGULAR[kind]} name; use letters and digits starting with a letter, such as order${libName.charAt(0).toUpperCase()}${libName.slice(1)}.`, 'BAD_NAME');
  }
  const dir = `${layout.features}/${f}/${kind}`;
  if (itemsIn(root, layout, dir).has(n)) throw new LineOpError(`Feature "${f}" already has a ${SINGULAR[kind]} named ${n}; pick another name.`, 'NAME_TAKEN');
  const ext = kind === 'fixtures' ? '.json' : posix.extname(libFile);
  const dest = `${dir}/${n}${ext}`;
  const libSrc = fs.readFileSync(path.join(root, libFile), 'utf8');
  const content = wrapperSource({ libraryId: id, kind, name: n, dest, libFile, libName, libSrc });
  return { summary: `Creates ${n} in feature ${f}, based on the library ${libName}.`, files: [{ path: dest, content }] };
}

// ---------------------------------------------------------------------------------------------
// planPromote

/** Drop the `@line-base` link from a feature item's source (a `//` line, a JSDoc line, or a `$lineBase` field). */
function dropBase(rel, src) {
  if (posix.extname(rel) === '.json') {
    const data = JSON.parse(src);
    if (data && typeof data === 'object' && !Array.isArray(data)) delete data.$lineBase;
    return `${JSON.stringify(data, null, 2)}\n`;
  }
  const whole = /^\s*(?:\/\/|\*|\/\*\*?)\s*@line-base\s+[^\s*]+\s*(?:\*\/)?\s*$/; // a line that is only the link
  return src.split('\n').filter((l) => !whole.test(l)).join('\n')
    .replace(/@line-base\s+[^\s*]+[ \t]*/g, '') // a link sharing its comment line with other text
    .replace(/^\s*\/\*\*?\s*\*\/[ \t]*\n/m, ''); // a JSDoc block left empty
}

/** Rewrite the module specifiers of `src` (the file at `rel`) with `map(spec, target)`; unchanged when it returns null. */
function rewriteSpecifiers(layout, rel, src, map) {
  return src.replace(SPECIFIER, (whole, lead, q, spec) => {
    const target = resolveSpecifier(layout, rel, spec);
    const next = target === null ? null : map(spec, target);
    return next === null || next === spec ? whole : `${lead}${q}${next}${q}`;
  });
}

/** The regex engine for a move (no tsconfig, or TypeScript refused): own relative imports re-pointed, every importer re-pointed. */
function regexMove(root, layout, from, to) {
  const files = new Map();
  const own = fs.readFileSync(path.join(root, from), 'utf8');
  files.set(from, posix.extname(from) === '.json' ? own : rewriteSpecifiers(layout, from, own, (spec, target) => (spec.startsWith('.') ? relSpec(to, target) : null)));
  const fromNoExt = stripExt(from);
  for (const rel of listFiles(root)) {
    if (rel === from || !CODE_EXTENSIONS.includes(posix.extname(rel))) continue;
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    const out = rewriteSpecifiers(layout, rel, src, (spec, target) => {
      if (target !== from && target !== fromNoExt) return null;
      const dest = target === from ? to : stripExt(to);
      if (spec.startsWith('.')) return relSpec(rel, dest);
      const prefix = (spec.match(/^[@~#]\//) || [''])[0];
      const bare = spec.slice(prefix.length);
      const lib = bare.startsWith(`${layout.features}/`) ? layout.library : layout.library.replace(/^src\//, '');
      return prefix + lib + dest.slice(layout.library.length);
    });
    if (out !== src) files.set(rel, out);
  }
  return files;
}

/** The TypeScript engine (tsFileMove.mjs) when the project has a tsconfig.json; null when it refuses. */
function tsMove(root, from, to) {
  if (!fs.existsSync(path.join(root, 'tsconfig.json')) || posix.extname(from) === '.json') return null;
  const abs = (rel) => path.join(root, rel);
  const plan = planFileMove(root, abs(from), abs(to));
  if (!plan.ok) return null;
  const files = new Map([[from, fs.readFileSync(abs(from), 'utf8')]]);
  for (const file of plan.files) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    const src = files.get(rel) ?? fs.readFileSync(file, 'utf8');
    files.set(rel, applyEdits(src, plan.edits.filter((e) => e.file === file)));
  }
  return files;
}

/**
 * Plan promoting a feature item into the library: it moves to `<library>/<kind>/`, loses its `@line-base`
 * link, its own relative imports are re-pointed from the new place, and every importer in the project
 * imports the library copy instead. Uses the TypeScript language service when the project has a
 * tsconfig.json, else a specifier rewrite over every code file. Pure: nothing is written.
 * @param {string} root Project root.
 * @param {import('./contract.mjs').PromoteRequest} req The request.
 * @returns {import('./contract.mjs').StagedChange} The new library file, the deleted feature file and the rewritten importers.
 * @throws {LineOpError} UNKNOWN_ITEM or NAME_TAKEN.
 */
export function planPromote(root, { featureItemId } = /** @type {any} */ ({})) {
  const layout = layoutOf(root);
  const id = String(featureItemId ?? '');
  const [feature, kind, name, ...extra] = id.split('/');
  const from = !extra.length && FEATURE_NAME.test(feature ?? '') && ITEM_KINDS.includes(kind) && name
    ? itemsIn(root, layout, `${layout.features}/${feature}/${kind}`).get(name) : undefined;
  if (!from) throw new LineOpError(`There is no feature item "${id}"; pick one from a feature.`, 'UNKNOWN_ITEM');
  if (itemsIn(root, layout, `${layout.library}/${kind}`).has(name)) {
    throw new LineOpError(`The library already has a ${SINGULAR[kind]} named ${name}; rename the feature item before promoting it.`, 'NAME_TAKEN');
  }
  const to = `${layout.library}/${kind}/${name}${posix.extname(from)}`;
  const edited = tsMove(root, from, to) ?? regexMove(root, layout, from, to);
  let moved;
  try { moved = dropBase(from, edited.get(from)); } catch { throw new LineOpError(`The fixture "${from}" is not valid JSON, so it cannot be promoted; fix its JSON first.`, 'UNKNOWN_ITEM'); }
  edited.delete(from);
  const users = [...edited.keys()].sort();
  const files = [{ path: to, content: moved }, { path: from, content: null }, ...users.map((p) => ({ path: p, content: edited.get(p) }))];
  const tail = users.length ? ` and points its ${users.length === 1 ? 'one user' : `${users.length} users`} at the library copy` : '';
  return { summary: `Moves ${name} from feature ${feature} into the library${tail}.`, files };
}

// ---------------------------------------------------------------------------------------------
// Fix planners (fixes.mjs): set a base link, move a file, create the library folder. Pure, like the others.

/** A root-relative path that names a file inside the project (no `..`, no absolute path, no `.git`). */
const safeRel = (rel) => typeof rel === 'string' && rel.length > 0 && !rel.includes('\\') && !path.isAbsolute(rel)
  && !rel.split('/').some((s) => s === '..' || s === '.' || s === '' || s === '.git');

/** `src` with its base links replaced by exactly one: `libraryId` (a header line in code, `"$lineBase"` first in JSON). */
function withBase(rel, src, libraryId) {
  if (posix.extname(rel) === '.json') {
    const data = JSON.parse(src);
    const body = data && typeof data === 'object' && !Array.isArray(data) ? data : { value: data };
    const { $lineBase: _drop, ...rest } = body;
    return `${JSON.stringify({ $lineBase: libraryId, ...rest }, null, 2)}\n`;
  }
  return `// @line-base ${libraryId}\n${dropBase(rel, src).replace(/^\n+/, '')}`;
}

/** The library item `libraryId` names, or a LineOpError. */
function libraryFileOf(root, layout, libraryId) {
  const id = String(libraryId ?? '');
  const [kind, name, ...extra] = id.split('/');
  const resolved = ITEM_KINDS.includes(kind) && name && !extra.length ? resolveBase(root, layout, id) : { file: undefined };
  if (!resolved.file || NON_ITEM_FILE.test(posix.basename(resolved.file))) throw new LineOpError(`There is no library item "${id}"; pick one from the library.`, 'UNKNOWN_ITEM');
  return { id, kind, name, file: resolved.file };
}

/**
 * Plan rewriting a feature item's base link so it names exactly one library item: every `@line-base` link (or the
 * fixture's `"$lineBase"`) is replaced by `libraryId`. Pure: nothing is written.
 * @param {string} root Project root.
 * @param {{file: string, libraryId: string}} req The feature item (root-relative) and the library item to base it on.
 * @returns {import('./contract.mjs').StagedChange}
 * @throws {LineOpError} UNKNOWN_ITEM, WRONG_KIND or BAD_JSON.
 */
export function planSetBase(root, { file, libraryId } = /** @type {any} */ ({})) {
  const layout = layoutOf(root);
  const rel = String(file ?? '');
  const place = classify(rel, layout);
  if (!safeRel(rel) || place.area !== 'feature' || !place.feature || !isItemFile({ rel, ...place }) || !fs.existsSync(path.join(root, rel))) {
    throw new LineOpError(`There is no feature item "${rel}"; pick a file inside a feature's kind folder.`, 'UNKNOWN_ITEM');
  }
  const lib = libraryFileOf(root, layout, libraryId);
  if (lib.kind !== place.kind) throw new LineOpError(`A feature ${SINGULAR[place.kind]} can only be based on a library ${SINGULAR[place.kind]}, and "${lib.id}" is not one.`, 'WRONG_KIND');
  let content;
  try { content = withBase(rel, fs.readFileSync(path.join(root, rel), 'utf8'), lib.id); } catch { throw new LineOpError(`The fixture "${rel}" is not valid JSON, so its base cannot be set; fix its JSON first.`, 'BAD_JSON'); }
  return { summary: `Bases ${posix.basename(rel)} on the library ${lib.name}.`, files: [{ path: rel, content }] };
}

/**
 * Plan moving a file to a new place and re-pointing every import of it (and its own relative imports), with the
 * TypeScript language service when the project has a tsconfig.json, else a specifier rewrite. With `base`, the moved
 * file's base link is also set to that library item (a file that becomes a feature item needs one). Pure.
 * @param {string} root Project root.
 * @param {{from: string, to: string, base?: string}} req Root-relative paths, and an optional library id.
 * @returns {import('./contract.mjs').StagedChange}
 * @throws {LineOpError} UNKNOWN_FILE, NAME_TAKEN or UNKNOWN_ITEM.
 */
export function planMoveFile(root, { from, to, base } = /** @type {any} */ ({})) {
  const layout = layoutOf(root);
  const src = String(from ?? '');
  const dest = String(to ?? '');
  if (!safeRel(src) || !fs.statSync(path.join(root, src), { throwIfNoEntry: false })?.isFile()) throw new LineOpError(`There is no file "${src}" to move.`, 'UNKNOWN_FILE');
  if (!safeRel(dest) || dest === src) throw new LineOpError(`"${dest}" is not a new place inside the project for "${src}".`, 'UNKNOWN_FILE');
  if (fs.existsSync(path.join(root, dest))) throw new LineOpError(`"${dest}" already exists; pick another name or place.`, 'NAME_TAKEN');
  const lib = base ? libraryFileOf(root, layout, base) : null;
  const edited = (CODE_EXTENSIONS.includes(posix.extname(src)) ? tsMove(root, src, dest) : null) ?? regexMove(root, layout, src, dest);
  let moved = edited.get(src);
  if (lib) {
    try { moved = withBase(dest, moved, lib.id); } catch { throw new LineOpError(`The fixture "${src}" is not valid JSON, so its base cannot be set; fix its JSON first.`, 'BAD_JSON'); }
  }
  edited.delete(src);
  const users = [...edited.keys()].sort();
  const tail = users.length ? ` and points its ${users.length === 1 ? 'one user' : `${users.length} users`} at the new place` : '';
  const based = lib ? `, based on the library ${lib.name},` : '';
  return { summary: `Moves ${posix.basename(src)} to ${posix.dirname(dest)}/${based}${tail}.`.replace(/,\./, '.'), files: [{ path: dest, content: moved }, { path: src, content: null }, ...users.map((p) => ({ path: p, content: edited.get(p) }))] };
}

/**
 * Plan creating the library folder (with a README.md, since a folder alone is not a file) so the project is laid out as Line.
 * @param {string} root Project root.
 * @returns {import('./contract.mjs').StagedChange}
 * @throws {LineOpError} NAME_TAKEN when the library folder already exists.
 */
export function planCreateLayout(root) {
  const layout = layoutOf(root);
  if (fs.existsSync(path.join(root, layout.library))) throw new LineOpError(`The library folder ${layout.library}/ already exists.`, 'NAME_TAKEN');
  const content = `# Library\n\nShared items every feature builds on: ${ITEM_KINDS.map((k) => `${k}/`).join(', ')}. Each feature lives in ${layout.features}/<name>/ and bases its items on these.\n`;
  return { summary: `Creates the library folder ${layout.library}/, so the project is laid out as a Line project.`, files: [{ path: `${layout.library}/README.md`, content }] };
}

// ---------------------------------------------------------------------------------------------
// applyChange

/** Why `rel` cannot be written inside `root`, or null when it can (no escape by `..`, absolute path or symlink). */
function outsideReason(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || rel.includes('\\') || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)
    || rel.split('/').some((s) => s === '..' || s === '.' || s === '') || rel.split('/').includes('.git')) {
    return `the path "${rel}" is not a file inside the project.`;
  }
  let realRoot;
  try { realRoot = fs.realpathSync(root); } catch { return 'the project folder does not exist.'; }
  const abs = path.join(realRoot, rel);
  const lst = fs.lstatSync(abs, { throwIfNoEntry: false });
  if (lst?.isSymbolicLink()) return `the path "${rel}" is a link, and Line never writes through a link.`;
  if (lst?.isDirectory()) return `the path "${rel}" is a folder, not a file.`;
  let dir = path.dirname(abs);
  while (!fs.existsSync(dir)) dir = path.dirname(dir);
  const real = fs.realpathSync(dir);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return `the path "${rel}" leads outside the project through a link.`;
  return null;
}

/** One violation's identity across a change: its line can move, its rule, file and message do not. */
const problemKey = (v) => `${v.rule}\u0000${v.file}\u0000${v.message}`;

/**
 * The commit gate for a Line change: validate the shadow copy, but refuse only problems the change ADDS.
 * A file that already had a problem (a planted cross-feature import, say) can still get an unrelated edit;
 * the old problem stays reported by validate, it just does not block this save.
 * @param {string} root The real project root (the "before" state).
 */
function onlyNewProblems(root) {
  return (shadow, { files }) => {
    const after = aggregateValidation(shadow, enforcersForRoot(shadow), { files }).violations;
    const existing = files.filter((f) => fs.existsSync(path.join(root, f)));
    const before = new Set(existing.length ? aggregateValidation(root, enforcersForRoot(root), { files: existing }).violations.map(problemKey) : []);
    const added = after.filter((v) => !before.has(problemKey(v)));
    return { violations: added, ok: !added.some((v) => v.severity === 'error') };
  };
}

/** A validate violation as Cockpit shows it. */
function toFinding(v) {
  return {
    sentence: asSentence(v.message),
    rule: String(v.rule || 'VALIDATE'),
    severity: ['error', 'warning', 'info'].includes(v.severity) ? v.severity : 'error',
    file: typeof v.file === 'string' && v.file ? v.file : '.',
    line: Number.isInteger(v.line) && v.line >= 1 ? v.line : 1,
  };
}

/**
 * One plain-English sentence for a write the writer refused while staging or landing: a frozen file, or the disk
 * itself (permissions, a full disk, a read-only mount). Paths are project-relative, never absolute.
 * @param {string} root Project root.
 * @param {unknown} e The error the writer threw.
 * @param {string[]} files The change's root-relative paths (an error in the writer's shadow copy names one of them).
 * @returns {string} The sentence (without the "Nothing was saved:" lead).
 */
function writeRefusal(root, e, files) {
  const err = /** @type {any} */ (e);
  const message = String(err?.message ?? e);
  const rel = (abs) => {
    if (typeof abs !== 'string' || !abs) return 'one of its files';
    const posixAbs = abs.split(path.sep).join('/');
    const own = files.find((f) => posixAbs.endsWith(`/${f}`));
    if (own) return own;
    const r = path.relative(root, abs).split(path.sep).join('/');
    return r.startsWith('..') ? 'one of its files' : r;
  };
  const frozen = /Refusing to [a-z ]+ "([^"]+)": it matches the frozen glob "([^"]+)"/.exec(message);
  if (frozen) return `${rel(frozen[1])} is frozen (it matches "${frozen[2]}" in architecture.yml), so Construct may not change it; wrap it from a controller instead.`;
  if (typeof err?.code === 'string' && /^E[A-Z]+$/.test(err.code)) return `the disk refused to write ${rel(err.path)} (${err.code}), and every file this change had already written was put back.`;
  return message;
}

/** The checks every change passes before the writer sees it: its shape, every path inside the project, every file
 * inside the workspace folder. Null when it may go on, else the refusal (an ApplyResult with ok false). */
function preflight(root, change) {
  const refuse = (s, findings = []) => ({ ok: false, sentence: `Nothing was saved: ${lowerFirst(asSentence(s))}`, files: [], findings });
  try { assertStagedChange(change); } catch (e) { return refuse(`The change is not in the expected shape (${/** @type {Error} */ (e).message.replace(/[.?!]$/, '')}).`); }
  for (const f of change.files) {
    const why = outsideReason(root, f.path);
    if (why) return refuse(why);
  }
  // cu6: Line changes only the workspace folder; everything outside it stays read-only (no workspace = whole project).
  let workspace;
  try { workspace = readWorkspace(root); } catch (e) {
    return { ...refuse(/** @type {any} */ (e).sentence ?? 'The workspace folder cannot be read.'), code: 'BAD_WORKSPACE' };
  }
  const outside = change.files.find((f) => !isInsideWorkspace(workspace.folder, f.path));
  if (outside) {
    return {
      ok: false,
      sentence: `Nothing was saved: ${outside.path} is outside your workspace folder ${workspace.folder}; it stays read-only.`,
      files: [],
      findings: [{ sentence: `${outside.path} is outside your workspace folder ${workspace.folder}; change the workspace folder to edit it.`, rule: 'OUTSIDE_WORKSPACE', severity: 'error', file: outside.path, line: 1 }],
      code: 'OUTSIDE_WORKSPACE',
    };
  }
  return null;
}

/**
 * Apply a staged change: the ONLY Line operation that writes. Every file is staged in one transaction and
 * committed through the project's validate profile; when that refuses, nothing lands.
 * @param {string} root Project root.
 * @param {import('./contract.mjs').StagedChange} change The change from a plan function.
 * Files outside the project's workspace folder (workspace.mjs) are refused first, with code OUTSIDE_WORKSPACE.
 * @param {{acceptedIn?: string}} [opts] `acceptedIn`: a folder whose problems count as already accepted, instead of
 *   `root` as it is now. Import's all-or-nothing apply (import.mjs applyImport) chains its steps in a scratch copy, each
 *   checked by this function there, and lands the net result in one change: that commit refuses only problems the
 *   scratch copy (the end of the checked chain) does not have.
 * @returns {import('./contract.mjs').ApplyResult} `Saved. <summary>` with the files, or `Nothing was saved: ...` with the findings.
 */
export function applyChange(root, change, { acceptedIn } = {}) {
  const refused = preflight(root, change);
  if (refused) return refused;
  const refuse = (s, findings = []) => ({ ok: false, sentence: `Nothing was saved: ${lowerFirst(asSentence(s))}`, files: [], findings });
  const txn = createTransaction(root);
  let result;
  try {
    for (const f of change.files) {
      if (f.content === null) txn.deleteFile(f.path); else txn.writeFile(f.path, f.content);
    }
    result = txn.commit({ validate: onlyNewProblems(acceptedIn ?? root) });
  } catch (e) {
    txn.reset();
    return refuse(writeRefusal(root, e, change.files.map((f) => f.path)));
  }
  if (!result.committed) {
    const findings = result.violations.map(toFinding).sort((a, b) => (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1));
    const first = findings.find((x) => x.severity === 'error');
    return refuse(first ? first.sentence : 'The project checks refused the change.', findings);
  }
  return { ok: true, sentence: `Saved. ${change.summary}`, files: [...new Set(change.files.map((f) => f.path))], findings: [] };
}

/**
 * Would the writer land this change now? The same checks as applyChange (shape, paths, workspace, and the project's
 * validate profile on a shadow copy, refusing only NEW problems), but nothing is ever committed. Used to re-check a
 * step after its fix landed (planService), without writing.
 * @param {string} root @param {import('./contract.mjs').StagedChange} change
 * @returns {{ok: boolean, sentence: string, findings: import('./contract.mjs').LineFinding[]}}
 */
export function checkChange(root, change) {
  const refused = preflight(root, change);
  if (refused) return { ok: false, sentence: refused.sentence, findings: refused.findings };
  const txn = createTransaction(root);
  /** @type {{violations: any[], ok: boolean} | null} */
  let verdict = null;
  try {
    for (const f of change.files) {
      if (f.content === null) txn.deleteFile(f.path); else txn.writeFile(f.path, f.content);
    }
    txn.commit({ validate: (shadow, ctx) => { verdict = onlyNewProblems(root)(shadow, ctx); return { violations: [], ok: false }; } });
  } catch (e) {
    if (!verdict) return { ok: false, sentence: `Nothing would be saved: ${lowerFirst(asSentence(writeRefusal(root, e, change.files.map((f) => f.path))))}`, findings: [] };
  } finally {
    txn.reset();
  }
  const v = /** @type {{violations: any[], ok: boolean}} */ (verdict ?? { violations: [], ok: false });
  const findings = v.violations.map(toFinding);
  const first = findings.find((x) => x.severity === 'error');
  return v.ok ? { ok: true, sentence: 'The change would land now.', findings } : { ok: false, sentence: `Nothing would be saved: ${lowerFirst(first ? first.sentence : 'The project checks refuse the change.')}`, findings };
}
