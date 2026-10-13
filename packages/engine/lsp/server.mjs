// #943 -- the Line LSP as one server: three layers linked by stable id, over one per-project index keyed by file
// version (content hash), so the vocabulary grows as generated code lands and update() re-indexes only what changed.
//
//   layer 1  Smith English   function -> Smith sentences (smith.mjs)
//   layer 2  Line rules      file -> rule violations (rules.mjs), path node -> allowed Trace steps
//   layer 3  TypeScript      the shared language service (host.mjs + index.mjs), re-versioned per changed file
//
//   const lsp = await createLineLsp(root, { extraRoots, smith: true })
//   await lsp.update(['features/book/domains/formatPages.ts'])   -> { touched, layers: {ts, smith, rules}, ms }
//   lsp.symbol('book/domains/formatPages')                        -> { id, file, name, ts, smith, rules }  one id, all layers
//   await lsp.diagnostics(file)                                   -> TS + rules + atomicGate lines, one each
//   plus every layer's calls: fixes, completionsAt, quickInfo, signatureAt, definition, references, smithCompletions,
//   smithDiagnostics, smithDefinition, smithReferences, ruleDiagnostics, ruleFixes, nextSteps
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as T from './index.mjs';
import { openProject, updateFiles, sourceFiles, inside } from './host.mjs';
import * as S from './smith.mjs';
import * as R from './rules.mjs';
import { gateDiagnostics } from './gate.mjs';

const hash = (t) => crypto.createHash('sha1').update(t).digest('hex').slice(0, 16);
const posix = (p) => p.split(path.sep).join('/');

/**
 * The Line LSP over one project: its index across the TS, Smith and rules layers, kept current by update().
 * @param {string} root Project root (tsconfig.json at it).
 * @param {{extraRoots?: string[], smith?: boolean, rules?: boolean}} [o] `smith: false` skips layer 1 (no atomic-codemod).
 * @returns {Promise<any>} The server: its index and calls (update, ...).
 */
