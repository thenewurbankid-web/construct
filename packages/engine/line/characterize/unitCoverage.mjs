// iv2-tests -- coverage -> logic units. Istanbul's per-file statement, branch and function counters (jest
// `--coverage --coverageReporters=json`, or the per-scenario counters the probe records) are matched to each logic unit's
// span in the source, and each unit is called covered or uncovered with the reason in one sentence.
//
// What "covered" means, per unit kind:
//   branch (if / ternary)   every outcome of that decision ran (istanbul's branch arms all > 0)
//   branch (switch case)    that case's arm ran
//   render-if               every operand of the JSX `a && <b/>` / `a ?? b` / `a || b` ran (the guarded part rendered)
//   effect / derived        the callback passed to useEffect / useMemo / useCallback ran
//   handler                 the handler function ran; a handler that is a plain reference to a function outside the file
//                           (a state setter, a prop) counts when the element carrying it rendered
//   export                  the exported function ran (an exported value: its statement ran)
//   anything else           the statement holding the call ran (state, data, navigation, url-read, toast, analytics,
//                           storage, io)
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ts } from '@construct/ast/lazy';

const posix = (p) => p.split(path.sep).join('/');
const before = (a, b) => a.line < b.line || (a.line === b.line && a.column <= b.column);
const within = (p, span) => p && span && before(span.start, p) && before(p, span.end);
const same = (a, b) => a && b && a.line === b.line && a.column === b.column;

/**
 * @typedef {object} UnitSpan
 * @property {{line: number, column: number}} start 1-based line, 0-based column (istanbul's convention).
 * @property {{line: number, column: number}} end
 * @property {string} nodeKind The syntax kind the unit was found at.
 * @property {{line: number, column: number}[]} [fnStarts] For effect/derived/handler: where the callback function starts.
 * @property {string} [handlerRef] For a handler that is a plain identifier: its name.
 */

/** The nodes a unit of `kind` can sit on (the same syntax the logic map reads). */
function candidates(kind, node, sf) {
  const K = ts.SyntaxKind;
  switch (kind) {
    case 'branch': return ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isCaseClause(node) || ts.isDefaultClause(node);
    case 'render-if': return ts.isBinaryExpression(node) && [K.AmpersandAmpersandToken, K.BarBarToken, K.QuestionQuestionToken].includes(node.operatorToken.kind);
    case 'handler': return ts.isJsxAttribute(node) && /^on[A-Z]/.test(node.name.getText(sf));
    case 'export': return (ts.isFunctionDeclaration(node) || ts.isVariableStatement(node)) && Boolean(node.modifiers?.some((m) => m.kind === K.ExportKeyword));
    default: return ts.isCallExpression(node);
  }
}

const startOf = (node, sf) => {
  const lc = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { line: lc.line + 1, column: lc.character };
};
const endOf = (node, sf) => {
  const lc = sf.getLineAndCharacterOfPosition(node.getEnd());
  return { line: lc.line + 1, column: lc.character };
};

/** Normalized text for the fingerprint: whitespace collapsed, comments dropped. */
const normText = (node, sf) => node.getText(sf).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();

/**
 * The contract's fingerprint (kind, enclosing function name, normalized AST text; never the path), for maps that do not
 * carry one yet (the prototype map).
 * @param {string} kind
 * @param {string} fn
 * @param {string} text
 * @returns {string}
 */
export function fingerprintOf(kind, fn, text) {
  return createHash('sha1').update(`${kind}\u0000${fn}\u0000${text}`).digest('hex').slice(0, 16);
}

/**
 * Locate every unit's span in its file: the node of the unit's kind on the unit's line, matched by its detail text when
 * several share the line, else by order. Units whose node cannot be found keep `span: null`.
 *
 * @param {string} appRoot
 * @param {{id: string, file: string, fn: string, kind: string, line: number, detail?: string, fingerprint?: string}[]} units
 * @returns {Array<object & {fingerprint: string, span: UnitSpan|null}>} The units with `span` (and a `fingerprint` when missing).
 */
