// #932 (b) the per-file context pack: when a refusal or an open-work item targets a file (line.setCode, line.baseOn),
// the builder sees what decides the file instead of writing it blind. lending-qwen-7b-r1 wrote PicksPage without its
// current code, without ListPage's props (it passed only `title`) and without an example of a page that landed.
// Deterministic, reads project files only (the files, the feature's spec.md, the library); never bench acceptance files.
//
//   packTarget(req)                  the file a request writes: setCode's file, the page a baseOn creates; else null
//   contextPack(root, file, o)       {file, exists, contentHash, code, base: {id, file, props}, points, example}
//   packText(pack, o)                the pack as the builder reads it, capped (PACK_CAP characters)
//   renderCodeBlock(code, o)         how one code block is shown: 'code' (default) or another registered representation
//   registerRepresentation(name, f)  plug a representation in (the English one, once the context probe picks it)
//   representationOf(root, o)        which one is in force: o.representation, LINE_CONTEXT_REPRESENTATION, the project's
//                                    architecture.yml line.contextRepresentation, else 'code'
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '@line/construct-core/config';
import { normalizeLineConfig, CODE_EXTENSIONS } from '@line/construct-core/profiles/line/contract';
import { resolveLayout } from '@line/construct-core/profiles/line/checks';
import { hashOf } from '../../pagesEditor.mjs';

/** The pack's whole text is cut here (characters, ~1k tokens). */
export const PACK_CAP = 3600;
const CODE_CAP = 1500;
const POINT_CAP = 240;
const POINTS_MAX = 6;

