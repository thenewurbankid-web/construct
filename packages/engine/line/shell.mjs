// bench-gaps 2 -- the app shell as a structured edit (pilot H1: a cart link on every page had no Line tool, so the
// builder copied a CartLink into all five pages). Contract: contract.mjs SetLayoutSlotRequest.
//
//   library/components/AppLayout.tsx   a complete library component with three slots (header, nav, footer) around the
//                                      page; created by the first line.setLayoutSlot when the library has none
//   app/layout.tsx                     written ONLY by Line: it renders AppLayout and fills its slots with library or
//                                      feature components. Its first line is `// @line-layout`; each filled slot is
//                                      one `// @line-slot <slot> <file>#<Export>` line, the structure the file is
//                                      re-rendered from, so a slot edit never parses or keeps hand-written code.
//
//   planSetLayoutSlot(root, {slot, components})  -> StagedChange (pure; the plan runner lands it through the writer)
//   renderAppLayout(root, {slots, title})        -> the app/layout.tsx source (make-starter writes the same file)
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '@line/construct-core/config';
import { normalizeLineConfig, CODE_EXTENSIONS } from '@line/construct-core/profiles/line/contract';
import { resolveLayout } from '@line/construct-core/profiles/line/checks';
import { LineOpError } from './contract.mjs';

const posix = path.posix;
export const LAYOUT_SLOTS = Object.freeze(['header', 'nav', 'footer']);
export const LAYOUT_MARK = '// @line-layout';
const layoutOf = (root) => resolveLayout(root, normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line));
const readOrNull = (abs) => { try { return fs.readFileSync(abs, 'utf8'); } catch { return null; } };
const appDirOf = (root) => (fs.existsSync(path.join(root, 'src', 'app')) ? 'src/app' : 'app');
const noExt = (p) => p.replace(/\.[cm]?[jt]sx?$/, '');

/**
 * The library layout component's file.
 * @param {string} root Project root.
 * @returns {string}
 */
export const appLayoutComponent = (root) => `${layoutOf(root).library}/components/AppLayout.tsx`;
/**
 * The app's root layout file.
 * @param {string} root Project root.
 * @returns {string}
 */
export const appLayoutFile = (root) => `${appDirOf(root)}/layout.tsx`;

/**
 * The library AppLayout: three slots around the page, nothing app-specific. A project gets it from the first
 * line.setLayoutSlot when its library has none; `provider` (the bench starter: Toast's ToastProvider) wraps the shell.
 * @param {{provider?: {name: string, from: string}}} [o]
 * @returns {string}
 */
export function appLayoutSource({ provider } = {}) {
  const open = provider ? `    <${provider.name}>\n` : '';
  const close = provider ? `    </${provider.name}>\n` : '';
  const pad = provider ? '  ' : '';
  return `// @line-level organism
import type { ReactNode } from 'react';
${provider ? `import { ${provider.name} } from '${provider.from}';\n` : ''}
export type AppLayoutProps = {
  /** Shown above every page, at the left (a logo, a title). */
  header?: ReactNode;
  /** Links shown above every page, at the right (a cart link, the main sections). */
  nav?: ReactNode;
  /** Shown below every page. */
  footer?: ReactNode;
  children: ReactNode;
};

/** The app shell: app/layout.tsx renders it and fills its slots (Line's line.setLayoutSlot writes that file). */
export function AppLayout({ header, nav, footer, children }: AppLayoutProps) {
  return (
${open}${pad}    <div className="mx-auto max-w-5xl p-6">
${pad}      <div className="mb-6 flex items-center justify-between gap-4">
${pad}        <div>{header}</div>
${pad}        <nav aria-label="Main" className="flex items-center gap-4">{nav}</nav>
${pad}      </div>
${pad}      {children}
${pad}      <div className="mt-8 text-sm text-slate-600">{footer}</div>
${pad}    </div>
${close}  );
}
`;
}

/** The first exported component name of a source (export function X / export const X), or null. */
function exportedComponent(src) {
  const m = /export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Z][A-Za-z0-9_]*)/.exec(src) || /export\s+const\s+([A-Z][A-Za-z0-9_]*)\s*=/.exec(src);
  return m ? m[1] : null;
}