export function locateUnitSpans(appRoot, units) {
  const byFile = new Map();
  for (const u of units) { if (!byFile.has(u.file)) byFile.set(u.file, []); byFile.get(u.file).push(u); }
  const out = new Map();
  for (const [file, us] of byFile) {
    const abs = path.resolve(appRoot, file);
    if (!fs.existsSync(abs)) { for (const u of us) out.set(u, { ...u, fingerprint: u.fingerprint ?? fingerprintOf(u.kind, u.fn, u.detail ?? u.id), span: null }); continue; }
    const sf = ts.createSourceFile(abs, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true, /x$/.test(abs) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const nodesByLineKind = new Map();
    const visit = (node) => {
      for (const kind of ['branch', 'render-if', 'handler', 'export', 'call']) {
        if (!candidates(kind === 'call' ? 'state' : kind, node, sf)) continue;
        const line = startOf(node, sf).line;
        const key = `${line}|${kind}`;
        if (!nodesByLineKind.has(key)) nodesByLineKind.set(key, []);
        nodesByLineKind.get(key).push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    const used = new Set();
    for (const u of us) {
      const kind = ['branch', 'render-if', 'handler', 'export'].includes(u.kind) ? u.kind : 'call';
      const nodes = (nodesByLineKind.get(`${u.line}|${kind}`) ?? []).filter((n) => !used.has(n));
      const detail = String(u.detail ?? '').replace(/…/g, '').replace(/\s+/g, ' ').trim();
      const textMatch = (n) => {
        const t = n.getText(sf).replace(/\s+/g, ' ');
        if (u.kind === 'branch' && ts.isIfStatement(n)) return detail.startsWith(`if (${n.expression.getText(sf).replace(/\s+/g, ' ').slice(0, 20)}`);
        if (u.kind === 'branch' && ts.isConditionalExpression(n)) return detail.startsWith(n.condition.getText(sf).replace(/\s+/g, ' ').slice(0, 20));
        if (u.kind === 'branch' && ts.isCaseClause(n)) return detail.startsWith(`case ${n.expression.getText(sf).replace(/\s+/g, ' ').slice(0, 20)}`);
        if (u.kind === 'branch' && ts.isDefaultClause(n)) return detail === 'case default';
        if (u.kind === 'render-if') return detail.startsWith(n.left.getText(sf).replace(/\s+/g, ' ').slice(0, 20));
        if (u.kind === 'handler') return detail.startsWith(`${n.name.getText(sf)}=`) && detail.slice(n.name.getText(sf).length + 1, n.name.getText(sf).length + 21) === (n.initializer?.getText(sf) ?? '').replace(/\s+/g, ' ').slice(0, 20);
        if (kind === 'call') return detail.startsWith(n.expression.getText(sf).replace(/\s+/g, ' ').slice(0, 20));
        return t.length > 0;
      };
      const node = nodes.find(textMatch) ?? nodes[0] ?? null;
      if (!node) { out.set(u, { ...u, fingerprint: u.fingerprint ?? fingerprintOf(u.kind, u.fn, detail), span: null }); continue; }
      used.add(node);
      const span = { start: startOf(node, sf), end: endOf(node, sf), nodeKind: ts.SyntaxKind[node.kind] };
      if (u.kind === 'effect' || u.kind === 'derived') {
        const fnArg = node.arguments?.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
        if (fnArg) span.fnStarts = [startOf(fnArg, sf)];
      }
      if (u.kind === 'handler' && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        const e = node.initializer.expression;
        if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) span.fnStarts = [startOf(e, sf)];
        else if (ts.isIdentifier(e)) {
          span.handlerRef = e.text;
          // a function declared in the same file under that name
          const decls = [];
          const find = (n) => {
            if (ts.isFunctionDeclaration(n) && n.name?.text === e.text) decls.push(startOf(n.name, sf));
            if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === e.text && n.initializer) {
              let init = n.initializer;
              if (ts.isCallExpression(init) && /^use(Callback|Memo)$/.test(init.expression.getText(sf))) init = init.arguments[0];
              if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) decls.push(startOf(init, sf));
            }
            ts.forEachChild(n, find);
          };
          find(sf);
          if (decls.length) span.fnStarts = decls;
        }
      }
      if (u.kind === 'export') {
        if (ts.isFunctionDeclaration(node)) span.fnStarts = [startOf(node.name ?? node, sf)];
        else {
          const fns = node.declarationList.declarations.map((d) => d.initializer).filter((i) => i && (ts.isArrowFunction(i) || ts.isFunctionExpression(i)));
          if (fns.length) span.fnStarts = fns.map((f) => startOf(f, sf));
        }
      }
      out.set(u, { ...u, fingerprint: u.fingerprint ?? fingerprintOf(u.kind, u.fn, normText(node, sf)), span });
    }
  }
  return units.map((u) => out.get(u));
}

