// bench-gaps 3 -- the type gate of a whole-file write (line.setCode, line.setLayoutSlot, line.useViaUsecase): the
// staged files and the project files that import them are type-checked as the change would leave them, before the
// change lands. Pilot Q6: a setCode that imported 'library/pages/ListPage' (a bare path the tsconfig does not map)
// landed, and `tsc` and `next build` failed afterwards.
//
//   typeCheckStaged(root, files)   -> {errors, ms, slow} | null   only the type errors the change ADDS (an error the
//                                     file already had never blocks); null when the project cannot be type-checked
//                                     honestly (no tsconfig.json, or no node_modules to resolve packages from)
//   importFixes(root, file, code, errors) -> RefusalFix[]          an unresolved import or a missing export, re-pointed
//                                     at the library or own-feature item that has it, as one line.setCode step each
//
// The "scratch copy" is in memory: the TypeScript program reads the staged content for the staged paths and the
// project for everything else (node_modules included), so nothing is copied or written and packages resolve exactly
// as in the project. Only the changed files and their importers are roots, so the check stays small; it reuses the
// "before" program (oldProgram) so the second pass re-reads only what changed.
import fs from 'node:fs';
import path from 'node:path';
import { ts } from '@construct/ast/lazy';
import { LineOpError } from './contract.mjs';
import { pageTitleOf } from './featureText.mjs';

/** Above this the check is too slow to block a save; its errors then ride along as warnings (as setFragment does). */
export const TYPE_GATE_BUDGET_MS = 4000;
/** The budget in force: LINE_TYPE_GATE_BUDGET_MS overrides it (a loaded CI machine), read at each check. */
const budgetMs = () => Number(process.env.LINE_TYPE_GATE_BUDGET_MS) || TYPE_GATE_BUDGET_MS;
const TS_EXT = /\.(tsx?|mts|cts)$/;
const SCAN_SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'out', 'build', 'coverage', 'line']);
const cache = new Map();
const CACHE_MAX = 32;

/**
 * The project's compiler options (tsconfig.json at the root), or null. Exported for line.extractExpression
 * (expressions.mjs), which reads the types of the values a JSX block uses with the same options the gate checks with.
 * @param {string} root Project root.
 * @returns {import('typescript').CompilerOptions | null}
 */
export function optionsOf(root) {
  const file = path.join(root, 'tsconfig.json');
  if (!fs.existsSync(file)) return null;
  const read = ts.readConfigFile(file, ts.sys.readFile);
  if (read.error) return null;
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
  return { ...parsed.options, noEmit: true, incremental: false, tsBuildInfoFile: undefined };
}

/** Every TypeScript file of the project outside node_modules, build output and Line's state, root-relative. */
function codeFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || SCAN_SKIP.has(e.name)) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel);
      else if (TS_EXT.test(e.name) && !e.name.endsWith('.d.ts')) out.push(rel);
    }
  };
  walk('');
  return out;
}

