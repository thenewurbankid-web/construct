// #943 -- the Line LSP as one server: three layers linked by stable id, over one per-project index keyed by file
// version (content hash), so the vocabulary grows as generated code lands and update() re-indexes only what changed.
//
//   layer 1  Smith English   function -> Smith sentences (smith.mjs), plain and exact (canonical) style
//   layer 2  Line rules      file -> rule violations (rules.mjs), path node -> allowed Trace steps
//   layer 3  TypeScript      the shared language service (host.mjs + index.mjs), re-versioned per changed file
//
// #950 -- the live index: scoped by default, persistent, kept current.
//   scope        lsp.scope = 'scoped' (default) | 'full' (option `scope`, LINE_LSP_SCOPE, line/lsp-profile.json). Scoped:
//                TS root files, Smith and the rules cover the scope only (scope.mjs: the focus feature + other features'
//                index files + library/ for a Line project, a folder + its direct imports otherwise). It widens lazily:
//                a call on a file outside it, a definition or completion that only resolves outside it (the stored
//                exported signatures say where), a landed edit that imports a file outside it (add_to_scope), and
//                applied({step: 'add_to_scope' | 'create_module', target}).
//   store        lsp/store: per (file, content hash, Smith pin, rules version) the Smith steps, stable ids, rule results,
//                exported signatures and references, under <root>/line/.index/. A cold start reuses every matching
//                entry and recomputes only the misses (`store: false` turns it off).
//   background   `background: true` (the MCP server session; one-shot CLI runs leave it off) starts indexer.mjs: a nice-19
//                child under a 1.5 GB cap, 50 files a tick outward from the scope, pausing on heavy.sh's lock or low RAM.
//   live         update(changedFiles) when a step lands (planService runNext calls it); `watch: true` adds an fs.watch
//                watcher (watch.mjs) for outside edits, debounced. close() stops both.
//
//   const lsp = await createLineLsp(root, { extraRoots, scope: 'scoped', background: false, watch: false })
//   await lsp.update(['features/book/domains/formatPages.ts'])   -> { touched, layers: {ts, smith, rules}, widened, ms }
//   lsp.symbol('book/domains/formatPages')                        -> { id, file, name, ts, smith, exact, rules }
//   await lsp.diagnostics(file)                                   -> TS + rules + atomicGate lines, one each
//   lsp.scope / lsp.cold / lsp.widen(files) / lsp.applied(step) / lsp.background / await lsp.idle() / lsp.close()
//   plus every layer's calls: fixes, completionsAt, quickInfo, signatureAt, definition, references, smithCompletions,
//   smithDiagnostics, smithDefinition, smithReferences, ruleDiagnostics, ruleFixes, nextSteps
import fs from 'node:fs';
import path from 'node:path';
import * as T from './index.mjs';
import { openProject, updateFiles, sourceFiles, inside, readOptions, hashOf, MAX_FILES } from './host.mjs';
import * as S from './smith.mjs';
import * as R from './rules.mjs';
import { gateDiagnostics } from './gate.mjs';
import { openStore } from './store/index.mjs';
import { computeRecord, smithPin, rulesVersion, isCode } from './record.mjs';
import { resolveScope } from './scope.mjs';
import { directImportsOf, exportsOf } from './outline.mjs';
import { startBackgroundIndexer } from './indexer.mjs';
import { watchProject } from './watch.mjs';

const posix = (p) => p.split(path.sep).join('/');
const EXPORT_RE = (name) => new RegExp(`export\\s+(?:default\\s+)?(?:declare\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|class|interface|type|enum|abstract\\s+class)\\s+${name}`);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MAX_WIDEN = 5;