/** Coverage keyed by app-relative path (istanbul keys absolute paths). */
function byRelFile(appRoot, coverageJson) {
  const out = new Map();
  for (const [k, v] of Object.entries(coverageJson ?? {})) {
    const rel = path.isAbsolute(k) ? posix(path.relative(appRoot, k)) : posix(k);
    out.set(rel, v);
    // macOS: /private/tmp vs /tmp
    const real = (() => { try { return posix(path.relative(fs.realpathSync(appRoot), fs.realpathSync(k))); } catch { return null; } })();
    if (real && real !== rel) out.set(real, v);
  }
  return out;
}

/** The function counter whose declaration or body starts at one of `starts`. */
function fnCount(fc, starts) {
  let best = null;
  for (const [k, d] of Object.entries(fc.fnMap ?? {})) {
    const at = [d.loc?.start, d.decl?.start].filter(Boolean);
    if (starts.some((s) => at.some((a) => same(a, s) || (a.line === s.line && Math.abs(a.column - s.column) <= 2)))) { best = fc.f[k] ?? 0; if (best > 0) return best; }
  }
  if (best !== null) return best;
  // fall back: a function whose body span contains the start (same line)
  for (const [k, d] of Object.entries(fc.fnMap ?? {})) if (starts.some((s) => d.loc?.start?.line === s.line || d.decl?.start?.line === s.line)) return fc.f[k] ?? 0;
  return null;
}

/** The innermost statement containing `p` (or starting inside `span`). */
function stmtCount(fc, span) {
  let best = null; let bestSize = Infinity;
  for (const [k, loc] of Object.entries(fc.statementMap ?? {})) {
    if (!loc?.start || !loc?.end) continue;
    const contains = before(loc.start, span.start) && before(span.start, loc.end);
    const inside = within(loc.start, span);
    if (!contains && !inside) continue;
    const size = (loc.end.line - loc.start.line) * 1000 + (loc.end.column - loc.start.column);
    if (contains && size < bestSize) { best = k; bestSize = size; }
    if (inside && !contains && best === null) best = k;
  }
  return best === null ? null : fc.s[best] ?? 0;
}