const specifiersOf = (src) => [...String(src).matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
const noExt = (p) => p.replace(/\.(tsx?|jsx?|mts|cts|mjs|cjs)$/, '').replace(/\/index$/, '');

/** Project files that import one of `changed` (resolved the way TypeScript resolves them). */
function importersOf(root, changed, options, host) {
  const targets = new Set(changed.map((p) => noExt(p)));
  const names = new Set(changed.map((p) => path.posix.basename(noExt(p))));
  const out = [];
  for (const rel of codeFiles(root)) {
    if (changed.includes(rel)) continue;
    let src;
    try { src = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
    if (![...names].some((n) => src.includes(n))) continue;
    const hit = specifiersOf(src).some((spec) => {
      const r = ts.resolveModuleName(spec, path.join(root, rel), options, host).resolvedModule;
      return r && targets.has(noExt(path.relative(root, r.resolvedFileName).split(path.sep).join('/')));
    });
    if (hit) out.push(rel);
  }
  return out;
}

/** A compiler host whose view of the project has `overlay` (abs path -> content) written in. */
function overlayHost(options, overlay) {
  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (f) => (overlay.has(path.resolve(f)) ? overlay.get(path.resolve(f)) : readFile(f));
  host.fileExists = (f) => overlay.has(path.resolve(f)) || fileExists(f);
  // A staged file in a folder that does not exist yet (a new expressions/ folder): module resolution asks for the
  // folder before the file, so the folder of every staged file exists too.
  const dirExists = host.directoryExists?.bind(host);
  host.directoryExists = (d) => { const abs = path.resolve(d); return [...overlay.keys()].some((f) => f.startsWith(`${abs}${path.sep}`)) || (dirExists ? dirExists(d) : ts.sys.directoryExists(d)); };
  host.getSourceFile = (f, lang, onError, shouldCreate) => {
    const abs = path.resolve(f);
    return overlay.has(abs) ? ts.createSourceFile(f, /** @type {string} */ (overlay.get(abs)), lang, true) : getSourceFile(f, lang, onError, shouldCreate);
  };
  return host;
}

/** overlayHost with the staged files (root-relative {path, content}) written in. */
const stagedHost = (root, options, files) => overlayHost(options, new Map(files.map((f) => [path.resolve(root, f.path), /** @type {string} */ (f.content)])));

/** Errors of the root files of `program`, as {file, code, message, line}. */
function errorsOf(root, program, files) {
  const out = [];
  for (const rel of files) {
    const sf = program.getSourceFile(path.join(root, rel));
    if (!sf) continue;
    const syn = program.getSyntacticDiagnostics(sf);
    for (const d of syn.length ? syn : program.getSemanticDiagnostics(sf)) {
      if (d.category !== ts.DiagnosticCategory.Error) continue;
      const line = d.file && typeof d.start === 'number' ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 1;
      out.push({ file: rel, code: `TS${d.code}`, message: ts.flattenDiagnosticMessageText(d.messageText, '\n'), line });
    }
  }
  return out;
}

/**
 * The type errors a staged change adds, in the changed files and the files that import them. Pure (nothing written).
 * @param {string} root Project root.
 * @param {{path: string, content: string|null}[]} files The staged files (root-relative).
 * @returns {{errors: {file: string, code: string, message: string, line: number}[], ms: number, slow: boolean, checked: string[]} | null}
 */
export function typeCheckStaged(root, files) {
  const code = files.filter((f) => typeof f.content === 'string' && TS_EXT.test(f.path));
  if (!code.length || !fs.existsSync(path.join(root, 'node_modules'))) return null;
  const options = optionsOf(root);
  if (!options) return null;
  const t0 = Date.now();
  const changed = code.map((f) => f.path);
  const stamp = (rel) => { try { return fs.statSync(path.join(root, rel)).mtimeMs; } catch { return 0; } };
  const plain = ts.createCompilerHost(options, true);
  // Resolved with the staged files written in: a new file (line.baseOn's) is imported by a route entry already there.
  const importers = importersOf(root, changed, options, stagedHost(root, options, code));
  const key = JSON.stringify([root, code.map((f) => [f.path, f.content]), [...changed, ...importers].map((r) => [r, stamp(r)])]);
  if (cache.has(key)) return cache.get(key);
  const roots = [...changed, ...importers];
  const before = ts.createProgram({ rootNames: roots.filter((r) => fs.existsSync(path.join(root, r))).map((r) => path.join(root, r)), options, host: plain });
  const overlay = new Map(code.map((f) => [path.resolve(root, f.path), /** @type {string} */ (f.content)]));
  // Next.js refuses a route page whose props are more than params and searchParams (the second pilot's next build
  // failed on it while tsc was clean): one virtual check file per route entry the change reaches, never written.
  const checks = routeChecks(root, roots, new Map(code.map((f) => [f.path, /** @type {string} */ (f.content)])));
  for (const c of checks) overlay.set(path.resolve(root, c.file), c.content);
  const after = ts.createProgram({ rootNames: [...roots, ...checks.map((c) => c.file)].map((r) => path.join(root, r)), options, host: overlayHost(options, overlay), oldProgram: before });
  const old = new Map();
  for (const e of errorsOf(root, before, roots)) { const k = `${e.file}|${e.code}|${e.message}`; old.set(k, (old.get(k) ?? 0) + 1); }
  const errors = [];
  for (const e of errorsOf(root, after, roots)) {
    const k = `${e.file}|${e.code}|${e.message}`;
    if (old.get(k)) old.set(k, old.get(k) - 1); else errors.push(e);
  }
  for (const c of checks) {
    const hit = errorsOf(root, after, [c.file])[0];
    if (!hit) continue;
    const keys = [...hit.message.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((k) => k !== 'params' && k !== 'searchParams');
    const page = c.page ?? c.entry;
    errors.unshift({ file: page, code: 'ROUTE_PROPS', line: 1, message: `${path.posix.basename(page).replace(/\.[^.]+$/, '')} is served at a route (${c.entry}), so Next.js lets it take only params and searchParams as props, not ${keys.length ? keys.join(', ') : 'the props it declares'}` });
  }
  const ms = Date.now() - t0;
  const out = { errors, ms, slow: ms > budgetMs(), checked: roots };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, out);
  return out;
}

/**
 * The app-router route entries among `roots` (app/.../page.tsx), each with a virtual file that fails to type-check
 * when the page it serves takes props other than params and searchParams (Next.js's own page-props rule).
 * A staged entry (line.addRoute's new app/.../page.tsx) is read as staged, not from disk.
 * @param {string} root @param {string[]} roots @param {Map<string, string>} [staged] root-relative path -> staged content
 * @returns {{entry: string, page: string|null, file: string, content: string}[]}
 */
function routeChecks(root, roots, staged = new Map()) {
  return roots.filter(isRouteEntry).map((entry, i) => {
    const dir = path.posix.dirname(entry);
    let src = staged.get(entry) ?? '';
    if (!staged.has(entry)) { try { src = fs.readFileSync(path.join(root, entry), 'utf8'); } catch { src = ''; } }
    const target = (/from\s*['"]([^'"]+)['"]/.exec(src) || [])[1];
    const base = target && target.startsWith('.') ? path.posix.normalize(path.posix.join(dir, target)) : null;
    const page = base ? roots.find((r) => noExt(r) === base) ?? ['.tsx', '.ts'].map((x) => `${base}${x}`).find((p) => staged.has(p) || fs.existsSync(path.join(root, p))) ?? null : null;
    const file = `${dir}/__line_route_check_${i}__.ts`;
    const content = `import type * as Entry from './${path.posix.basename(entry).replace(/\.tsx?$/, '')}';\n`
      + 'type First<T> = T extends (...args: infer A) => unknown ? A[0] : never;\n'
      + 'type Props = First<typeof Entry.default>;\n'
      + "type Extra = [Props] extends [undefined] ? never : Exclude<keyof NonNullable<Props>, 'params' | 'searchParams'>;\n"
      + 'export const lineRouteProps: [Extra] extends [never] ? true : Extra = true;\n';
    return { entry, page, file, content };
  });
}

/** An app-router route entry (app/.../page.tsx, src/app/... too). */
const isRouteEntry = (rel) => /(^|\/)app\/(.+\/)?page\.tsx?$/.test(rel);

/**
 * pilot-qwen-7b-r2 R2: the route-props part of the gate, for a change that is not a whole-file write but can still
 * leave a route serving a page with props Next.js refuses: line.addRoute (a new route entry for an existing page) and
 * line.baseOn (a new page that a route entry already imports). Refused exactly as line.setCode refuses it (TYPE_ERROR,
 * typeRefusal's sentence, importFixes' "take no props" fix), so a builder meets one refusal whichever tool it used. Only
 * ROUTE_PROPS blocks here: other type errors stay line.setCode's to judge. Cheap when no route serves the change: the
 * TypeScript programs are built only when a staged file is a route entry or a route entry imports one.
 * @param {string} root Project root.
 * @param {{library: string, features: string}} layout
 * @param {{path: string, content: string|null}[]} files The staged files.
 * @param {{file: string, code: string, contentHash?: string, then?: string}} page The page the fix rewrites: its path,
 *   the code to fix (what is on disk for addRoute, the staged wrapper for baseOn), the hash it was read at (none for a
 *   new file), and a sentence each fix adds after its own (addRoute: add the route again).
 * @returns {{sentence: string, rule: string, severity: string, file: string, line: number}[]} Warnings when the check ran
 *   past its budget (as line.setCode degrades), else none.
 * @throws {LineOpError} TYPE_ERROR when a route would serve the page with props other than params and searchParams.
 */
export function refuseRouteProps(root, layout, files, page) {
  const code = files.filter((f) => typeof f.content === 'string' && TS_EXT.test(f.path));
  if (!code.length || !fs.existsSync(path.join(root, 'node_modules'))) return [];
  const options = optionsOf(root);
  if (!options) return [];
  const changed = code.map((f) => f.path);
  if (!changed.some(isRouteEntry) && !importersOf(root, changed, options, stagedHost(root, options, code)).some(isRouteEntry)) return [];
  const types = typeCheckStaged(root, files);
  const errors = (types?.errors ?? []).filter((e) => e.code === 'ROUTE_PROPS');
  if (!types || !errors.length) return [];
  if (types.slow) return errors.map((d) => ({ sentence: `The saved code may not compile (${d.message.replace(/[.?!]$/, '')}).`, rule: d.code, severity: 'warning', file: d.file, line: d.line }));
  const { sentence, detail } = typeRefusal(errors);
  const fixes = importFixes(root, layout, page.file, page.code, page.contentHash, errors.map((e) => ({ ...e, file: page.file })));
  throw new LineOpError(sentence, 'TYPE_ERROR', detail, page.then ? fixes.map((f) => ({ ...f, sentence: `${f.sentence} ${page.then}` })) : fixes);
}

/** Code files of the library and of `feature` (the places a feature or library file may import from). */
function importableFiles(root, layout, file) {
  const segs = file.split('/');
  const fBase = layout.features.split('/').length;
  const own = file.startsWith(`${layout.features}/`) ? `${layout.features}/${segs[fBase]}/` : null;
  return codeFiles(root).filter((r) => r.startsWith(`${layout.library}/`) || (own && r.startsWith(own)));
}

/** `spec` re-pointed at `target` from `file` (a relative specifier with no extension). */
function relSpec(file, target) {
  let s = path.posix.relative(path.posix.dirname(file), noExt(target));
  if (!s.startsWith('.')) s = `./${s}`;
  return s;
}

/** `code` with every import/export of `from` re-pointed at `to`. */
function repoint(code, from, to) {
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return code.replace(new RegExp(`(\\bfrom\\s*|\\bimport\\s*\\(?\\s*)(['"])${esc}\\2`, 'g'), (_m, lead, q) => `${lead}${q}${to}${q}`);
}

/** #906: props a page fills with its title (the rest of the required string props get their own name). */
const TITLE_PROPS = new Set(['title', 'heading', 'label', 'name']);
/** The props a bare render misses: TS2741 ("Property 'title' is missing ...") and TS2739/TS2740 ("... properties from type 'X': a, b"). */
function missingProps(errors) {
  const out = [];
  for (const e of errors) {
    if (e.code === 'TS2741') { const p = /Property '([\w$]+)' is missing/.exec(e.message)?.[1]; if (p) out.push(p); }
    if (e.code === 'TS2739' || e.code === 'TS2740') {
      const list = /missing the following properties from type '.*': ([^\n]+)$/m.exec(e.message)?.[1] ?? '';
      if (/ more\b/.test(list)) return [];
      out.push(...list.split(',').map((s) => s.trim().replace(/[.]$/, '')).filter((s) => /^[\w$]+$/.test(s)));
    }
  }
  return [...new Set(out)];
}
/** The feature a file belongs to (features/<name>/...), or null. */
const featureOf = (layout, file) => (file.startsWith(`${layout.features}/`) ? file.slice(layout.features.length + 1).split('/')[0] : null);
/** The spec.md of the feature `file` belongs to, or null. */
function readSpecOf(root, layout, file) {
  const f = featureOf(layout, file);
  if (!f) return null;
  try { return fs.readFileSync(path.join(root, layout.features, f, 'spec.md'), 'utf8'); } catch { return null; }
}

/**
 * Typed fixes for the type errors of one written file: an import that does not resolve (TS2307) or names an export the
 * module lacks (TS2305, TS2724) is re-pointed at the library or own-feature file that has it, as a line.setCode step
 * with the whole corrected code. Fixes that type-check clean come first.
 * @param {string} root @param {{library: string, features: string}} layout @param {string} file @param {string} code
 * @param {string|undefined} contentHash @param {{file: string, code: string, message: string}[]} errors
 * @returns {{id: string, sentence: string, step: {tool: string, args: Record<string, unknown>}}[]}
 */
export function importFixes(root, layout, file, code, contentHash, errors) {
  const files = importableFiles(root, layout, file);
  const out = [];
  const seen = new Set();
  for (const e of errors.filter((x) => x.file === file)) {
    const spec = (/['"]([^'"]+)['"]/.exec(e.message) || [])[1];
    if (!spec || seen.has(spec)) continue;
    let candidates = [];
    if (e.code === 'TS2307') {
      const base = path.posix.basename(spec).toLowerCase();
      candidates = files.filter((r) => path.posix.basename(noExt(r)).toLowerCase() === base);
    } else if (e.code === 'TS2305' || e.code === 'TS2724') {
      const name = (/has no exported member (?:named )?'([^']+)'/.exec(e.message) || [])[1];
      if (!name) continue;
      const re = new RegExp(`export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|let|class|type|interface|enum)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`);
      candidates = files.filter((r) => r !== file && re.test(fs.readFileSync(path.join(root, r), 'utf8')));
    }
    seen.add(spec);
    for (const target of candidates.slice(0, 3)) {
      const to = relSpec(file, target);
      if (to === spec) continue;
      const fixed = repoint(code, spec, to);
      if (fixed === code) continue;
      out.push({ id: `TYPE_ERROR/import:${spec}->${target}`, sentence: `Import ${path.posix.basename(noExt(target))} from ${to} (${target}) instead of "${spec}".`, step: { tool: 'line.setCode', args: { file, code: fixed, ...(contentHash ? { contentHash } : {}) } } });
    }
  }
  // ROUTE_PROPS: a page that ignores its props (a line.baseOn wrapper's signature kept) takes none instead. A bare
  // line.baseOn wrapper only passes them on (`<Lib {...props} />`, pilot-qwen-7b-r2 R2): it takes none and renders the
  // library page bare, and its `import type { ComponentProps }` goes when nothing else uses it.
  if (errors.some((e) => e.code === 'ROUTE_PROPS' && e.file === file)) {
    const m = /export\s+(?:default\s+)?function\s+([A-Z]\w*)\s*\(\s*([A-Za-z_$][\w$]*)\s*(?::[^)]*)?\)/.exec(code);
    const esc = m ? m[2].replace(/\$/g, '\\$') : '';
    const spread = new RegExp(`\\s*\\{\\s*\\.\\.\\.${esc}\\s*\\}`, 'g');
    const spreads = m ? (code.match(spread) ?? []).length : 0;
    const rest = m ? code.replace(m[0], '').replace(spread, '') : '';
    const uses = m ? (rest.match(new RegExp(`(^|[^\\w$])${esc}(?![\\w$])`, 'g')) ?? []).length : 1;
    if (m && uses === 0) {
      let fixed = code.replace(m[0], m[0].replace(/\([\s\S]*\)$/, '()')).replace(spread, '');
      const typeImport = /^import\s+type\s*\{\s*ComponentProps\s*\}\s*from\s*['"]react['"];?[ \t]*\n/m;
      if (spreads && !/\bComponentProps\b/.test(fixed.replace(typeImport, ''))) fixed = fixed.replace(typeImport, '');
      // Rendered bare, a library page whose props are required does not compile. #906 (data-qwen3-4b-r1 call 34): the
      // page then passes its required string props itself, the title from the feature's spec.md (pageTitleOf), each
      // other one its own name; the fix is offered only when that compiles, never one that line.setCode would refuse.
      let filled = null;
      const bare = spreads ? typeCheckStaged(root, [{ path: file, content: fixed }]) : null;
      if (bare?.errors.length) {
        const props = missingProps(bare.errors.filter((e) => e.file === file));
        const tag = new RegExp(`<([A-Z][\\w$.]*)\\s*\\{\\s*\\.\\.\\.${esc}\\s*\\}\\s*/>`).exec(code)?.[1];
        if (props.length && tag) {
          const title = pageTitleOf(readSpecOf(root, layout, file), featureOf(layout, file) ?? m[1]);
          const values = props.map((p) => [p, TITLE_PROPS.has(p) ? title : p.charAt(0).toUpperCase() + p.slice(1)]);
          const attrs = values.map(([p, v]) => `${p}=${JSON.stringify(v)}`).join(' ');
          const withProps = fixed.replace(new RegExp(`<${tag.replace(/[$.]/g, '\\$&')}\\s*/>`), `<${tag} ${attrs} />`);
          const check = withProps !== fixed ? typeCheckStaged(root, [{ path: file, content: withProps }]) : null;
          if (check && !check.errors.length) { fixed = withProps; filled = values; }
        }
      }
      if (!bare || !bare.errors.length || filled) {
        const how = filled ? `and pass ${filled.map(([p, v]) => `${p}="${v}"`).join(', ')} to the library page itself${filled.some(([p]) => TITLE_PROPS.has(p)) ? ' (the title from the spec)' : ''}` : `(${spreads ? `it only passes ${m[2]} on` : `it does not use ${m[2]}`})`;
        out.unshift({ id: 'TYPE_ERROR/route-props', sentence: `Make ${m[1]} take no props ${how}, so its route can serve it.`, step: { tool: 'line.setCode', args: { file, code: fixed, ...(contentHash ? { contentHash } : {}) } } });
      }
    }
  }
  if (out.length < 2) return out;
  const clean = (f) => { const r = typeCheckStaged(root, [{ path: file, content: /** @type {string} */ (f.step.args.code) }]); return !r || !r.errors.length; };
  return [...out.filter(clean), ...out.filter((f) => !clean(f))];
}

/**
 * One plain sentence for a type refusal, and the detail lines.
 * @param {{file: string, code: string, message: string, line: number}[]} errors At least one.
 * @returns {{sentence: string, detail: string}}
 */
export function typeRefusal(errors) {
  const first = errors[0];
  const msg = first.message.split('\n')[0].replace(/[.?!]$/, '');
  return {
    sentence: `The code does not compile, so nothing was saved: ${msg} (${first.file} line ${first.line}${errors.length > 1 ? `, and ${errors.length - 1} more` : ''}).`,
    detail: errors.slice(0, 20).map((d) => `${d.file}:${d.line} ${d.code} ${d.message}`).join('\n'),
  };
}