export async function createLineLsp(root, o = {}) {
  const r = path.resolve(root);
  const opts = { extraRoots: o.extraRoots ?? [], includeDts: true };
  const useSmith = o.smith ?? S.smithReady();
  const useRules = o.rules ?? true;
  const versions = new Map();   // rel -> content hash (the index key)
  const smithIdx = new Map();   // stable id -> entry
  const smithByFile = new Map(); // rel -> [ids]
  const rulesByFile = new Map(); // rel -> ruleDiagnostics result
  const stats = { builds: 0, updates: 0 };
  let facts = null;

  const rel = (f) => posix(path.isAbsolute(f) ? path.relative(r, f) : f);
  const isCode = (f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f) && !/\.d\.ts$/.test(f);

  async function indexFile(f) {
    const abs = path.join(r, f);
    let text = null;
    try { text = fs.readFileSync(abs, 'utf8'); } catch { text = null; }
    for (const id of smithByFile.get(f) ?? []) smithIdx.delete(id);
    smithByFile.delete(f); rulesByFile.delete(f);
    if (text === null) { versions.delete(f); return { smith: 0, rules: 0 }; }
    versions.set(f, hash(text));
    let n = 0;
    if (useSmith && isCode(f)) {
      const entries = await S.smithIndexFile(f, text);
      for (const e of entries) smithIdx.set(e.id, e);
      smithByFile.set(f, entries.map((e) => e.id)); n = entries.length;
    }
    if (useRules && isCode(f)) rulesByFile.set(f, R.ruleDiagnostics(r, f));
    return { smith: n, rules: useRules ? 1 : 0 };
  }

  // full build (once)
  const t0 = Date.now();
  const proj = openProject(r, opts);
  if (proj.ok === false) throw new Error(proj.reason);
  for (const abs of sourceFiles(r, { includeDts: false })) await indexFile(rel(abs));
  stats.builds++;
  const buildMs = Date.now() - t0;

  const api = {
    root: r, buildMs, stats,
    get size() { return { files: versions.size, functions: smithIdx.size, ruleFiles: rulesByFile.size }; },

    /** Re-index only files whose content hash changed (new, edited, deleted), across all three layers. */
    async update(changed) {
      const t1 = Date.now();
      const touched = [];
      const layers = { ts: 0, smith: 0, rules: 0 };
      const absChanged = changed.map((f) => (path.isAbsolute(f) ? path.resolve(f) : path.join(r, f))).filter((a) => inside(r, a));
      const p = openProject(r, opts);
      layers.ts = p.ok === false ? 0 : updateFiles(p.entry, absChanged).length;
      for (const abs of absChanged) {
        const f = rel(abs);
        let text = null;
        try { text = fs.readFileSync(abs, 'utf8'); } catch { text = null; }
        if (text !== null && versions.get(f) === hash(text)) continue; // unchanged: nothing to do
        const n = await indexFile(f);
        layers.smith += n.smith; layers.rules += n.rules;
        touched.push(f);
      }
      if (touched.length) facts = null;
      stats.updates++;
      return { touched, layers, ms: Date.now() - t1 };
    },

    /** One stable id across all three layers. */
    symbol(id) {
      const e = smithIdx.get(id) ?? [...smithIdx.values()].find((x) => x.name === id);
      const name = e?.name ?? String(id).split(/[/#]/).pop();
      const file = e?.file ?? null;
      const tsInfo = file ? T.quickInfo(r, file, name, opts) : null;
      return { id: e?.id ?? id, file, name, ts: tsInfo?.ok ? tsInfo.type : null, smith: e?.sentences ?? null, rules: file ? (rulesByFile.get(file)?.lines ?? []) : [] };
    },

    // layer 3: TypeScript
    fixes: (file, x = {}) => T.fixes(r, file, { ...opts, ...x }),
    completionsAt: (file, at, x = {}) => T.completionsAt(r, file, at, { ...opts, ...x }),
    quickInfo: (file, sym) => T.quickInfo(r, file, sym, opts),
    signatureAt: (file, at, x = {}) => T.signatureAt(r, file, at, { ...opts, ...x }),
    definition: (file, sym) => T.definition(r, file, sym, opts),
    references: (file, sym) => T.references(r, file, sym, opts),
    tsDiagnostics: (file, x = {}) => T.diagnostics(r, file, { ...opts, ...x }),

    // layer 1: Smith
    smithCompletions: (context) => S.smithCompletions(context),
    smithDiagnostics: (proposal, x = {}) => S.smithDiagnostics(proposal, smithIdx, x),
    smithDefinition: (sentence) => S.smithDefinition(sentence, smithIdx),
    smithReferences: (id) => S.smithReferences(id, smithIdx),

    // layer 2: rules
    ruleDiagnostics: (file) => rulesByFile.get(rel(file)) ?? R.ruleDiagnostics(r, file),
    ruleFixes: (file) => R.ruleFixes(r, file),
    nextSteps(node) { facts ??= R.lineFacts(r); return R.nextSteps(r, node, { facts }); },

    /** TS + rules + atomicGate, one line each, capped. */
    async diagnostics(file, x = {}) {
      const f = rel(file);
      const tsD = T.diagnostics(r, f, { ...opts, ...x });
      const ruleD = x.text == null ? (api.ruleDiagnostics(f).lines ?? []) : [];
      let gateD = [];
      if (useSmith && isCode(f)) gateD = await gateDiagnostics({ rel: f, source: x.text ?? fs.readFileSync(path.join(r, f), 'utf8') });
      const { kept, dropped } = T.capList([...(tsD.lines ?? []), ...ruleD, ...gateD], (s) => s);
      return { ok: true, file: f, lines: kept, ...(dropped ? { more: dropped } : {}) };
    },
  };
  return api;
}