/** The branch whose decision starts at the unit (if, ternary, logical, switch) and its arms' counts. */
function branchOf(fc, span, unit) {
  const wantType = unit.kind === 'render-if' ? /binary-expr|logical/ : span.nodeKind === 'IfStatement' ? /^if$/ : span.nodeKind === 'ConditionalExpression' ? /cond-expr/ : /switch/;
  let hit = null;
  for (const [k, d] of Object.entries(fc.branchMap ?? {})) {
    if (!wantType.test(d.type)) continue;
    if (/switch/.test(d.type)) {
      const i = d.locations.findIndex((l) => l?.start && (same(l.start, span.start) || (l.start.line === span.start.line && Math.abs(l.start.column - span.start.column) <= 2)));
      if (i >= 0) return { arms: [fc.b[k]?.[i] ?? 0], type: d.type, single: true };
      continue;
    }
    if (d.loc?.start && (same(d.loc.start, span.start) || (d.loc.start.line === span.start.line && Math.abs(d.loc.start.column - span.start.column) <= 2))) return { arms: fc.b[k] ?? [], type: d.type };
    if (!hit && d.loc?.start && within(d.loc.start, span) && d.loc.start.line === span.start.line) hit = { arms: fc.b[k] ?? [], type: d.type };
  }
  return hit;
}

const armNames = (unit, span) => (span.nodeKind === 'IfStatement' ? ['the then-branch', 'the else-path'] : span.nodeKind === 'ConditionalExpression' ? ['the true side', 'the false side'] : unit.kind === 'render-if' ? ['the condition', 'the guarded part'] : []);

/**
 * Is one unit covered by this coverage, and if not, why (one sentence)?
 * @param {object} unit A located unit (locateUnitSpans).
 * @param {object|null} fc Istanbul file coverage for the unit's file.
 * @returns {{covered: boolean, why: string}}
 */
export function unitVerdict(unit, fc) {
  const span = unit.span;
  if (!span) return { covered: false, why: 'Its code was not found in the file any more, so it could not be matched to coverage.' };
  if (!fc) return { covered: false, why: 'Its file was not loaded by any characterization test.' };
  const ran = (n) => n !== null && n > 0;
  switch (unit.kind) {
    case 'branch':
    case 'render-if': {
      const b = branchOf(fc, span, unit);
      if (!b) {
        const s = stmtCount(fc, span);
        return ran(s) ? { covered: true, why: '' } : { covered: false, why: 'The code around this decision never ran.' };
      }
      if (b.single) return ran(b.arms[0]) ? { covered: true, why: '' } : { covered: false, why: 'No test reached this case.' };
      if (b.arms.every((n) => n > 0)) return { covered: true, why: '' };
      if (b.arms.every((n) => !n)) return { covered: false, why: 'No test reached this decision.' };
      const names = armNames(unit, span);
      const missing = b.arms.map((n, i) => (n ? null : names[i] ?? `outcome ${i + 1}`)).filter(Boolean);
      return { covered: false, why: `Only one outcome ran; ${missing.join(' and ')} never did.` };
    }
    case 'effect':
    case 'derived': {
      const n = span.fnStarts ? fnCount(fc, span.fnStarts) : null;
      if (ran(n)) return { covered: true, why: '' };
      const s = stmtCount(fc, span);
      if (n === null && ran(s)) return { covered: true, why: '' };
      return ran(s) ? { covered: false, why: 'The hook was declared but its callback never ran.' } : { covered: false, why: 'The component or hook holding it never rendered.' };
    }
    case 'handler': {
      if (span.fnStarts) {
        const n = fnCount(fc, span.fnStarts);
        if (ran(n)) return { covered: true, why: '' };
        const s = stmtCount(fc, span);
        return ran(s) ? { covered: false, why: 'The element rendered but no test fired this handler.' } : { covered: false, why: 'The element carrying this handler never rendered.' };
      }
      const s = stmtCount(fc, span);
      return ran(s) ? { covered: true, why: '' } : { covered: false, why: 'The element carrying this handler never rendered.' };
    }
    case 'export': {
      if (span.fnStarts) {
        const n = fnCount(fc, span.fnStarts);
        if (ran(n)) return { covered: true, why: '' };
        return { covered: false, why: 'No test called this exported function.' };
      }
      const s = stmtCount(fc, span);
      return ran(s) ? { covered: true, why: '' } : { covered: false, why: 'The module was never loaded.' };
    }
    default: {
      const s = stmtCount(fc, span);
      if (ran(s)) return { covered: true, why: '' };
      return { covered: false, why: s === null ? 'No coverage counter sits on this call.' : 'No test reached this call.' };
    }
  }
}