/**
 * The Line LSP over one project: its index across the TS, Smith and rules layers, kept current by update().
 * @param {string} root Project root (tsconfig.json at it).
 * @param {{extraRoots?: string[], smith?: boolean, rules?: boolean, exact?: boolean,
 *   scope?: 'scoped'|'full'|{feature?: string, folder?: string, files?: string[]},
 *   store?: boolean, storeDir?: string, background?: boolean | object, watch?: boolean, debounceMs?: number,
 *   smithIndex?: (rel: string, text: string, o?: {canonical?: boolean}) => Promise<any[]>, smithModule?: string,
 *   smithPin?: string, rulesVersion?: string}} [o]
 *   `smith: false` skips layer 1 (no atomic-codemod); `exact: false` stores the plain style only. `smithIndex` /
 *   `smithModule` (a module exporting smithIndexFile, also used by the background child) replace Smith (tests);
 *   `smithPin` / `rulesVersion` override the computed pins (tests).
 * @returns {Promise<any>} The server: its index and calls (update, ...).
 */
export async function createLineLsp(root, o = {}) {
  const r = path.resolve(root);
  const t0 = Date.now();
  const useSmith = o.smith ?? (o.smithIndex || o.smithModule ? true : S.smithReady());
  const useRules = o.rules ?? true;
  const exact = o.exact ?? true;
  const smithFn = !useSmith ? null : o.smithIndex ?? (o.smithModule ? (await import(o.smithModule)).smithIndexFile : (rel, text, x) => S.smithIndexFile(rel, text, x));
  const versions = new Map();    // rel -> content hash (the index key)
  const smithIdx = new Map();    // stable id -> entry (plain style)
  const exactIdx = new Map();    // stable id -> exact-style sentences
  const smithByFile = new Map(); // rel -> [ids]
  const rulesByFile = new Map(); // rel -> ruleDiagnostics result
  const exportsBy = new Map();   // rel -> exported signatures (indexed files, and stored records read for lookups)
  const refsBy = new Map();      // rel -> references
  const known = new Map();       // rel -> hash: files the background indexer has stored (outside the scope)
  const gateCache = new Map();   // `${rel}:${hash}` -> atomicGate lines
  const stats = { builds: 0, updates: 0, smithCalls: 0, computed: 0, reused: 0, widened: 0 };
  let facts = null;
  let pending = Promise.resolve();

  const rel = (f) => posix(path.isAbsolute(f) ? path.relative(r, f) : f);
  const absOf = (f) => (path.isAbsolute(f) ? path.resolve(f) : path.join(r, f));
  let allFiles = sourceFiles(r, { includeDts: false }).map((a) => posix(path.relative(r, a)));
  if (allFiles.length > MAX_FILES) throw new Error(`the project has more than ${MAX_FILES} source files`);
  const allSet = new Set(allFiles);
  const scope = await resolveScope(r, o.scope, { all: allFiles });
  const scoped = scope.mode !== 'full';
  const opts = { extraRoots: o.extraRoots ?? [], includeDts: true, rootFiles: scoped ? [...scope.files] : null };
  const tsOptions = readOptions(r).options ?? null;
  const pin = { smith: o.smithPin ?? (await smithPin({ smith: useSmith })), rules: o.rulesVersion ?? (await rulesVersion(r, { rules: useRules })) };
  const store = o.store === false ? null : openStore(r, { pin, dir: o.storeDir });
  const countingSmith = smithFn ? async (f, text, x) => { stats.smithCalls++; return smithFn(f, text, x); } : null;

  const drop = (f) => {
    for (const id of smithByFile.get(f) ?? []) { smithIdx.delete(id); exactIdx.delete(id); }
    smithByFile.delete(f); rulesByFile.delete(f); exportsBy.delete(f); refsBy.delete(f);
  };
  /** Index one file across Smith + rules + outline: the stored record when its key matches, else computed and stored. */
  async function indexFile(f, text0) {
    let text = text0;
    if (text === undefined) { try { text = fs.readFileSync(path.join(r, f), 'utf8'); } catch { text = null; } }
    drop(f);
    if (text === null) { versions.delete(f); return { smith: 0, rules: 0, hit: false }; }
    const h = hashOf(text);
    versions.set(f, h);
    let rec = store?.get(f, h) ?? null;
    const hit = !!rec;
    if (!rec) {
      rec = await computeRecord(r, f, text, { smith: isCode(f) ? countingSmith : null, exact, rules: useRules && isCode(f), tsOptions });
      stats.computed++;
      if (store) store.put(f, h, rec);
    } else stats.reused++;
    for (const e of rec.smith ?? []) smithIdx.set(e.id, e);
    for (const [id, sentences] of Object.entries(rec.exact ?? {})) exactIdx.set(id, sentences);
    if (rec.smith) smithByFile.set(f, rec.smith.map((e) => e.id));
    if (rec.rules) rulesByFile.set(f, rec.rules);
    exportsBy.set(f, rec.exports ?? []);
    refsBy.set(f, rec.refs ?? []);
    return { smith: hit ? 0 : (rec.smith?.length ?? 0), rules: !hit && rec.rules ? 1 : 0, hit };
  }
  const later = (fn) => { pending = pending.then(fn).catch(() => { /* one file's failure never stops the index */ }); return pending; };

  // build (once): TS root files = the scope; Smith + rules + outline over the scope's files, reusing the store
  const proj = openProject(r, opts);
  if (proj.ok === false) throw new Error(proj.reason);
  const indexed = { hits: 0, misses: 0 };
  for (const f of [...scope.files].sort()) { const n = await indexFile(f); if (n.hit) indexed.hits++; else indexed.misses++; }
  stats.builds++;
  const buildMs = Date.now() - t0;
  const cold = { ms: buildMs, files: scope.files.size, hits: indexed.hits, misses: indexed.misses, smithCalls: stats.smithCalls, mode: scope.mode, how: scope.how };

  /** Widen the scope by files (TS root files now; Smith + rules + outline queued, never awaited by the caller). */
  function widen(files, why = 'widen') {
    const ok = files.map(rel).filter((f) => allSet.has(f) || fs.existsSync(path.join(r, f)));
    const added = scope.add(ok);
    if (!added.length) return { added: [], why };
    if (scoped) opts.rootFiles = [...scope.files];
    stats.widened += added.length;
    for (const f of added) later(() => indexFile(f));
    return { added, why };
  }
  /** A call on a file outside the scope widens to it first. */
  const ensure = (file) => { const f = rel(file); if (scoped && !scope.files.has(f) && inside(r, absOf(file))) widen([f], 'call outside the scope'); return f; };

  /** Files outside the scope that export `test`-matching names: indexed records, stored ones, then a text search. */
  function exportersOf(test, nameForGrep) {
    const out = new Set();
    for (const [f, h] of known) if (!exportsBy.has(f) && store) { const rec = store.get(f, h); if (rec) exportsBy.set(f, rec.exports ?? []); }
    for (const [f, ex] of exportsBy) if (!scope.files.has(f) && ex.some((e) => test(e.name))) out.add(f);
    if (!out.size && nameForGrep) {
      const re = EXPORT_RE(nameForGrep);
      for (const f of allFiles) {
        if (scope.files.has(f) || exportsBy.has(f) || !isCode(f)) continue;
        let text = '';
        try { text = fs.readFileSync(path.join(r, f), 'utf8'); } catch { continue; }
        if (re.test(text) && exportsOf(f, text).some((e) => test(e.name))) out.add(f);
        if (out.size >= MAX_WIDEN) break;
      }
    }
    return [...out].sort().slice(0, MAX_WIDEN);
  }

  // background indexer (MCP session) and outside-edit watcher
  let bg = null;
  if (o.background && store) {
    const b = typeof o.background === 'object' ? o.background : {};
    bg = startBackgroundIndexer({
      root: r, scope: [...scope.files], pin, storeDir: o.storeDir, smith: useSmith, smithModule: o.smithModule ?? null, exact, rules: useRules, ...b,
      onIndexed: (files) => { for (const x of files) if (!scope.files.has(x.rel)) known.set(x.rel, x.hash); },
    });
  }
  let watcher = null;

  const api = {
    root: r, buildMs, stats, cold, pin,
    get scope() { return { mode: scope.mode, how: scope.how, focus: scope.focus, files: scope.files.size }; },
    get size() { return { files: versions.size, functions: smithIdx.size, ruleFiles: rulesByFile.size }; },
    get store() { return store ? { dir: store.dir, pinKey: store.pinKey, ...store.stats } : null; },
    get background() { return bg ? bg.status : null; },
    /** Whether a file is in the scope. */
    inScope: (file) => scope.files.has(rel(file)),
    widen: (files) => widen(files),
    /** Settles once every queued (widening) index job has run. */
    idle: () => pending,

    /**
     * A Trace step Line took: add_to_scope `<feature>/<kind>/<name>` widens to that feature's index and the file that
     * declares it; create_module `module:<feature>/<kind>` widens to that folder (its files now and later).
     */
    applied({ step, target } = /** @type {any} */ ({})) {
      if (step === 'add_to_scope') {
        const [feature, kind, name] = String(target).split('/');
        const files = allFiles.filter((f) => f === `features/${feature}/index.ts` || f === `features/${feature}/index.tsx` || (f.startsWith(`features/${feature}/${kind}/`) && path.posix.basename(f).replace(/\.[^.]+$/, '').split('.')[0] === name));
        return widen(files, 'add_to_scope');
      }
      if (step === 'create_module') {
        const m = /^module:([^/]+)\/([^/]+)$/.exec(String(target));
        if (!m) return { added: [], why: 'create_module' };
        const added = scope.addPrefix(`features/${m[1]}/${m[2]}/`, allFiles);
        if (scoped) opts.rootFiles = [...scope.files];
        for (const f of added) later(() => indexFile(f));
        stats.widened += added.length;
        return { added, why: 'create_module' };
      }
      return { added: [], why: String(step) };
    },

    /** Re-index only files whose content hash changed (new, edited, deleted), across all three layers. */
    async update(changed) {
      const t1 = Date.now();
      await pending;
      const touched = [];
      const layers = { ts: 0, smith: 0, rules: 0 };
      const absChanged = changed.map(absOf).filter((a) => inside(r, a) && !inside(path.join(r, 'line', '.index'), a));
      const p = openProject(r, opts);
      layers.ts = p.ok === false ? 0 : updateFiles(p.entry, absChanged).length;
      if (scoped && p.ok !== false) p.entry.files = [...opts.rootFiles.map((f) => path.join(r, f))]; // an outside file stays out of the roots
      const widened = [];
      for (const abs of absChanged) {
        const f = rel(abs);
        let text = null;
        try { text = fs.readFileSync(abs, 'utf8'); } catch { text = null; }
        if (text !== null && !allSet.has(f)) { allSet.add(f); allFiles = [...allFiles, f]; }
        if (text === null && allSet.has(f)) { allSet.delete(f); allFiles = allFiles.filter((x) => x !== f); }
        if (text !== null && versions.get(f) === hashOf(text)) continue; // unchanged: nothing to do
        if (!scope.contains(f)) { known.delete(f); continue; } // outside the scope: TS re-versioned; the store fills it later
        if (text !== null && !scope.files.has(f)) { scope.add([f]); if (scoped) opts.rootFiles = [...scope.files]; }
        if (text === null) { scope.files.delete(f); if (scoped) opts.rootFiles = [...scope.files]; }
        const n = await indexFile(f, text);
        layers.smith += n.smith; layers.rules += n.rules;
        touched.push(f);
        // add_to_scope, seen in the code: a landed edit that now imports a file outside the scope widens to it
        if (scoped) for (const d of directImportsOf(refsBy.get(f))) if (!scope.files.has(d)) widened.push(d);
      }
      const w = widened.length ? widen([...new Set(widened)], 'import outside the scope') : { added: [] };
      if (touched.length) { facts = null; gateCache.clear(); }
      stats.updates++;
      return { touched, layers, widened: w.added, ms: Date.now() - t1 };
    },

    /** One stable id across all three layers. */
    symbol(id) {
      const e = smithIdx.get(id) ?? [...smithIdx.values()].find((x) => x.name === id);
      const name = e?.name ?? String(id).split(/[/#]/).pop();
      const file = e?.file ?? null;
      const tsInfo = file ? T.quickInfo(r, file, name, opts) : null;
      return { id: e?.id ?? id, file, name, ts: tsInfo?.ok ? tsInfo.type : null, smith: e?.sentences ?? null, exact: e ? exactIdx.get(e.id) ?? null : null, rules: file ? (rulesByFile.get(file)?.lines ?? []) : [] };
    },

    // layer 3: TypeScript (a call outside the scope widens to that file; a cross-scope miss widens to its exporter)
    fixes: (file, x = {}) => T.fixes(r, ensure(file), { ...opts, ...x }),
    completionsAt(file, at, x = {}) {
      const f = ensure(file);
      const res = T.completionsAt(r, f, at, { ...opts, ...x });
      if (!scoped || !res?.ok || res.items.length || !res.typed) return res;
      const typed = res.typed;
      const w = widen(exportersOf((n) => n.startsWith(typed), `${escapeRe(typed)}\\w*`), 'completion outside the scope');
      if (!w.added.length) return res;
      const again = T.completionsAt(r, f, at, { ...opts, ...x });
      return again?.ok ? { ...again, widened: w.added } : res;
    },
    quickInfo: (file, sym) => T.quickInfo(r, ensure(file), sym, opts),
    signatureAt: (file, at, x = {}) => T.signatureAt(r, ensure(file), at, { ...opts, ...x }),
    definition(file, sym) {
      const f = ensure(file);
      const res = T.definition(r, f, sym, opts);
      if (!scoped || (res?.ok && res.locations.length)) return res;
      const last = String(sym).split('.').pop() ?? '';
      const w = widen(exportersOf((n) => n === last, escapeRe(last)), 'definition outside the scope');
      if (!w.added.length) return res;
      const again = T.definition(r, f, sym, opts);
      return again?.ok ? { ...again, widened: w.added } : res;
    },
    references: (file, sym) => T.references(r, ensure(file), sym, opts),
    tsDiagnostics: (file, x = {}) => T.diagnostics(r, ensure(file), { ...opts, ...x }),

    // layer 1: Smith
    smithCompletions: (context) => S.smithCompletions(context),
    smithDiagnostics: (proposal, x = {}) => S.smithDiagnostics(proposal, smithIdx, x),
    smithDefinition: (sentence) => S.smithDefinition(sentence, smithIdx),
    smithReferences: (id) => S.smithReferences(id, smithIdx),

    // layer 2: rules
    ruleDiagnostics: (file) => rulesByFile.get(rel(file)) ?? R.ruleDiagnostics(r, file),
    ruleFixes: (file) => R.ruleFixes(r, file),
    nextSteps(node) { facts ??= R.lineFacts(r); return R.nextSteps(r, node, { facts }); },

    /** TS + rules + atomicGate, one line each, capped. atomicGate's lines are reused while the file's content holds. */
    async diagnostics(file, x = {}) {
      const f = ensure(file);
      const tsD = T.diagnostics(r, f, { ...opts, ...x });
      const ruleD = x.text == null ? (api.ruleDiagnostics(f).lines ?? []) : [];
      let gateD = [];
      if (useSmith && isCode(f)) {
        const source = x.text ?? fs.readFileSync(path.join(r, f), 'utf8');
        const key = `${f}:${hashOf(source)}`;
        gateD = gateCache.get(key) ?? await gateDiagnostics({ rel: f, source });
        gateCache.set(key, gateD);
      }
      const { kept, dropped } = T.capList([...(tsD.lines ?? []), ...ruleD, ...gateD], (s) => s);
      return { ok: true, file: f, lines: kept, ...(dropped ? { more: dropped } : {}) };
    },

    /** Stop the background indexer and the watcher. */
    close() { bg?.stop(); watcher?.close(); watcher = null; },
  };
  if (o.watch) {
    const w = watchProject(r, (files) => api.update(files), { debounceMs: o.debounceMs });
    watcher = w.ok ? w : null;
  }
  return api;
}
