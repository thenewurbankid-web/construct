#!/usr/bin/env node
// bench/lsp-speed -- how fast is the Line LSP (packages/engine/lsp) on real-size projects? Measurement only: nothing
// here changes product code; every project is measured from a copy or clone under a NEW /tmp/construct-lsp-speed-<pid>/,
// which is deleted at the end. No model calls, no npm/scripts inside a cloned repo (parse only).
//
//   node bench/lsp-speed/measure.mjs run        driver: prepare projects, one FRESH node process per phase, write
//                                               bench/lsp-speed/results.json (run it once, through heavy.sh)
//   node bench/lsp-speed/measure.mjs render     print the markdown tables of results.json
//
// Phases per project (each its own fresh process, so every "cold" is really cold):
//   split      full project, layer by layer: TS service (openProject + getProgram), Smith index, rules index; writes the
//              per-(file, content-hash) memo the persisted phases read
//   full       createLineLsp build (as shipped), then cold first + warm (median of 20) calls, update([file]), RSS
//   scoped     a scope-only language service (root files = scope; TS follows imports), Smith + rules on scope files only,
//              the same raw calls, one-file change, lazy widening (add_to_scope one more index file)
//   persisted  (full | scoped) cold start with Smith + rules served from the stored hash index: only TS + hashing cost
//   throttle   (excalidraw) foreground scoped LSP + a nice-19 background shadow indexer child, N = 5 / 20 / 50 files a
//              tick, pausing while another heavy.sh job holds the lock or free RAM is below heavy.sh's threshold
//   live       (#950) the shipped live index: createLineLsp with its persistent hash index (lsp/store), scoped and full,
//              cold (empty store), warm (a fresh process over the stored index), one-file change; LSP_SPEED_PHASES=live
//
// Env (as the hardened Smith needs): LSP_SMITH_RAW=1 LINE_LINKS_ALLOW_DRIFT=1
//   ATOMIC_CODEMOD_SOURCE_DIR=~/Repositories/atomic-codemod-hardening SMITH_SOURCE_DIR=~/Repositories/smith
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const LSP = path.join(REPO, 'packages', 'engine', 'lsp');
const RESULTS = path.join(HERE, 'results.json');
const WARM_N = 20;
const CAP_MB = 1536; // shadow indexer memory cap
const MIN_FREE_MB = Number(process.env.CONSTRUCT_MIN_FREE_MB ?? 3000); // heavy.sh's threshold
const HEAVY_LOCK = process.env.CONSTRUCT_HEAVY_LOCK ?? '/tmp/construct-heavy.lock';

const PROJECTS = [
  { name: 'line-primitives', source: 'copy', from: 'packages/line-primitives', feature: 'library/components', widen: 'test/kit/harness.tsx', marker: 'library/components/Button.tsx',
    note: 'packages/ has no tsconfig.json, so the largest package with one (packages/line-primitives) stands in for it' },
  { name: 'lending-starter', source: 'copy', from: 'bench/lending/starter', line: true, feature: 'browse', widen: null, marker: 'library/pages/ListPage.tsx',
    note: 'a Line project with one feature (browse, no code yet): scope = that feature + library/; no second feature to widen to' },
  { name: 'vercel-commerce', source: 'clone', url: 'https://github.com/vercel/commerce', feature: 'components/cart', widen: 'lib/shopify/index.ts', marker: 'components/cart/actions.ts' },
  { name: 'excalidraw', source: 'clone', url: 'https://github.com/excalidraw/excalidraw', feature: 'packages/excalidraw/actions', widen: 'packages/math/src/index.ts', marker: 'packages/excalidraw/actions/actionAlign.tsx', throttle: true },
];

// ------------------------------------------------------------------------------------------------ small helpers
const now = () => performance.now();
const ms = (x) => Math.round(x * 10) / 10;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? ms(s[Math.floor(s.length / 2)]) : null; };
const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? ms(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]) : null; };
const mb = (bytes) => Math.round(bytes / 1048576);
const maxRssMb = () => Math.round(process.resourceUsage().maxRSS / 1024); // maxRSS is in KiB
const sha = (t) => crypto.createHash('sha1').update(t).digest('hex').slice(0, 16);
const posix = (p) => p.split(path.sep).join('/');
const isCode = (f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f) && !/\.d\.ts$/.test(f);
const sleep = (t) => new Promise((r) => setTimeout(r, t));
async function timed(fn) { const t = now(); const v = await fn(); return [now() - t, v]; }
async function warm(fn, n = WARM_N) { const xs = []; for (let i = 0; i < n; i++) { const t = now(); await fn(); xs.push(now() - t); } return { median: median(xs), p95: p95(xs) }; }

async function load() {
  const host = await import(path.join(LSP, 'host.mjs'));
  const server = await import(path.join(LSP, 'server.mjs'));
  return { host, server, ts: host.ts };
}
const loadS = () => import(path.join(LSP, 'smith.mjs'));
const loadR = () => import(path.join(LSP, 'rules.mjs'));

