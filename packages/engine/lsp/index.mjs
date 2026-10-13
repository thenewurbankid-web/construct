// #943 -- the Line LSP's TypeScript layer: five pure, read-only calls over the shared host (lsp/host.mjs), each
// returning compact JSON for a small model (every output capped at MAX_LINES lines and about MAX_TOKENS tokens).
//
//   fixes(root, file, {text})                  -> { edits, unfixed }      import + safe single-candidate code fixes, not applied
//   completionsAt(root, file, at, {text})      -> { items, schema }       names valid at a hole, + an Ollama `format` enum
//   quickInfo(root, file, symbol)              -> { symbol, type }        the exact type as a short string
//   signatureAt(root, file, at, {text})        -> { signature }           the call signature at a position / marker / symbol
//   definition(root, file, symbol)             -> { locations }           file:line + one-line excerpt each
//   references(root, file, symbol)             -> { locations }
//   diagnostics(root, file, {text})            -> { lines }               syntactic + semantic, one line each
//
// `file` is absolute or root-relative; `text` (optional) is an unsaved buffer for that file (an overlay, never written).
// `at` is a character offset, a marker string present in the text (removed before analysis, e.g. '/*HOLE*/'), or
// { symbol } (the first occurrence of that identifier). Project options: { extraRoots } (read-only folders, e.g. the
// node_modules that holds React's types), { includeDts } (ambient .d.ts files under the root).
import fs from 'node:fs';
import path from 'node:path';
import { ts, openProject, withOverlay, inside } from './host.mjs';

export const MAX_LINES = 40;
export const MAX_TOKENS = 1500;
export const approxTokens = (s) => Math.ceil(s.length / 3.2);
const MAX_ITEMS = 30;
const FORMAT = { indentSize: 2, tabSize: 2, convertTabsToSpaces: true, newLineCharacter: '\n', semicolons: ts.SemicolonPreference.Insert };
const PREFS = { quotePreference: 'single', importModuleSpecifierEnding: 'minimal', includeCompletionsForModuleExports: true, includeCompletionsWithInsertText: true, allowIncompleteCompletions: false };

/** Keep at most MAX_LINES entries and about MAX_TOKENS tokens of JSON; the rest is counted, not sent. */
export function capList(list, render = (x) => JSON.stringify(x)) {
  const out = []; let tok = 0;
  for (const x of list) {
    const t = approxTokens(render(x));
    if (out.length >= MAX_LINES || tok + t > MAX_TOKENS) break;
    out.push(x); tok += t;
  }
  return { kept: out, dropped: list.length - out.length };
}

const projOpts = (o = {}) => ({ includeDts: o.includeDts ?? true, extraRoots: o.extraRoots ?? [] });
function ctx(root, file, o = {}) {
  const r = path.resolve(root);
  const abs = path.isAbsolute(file) ? path.resolve(file) : path.resolve(r, file);
  if (!inside(r, abs)) throw new Error('the file is outside the project');
  const proj = openProject(r, projOpts(o));
  if (!proj.ok) throw new Error(proj.reason);
  const rel = (f) => path.relative(r, path.resolve(f)).split(path.sep).join('/');
  return { r, abs, proj, entry: proj.entry, svc: proj.service, rel };
}
const read = (c, text) => text ?? fs.readFileSync(c.abs, 'utf8');
const guard = (fn) => { try { return fn(); } catch (e) { return { ok: false, reason: String(e?.message || e).slice(0, 200) }; } };
const flat = (m) => ts.flattenDiagnosticMessageText(m, ' ').replace(/\s+/g, ' ');
const lineCol = (text, pos) => { const pre = text.slice(0, pos).split('\n'); return { line: pre.length, col: pre[pre.length - 1].length + 1 }; };
const lineAt = (text, line) => (text.split('\n')[line - 1] ?? '').trim().slice(0, 120);

/** The offset of `at` in `text`; a marker is removed from the text first. -> { text, pos } */
function resolveAt(text, at) {
  if (typeof at === 'number') return { text, pos: at };
  if (typeof at === 'string') {
    const i = text.indexOf(at);
    if (i < 0) throw new Error(`marker ${at} is not in the file`);
    return { text: text.slice(0, i) + text.slice(i + at.length), pos: i };
  }
  if (at && at.symbol) { const pos = findIdentifier(text, at.symbol); if (pos < 0) throw new Error(`no identifier ${at.symbol} in the file`); return { text, pos }; }
  throw new Error('at must be an offset, a marker or { symbol }');
}