/** Every component file a slot may hold: library and feature components, sorted. */
function slotComponents(root) {
  const { library, features } = layoutOf(root);
  const list = (dir) => { try { return fs.readdirSync(path.join(root, dir)).filter((n) => CODE_EXTENSIONS.includes(posix.extname(n)) && !/^index\.|\.(test|spec|stories)\./.test(n)).map((n) => `${dir}/${n}`); } catch { return []; } };
  let feats = [];
  try { feats = fs.readdirSync(path.join(root, features), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { feats = []; }
  return [...list(`${library}/components`).filter((f) => !f.endsWith('/AppLayout.tsx')), ...feats.flatMap((f) => list(`${features}/${f}/components`))].sort();
}

/**
 * The slots and title of a Line-written app/layout.tsx: null when the file is not Line's (no `// @line-layout`).
 * @param {string} src
 * @returns {{slots: Record<string, string[]>, title: string} | null}
 */
export function parseAppLayout(src) {
  if (!String(src).startsWith(LAYOUT_MARK)) return null;
  /** @type {Record<string, string[]>} */
  const slots = {};
  for (const m of String(src).matchAll(/^\/\/ @line-slot (\w+) (\S+)$/gm)) (slots[m[1]] ??= []).push(m[2]);
  const title = (/export const metadata = \{ title: '((?:[^'\\]|\\.)*)' \}/.exec(src) || [])[1] ?? 'App';
  return { slots, title };
}

/**
 * The app/layout.tsx source for these slots (each entry "<file>#<Export>").
 * @param {string} root @param {{slots: Record<string, string[]>, title: string, css?: boolean}} o `css`: import
 *   ./globals.css (default: when the app folder has it).
 * @returns {string}
 */
export function renderAppLayout(root, { slots, title, css: withCss }) {
  const appDir = appDirOf(root);
  const spec = (file) => { const s = posix.relative(appDir, noExt(file)); return s.startsWith('.') ? s : `./${s}`; };
  const used = new Map();
  const imports = [];
  const tags = {};
  for (const slot of LAYOUT_SLOTS) {
    for (const entry of slots[slot] ?? []) {
      const [file, name] = entry.split('#');
      let local = name;
      for (let i = 2; used.has(local) && used.get(local) !== entry; i += 1) local = `${name}${i}`;
      if (!used.has(local)) { used.set(local, entry); imports.push(`import { ${local === name ? name : `${name} as ${local}`} } from '${spec(file)}';`); }
      (tags[slot] ??= []).push(`<${local} />`);
    }
  }
  const props = LAYOUT_SLOTS.filter((s) => tags[s]).map((s) => ` ${s}={<>${tags[s].join('')}</>}`).join('');
  const css = (withCss ?? fs.existsSync(path.join(root, appDir, 'globals.css'))) ? "import './globals.css';\n" : '';
  return `${LAYOUT_MARK}: the app shell. Line writes this file; change its slots with line.setLayoutSlot.\n`
    + LAYOUT_SLOTS.flatMap((s) => (slots[s] ?? []).map((e) => `// @line-slot ${s} ${e}\n`)).join('')
    + `import type { ReactNode } from 'react';\n${css}import { AppLayout } from '${spec(appLayoutComponent(root))}';\n${imports.map((l) => `${l}\n`).join('')}\n`
    + `export const metadata = { title: '${String(title).replace(/['\\]/g, '\\$&')}' };\n\n`
    + 'export default function RootLayout({ children }: { children: ReactNode }) {\n  return (\n    <html lang="en">\n      <body>\n'
    + `        <AppLayout${props}>{children}</AppLayout>\n      </body>\n    </html>\n  );\n}\n`;
}

/** Typed fixes naming each component a slot can hold (closest to what was asked first). */
function componentFixes(root, slot, asked) {
  const a = String(asked ?? '').toLowerCase();
  const score = (f) => (a.includes(posix.basename(noExt(f)).toLowerCase()) ? 2 : 0) + (a.includes(f.split('/')[1]?.toLowerCase() ?? '\0') ? 1 : 0);
  return slotComponents(root).map((f, i) => ({ f, i, s: score(f) })).sort((x, y) => y.s - x.s || x.i - y.i).slice(0, 6)
    .map(({ f }) => ({ id: `UNKNOWN_ITEM/slot:${f}`, sentence: `Show ${posix.basename(noExt(f))} in the ${slot} of every page.`, step: { tool: 'line.setLayoutSlot', args: { slot, components: [f] } } }));
}

/**
 * Fill one slot of the app shell. Pure.
 * @param {string} root Project root.
 * @param {import('./contract.mjs').SetLayoutSlotRequest} req
 * @returns {import('./contract.mjs').StagedChange}
 * @throws {LineOpError} BAD_ARGS, UNKNOWN_ITEM, NO_EXPORT, NOT_LINE_LAYOUT or NO_CHANGE.
 */
export function planSetLayoutSlot(root, { slot, components } = /** @type {any} */ ({})) {
  if (!LAYOUT_SLOTS.includes(slot)) throw new LineOpError(`The app shell has the slots ${LAYOUT_SLOTS.join(', ')}; "${slot}" is not one of them.`, 'BAD_ARGS', undefined,
    Array.isArray(components) && components.length ? LAYOUT_SLOTS.map((s) => ({ id: `BAD_ARGS/slot:${s}`, sentence: `Put them in the ${s} slot.`, step: { tool: 'line.setLayoutSlot', args: { slot: s, components } } })) : undefined);
  if (!Array.isArray(components) || !components.length) throw new LineOpError('Name at least one component file for the slot, like ["library/components/CartLink.tsx"].', 'BAD_ARGS');
  const { library, features } = layoutOf(root);
  const entries = [];
  for (const c of components) {
    const [file, named] = String(c).split('#');
    const okPlace = /^[^./][^\\]*$/.test(file) && !file.split('/').includes('..') && (file.startsWith(`${library}/components/`) || new RegExp(`^${features.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^/]+/components/`).test(file)) && CODE_EXTENSIONS.includes(posix.extname(file));
    const src = okPlace ? readOrNull(path.join(root, file)) : null;
    if (src === null) throw new LineOpError(`A slot holds a library or feature component file; "${c}" is not one (like ${library}/components/<Name>.tsx).`, 'UNKNOWN_ITEM', undefined, componentFixes(root, slot, c));
    const name = named || exportedComponent(src);
    if (!name || !new RegExp(`export\\s+(?:(?:async\\s+)?function|const|class)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`).test(src)) {
      throw new LineOpError(`${file} exports no component${named ? ` named ${named}` : ''}, so there is nothing to show in the ${slot}.`, 'NO_EXPORT');
    }
    if (file.endsWith('/AppLayout.tsx')) throw new LineOpError('AppLayout is the shell itself; put a component inside it instead.', 'BAD_ARGS', undefined, componentFixes(root, slot, ''));
    entries.push(`${file}#${name}`);
  }
  const layoutFile = appLayoutFile(root);
  const before = readOrNull(path.join(root, layoutFile));
  const parsed = before === null ? { slots: {}, title: 'App' } : parseAppLayout(before);
  if (!parsed) {
    throw new LineOpError(`${layoutFile} was written by hand, so Line will not rewrite it: decide which of its code to keep, then make its first line "${LAYOUT_MARK}" and render AppLayout from ${appLayoutComponent(root)}.`, 'NOT_LINE_LAYOUT');
  }
  const slots = { ...parsed.slots, [slot]: [...new Set(entries)] };
  const content = renderAppLayout(root, { slots, title: parsed.title });
  if (content === before) throw new LineOpError(`The ${slot} already shows exactly these components.`, 'NO_CHANGE');
  const files = [{ path: layoutFile, content }];
  const shell = appLayoutComponent(root);
  if (readOrNull(path.join(root, shell)) === null) files.push({ path: shell, content: appLayoutSource() });
  const names = entries.map((e) => e.split('#')[1]).join(', ');
  return { summary: `Shows ${names} in the ${slot} of every page (the app shell, ${layoutFile}).`, files };
}

/**
 * bench-gaps 2: a hand-written whole-file write of the app layout (line.setCode on app/layout.tsx) becomes the slot
 * edit it most likely meant: the library or feature components its code imports and renders, in the nav slot.
 * @param {string} root @param {string} code The code the builder tried to write.
 * @returns {{id: string, sentence: string, step: {tool: string, args: Record<string, unknown>}}[]}
 */
export function layoutFixesFor(root, code) {
  const appDir = appDirOf(root);
  const comps = new Set(slotComponents(root));
  const found = [];
  for (const m of String(code).matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const spec = m[2];
    const base = spec.startsWith('.') ? posix.normalize(posix.join(appDir, spec)) : spec.replace(/^@\//, '');
    const file = [...comps].find((f) => noExt(f) === base);
    if (!file) continue;
    for (const n of m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter((x) => /^[A-Z]/.test(x))) {
      if (new RegExp(`<${n}\\b`).test(code)) found.push(`${file}#${n}`);
    }
  }
  if (!found.length) return componentFixes(root, 'nav', code).slice(0, 4);
  return [{ id: 'UNKNOWN_ITEM/layout-slot', sentence: `Show ${found.map((f) => f.split('#')[1]).join(', ')} on every page through the app shell (its nav slot) instead of writing ${appDir}/layout.tsx.`, step: { tool: 'line.setLayoutSlot', args: { slot: 'nav', components: found } } }];
}
