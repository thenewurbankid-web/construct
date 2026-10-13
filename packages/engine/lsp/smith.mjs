// #943 -- the Line LSP's Smith English layer: every in-scope function indexed to its Smith sentences (atomic-codemod's
// to-english through packages/summarize/links.mjs summarizeCode), linked by stable id to the TS and rules layers.
// Deterministic; the only model use is an optional `embed` fallback the caller passes in (never called here on its own).
//
//   smithIndexFile(root, rel, source)     -> [{ id, file, name, sentences, empty }]   one file's functions
//   smithCompletions(context)             -> { items, schema }   sentence templates + Line atoms that fit the node
//   smithDiagnostics(proposal, index, o)  -> { missing, extra }  proposal sentences with no code, code with no proposal;
//                                         a JSX-returning function (page, component) is matched per element instead
//   smithElements(code)                   -> [{ tag, sentence }]  one sentence per JSX element, from to-english's chips
//   smithDefinition(sentence, index)      -> { ids }             the function(s) a sentence describes
//   smithReferences(id, index)            -> { sentences }       a function's sentences
//
// Stable id: `<feature>/<kind>/<name>` for a file under features/<feature>/<kind>/, else `<rel>#<name>`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeCode, smithLinks, toEnglishRaw } from '../../summarize/links.mjs';
import { toJs, functionsOf, smithInput, smithEmptyReason } from './smithText.mjs';
import { capList } from './index.mjs';
import { ts } from './host.mjs';

const ATOMS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'line-atoms', 'atoms');

/** The stable id of function `name` in root-relative file `rel`. */
export function stableIdOf(rel, name) {
  const m = /^features\/([^/]+)\/([^/]+)\//.exec(rel);
  return m ? `${m[1]}/${m[2]}/${name}` : `${rel}#${name}`;
}

export const smithReady = () => !!smithLinks().codemod.ok;
/** The atomic-codemod commit to-english is linked from (null when not linked). */
export const smithHead = () => smithLinks().codemod.head ?? null;
/**
 * LSP_SMITH_RAW=1 (or CHAIN_SMITH_RAW=1, exp/english-loop-chain's name): the hardened to-english (atomic-codemod
 * smith-hardening) parses TS/TSX itself, so a function goes in as written -- no type stripping, no JSX rewrite.
 */
export const RAW = process.env.LSP_SMITH_RAW === '1' || process.env.CHAIN_SMITH_RAW === '1';
export const normSentence = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');

/**
 * Smith's sentences for one function's code (TS or JS, JSX allowed). The "<name> works in N steps" title is kept as
 * sentence 0 in `all`; `steps` is the rest. `empty` is smith-system1's placeholder rule (blank | placeholder | null).
 */
export async function smithOfFunction(code, { kind = 'function', fileName = 'x.tsx', canonical = false, raw = RAW } = {}) {
  let input = code; let k = kind;
  if (!raw) { const js = toJs(code, fileName); const fn = functionsOf(js)[0] ?? { kind, code: js }; input = smithInput(fn); k = fn.kind; }
  const s = await summarizeCode(input, { kind: k, ...(canonical ? { toEnglishOptions: { canonical: true } } : {}) });
  const all = s.sentences ?? [];
  const failed = s.via === 'static' && !/works in \d+ steps?/.test(all[0] ?? '');
  const text = all.join(' ');
  return { all, steps: all.slice(1), empty: failed ? 'failed' : smithEmptyReason(text) };
}

/** Raw mode: each top-level function declaration (or arrow const) as written TS/TSX, `export` kept. */
function rawFunctionsOf(rel, source) {
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, /\.tsx$/.test(rel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.body && st.name) out.push({ name: st.name.text, kind: 'function', code: st.getText(sf) });
    else if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) out.push({ name: d.name.text, kind: 'function', code: st.getText(sf) });
  }
  return out;
}