/** The offset of identifier `name` in `text`: its declaration when the file declares it, else its first use. */
export function findIdentifier(text, name, fileName = 'x.tsx') {
  const last = String(name).split('.').pop();
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let decl = -1; let use = -1;
  const visit = (n) => {
    if (decl >= 0) return;
    if (ts.isIdentifier(n) && n.text === last) {
      if (n.parent && 'name' in n.parent && n.parent.name === n) decl = n.getStart(sf); else if (use < 0) use = n.getStart(sf);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return decl >= 0 ? decl : use;
}

/** Where `symbol` is: in `file` when it occurs there, else the project's navigate-to index. -> { abs, pos } | null */
function locate(c, symbol) {
  const text = fs.readFileSync(c.abs, 'utf8');
  const pos = findIdentifier(text, symbol, c.abs);
  if (pos >= 0) return { abs: c.abs, pos };
  const last = String(symbol).split('.').pop();
  const hit = c.svc.getNavigateToItems(last, 20).find((x) => x.name === last && inside(c.r, path.resolve(x.fileName)));
  return hit ? { abs: path.resolve(hit.fileName), pos: hit.textSpan.start } : null;
}

function diagLines(c, abs, text) {
  const d = [...c.svc.getSyntacticDiagnostics(abs), ...c.svc.getSemanticDiagnostics(abs)];
  return d.map((x) => {
    const { line, col } = lineCol(text, x.start ?? 0);
    return { line, col, code: x.code, start: x.start ?? 0, length: x.length ?? 0, text: `${c.rel(abs)}:${line}:${col} TS${x.code} ${flat(x.messageText).slice(0, 160)}` };
  });
}

// ------------------------------------------------------------------------------------------------ 5. diagnostics
export function diagnostics(root, file, o = {}) {
  return guard(() => {
    const c = ctx(root, file, o);
    const text = read(c, o.text);
    const t0 = Date.now();
    const lines = withOverlay(c.entry, c.abs, o.text, () => diagLines(c, c.abs, text));
    const { kept, dropped } = capList(lines.map((l) => l.text), (s) => s);
    return { ok: true, file: c.rel(c.abs), count: lines.length, lines: kept, ...(dropped ? { more: dropped } : {}), ms: Date.now() - t0 };
  });
}

// ------------------------------------------------------------------------------------------------ 1. fixes
const SINGLE_FIX = new Set(['spelling', 'addMissingMember', 'fixMissingMember', 'fixMissingProperties', 'fixAddMissingMember']);
const SINGLE_CODES = [2551, 2552, 2724, 2561, 2339, 2741, 2739];
const DID_YOU_MEAN = [2551, 2552, 2724, 2561];

/** Map an offset in text1 (original + edits1 applied) back to the original; null when it falls in an inserted span. */
function backMap(edits1, p) {
  let delta = 0;
  for (const e of [...edits1].sort((a, b) => a.start - b.start)) {
    const ns = e.start + delta; const ne = ns + e.newText.length;
    if (p < ns) return p - delta;
    if (p <= ne && !(p === ns && e.newText.length === 0)) return p <= ns ? p - delta : null;
    delta += e.newText.length - (e.end - e.start);
  }
  return p - delta;
}
const applyText = (text, edits) => [...edits].sort((a, b) => b.start - a.start).reduce((t, e) => t.slice(0, e.start) + e.newText + t.slice(e.end), text);

/**
 * Import fixes (getCombinedCodeFix 'fixMissingImport') plus safe single-candidate fixes (spelling, add missing member)
 * at each remaining error. Returns edits against the ORIGINAL text, not applied; `other` holds edits in other files.
 */
export function fixes(root, file, o = {}) {
  return guard(() => {
    const c = ctx(root, file, o);
    const t0 = Date.now();
    const text0 = read(c, o.text);
    const toEdits = (changes) => changes.flatMap((ch) => ch.textChanges.map((t) => ({ file: path.resolve(ch.fileName), start: t.span.start, end: t.span.start + t.span.length, newText: t.newText })));
    // round 1: every missing import in the file, in one combined fix
    const r1 = withOverlay(c.entry, c.abs, text0, () => toEdits(c.svc.getCombinedCodeFix({ type: 'file', fileName: c.abs }, 'fixMissingImport', FORMAT, PREFS).changes));
    const own1 = r1.filter((e) => e.file === c.abs);
    const text1 = applyText(text0, own1);
    // round 2: single-candidate fixes on what is left
    const own2 = []; const other = r1.filter((e) => e.file !== c.abs).map((e) => ({ ...e, file: c.rel(e.file), fix: 'fixMissingImport' }));
    const applied = own1.length ? [{ fix: 'fixMissingImport', edits: own1.length }] : [];
    withOverlay(c.entry, c.abs, text1, () => {
      for (const d of c.svc.getSemanticDiagnostics(c.abs)) {
        if (!SINGLE_CODES.includes(d.code) || d.start == null) continue;
        let cands = c.svc.getCodeFixesAtPosition(c.abs, d.start, d.start + (d.length ?? 0), [d.code], FORMAT, PREFS).filter((f) => SINGLE_FIX.has(f.fixName));
        if (DID_YOU_MEAN.includes(d.code)) cands = cands.filter((f) => f.fixName === 'spelling'); // TS's own suggestion wins over declaring a new member
        if (cands.length !== 1) continue; // ambiguous: left for the model
        const es = toEdits(cands[0].changes);
        const mine = []; let ok = true;
        for (const e of es) {
          if (e.file !== c.abs) { other.push({ ...e, file: c.rel(e.file), fix: cands[0].fixName }); continue; }
          const s = backMap(own1, e.start); const en = backMap(own1, e.end);
          if (s == null || en == null || [...own1, ...own2].some((x) => x.start < en && s < x.end)) { ok = false; break; }
          mine.push({ file: e.file, start: s, end: en, newText: e.newText });
        }
        if (!ok) continue;
        own2.push(...mine);
        applied.push({ fix: cands[0].fixName, at: lineCol(text1, d.start).line, desc: cands[0].description.slice(0, 80) });
      }
    });
    const edits = [...own1, ...own2].sort((a, b) => a.start - b.start).map((e) => ({ start: e.start, end: e.end, newText: e.newText }));
    const fixed = applyText(text0, edits);
    const left = withOverlay(c.entry, c.abs, fixed, () => diagLines(c, c.abs, fixed)).map((l) => l.text);
    const { kept, dropped } = capList(left, (s) => s);
    return { ok: true, file: c.rel(c.abs), edits, other, applied, unfixed: kept, ...(dropped ? { moreUnfixed: dropped } : {}), ms: Date.now() - t0 };
  });
}

/** Apply fixes()'s `edits` to the text they were computed on. */
export const applyFixEdits = applyText;

// ------------------------------------------------------------------------------------------------ 2. completionsAt
const trigger = (text, pos) => { const ch = text[pos - 1]; return ['.', '/', '"', "'", '<', '@', '#'].includes(ch) ? { triggerCharacter: ch, triggerKind: 2 } : { triggerKind: 1 }; };
const PRIORITY = (s) => Number(String(s).slice(0, 2)) || 99;
/**
 * Names valid at `at`: locals, members, props, module exports and import paths, filtered by the prefix already typed,
 * ranked (TypeScript's sort priority, then name), keywords and lib globals dropped unless nothing else fits. Capped at
 * about 30. `schema` is an Ollama `format` JSON schema whose `name` enum is exactly these names.
 */
export function completionsAt(root, file, at, o = {}) {
  return guard(() => {
    const c = ctx(root, file, o);
    const t0 = Date.now();
    const { text, pos } = resolveAt(read(c, o.text), at);
    const info = withOverlay(c.entry, c.abs, text, () => c.svc.getCompletionsAtPosition(c.abs, pos, { ...PREFS, ...trigger(text, pos) }, FORMAT));
    const typed = /[\w$]*$/.exec(text.slice(0, pos))[0];
    let all = (info?.entries ?? []).filter((e) => !typed || e.name.startsWith(typed));
    const isString = all.some((e) => e.kind === 'script' || e.kind === 'directory' || e.kind === 'string');
    const local = all.filter((e) => e.kind !== 'keyword' && (info?.isMemberCompletion || isString || PRIORITY(e.sortText) < 15 || e.source || e.hasAction));
    if (local.length) all = local;
    all = all.filter((e) => !/^__/.test(e.name));
    all.sort((a, b) => PRIORITY(a.sortText) - PRIORITY(b.sortText) || Number(!!a.source) - Number(!!b.source) || a.name.localeCompare(b.name));
    const seen = new Set();
    const items = [];
    for (const e of all) {
      if (seen.has(e.name)) continue; seen.add(e.name);
      const src = e.source && !path.isAbsolute(e.source) ? e.source : e.source ? c.rel(e.source) : undefined;
      items.push({ name: e.name, kind: e.kind, ...(src ? { from: src } : {}) });
      if (items.length >= MAX_ITEMS) break;
    }
    const names = items.map((i) => i.name);
    return {
      ok: true, file: c.rel(c.abs), at: lineCol(text, pos), member: !!info?.isMemberCompletion, typed, total: (info?.entries ?? []).length, items,
      schema: completionSchema(names), ms: Date.now() - t0,
    };
  });
}

/** An Ollama `format` JSON schema that lets the model answer only one of `names`. */
export const completionSchema = (names) => ({ type: 'object', properties: { name: { type: 'string', enum: names.length ? names : [''] } }, required: ['name'] });

// ------------------------------------------------------------------------------------------------ 3. quickInfo / signatureAt
const short = (s, n = 400) => (s.length > n ? `${s.slice(0, n)}...` : s);
export function quickInfo(root, file, symbol, o = {}) {
  return guard(() => {
    const c = ctx(root, file, o);
    const t0 = Date.now();
    const at = locate(c, symbol);
    if (!at) return { ok: false, reason: `no symbol ${symbol} in the project` };
    let q = c.svc.getQuickInfoAtPosition(at.abs, at.pos);
    if (q?.kind === 'alias') { // an import: answer with the type where it is declared
      const d = (c.svc.getDefinitionAtPosition(at.abs, at.pos) ?? []).find((x) => inside(c.r, path.resolve(x.fileName)));
      if (d) { at.abs = path.resolve(d.fileName); at.pos = d.textSpan.start; q = c.svc.getQuickInfoAtPosition(at.abs, at.pos) ?? q; }
    }
    if (!q) return { ok: false, reason: `no type for ${symbol}` };
    return { ok: true, symbol, kind: q.kind, type: short(ts.displayPartsToString(q.displayParts).replace(/\s+/g, ' ')), file: c.rel(at.abs), ms: Date.now() - t0 };
  });
}

export function signatureAt(root, file, at, o = {}) {
  return guard(() => {
    const c = ctx(root, file, o);
    const t0 = Date.now();
    let { text, pos } = resolveAt(read(c, o.text), at);
    // { symbol }: inside the first call of it, else its declaration's type
    if (at && typeof at === 'object' && at.symbol) {
      const m = new RegExp(`\\b${String(at.symbol).split('.').pop().replace(/\$/g, '\\$')}\\s*\\(`).exec(text);
      if (!m) { const q = quickInfo(root, file, at.symbol, o); return q.ok ? { ok: true, signature: q.type, from: 'quickInfo', ms: Date.now() - t0 } : q; }
      pos = m.index + m[0].length;
    }
    const help = withOverlay(c.entry, c.abs, text, () => c.svc.getSignatureHelpItems(c.abs, pos, {}));
    if (!help?.items?.length) return { ok: false, reason: 'not inside a call' };
    const it = help.items[help.selectedItemIndex] ?? help.items[0];
    const str = (ps) => ts.displayPartsToString(ps);
    const sig = str(it.prefixDisplayParts) + it.parameters.map((p) => str(p.displayParts)).join(str(it.separatorDisplayParts)) + str(it.suffixDisplayParts);
    return { ok: true, signature: short(sig.replace(/\s+/g, ' ')), argument: help.argumentIndex, overloads: help.items.length, ms: Date.now() - t0 };
  });
}

// ------------------------------------------------------------------------------------------------ 4. definition / references
function locations(c, spans) {
  const texts = new Map();
  const lt = (abs) => { if (!texts.has(abs)) { try { texts.set(abs, fs.readFileSync(abs, 'utf8')); } catch { texts.set(abs, ''); } } return texts.get(abs); };
  const out = [];
  for (const s of spans) {
    const abs = path.resolve(s.fileName);
    if (!inside(c.r, abs)) continue; // lib / node_modules locations are never shown
    const t = lt(abs); const { line } = lineCol(t, s.textSpan.start);
    out.push({ file: c.rel(abs), line, text: lineAt(t, line) });
  }
  return capList(out, (x) => `${x.file}:${x.line} ${x.text}`);
}
export function definition(root, file, symbol, o = {}) {
  return guard(() => {
    const c = ctx(root, file, o);
    const t0 = Date.now();
    const at = locate(c, symbol);
    if (!at) return { ok: false, reason: `no symbol ${symbol} in the project` };
    const defs = c.svc.getDefinitionAtPosition(at.abs, at.pos) ?? [];
    const { kept, dropped } = locations(c, defs);
    return { ok: true, symbol, locations: kept, ...(dropped ? { more: dropped } : {}), ms: Date.now() - t0 };
  });
}
export function references(root, file, symbol, o = {}) {
  return guard(() => {
    const c = ctx(root, file, o);
    const t0 = Date.now();
    const at = locate(c, symbol);
    if (!at) return { ok: false, reason: `no symbol ${symbol} in the project` };
    const refs = (c.svc.findReferences(at.abs, at.pos) ?? []).flatMap((r) => r.references.filter((x) => !x.isDefinition));
    const { kept, dropped } = locations(c, refs);
    return { ok: true, symbol, locations: kept, ...(dropped ? { more: dropped } : {}), ms: Date.now() - t0 };
  });
}