/** Root-relative code files of the whole project, as server.mjs's build walks them. */
function codeFiles(host, root) { return host.sourceFiles(root, { includeDts: false }).map((a) => posix(path.relative(root, a))).filter(isCode); }

/** The marker spots in a file: an offset for completions (first statement of the first function body) and a symbol
 * for quickInfo/definition (the first named import binding, so definition crosses files; else the first function). */
function spotsOf(ts, rel, text) {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, /\.tsx$/.test(rel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let offset = null; let fnName = null; let imported = null;
  const visit = (n) => {
    if (offset === null && (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n)) && n.body && ts.isBlock(n.body) && n.body.statements.length) {
      offset = n.body.statements[0].getStart(sf);
      fnName = n.name && ts.isIdentifier(n.name) ? n.name.text : null;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  for (const st of sf.statements) {
    if (imported || !ts.isImportDeclaration(st) || !st.importClause) continue;
    const nb = st.importClause.namedBindings;
    if (nb && ts.isNamedImports(nb) && nb.elements.length) imported = nb.elements[0].name.text;
    else if (st.importClause.name) imported = st.importClause.name.text;
  }
  return { offset: offset ?? text.length, symbol: imported ?? fnName ?? 'x' };
}

// ------------------------------------------------------------------------------------------------ scope
/** The scope's root files. Line: the feature's files + other features' index files (moduleScope) + library/.
 * Otherwise: one folder as the "feature" + its direct (one-hop) imports inside the project. */
async function scopeOf(ts, host, root, p) {
  const all = host.sourceFiles(root, { includeDts: false }).map((a) => posix(path.relative(root, a)));
  if (p.line) {
    const { moduleScope } = await import(path.join(REPO, 'packages', 'engine', 'line', 'scope', 'moduleScope.mjs'));
    const feats = fs.readdirSync(path.join(root, 'features'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    const indexes = feats.filter((f) => f !== p.feature).map((f) => { try { return moduleScope(root, f).index; } catch { return null; } }).filter(Boolean);
    const files = all.filter((f) => f.startsWith(`features/${p.feature}/`) || f.startsWith('library/') || indexes.includes(f));
    return { files, how: `features/${p.feature}/** + ${indexes.length} other feature index file(s) + library/**` };
  }
  const own = all.filter((f) => f.startsWith(`${p.feature}/`));
  const options = host.readOptions(root).options;
  const set = new Set(own);
  for (const f of own) for (const d of directImports(ts, root, f, options)) set.add(d);
  return { files: [...set], how: `${p.feature}/** (${own.length} files) + their direct imports inside the project (${set.size - own.length})` };
}
function directImports(ts, root, rel, options) {
  const abs = path.join(root, rel);
  let text = ''; try { text = fs.readFileSync(abs, 'utf8'); } catch { return []; }
  const out = [];
  for (const im of ts.preProcessFile(text, true, true).importedFiles) {
    const r = ts.resolveModuleName(im.fileName, abs, options, ts.sys).resolvedModule?.resolvedFileName;
    if (!r) continue;
    const a = path.resolve(r);
    if (a.startsWith(root + path.sep) && !a.includes(`${path.sep}node_modules${path.sep}`)) out.push(posix(path.relative(root, a)));
  }
  return out;
}

/** A language service whose root files are only `files` (TS follows their imports), contained like host.mjs. */
function scopedService(ts, host, root, files) {
  const options = host.readOptions(root).options;
  const versions = new Map();
  const state = { files: files.map((f) => path.join(root, f)), overlays: new Map() };
  const readable = (p) => { const a = path.resolve(p); return host.inside(root, a) || host.inside(host.tsLibDir(), a); };
  const lsHost = {
    getScriptFileNames: () => state.files,
    getScriptVersion: (f) => versions.get(path.resolve(f)) ?? host.mtimeOf(f),
    getScriptSnapshot: (f) => { if (!readable(f)) return undefined; try { return ts.ScriptSnapshot.fromString(fs.readFileSync(path.resolve(f), 'utf8')); } catch { return undefined; } },
    getCurrentDirectory: () => root,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (p) => readable(p) && ts.sys.fileExists(p),
    readFile: (p) => (readable(p) ? ts.sys.readFile(p) : undefined),
    directoryExists: (p) => host.inside(root, path.resolve(p)) && ts.sys.directoryExists(p),
    getDirectories: (p) => (readable(p) ? ts.sys.getDirectories(p) : []),
    readDirectory: (p, e, x, i, d) => (readable(p) ? ts.sys.readDirectory(p, e, x, i, d).filter(readable) : []),
    realpath: (p) => p,
    useCaseSensitiveFileNames: () => true,
  };
  const service = ts.createLanguageService(lsHost, ts.createDocumentRegistry(true, root));
  return {
    service, state,
    add: (rels) => { for (const f of rels) { const a = path.join(root, f); if (!state.files.includes(a)) state.files.push(a); } },
    bump: (rel) => versions.set(path.join(root, rel), `h:${sha(fs.readFileSync(path.join(root, rel), 'utf8'))}`),
  };
}

/** Program size: every source file it loaded, and those inside the project (lib .d.ts files excluded). */
function programSize(service, root) {
  const sfs = service.getProgram().getSourceFiles();
  return { loaded: sfs.length, inProject: sfs.filter((s) => path.resolve(s.fileName).startsWith(root + path.sep)).length };
}

// Raw calls on any language service, so full and scoped are compared on the same code path (the product API's own
// calls always use openProject's full file list). `fixes` here is one round: combined missing-import + the
// single-candidate fixes at each error (the product's fixes() runs up to 8 such rounds).
const FORMAT_OF = (ts) => ({ ...ts.getDefaultFormatCodeSettings('\n'), indentSize: 2, tabSize: 2, convertTabsToSpaces: true });
const PREFS = { quotePreference: 'single', importModuleSpecifierEnding: 'minimal', includeCompletionsForModuleExports: true, includeCompletionsWithInsertText: true, allowIncompleteCompletions: false };
function rawCalls(ts, svc, abs, spots, text) {
  const FORMAT = FORMAT_OF(ts);
  const symPos = () => { const i = text.indexOf(spots.symbol); return i < 0 ? 0 : i; };
  return {
    diagnostics: () => [...svc.getSyntacticDiagnostics(abs), ...svc.getSemanticDiagnostics(abs)].length,
    completionsAt: () => (svc.getCompletionsAtPosition(abs, spots.offset, { ...PREFS, triggerKind: 1 }, FORMAT)?.entries ?? []).length,
    quickInfo: () => svc.getQuickInfoAtPosition(abs, symPos()),
    definition: () => svc.getDefinitionAtPosition(abs, symPos()),
    fixes: () => {
      const n = svc.getCombinedCodeFix({ type: 'file', fileName: abs }, 'fixMissingImport', FORMAT, PREFS).changes.length;
      let k = 0;
      for (const d of svc.getSemanticDiagnostics(abs).slice(0, 20)) if (d.start != null) k += svc.getCodeFixesAtPosition(abs, d.start, d.start + (d.length ?? 0), [d.code], FORMAT, PREFS).length;
      return n + k;
    },
  };
}
async function measureCalls(calls) {
  const cold = {}; const warmed = {};
  for (const [k, fn] of Object.entries(calls)) cold[k] = ms((await timed(fn))[0]);
  for (const [k, fn] of Object.entries(calls)) warmed[k] = await warm(fn);
  return { cold, warm: warmed };
}

// Smith + rules over a file list, with the per-(file, hash) memo.
async function indexLayers(root, rels, { memo = null, record = null } = {}) {
  const S = await loadS(); const R = await loadR();
  let smithMs = 0; let rulesMs = 0; let hashMs = 0; let functions = 0; let hits = 0;
  for (const rel of rels) {
    if (!isCode(rel)) continue;
    let text; try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
    let t = now(); const key = sha(`${rel}\0${text}`); hashMs += now() - t;
    const m = memo?.[key];
    if (m) { hits++; functions += m.smith.length; continue; }
    t = now(); const entries = await S.smithIndexFile(rel, text); smithMs += now() - t;
    t = now(); const rules = R.ruleDiagnostics(root, rel); rulesMs += now() - t;
    functions += entries.length;
    if (record) record[key] = { smith: entries, rules };
  }
  return { smithMs: ms(smithMs), rulesMs: ms(rulesMs), hashMs: ms(hashMs), functions, hits };
}

// ------------------------------------------------------------------------------------------------ phases
async function phaseSplit(p, root, work) {
  const { host } = await load();
  const t0 = now();
  const proj = host.openProject(root, { includeDts: true, extraRoots: [] });
  if (!proj.ok) return { ok: false, reason: proj.reason };
  const openMs = now() - t0;
  const t1 = now(); proj.service.getProgram(); const programMs = now() - t1;
  const size = programSize(proj.service, root);
  const files = codeFiles(host, root);
  const record = {};
  const layers = await indexLayers(root, files, { record });
  fs.writeFileSync(path.join(work, `memo-${p.name}.json`), JSON.stringify(record));
  return { ok: true, files: files.length, allSourceFiles: proj.files.length, functions: layers.functions, ts: { openProjectMs: ms(openMs), programMs: ms(programMs), totalMs: ms(openMs + programMs), ...size }, smithMs: layers.smithMs, rulesMs: layers.rulesMs, rssMb: mb(process.memoryUsage().rss), maxRssMb: maxRssMb() };
}

async function phaseFull(p, root) {
  const { host, server, ts } = await load();
  const [buildMs, lsp] = await timed(() => server.createLineLsp(root, { smith: true }));
  const proj = host.openProject(root, { includeDts: true, extraRoots: [] });
  const [programMs] = await timed(() => proj.service.getProgram());
  const rssAfterBuild = mb(process.memoryUsage().rss);
  const size = programSize(proj.service, root);
  const rel = p.marker; const abs = path.join(root, rel);
  const text = fs.readFileSync(abs, 'utf8');
  const spots = spotsOf(ts, rel, text);
  const node = { need: p.line ? `${p.feature}/pages/BrowsePage` : `${p.feature.split('/').pop()}/domains/probe`, from: p.line ? p.feature : 'probe' };
  const api = {
    diagnostics: () => lsp.diagnostics(rel),
    completionsAt: () => lsp.completionsAt(rel, spots.offset),
    quickInfo: () => lsp.quickInfo(rel, spots.symbol),
    definition: () => lsp.definition(rel, spots.symbol),
    fixes: () => lsp.fixes(rel),
    nextSteps: () => lsp.nextSteps(node),
  };
  const product = await measureCalls(api);
  const completion = lsp.completionsAt(rel, spots.offset);
  const raw = await measureCalls(rawCalls(ts, proj.service, abs, spots, text));
  const completionTotal = rawCalls(ts, proj.service, abs, spots, text).completionsAt();
  // one-file change: append a comment line, update([file]), then the next diagnostics call (TS re-parses lazily)
  fs.writeFileSync(abs, `${text}\n// lsp-speed probe\n`);
  const upd = await lsp.update([rel]);
  const [nextDiagMs] = await timed(() => lsp.diagnostics(rel));
  fs.writeFileSync(abs, text);
  await lsp.update([rel]);
  return {
    ok: true, buildMs: ms(buildMs), size: lsp.size, programMs: ms(programMs), program: size, spots,
    product, raw, completion: { productItems: completion.items?.length ?? null, productTotal: completion.total ?? null, rawTotal: completionTotal },
    update: { ms: upd.ms, touched: upd.touched, layers: upd.layers, nextDiagnosticsMs: ms(nextDiagMs) },
    rssAfterBuildMb: rssAfterBuild, rssEndMb: mb(process.memoryUsage().rss), maxRssMb: maxRssMb(),
  };
}

async function phaseScoped(p, root) {
  const { host, ts } = await load();
  const tAll = now();
  const [scopeMs, scope] = await timed(() => scopeOf(ts, host, root, p));
  const sc = scopedService(ts, host, root, scope.files);
  const [programMs] = await timed(() => sc.service.getProgram());
  const size = programSize(sc.service, root);
  const layers = await indexLayers(root, scope.files);
  const buildMs = now() - tAll;
  const rssAfterBuild = mb(process.memoryUsage().rss);
  const rel = p.marker; const abs = path.join(root, rel);
  const text = fs.readFileSync(abs, 'utf8');
  const spots = spotsOf(ts, rel, text);
  const raw = await measureCalls(rawCalls(ts, sc.service, abs, spots, text));
  const completionTotal = rawCalls(ts, sc.service, abs, spots, text).completionsAt();
  // one-file change: Smith + rules for that file, TS re-versioned, then the next diagnostics call
  fs.writeFileSync(abs, `${text}\n// lsp-speed probe\n`);
  const t = now(); sc.bump(rel); const l1 = await indexLayers(root, [rel]); const updMs = now() - t;
  const [nextDiagMs] = await timed(() => rawCalls(ts, sc.service, abs, spots, text).diagnostics());
  fs.writeFileSync(abs, text); sc.bump(rel);
  let widen = null;
  if (p.widen) {
    const before = programSize(sc.service, root);
    const t2 = now(); sc.add([p.widen]); sc.service.getProgram(); const tsMs = now() - t2;
    const l2 = await indexLayers(root, [p.widen]);
    const after = programSize(sc.service, root);
    widen = { file: p.widen, tsMs: ms(tsMs), smithMs: l2.smithMs, rulesMs: l2.rulesMs, totalMs: ms(tsMs + l2.smithMs + l2.rulesMs), loadedBefore: before.inProject, loadedAfter: after.inProject, completionTotalAfter: rawCalls(ts, sc.service, abs, spots, text).completionsAt() };
  }
  return {
    ok: true, scope: { how: scope.how, rootFiles: scope.files.length, codeFiles: scope.files.filter(isCode).length, resolveMs: ms(scopeMs) },
    buildMs: ms(buildMs), programMs: ms(programMs), program: size, smithMs: layers.smithMs, rulesMs: layers.rulesMs, functions: layers.functions,
    raw, completionTotal, update: { ms: ms(updMs), layers: { ts: 1, smith: l1.functions, rules: 1 }, nextDiagnosticsMs: ms(nextDiagMs) }, widen,
    rssAfterBuildMb: rssAfterBuild, maxRssMb: maxRssMb(),
  };
}

async function phasePersisted(p, root, work, mode) {
  const { host, ts } = await load();
  const t0 = now();
  const [loadMs, memo] = await timed(() => JSON.parse(fs.readFileSync(path.join(work, `memo-${p.name}.json`), 'utf8')));
  let tsMs; let files;
  if (mode === 'full') {
    const t = now(); const proj = host.openProject(root, { includeDts: true, extraRoots: [] }); proj.service.getProgram(); tsMs = now() - t;
    files = codeFiles(host, root);
  } else {
    const t = now(); const scope = await scopeOf(ts, host, root, p); const sc = scopedService(ts, host, root, scope.files); sc.service.getProgram(); tsMs = now() - t;
    files = scope.files;
  }
  const layers = await indexLayers(root, files, { memo });
  return { ok: true, mode, totalMs: ms(now() - t0), memoLoadMs: ms(loadMs), tsMs: ms(tsMs), hashMs: layers.hashMs, hits: layers.hits, misses: files.filter(isCode).length - layers.hits, smithMs: layers.smithMs, rulesMs: layers.rulesMs, maxRssMb: maxRssMb() };
}

// ------------------------------------------------------------------------------------------------ live (#950)
/** The shipped live index: `variant` = cold-scoped | warm-scoped | cold-full | warm-full. A cold run starts from an
 * empty store; a warm run is a fresh process over the store the cold run of the same scope left. Ready = build + the
 * first TS call (it builds the program). The warm runs also time a one-file change: update([file]) + next diagnostics. */
async function phaseLive(p, root, work, variant) {
  const { server, ts } = await load();
  const [temp, kind] = variant.split('-');
  const storeDir = path.join(work, `store-${p.name}-${kind}`);
  if (temp === 'cold') fs.rmSync(storeDir, { recursive: true, force: true });
  const scope = kind === 'full' ? 'full' : p.line ? { feature: p.feature } : { folder: p.feature };
  const [buildMs, lsp] = await timed(() => server.createLineLsp(root, { scope, storeDir }));
  const rel = p.marker; const abs = path.join(root, rel);
  const text = fs.readFileSync(abs, 'utf8');
  const spots = spotsOf(ts, rel, text);
  const [firstTsMs] = await timed(() => lsp.quickInfo(rel, spots.symbol));
  let change = null;
  if (temp === 'warm') {
    await lsp.diagnostics(rel); // warm the gate cache for the unchanged file, as a running session has it
    fs.writeFileSync(abs, `${text}\n// lsp-speed probe\n`);
    const [updMs, u] = await timed(() => lsp.update([rel]));
    const [nextDiagMs] = await timed(() => lsp.diagnostics(rel));
    fs.writeFileSync(abs, text);
    const [revertMs, u2] = await timed(() => lsp.update([rel]));
    change = { updateMs: ms(updMs), layers: u.layers, touched: u.touched, nextDiagnosticsMs: ms(nextDiagMs), revertMs: ms(revertMs), revertLayers: u2.layers };
  }
  lsp.close();
  return { ok: true, variant, buildMs: ms(buildMs), firstTsMs: ms(firstTsMs), readyMs: ms(buildMs + firstTsMs), cold: lsp.cold, store: lsp.store, scope: lsp.scope, size: lsp.size, stats: lsp.stats, change, maxRssMb: maxRssMb() };
}

// ------------------------------------------------------------------------------------------------ throttle
function freeMb() {
  try {
    const out = execFileSync('vm_stat', { encoding: 'utf8' });
    const page = Number(/page size of (\d+)/.exec(out)?.[1] ?? 4096);
    const pages = (k) => Number(new RegExp(`Pages ${k}:\\s+(\\d+)`).exec(out)?.[1] ?? 0);
    return Math.round(((pages('free') + pages('inactive') + pages('speculative')) * page) / 1048576);
  } catch { return Math.round(os.freemem() / 1048576); }
}
/** Another heavy.sh job holds the lock (macOS mkdir lock: <lock>.d/pid; flock: <lock>.holder). Our own run's holder
 * (CONSTRUCT_HEAVY_HELD) does not count, or the shadow job would wait out the measurement itself. */
function lockHeldByOther() {
  const own = Number(String(process.env.CONSTRUCT_HEAVY_HELD ?? '').split(':')[0]) || -1;
  let pid = null;
  try { pid = Number(fs.readFileSync(`${HEAVY_LOCK}.d/pid`, 'utf8').replace(/\D/g, '')); } catch { /* none */ }
  if (!pid) { try { pid = Number(/^pid (\d+)/.exec(fs.readFileSync(`${HEAVY_LOCK}.holder`, 'utf8'))?.[1]); } catch { /* none */ } }
  if (!pid || pid === own) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** The shadow indexer child: index the rest of the project outward from the scope, N files a tick. */
async function phaseShadow(p, root, n, pauseMs) {
  try { os.setPriority(19); } catch { /* already niced by `nice -n 19` (macOS refuses a no-op renice here) */ }
  const nice = os.getPriority();
  const { host, ts } = await load();
  const S = await loadS(); const R = await loadR();
  const scope = await scopeOf(ts, host, root, p);
  const options = host.readOptions(root).options;
  const all = codeFiles(host, root);
  // outward order: BFS over direct imports from the scope, then whatever is left (alphabetical)
  const seen = new Set(scope.files); const order = []; let frontier = [...scope.files];
  while (frontier.length) {
    const next = [];
    for (const f of frontier) for (const d of directImports(ts, root, f, options)) if (!seen.has(d)) { seen.add(d); next.push(d); if (isCode(d)) order.push(d); }
    frontier = next;
  }
  const reached = order.length;
  for (const f of all) if (!seen.has(f)) { seen.add(f); order.push(f); }
  const sc = scopedService(ts, host, root, scope.files);
  sc.service.getProgram();
  const t0 = now(); const c0 = process.cpuUsage();
  const ticks = []; let paused = 0; let pausedFor = { lock: 0, ram: 0 }; let capHit = false; let done = 0;
  for (let i = 0; i < order.length; i += n) {
    for (;;) { // gate: another heavy job, or low RAM -> wait (bounded at 5 min in all, so the bench always ends)
      if (paused >= 300000) break;
      const lock = lockHeldByOther(); const ram = freeMb() < MIN_FREE_MB;
      if (!lock && !ram) break;
      if (lock) pausedFor.lock += 1000; else pausedFor.ram += 1000;
      paused += 1000; await sleep(1000);
    }
    if (mb(process.memoryUsage().rss) > CAP_MB) { capHit = true; break; }
    const batch = order.slice(i, i + n);
    const tt = now(); const cc = process.cpuUsage();
    sc.add(batch); sc.service.getProgram();
    for (const rel of batch) { const text = fs.readFileSync(path.join(root, rel), 'utf8'); await S.smithIndexFile(rel, text); R.ruleDiagnostics(root, rel); }
    const wall = now() - tt; const cpu = process.cpuUsage(cc);
    ticks.push({ wall, cpuPct: ((cpu.user + cpu.system) / 1000 / wall) * 100 });
    done += batch.length;
    await sleep(pauseMs);
  }
  const wall = now() - t0; const cpu = process.cpuUsage(c0);
  return {
    ok: true, n, pauseMs, nice, files: order.length, reachedFromScope: reached, indexed: done, coverage: `${scope.files.length + done}/${scope.files.length + order.length}`,
    totalMs: ms(wall), avgCpuPct: ms(((cpu.user + cpu.system) / 1000 / wall) * 100), peakTickCpuPct: ms(Math.max(...ticks.map((t) => t.cpuPct))),
    maxTickMs: ms(Math.max(...ticks.map((t) => t.wall))), medianTickMs: median(ticks.map((t) => t.wall)), ticks: ticks.length,
    pausedMs: paused, pausedFor, capMb: CAP_MB, capHit, maxRssMb: maxRssMb(), freeMbAtEnd: freeMb(),
  };
}

async function phaseThrottle(p, root, work) {
  const { host, ts } = await load();
  const scope = await scopeOf(ts, host, root, p);
  const sc = scopedService(ts, host, root, scope.files);
  sc.service.getProgram();
  const rel = p.marker; const abs = path.join(root, rel); const text = fs.readFileSync(abs, 'utf8');
  const calls = rawCalls(ts, sc.service, abs, spotsOf(ts, rel, text), text);
  calls.completionsAt(); calls.quickInfo();
  const sample = async (k) => { const t = now(); calls[k](); return now() - t; };
  const base = { completionsAt: [], quickInfo: [] };
  for (let i = 0; i < 40; i++) { base.completionsAt.push(await sample('completionsAt')); base.quickInfo.push(await sample('quickInfo')); await sleep(50); }
  const runs = [];
  for (const n of [5, 20, 50]) {
    const child = spawn('nice', ['-n', '19', process.execPath, `--max-old-space-size=${CAP_MB}`, fileURLToPath(import.meta.url), 'phase', 'shadow', p.name, root, work, String(n)], { stdio: ['ignore', 'pipe', 'inherit'], env: process.env });
    let out = ''; child.stdout.on('data', (d) => { out += d; });
    let exited = false; const done = new Promise((r) => child.on('exit', () => { exited = true; r(); }));
    const fg = { completionsAt: [], quickInfo: [] };
    await sleep(1500); // let the child pass its own startup (module load, scope build)
    while (!exited) { fg.completionsAt.push(await sample('completionsAt')); fg.quickInfo.push(await sample('quickInfo')); await sleep(250); }
    await done;
    const res = JSON.parse(out.trim().split('\n').pop() || '{}');
    const added = (k) => ({ baseMedian: median(base[k]), duringMedian: median(fg[k]), baseP95: p95(base[k]), duringP95: p95(fg[k]), addedMedianMs: fg[k].length ? ms(median(fg[k]) - median(base[k])) : null, addedP95Ms: fg[k].length ? ms(p95(fg[k]) - p95(base[k])) : null, samples: fg[k].length });
    runs.push({ ...res, foreground: { completionsAt: added('completionsAt'), quickInfo: added('quickInfo') } });
  }
  const ok = runs.filter((r) => r.ok && !r.capHit && r.maxRssMb < CAP_MB && Math.max(r.foreground.completionsAt.addedP95Ms, r.foreground.quickInfo.addedP95Ms) < 20);
  return { ok: true, capMb: CAP_MB, minFreeMb: MIN_FREE_MB, runs, pickN: ok.length ? Math.max(...ok.map((r) => r.n)) : null, pickRule: 'largest N with added p95 foreground latency < 20 ms and peak RSS < cap' };
}

// ------------------------------------------------------------------------------------------------ driver
function runPhase(args, timeoutMs = 45 * 60000) {
  const t = now();
  try {
    const out = execFileSync(process.execPath, [fileURLToPath(import.meta.url), 'phase', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: timeoutMs, maxBuffer: 64 << 20, env: process.env });
    return { ...JSON.parse(out.trim().split('\n').pop()), wallMs: ms(now() - t) };
  } catch (e) { return { ok: false, reason: String(e.message).split('\n')[0].slice(0, 300), wallMs: ms(now() - t) }; }
}

function countPackages(ts) {
  const files = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isSymbolicLink()) continue; const p = path.join(d, e.name); if (e.isDirectory()) { if (!['node_modules', 'dist', '.next'].includes(e.name)) walk(p); } else if (isCode(e.name)) files.push(p); } };
  walk(path.join(REPO, 'packages'));
  let fns = 0;
  for (const f of files) {
    const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, /x$/.test(f) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const st of sf.statements) { if (ts.isFunctionDeclaration(st) && st.body) fns++; else if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) fns++; }
  }
  return { codeFiles: files.length, topLevelFunctions: fns, tsconfigAtPackagesRoot: fs.existsSync(path.join(REPO, 'packages', 'tsconfig.json')) };
}