const readOrNull = (abs) => { try { return fs.readFileSync(abs, 'utf8'); } catch { return null; } };
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n…(${s.length - n} more characters)` : s);
/**
 * The project's library and features folders (architecture.yml), or the defaults.
 * @param {string} root
 * @returns {{library: string, features: string}}
 */
export const packLayout = (root) => { try { return resolveLayout(root, normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line)); } catch { return { library: 'library', features: 'features' }; } };

// ------------------------------------------------------------------------------------------------- representation

/** @typedef {'code' | 'english'} Representation */
/** @type {Map<string, (code: string, o: {file?: string, root?: string}) => (string|null)>} */
const REPRESENTATIONS = new Map([['code', (code) => code]]);

/**
 * Plug in a representation of code blocks (e.g. 'english': packages/summarize's to-english link, once the context probe
 * shows it wins). The renderer returns the block's text, or null to fall back to the code.
 * @param {string} name @param {(code: string, o: {file?: string, root?: string}) => (string|null)} render
 */
export function registerRepresentation(name, render) { REPRESENTATIONS.set(name, render); }

/**
 * Which representation is in force: the option, then LINE_CONTEXT_REPRESENTATION, then the project's architecture.yml
 * `line.contextRepresentation`, else 'code'.
 * @param {string} [root] @param {{representation?: string}} [o]
 * @returns {string}
 */
export function representationOf(root, o = {}) {
  if (o.representation) return o.representation;
  if (process.env.LINE_CONTEXT_REPRESENTATION) return process.env.LINE_CONTEXT_REPRESENTATION;
  if (root) { try { const r = /** @type {any} */ (loadConfig(root))?.line?.contextRepresentation; if (typeof r === 'string' && r) return r; } catch { /* no config */ } }
  return 'code';
}

/**
 * One code block as the context shows it: the code itself by default; another registered representation when chosen
 * (an unknown one, or one that answers null, falls back to the code, so the pack never goes empty).
 * @param {string} code @param {{file?: string, root?: string, representation?: string}} [o]
 * @returns {string}
 */
export function renderCodeBlock(code, o = {}) {
  const name = representationOf(o.root, o);
  const render = REPRESENTATIONS.get(name);
  if (!render || name === 'code') return code;
  try { return render(code, { file: o.file, root: o.root }) ?? code; } catch { return code; }
}

// ------------------------------------------------------------------------------------------------------ the pack

/**
 * The file a request writes, or null: line.setCode's `file`; the page or component line.baseOn creates.
 * @param {{tool?: unknown, args?: any}} req @param {{features?: string}} [layout]
 * @returns {string|null}
 */
export function packTarget(req, layout = { features: 'features' }) {
  const a = req?.args && typeof req.args === 'object' ? req.args : {};
  if (req?.tool === 'line.setCode' && typeof a.file === 'string' && CODE_EXTENSIONS.includes(path.extname(a.file))) return a.file;
  if (req?.tool === 'line.baseOn' && typeof a.libraryId === 'string' && typeof a.feature === 'string' && typeof a.name === 'string' && a.libraryId.includes('/')) {
    return `${layout.features}/${a.feature}/${a.libraryId.split('/')[0]}/${a.name}.tsx`;
  }
  return null;
}

/** A library item's file (library/pages/ListPage.tsx for pages/ListPage), or null. */
function libraryFile(root, layout, id) {
  const ext = CODE_EXTENSIONS.find((x) => fs.existsSync(path.join(root, layout.library, `${id}${x}`)));
  return ext ? `${layout.library}/${id}${ext}` : null;
}

/** The text of a balanced {...} starting at `open` (the index of "{"), or null. */
function braced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1; else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(open, i + 1); }
  }
  return null;
}

/**
 * The props of a library item: its exported `<Name>Props` type or interface, else its exported function's parameter
 * list. Null when neither is found.
 * @param {string} src @param {string} name
 * @returns {string|null}
 */
export function propsOf(src, name) {
  const t = new RegExp(`export\\s+(?:type\\s+${name}Props\\s*=\\s*|interface\\s+${name}Props\\s*)`).exec(src);
  if (t) {
    const open = src.indexOf('{', t.index);
    const body = open >= 0 ? braced(src, open) : null;
    if (body) return `${src.slice(t.index, open)}${body}`.trim();
  }
  const f = new RegExp(`export\\s+(?:default\\s+)?function\\s+${name}\\s*\\(`).exec(src);
  if (!f) return null;
  let depth = 0;
  for (let i = f.index + f[0].length - 1; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1; else if (src[i] === ')') { depth -= 1; if (depth === 0) return src.slice(f.index, i + 1).trim(); }
  }
  return null;
}

/** "- ID: text" lines of a spec.md, as {id, text}. */
const specPoints = (text) => [...String(text ?? '').matchAll(/^\s*-\s+([A-Z][A-Z0-9]*-\d+):\s+(.+)$/gm)].map((m) => ({ id: m[1], text: m[2].trim() }));
const pageAt = (text) => [...String(text).matchAll(/\bpage at `(\/[^`\s]*)`/g)].map((m) => m[1].replace(/<([A-Za-z]\w*)>/g, ':$1'));

/**
 * The spec points a file covers: the feature's points, minus those that put their page at another route than the file's.
 * @param {{id: string, text: string}[]} points @param {string|null} route
 */
function pointsFor(points, route) {
  return points.filter((p) => { const at = pageAt(p.text); return !at.length || !route || at.includes(route); });
}

/**
 * One landed file of the same kind (another feature's pages/... file that renders content: its base's closing tag,
 * a children prop or a .map), the largest that fits CODE_CAP; null when none.
 * @param {string} root @param {{features: string}} layout @param {string} file @param {string} kind
 */
function landedExample(root, layout, file, kind) {
  const out = [];
  let feats = [];
  try { feats = fs.readdirSync(path.join(root, layout.features), { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort(); } catch { feats = []; }
  for (const f of feats) {
    let names = [];
    try { names = fs.readdirSync(path.join(root, layout.features, f, kind)).sort(); } catch { names = []; }
    for (const n of names) {
      const rel = `${layout.features}/${f}/${kind}/${n}`;
      if (rel === file || !CODE_EXTENSIONS.includes(path.extname(n)) || /\.(test|spec|stories)\./.test(n)) continue;
      const src = readOrNull(path.join(root, rel));
      if (!src) continue;
      const base = /@line-base\s+\S*\/(\w+)/.exec(src)?.[1];
      const landed = (base && new RegExp(`</${base}\\s*>`).test(src)) || /\bchildren\s*=/.test(src) || /\.map\s*\(/.test(src);
      if (landed && src.length <= CODE_CAP) out.push({ file: rel, code: src });
    }
  }
  out.sort((a, b) => b.code.length - a.code.length || a.file.localeCompare(b.file));
  return out[0] ?? null;
}

/**
 * The context pack of one file (see the header). `code`: the code a request sent for it (its @line-base and
 * @line-route count when the file is new); `libraryId`: the base a line.baseOn names.
 * @param {string} root @param {string} file @param {{code?: string, libraryId?: string, spec?: {features?: {name: string, points: {id: string, text: string}[]}[]} | null}} [o]
 * @returns {{file: string, exists: boolean, contentHash: string|null, code: string|null, base: {id: string, file: string|null, props: string|null} | null,
 *   route: string|null, points: {id: string, text: string}[], example: {file: string, code: string, from: 'project'|'library'} | null}}
 */
export function contextPack(root, file, { code, libraryId, spec = null } = {}) {
  const layout = packLayout(root);
  const current = readOrNull(path.join(root, file));
  const heads = current ?? code ?? '';
  const baseId = /@line-base\s+(\S+)/.exec(heads)?.[1] ?? libraryId ?? null;
  const route = /@line-route\s+(\S+)/.exec(heads)?.[1] ?? null;
  const baseFile = baseId ? libraryFile(root, layout, baseId) : null;
  const baseSrc = baseFile ? readOrNull(path.join(root, baseFile)) : null;
  const props = baseSrc && baseId ? propsOf(baseSrc, baseId.split('/').pop() ?? '') : null;
  const parts = file.split('/');
  const feature = file.startsWith(`${layout.features}/`) ? parts[layout.features.split('/').length] : null;
  const given = feature ? spec?.features?.find((f) => f.name === feature)?.points : null;
  const all = given?.length ? given : feature ? specPoints(readOrNull(path.join(root, layout.features, feature, 'spec.md'))) : [];
  const points = pointsFor(all, route).slice(0, POINTS_MAX);
  const kind = parts.at(-2) ?? 'pages';
  const landed = feature ? landedExample(root, layout, file, kind) : null;
  const example = landed ? { file: landed.file, code: landed.code, from: /** @type {const} */ ('project') } : baseFile && baseSrc ? { file: baseFile, code: baseSrc, from: /** @type {const} */ ('library') } : null;
  return {
    file, exists: current !== null, contentHash: current !== null ? hashOf(current) : null, code: current,
    base: baseId ? { id: baseId, file: baseFile, props } : null, route, points, example,
  };
}

/**
 * The pack as the builder reads it, cut at `cap`. `codeInStep`: the file's current code is in a step shown just above
 * (an open-work item's setCode), so it is not repeated.
 * @param {ReturnType<typeof contextPack>} p @param {{root?: string, representation?: string, cap?: number, codeInStep?: boolean}} [o]
 * @returns {string}
 */
export function packText(p, { root, representation, cap = PACK_CAP, codeInStep = false } = {}) {
  const block = (code, file) => renderCodeBlock(clip(code.trimEnd(), CODE_CAP), { file, root, representation });
  const out = [`Context for ${p.file}${p.contentHash ? ` (contentHash ${p.contentHash})` : ' (a new file: leave contentHash out)'}:`];
  if (p.code !== null && p.code !== undefined) out.push(codeInStep ? 'Its current code is the code of the step above.' : `Its current code:\n${block(p.code, p.file)}`);
  const libExample = p.example?.from === 'library';
  if (p.base) {
    if (p.base.props && !libExample) out.push(`Its base ${p.base.id} (${p.base.file}) takes these props:\n${block(p.base.props, p.base.file ?? undefined)}`);
    else if (!p.base.file) out.push(`Its base ${p.base.id} is not in the library.`);
  }
  if (p.points.length) out.push(`Spec points it covers:\n${p.points.map((x) => `- ${x.id}: ${x.text.length > POINT_CAP ? `${x.text.slice(0, POINT_CAP - 3)}...` : x.text}`).join('\n')}`);
  if (p.example) {
    out.push(libExample
      ? `Example: no ${path.posix.basename(path.posix.dirname(p.file))} file of the project renders content yet, so here is its base ${p.base?.id ?? ''} itself (${p.example.file}), props included:\n${block(p.example.code, p.example.file)}`
      : `Example of a ${path.posix.basename(path.posix.dirname(p.file)).replace(/s$/, '')} that landed (${p.example.file}):\n${block(p.example.code, p.example.file)}`);
  }
  const text = out.join('\n');
  return text.length > cap ? `${text.slice(0, cap)}\n…(context cut at ${cap} characters)` : text;
}