/** Index one file: each top-level function (declarations, arrow consts, class methods) to its Smith sentences; a
 * function that returns JSX also gets `elements` (smithElements: one sentence per element). */
export async function smithIndexFile(rel, source, { canonical = false } = {}) {
  const out = [];
  let fns = [];
  try { fns = RAW ? rawFunctionsOf(rel, source) : functionsOf(toJs(source, rel)); } catch { fns = []; }
  let written = [];
  try { written = rawFunctionsOf(rel, source); } catch { written = []; }
  for (const fn of fns) {
    const s = await summarizeCode(RAW ? fn.code : smithInput(fn), { kind: fn.kind, ...(canonical ? { toEnglishOptions: { canonical: true } } : {}) });
    const all = s.sentences ?? [];
    const failed = s.via === 'static' && !/works in \d+ steps?/.test(all[0] ?? '');
    const asWritten = written.find((w) => w.name === fn.name)?.code ?? null;
    const elements = asWritten && returnsJsx(asWritten) ? await smithElements(asWritten) : null;
    out.push({ id: stableIdOf(rel, fn.name), file: rel, name: fn.name, sentences: all.slice(1), title: all[0] ?? '', empty: failed ? 'failed' : smithEmptyReason(all.join(' ')), ...(elements ? { elements } : {}) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- per JSX element
const tsx = (code) => ts.createSourceFile('x.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
/** Whether a function's code (TS/TSX as written) returns JSX: a page or a component, matched per element. */
export function returnsJsx(code) {
  let hit = false;
  const visit = (n) => { if (hit) return; if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) { hit = true; return; } ts.forEachChild(n, visit); };
  visit(tsx(code));
  return hit;
}
const LEAD = new Set(['return', 'shows a', 'a', 'and', 'shows a group', 'a group', 'it returns']);
const TRAIL = new Set(['containing', 'and', 'with', 'as']);
/**
 * One sentence per JSX element of a function (as written), from to-english's step chips: each chip belongs to the
 * innermost element whose source range holds it (a chip without a range, a connective, to the next chip that has
 * one), so an element's sentence is its own tag, attributes and direct content, never its children's. e.g.
 * `<h2>{book.title}</h2>` -> "<h2> containing book title". Null when atomic-codemod cannot read the code.
 * @param {string} code
 * @returns {Promise<{tag: string, sentence: string}[] | null>}
 */
export async function smithElements(code) {
  const r = await toEnglishRaw(code, { kind: 'function' });
  if (!r.ok || !Array.isArray(r.result?.steps)) return null;
  const sf = tsx(code);
  const els = [];
  const visit = (n) => {
    if (ts.isJsxElement(n)) els.push({ tag: `<${n.openingElement.tagName.getText(sf)}>`, start: n.getStart(sf), end: n.getEnd() });
    else if (ts.isJsxSelfClosingElement(n)) els.push({ tag: `<${n.tagName.getText(sf)}>`, start: n.getStart(sf), end: n.getEnd() });
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!els.length) return [];
  const ownerOf = (pos) => { let best = -1; els.forEach((e, i) => { if (pos >= e.start && pos < e.end && (best < 0 || e.start >= els[best].start)) best = i; }); return best; };
  const chips = r.result.steps.flatMap((st) => st.tokens ?? []);
  const owners = chips.map((c) => (typeof c.start === 'number' ? ownerOf(c.start) : null));
  for (let i = owners.length - 1, next = -1; i >= 0; i--) { if (owners[i] === null) owners[i] = next; else next = owners[i]; }
  const own = els.map(() => []);
  chips.forEach((c, i) => { if (owners[i] >= 0) own[owners[i]].push(String(c.text)); });
  return els.map((e, i) => {
    const at = own[i].indexOf(e.tag);
    const t = at >= 0 ? own[i].slice(at) : [...own[i]]; // the connectives before an element's tag are its parent's
    while (t.length && LEAD.has(t[0].toLowerCase())) t.shift();
    while (t.length && TRAIL.has(t[t.length - 1].toLowerCase())) t.pop();
    return { tag: e.tag, sentence: t.join(' ') };
  });
}
const tagOf = (sentence) => (/<[\w.:-]+>/.exec(String(sentence)) ?? [null])[0];

// ---------------------------------------------------------------------------------------------- completions
/** Smith's to-english templates (what a step sentence can look like); X/NAME/... are filled from the node's scope. */
export const TEMPLATES = Object.freeze([
  'return X', 'let NAME be X', 'if CONDITION: STEP', 'if CONDITION: STEP, otherwise STEP', "OBJECT's FIELD",
  'SUBJECT VERB ARG and ARG', 'FUNCTION of ARG', 'not (X)', 'A OP B', "'TEXT'",
]);
let atomsCache;
/** Line atoms (packages/line-atoms/atoms/<id>/atom.json): id, kind, english. */
export function lineAtoms() {
  if (atomsCache) return atomsCache;
  const out = [];
  for (const d of fs.readdirSync(ATOMS_DIR).sort()) {
    try { const a = JSON.parse(fs.readFileSync(path.join(ATOMS_DIR, d, 'atom.json'), 'utf8')); out.push({ id: a.id, kind: a.kind, english: a.english, name: a.name }); } catch { /* not an atom */ }
  }
  return (atomsCache = out);
}
const words = (s) => new Set(String(s).toLowerCase().match(/[a-z]{3,}/g) ?? []);
const overlap = (a, b) => { const A = words(a); const B = words(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.max(1, Math.min(A.size, B.size)); };

/**
 * Sentence templates and atoms that fit a Trace node. `context`: { kind ('function' | 'component' | ...), names (the
 * identifiers in scope: params, fields), intent (the spec line or need) }. Templates are instantiated with the scope's
 * names ("return book's pages"); atoms are ranked by word overlap with the intent; logic atoms only for logic nodes.
 */
export function smithCompletions(context = {}) {
  const t0 = Date.now();
  const names = (context.names ?? []).slice(0, 8);
  const items = [];
  const [obj, ...fields] = names;
  for (const n of names) items.push({ kind: 'template', text: `return ${n}` });
  if (obj) for (const f of fields) items.push({ kind: 'template', text: `return ${obj}'s ${f}` });
  if (obj && fields[0]) items.push({ kind: 'template', text: `if ${obj}'s ${fields[0]}: return X, otherwise return Y` });
  for (const t of TEMPLATES) items.push({ kind: 'template', text: t });
  const logic = !context.kind || context.kind === 'function';
  const atoms = lineAtoms().filter((a) => (logic ? a.kind === 'function' : true))
    .map((a) => ({ kind: 'atom', id: a.id, text: a.english, score: context.intent ? overlap(context.intent, a.english) : 0 }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  items.push(...atoms.map(({ score, ...a }) => a));
  const { kept } = capList(items.slice(0, 30));
  return { ok: true, items: kept, schema: { type: 'object', properties: { sentence: { type: 'string', enum: kept.map((i) => i.text) } }, required: ['sentence'] }, ms: Date.now() - t0 };
}

// ---------------------------------------------------------------------------------------------- diagnostics
/**
 * Proposal (`{ fnOrId: sentences[] }`) against the indexed code (`index`: Map id -> entry, or an array of entries).
 * Exact normalized match first; when `embed(texts) -> vectors` is passed, an unmatched pair whose cosine is at least
 * `threshold` counts as a fuzzy match (reported as such). -> missing (proposal, no code), extra (code, no proposal).
 */
export async function smithDiagnostics(proposal, index, { embed = null, threshold = 0.9 } = {}) {
  const t0 = Date.now();
  const entries = index instanceof Map ? [...index.values()] : index;
  const byKey = (k) => entries.find((e) => e.id === k || e.name === k);
  const missing = []; const extra = []; const fuzzy = []; let exact = 0;
  const pending = [];
  const modes = {};
  for (const [k, want] of Object.entries(proposal)) {
    const e = byKey(k);
    if (Array.isArray(e?.elements) && e.elements.length) {
      // a page or component: every element the plan names must have its sentence; extra elements are allowed
      modes[e.id] = 'elements';
      const have = e.elements.map((x) => normSentence(x.sentence));
      for (const w of want) { if (have.includes(normSentence(w))) exact++; else missing.push({ id: e.id, element: tagOf(w), sentence: normSentence(w) }); }
      continue;
    }
    modes[e?.id ?? k] = 'exact';
    const got = (e?.sentences ?? []).map(normSentence);
    const pool = [...got];
    const left = [];
    for (const w of want.map(normSentence)) { const i = pool.indexOf(w); if (i >= 0) { pool.splice(i, 1); exact++; } else left.push(w); }
    pending.push({ k, id: e?.id ?? k, left, pool });
  }
  if (embed) {
    for (const p of pending) {
      if (!p.left.length || !p.pool.length) continue;
      const vs = await embed([...p.left, ...p.pool]);
      const L = vs.slice(0, p.left.length); const P = vs.slice(p.left.length);
      const keepL = []; const used = new Set();
      p.left.forEach((w, i) => {
        let best = -1; let bj = -1;
        P.forEach((v, j) => { if (used.has(j)) return; const c = cosine(L[i], v); if (c > best) { best = c; bj = j; } });
        if (best >= threshold) { used.add(bj); fuzzy.push({ id: p.id, proposal: w, code: p.pool[bj], cosine: Number(best.toFixed(3)) }); } else keepL.push(w);
      });
      p.left = keepL; p.pool = p.pool.filter((_, j) => !used.has(j));
    }
  }
  for (const p of pending) {
    for (const w of p.left) missing.push({ id: p.id, sentence: w });
    for (const g of p.pool) extra.push({ id: p.id, sentence: g });
  }
  const m = capList(missing); const x = capList(extra);
  return { ok: true, exact, fuzzy, missing: m.kept, extra: x.kept, modes, ...(m.dropped + x.dropped ? { more: m.dropped + x.dropped } : {}), ms: Date.now() - t0 };
}
export const cosine = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / Math.sqrt(x * y || 1); };

/** The function(s) a sentence describes: exact sentence match by stable id, else the best word overlap (>= 0.6). */
export function smithDefinition(sentence, index) {
  const entries = index instanceof Map ? [...index.values()] : index;
  const n = normSentence(sentence);
  const exact = entries.filter((e) => e.sentences.some((s) => normSentence(s) === n)).map((e) => ({ id: e.id, file: e.file, match: 'exact' }));
  if (exact.length) return { ok: true, ids: exact.slice(0, 10) };
  const scored = entries.map((e) => ({ id: e.id, file: e.file, score: Math.max(0, ...e.sentences.map((s) => overlap(s, sentence)), overlap(e.title ?? '', sentence)) }))
    .filter((x) => x.score >= 0.6).sort((a, b) => b.score - a.score).slice(0, 5).map((x) => ({ id: x.id, file: x.file, match: `overlap ${x.score.toFixed(2)}` }));
  return { ok: true, ids: scored };
}

/** A function's sentences, by stable id (or bare name). */
export function smithReferences(id, index) {
  const entries = index instanceof Map ? [...index.values()] : index;
  const e = entries.find((x) => x.id === id) ?? entries.find((x) => x.name === id);
  if (!e) return { ok: false, reason: `no function ${id} in the index` };
  const { kept, dropped } = capList(e.sentences, (s) => s);
  return { ok: true, id: e.id, file: e.file, title: e.title, sentences: kept, empty: e.empty, ...(dropped ? { more: dropped } : {}) };
}