/**
 * @typedef {object} UnitCoverage
 * @property {string[]} covered Fingerprints of the covered units.
 * @property {string[]} uncovered Fingerprints of the uncovered units (not waived).
 * @property {{fingerprint: string, by: 'owner', why: string}[]} waived
 * @property {Record<string, {covered: number, total: number}>} byKind
 * @property {{fingerprint: string, id: string, kind: string, file: string, line: number, why: string}[]} details Each uncovered unit with its reason.
 */

/**
 * Map istanbul coverage onto a logic map: which units the tests cover, and why each other one is not.
 *
 * @param {{root: string, units: object[]}} map A LogicMap (`root` is the app root; units with or without `span`).
 * @param {object} coverageJson Istanbul JSON (coverage-final.json), keyed by absolute or app-relative file path.
 * @param {{waived?: {fingerprint: string, by: 'owner', why: string}[], appRoot?: string}} [opts]
 * @returns {UnitCoverage}
 *
 * @example
 * unitCoverage(map, JSON.parse(fs.readFileSync('coverage/coverage-final.json', 'utf8'))).byKind.branch; // => { covered: 12, total: 14 }
 */
export function unitCoverage(map, coverageJson, opts = {}) {
  const appRoot = opts.appRoot ?? map.root;
  const units = map.units.every((u) => 'span' in u) ? map.units : locateUnitSpans(appRoot, map.units);
  const files = byRelFile(appRoot, coverageJson);
  const waived = opts.waived ?? [];
  const waivedSet = new Set(waived.map((w) => w.fingerprint));
  const covered = [];
  const uncovered = [];
  const details = [];
  /** @type {Record<string, {covered: number, total: number}>} */
  const byKind = {};
  for (const u of units) {
    byKind[u.kind] ??= { covered: 0, total: 0 };
    byKind[u.kind].total++;
    const v = unitVerdict(u, files.get(posix(u.file)) ?? null);
    if (v.covered) { covered.push(u.fingerprint); byKind[u.kind].covered++; continue; }
    if (waivedSet.has(u.fingerprint)) continue;
    uncovered.push(u.fingerprint);
    details.push({ fingerprint: u.fingerprint, id: u.id, kind: u.kind, file: u.file, line: u.line, why: v.why });
  }
  return { covered, uncovered, waived, byKind, details };
}

/**
 * The units one scenario touched (any counter inside the unit ran), from the probe's raw hit ids and remapped maps.
 *
 * @param {object[]} located Located units (locateUnitSpans).
 * @param {string[]} hits Hit ids `<abs file>|s|<id>`, `|f|<id>`, `|b|<id>|<arm>`.
 * @param {Record<string, {key: string, statementMap: object, fnMap: object, branchMap: object}>} maps Remapped maps by app-relative file.
 * @returns {string[]} Fingerprints.
 */
export function unitsTouched(located, hits, maps) {
  const byKey = new Map(Object.entries(maps).map(([rel, m]) => [m.key, { rel, m }]));
  const pts = new Map();
  for (const h of hits) {
    const [file, kind, id] = h.split('|');
    const e = byKey.get(file);
    if (!e) continue;
    const loc = kind === 's' ? e.m.statementMap[id] : kind === 'f' ? e.m.fnMap[id]?.loc : e.m.branchMap[id]?.loc;
    if (!loc?.start) continue;
    if (!pts.has(e.rel)) pts.set(e.rel, []);
    pts.get(e.rel).push(loc.start);
  }
  const out = [];
  for (const u of located) {
    if (!u.span) continue;
    const ps = pts.get(posix(u.file)) ?? [];
    if (ps.some((p) => within(p, u.span) || (p.line === u.span.start.line))) out.push(u.fingerprint);
  }
  return out;
}