async function driver() {
  const work = path.join('/tmp', `construct-lsp-speed-${process.pid}`);
  fs.mkdirSync(work); // NEW and empty: fails if it exists
  const { ts } = await load();
  const S = await loadS();
  const phases = process.env.LSP_SPEED_PHASES ? process.env.LSP_SPEED_PHASES.split(',') : null; // re-run only these, merged into results.json
  const want = (ph) => !phases || phases.includes(ph);
  const prev = phases && fs.existsSync(RESULTS) ? JSON.parse(fs.readFileSync(RESULTS, 'utf8')) : null;
  const out = prev ? { ...prev, reruns: [...(prev.reruns ?? []), { when: new Date().toISOString(), phases }] } : {
    when: new Date().toISOString(), node: process.version, machine: `${os.cpus()[0]?.model} x${os.cpus().length}, ${mb(os.totalmem())} MB`,
    construct: execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    smith: { raw: S.RAW, ready: S.smithReady(), atomicCodemodHead: S.smithHead() }, typescript: ts.version,
    packages: countPackages(ts), projects: {},
  };
  try {
    const only = process.env.LSP_SPEED_ONLY ? process.env.LSP_SPEED_ONLY.split(',') : null; // smoke tests only
    for (const p of PROJECTS.filter((x) => !only || only.includes(x.name))) {
      const root = path.join(work, p.name);
      const rec = prev?.projects?.[p.name] ?? { note: p.note ?? null, feature: p.feature, widen: p.widen, marker: p.marker };
      if (p.source === 'copy') {
        fs.cpSync(path.join(REPO, p.from), root, { recursive: true, filter: (s) => !/[/\\](node_modules|\.next)$/.test(s) });
        rec.source = p.from;
      } else {
        execFileSync('git', ['clone', '--depth', '1', '--quiet', p.url, root], { stdio: 'inherit' }); // parse only: nothing in it ever runs
        rec.source = p.url;
        const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        if (rec.commit && rec.commit !== head) rec.rerunCommit = head; else rec.commit = head;
        const lic = ['LICENSE', 'LICENSE.md', 'license.md'].map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
        rec.license = lic ? fs.readFileSync(lic, 'utf8').split('\n').find((l) => l.trim())?.trim() : null;
      }
      if (want('split')) { process.stderr.write(`[lsp-speed] ${p.name}: split\n`); rec.split = runPhase(['split', p.name, root, work]); }
      if (want('full')) { process.stderr.write(`[lsp-speed] ${p.name}: full\n`); rec.full = runPhase(['full', p.name, root, work]); }
      if (want('scoped')) { process.stderr.write(`[lsp-speed] ${p.name}: scoped\n`); rec.scoped = runPhase(['scoped', p.name, root, work]); }
      if (want('persisted')) {
        process.stderr.write(`[lsp-speed] ${p.name}: persisted\n`);
        rec.persistedFull = runPhase(['persisted', p.name, root, work, 'full']);
        rec.persistedScoped = runPhase(['persisted', p.name, root, work, 'scoped']);
      }
      if (want('live')) {
        rec.live = {};
        for (const v of ['cold-scoped', 'warm-scoped', 'cold-full', 'warm-full']) { process.stderr.write(`[lsp-speed] ${p.name}: live ${v}\n`); rec.live[v] = runPhase(['live', p.name, root, work, v]); }
      }
      if (p.throttle && want('throttle')) { process.stderr.write(`[lsp-speed] ${p.name}: throttle\n`); rec.throttle = runPhase(['throttle', p.name, root, work], 90 * 60000); }
      out.projects[p.name] = rec;
      fs.writeFileSync(RESULTS, `${JSON.stringify(out, null, 2)}\n`);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    out.cleanedUp = !fs.existsSync(work);
    fs.writeFileSync(RESULTS, `${JSON.stringify(out, null, 2)}\n`);
  }
  process.stderr.write(`[lsp-speed] wrote ${RESULTS}\n`);
}

async function phase([name, project, root, work, extra]) {
  const p = PROJECTS.find((x) => x.name === project);
  const fns = { split: () => phaseSplit(p, root, work), full: () => phaseFull(p, root), scoped: () => phaseScoped(p, root),
    persisted: () => phasePersisted(p, root, work, extra), live: () => phaseLive(p, root, work, extra), throttle: () => phaseThrottle(p, root, work), shadow: () => phaseShadow(p, root, Number(extra), 100) };
  let res;
  try { res = await fns[name](); } catch (e) { res = { ok: false, reason: String(e?.stack || e).split('\n').slice(0, 3).join(' | ').slice(0, 400) }; }
  process.stdout.write(`\n${JSON.stringify(res)}\n`);
  process.exit(0);
}

// ------------------------------------------------------------------------------------------------ render
function render() {
  const r = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
  const P = Object.entries(r.projects);
  const v = (x) => (x == null ? 'n/a' : x);
  const lines = [];
  lines.push('| project | files | functions | TS service | Smith index | rules index | createLineLsp build | RSS after build / peak |', '|---|--:|--:|--:|--:|--:|--:|--:|');
  for (const [n, x] of P) lines.push(`| ${n} | ${v(x.split.files)} | ${v(x.split.functions)} | ${v(x.split.ts?.totalMs)} ms | ${v(x.split.smithMs)} ms | ${v(x.split.rulesMs)} ms | ${v(x.full.buildMs)} ms (+${v(x.full.programMs)} ms TS on first call) | ${v(x.full.rssAfterBuildMb)} / ${v(x.full.maxRssMb)} MB |`);
  lines.push('', '| project | call | full cold | full warm (median / p95) | scoped raw cold | scoped raw warm | full raw warm |', '|---|---|--:|--:|--:|--:|--:|');
  for (const [n, x] of P) for (const k of ['diagnostics', 'completionsAt', 'quickInfo', 'definition', 'fixes', 'nextSteps']) {
    const fw = x.full.product?.warm?.[k]; const sw = x.scoped.raw?.warm?.[k]; const rw = x.full.raw?.warm?.[k];
    lines.push(`| ${n} | ${k} | ${v(x.full.product?.cold?.[k])} | ${fw ? `${fw.median} / ${fw.p95}` : 'n/a'} | ${v(x.scoped.raw?.cold?.[k])} | ${sw ? `${sw.median} / ${sw.p95}` : 'n/a'} | ${rw ? `${rw.median} / ${rw.p95}` : 'n/a'} |`);
  }
  lines.push('', '| project | scope | scoped build | TS files loaded (scoped / full) | completions (scoped / full) | update full (ms, layers, next diag) | update scoped (ms, next diag) | widen (+ms, files after) | RSS scoped / full | persisted cold full / scoped |', '|---|---|--:|--:|--:|---|---|---|--:|--:|');
  for (const [n, x] of P) {
    const s = x.scoped; const f = x.full;
    lines.push(`| ${n} | ${v(s.scope?.how)} | ${v(s.buildMs)} ms | ${v(s.program?.inProject)} / ${v(f.program?.inProject)} | ${v(s.completionTotal)} / ${v(f.completion?.rawTotal)} | ${v(f.update?.ms)} ms, ${JSON.stringify(f.update?.layers ?? null)}, ${v(f.update?.nextDiagnosticsMs)} ms | ${v(s.update?.ms)} ms, ${v(s.update?.nextDiagnosticsMs)} ms | ${s.widen ? `+${s.widen.totalMs} ms (TS ${s.widen.tsMs}), ${s.widen.loadedAfter}` : 'n/a'} | ${v(s.maxRssMb)} / ${v(f.maxRssMb)} MB | ${v(x.persistedFull?.totalMs)} / ${v(x.persistedScoped?.totalMs)} ms |`);
  }
  const th = r.projects.excalidraw?.throttle;
  if (th?.runs) {
    lines.push('', '| N files/tick | time to full coverage | coverage | avg CPU% | peak tick CPU% | max tick | peak RSS | paused | +completionsAt p95 | +quickInfo p95 |', '|--:|--:|---|--:|--:|--:|--:|--:|--:|--:|');
    for (const t of th.runs) lines.push(`| ${t.n} | ${v(t.totalMs)} ms | ${v(t.coverage)} | ${v(t.avgCpuPct)} | ${v(t.peakTickCpuPct)} | ${v(t.maxTickMs)} ms | ${v(t.maxRssMb)} MB | ${v(t.pausedMs)} ms | ${v(t.foreground?.completionsAt?.addedP95Ms)} ms | ${v(t.foreground?.quickInfo?.addedP95Ms)} ms |`);
    lines.push('', `Picked N = ${v(th.pickN)} (${th.pickRule}).`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'run') await driver();
else if (cmd === 'phase') await phase(rest);
else if (cmd === 'render') render();
else { process.stderr.write('usage: measure.mjs run | render\n'); process.exit(2); }
