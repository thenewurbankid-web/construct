// importFixer (#941, r3): deterministic import repair after an edit lands and before tsc. It does no import logic of
// its own. TypeScript's language service (the contained, cached host from packages/engine/tsFileMove.mjs) proposes
// every fix, and this block only chooses which fixes are safe and applies them. Only import declarations change;
// function bodies are never touched. Every change and every unfixed diagnostic is logged.
//
//   fixImports(root, rel, { readRoots }) -> { changed, body, log: [{ action, detail }], unfixed: [{ code, message }] }
//
// Steps, up to MAX_ROUNDS times while something changes:
//  1. Unresolvable imports: when a module does not resolve (TS2307), its import declaration is removed. When a name
//     is not exported by its module (TS2305/2724), that one specifier is removed. Step 2 then re-imports the names
//     from wherever they really live.
//  2. getCombinedCodeFix(fixMissingImport) adds the missing imports (React, hooks, library components and pages, the
//     UMD React global). Each import it adds is checked against the scope rule. If any added import breaks the rule,
//     the combined fix is dropped and step 3 is used instead.
//  3. For each remaining diagnostic, getCodeFixesAtPosition is called. A fix is applied only when exactly one safe
//     candidate is left: an `import` fix that passes the scope rule, or a `spelling` fix. All other diagnostics are
//     logged as unfixed.
//  4. Scope rule (Line's moduleScope/importableFor): another feature may be imported only through its index.ts. An
//     existing direct import into another feature is rewritten to that feature's index when the index exports every
//     imported name; otherwise it is flagged.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { projectLanguageService } from '../../../packages/engine/tsFileMove.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const MAX_ROUNDS = 3;
const FEATURES = 'features';
const fmt = ts.getDefaultFormatCodeSettings('\n');
const prefs = { importModuleSpecifierPreference: 'relative', importModuleSpecifierEnding: 'minimal', quotePreference: 'single', includeCompletionsForModuleExports: true };
const UNRESOLVED_MODULE = new Set([2307]);
const NOT_EXPORTED = new Set([2305, 2724]);

/** The node_modules folder that holds react (read-only for the language service). */
export function defaultReadRoots() {
  try { return [path.dirname(path.dirname(require.resolve('react/package.json')))]; } catch { return []; }
}

const featureOf = (rel) => (rel.startsWith(`${FEATURES}/`) ? rel.split('/')[1] : null);
const indexOf = (root, feature) => ['index.ts', 'index.tsx'].map((f) => `${FEATURES}/${feature}/${f}`).find((f) => fs.existsSync(path.join(root, f))) ?? null;

/**
 * Line's cross-feature rule as a candidate filter: a specifier from `rel` that lands in another feature must land on
 * that feature's index. Tries Line's own importableFor when `root` is a Line project, and otherwise applies the same
 * rule locally (the harness workspace is not a Line project).
 */
export function scopeAllows(root, rel, spec) {
  if (!spec.startsWith('.')) return { ok: true };
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
  const own = featureOf(rel);
  const other = featureOf(target);
  if (!other || other === own) return { ok: true };
  const isIndex = /\/index$|\/index\.tsx?$/.test(target) || target === `${FEATURES}/${other}`;
  return isIndex ? { ok: true } : { ok: false, reason: `${spec} reaches into feature "${other}"; only ${FEATURES}/${other}/index.ts may be imported` };
}

const specOfFix = (fix) => {
  const m = /from ["']([^"']+)["']/.exec(fix.description) ?? /from ["']([^"']+)["']/.exec(fix.changes.flatMap((c) => c.textChanges.map((t) => t.newText)).join('\n'));
  return m ? m[1] : null;
};

function applyTextChanges(text, changes) {
  const edits = changes.flatMap((c) => c.textChanges).sort((a, b) => b.span.start - a.span.start);
  for (const e of edits) text = text.slice(0, e.span.start) + e.newText + text.slice(e.span.start + e.span.length);
  return text;
}

// Bump the mtime so the cached service (versioned by mtime) re-reads the file, even within one millisecond.
let tick = 0;
function writeFresh(abs, text) {
  fs.writeFileSync(abs, text);
  const t = new Date(Date.now() + ++tick * 1000);
  fs.utimesSync(abs, t, t);
}

const importSpecs = (text, rel) => ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  .statements.filter(ts.isImportDeclaration).map((s) => s.moduleSpecifier.text);

export function fixImports(root, rel, { readRoots = defaultReadRoots() } = {}) {
  const abs = path.join(root, rel);
  const original = fs.readFileSync(abs, 'utf8');
  const log = [];
  let unfixed = [];
  const svc = projectLanguageService(root, { readRoots });
  if (!svc.ok) return { changed: false, body: original, log: [{ action: 'skipped', detail: svc.reason }], unfixed: [] };
  const service = () => projectLanguageService(root, { readRoots }).service;
  const diags = () => { const s = service(); return [...s.getSyntacticDiagnostics(abs), ...s.getSemanticDiagnostics(abs)]; };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let text = fs.readFileSync(abs, 'utf8');
    const before = text;
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    // 1. unresolvable modules and names
    const ds = diags();
    const removals = [];
    for (const imp of sf.statements.filter(ts.isImportDeclaration)) {
      const specNode = imp.moduleSpecifier;
      const hit = (codes, node) => ds.some((d) => codes.has(d.code) && d.start >= node.getStart(sf) && d.start < node.getEnd());
      if (hit(UNRESOLVED_MODULE, specNode)) {
        // A bare project path ('library/x', 'features/y/z') is root-relative: re-point it when that file exists.
        const asRoot = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].map((e) => specNode.text + e).find((p) => !specNode.text.startsWith('.') && fs.existsSync(path.join(root, p)) && fs.statSync(path.join(root, p)).isFile());
        let to = asRoot ? path.posix.relative(path.posix.dirname(rel), specNode.text) : null;
        if (to && !to.startsWith('.')) to = `./${to}`;
        if (to && scopeAllows(root, rel, to).ok) { removals.push({ start: specNode.getStart(sf), end: specNode.getEnd(), text: `'${to}'`, why: `rewrote unresolvable '${specNode.text}' to '${to}' (a project-root path)` }); continue; }
        removals.push({ start: imp.getFullStart(), end: imp.getEnd(), why: `removed import of unresolvable module '${specNode.text}'` });
        continue;
      }
      const named = imp.importClause?.namedBindings && ts.isNamedImports(imp.importClause.namedBindings) ? imp.importClause.namedBindings.elements : [];
      const bad = named.filter((e) => hit(NOT_EXPORTED, e));
      if (bad.length && bad.length === named.length && !imp.importClause.name) removals.push({ start: imp.getFullStart(), end: imp.getEnd(), why: `removed import of ${bad.map((e) => e.name.text).join(', ')}: not exported by '${specNode.text}'` });
      else for (const e of bad) {
        const comma = text.slice(e.getEnd()).match(/^\s*,/);
        removals.push({ start: e.getStart(sf), end: e.getEnd() + (comma ? comma[0].length : 0), why: `removed ${e.name.text} from the import of '${specNode.text}': not exported there` });
      }
    }
    // 4 (existing imports). A direct import into another feature goes through its index when the index has every name.
    for (const imp of sf.statements.filter(ts.isImportDeclaration)) {
      const spec = imp.moduleSpecifier.text;
      const verdict = scopeAllows(root, rel, spec);
      if (verdict.ok || removals.some((r) => r.start <= imp.getStart(sf) && imp.getEnd() <= r.end)) continue;
      const other = featureOf(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)));
      const idx = indexOf(root, other);
      const names = imp.importClause?.namedBindings && ts.isNamedImports(imp.importClause.namedBindings) ? imp.importClause.namedBindings.elements.map((e) => (e.propertyName ?? e.name).text) : [];
      let exported = [];
      if (idx) {
        const program = service().getProgram();
        const mod = program.getSourceFile(path.join(root, idx));
        const sym = mod && program.getTypeChecker().getSymbolAtLocation(mod);
        exported = sym ? program.getTypeChecker().getExportsOfModule(sym).map((s) => s.name) : [];
      }
      if (idx && names.length && !imp.importClause.name && names.every((n) => exported.includes(n))) {
        let to = path.posix.relative(path.posix.dirname(rel), path.posix.dirname(idx));
        if (!to.startsWith('.')) to = `./${to}`;
        removals.push({ start: imp.moduleSpecifier.getStart(sf), end: imp.moduleSpecifier.getEnd(), text: `'${to}'`, why: `rewrote '${spec}' to '${to}' (cross-feature imports go through ${idx})` });
      } else log.push({ action: 'flagged', detail: verdict.reason });
    }
    if (removals.length) {
      removals.sort((a, b) => b.start - a.start);
      for (const r of removals) { text = text.slice(0, r.start) + (r.text ?? '') + text.slice(r.end); log.push({ action: r.text ? 'rewrote' : 'removed', detail: r.why }); }
      writeFresh(abs, text);
    }

    // 2. combined missing-import fix, scope-checked
    const specsBefore = new Set(importSpecs(text, rel));
    const combined = service().getCombinedCodeFix({ type: 'file', fileName: abs }, 'fixMissingImport', fmt, prefs);
    if (combined.changes.length) {
      const next = applyTextChanges(text, combined.changes);
      const added = importSpecs(next, rel).filter((s) => !specsBefore.has(s));
      const denied = added.map((s) => [s, scopeAllows(root, rel, s)]).filter(([, v]) => !v.ok);
      if (!denied.length) {
        writeFresh(abs, next);
        log.push({ action: 'fixMissingImport', detail: `combined fix: ${diffImports(text, next, rel)}` });
        text = next;
      } else log.push({ action: 'dropped', detail: `combined fixMissingImport proposed ${denied.map(([s]) => s).join(', ')}, outside the scope rule; trying per-diagnostic fixes` });
    }

    // 3. per-diagnostic, single safe candidate only
    unfixed = [];
    for (const d of diags()) {
      if (d.start == null) { unfixed.push({ code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, ' ') }); continue; }
      let fixes = [];
      try { fixes = service().getCodeFixesAtPosition(abs, d.start, d.start + d.length, [d.code], fmt, prefs); } catch { fixes = []; }
      const safe = fixes.filter((f) => (f.fixName === 'import' && specOfFix(f) && scopeAllows(root, rel, specOfFix(f)).ok) || f.fixName === 'spelling');
      const kinds = new Set(safe.map((f) => f.fixName));
      if (safe.length === 1 || (kinds.size === 1 && kinds.has('import') && new Set(safe.map(specOfFix)).size === 1)) {
        const cur = fs.readFileSync(abs, 'utf8');
        const next = applyTextChanges(cur, safe[0].changes);
        // spelling fixes may only touch import declarations (never a function body)
        if (safe[0].fixName === 'spelling' && !insideImports(cur, rel, safe[0].changes)) { unfixed.push({ code: d.code, message: `${ts.flattenDiagnosticMessageText(d.messageText, ' ')} (spelling fix would edit a body: not applied)` }); continue; }
        writeFresh(abs, next);
        log.push({ action: safe[0].fixName, detail: safe[0].description });
      } else unfixed.push({ code: d.code, message: `${ts.flattenDiagnosticMessageText(d.messageText, ' ')}${fixes.length ? ` (${safe.length} safe of ${fixes.length} fixes: not applied)` : ''}` });
    }
    if (fs.readFileSync(abs, 'utf8') === before) break;
  }
  const body = fs.readFileSync(abs, 'utf8');
  const seen = new Set();
  const dedup = log.filter((l) => { const k = `${l.action}|${l.detail}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { changed: body !== original, body, log: dedup, unfixed };
}

function insideImports(text, rel, changes) {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const spans = sf.statements.filter(ts.isImportDeclaration).map((s) => [s.getFullStart(), s.getEnd()]);
  return changes.flatMap((c) => c.textChanges).every((t) => spans.some(([a, b]) => t.span.start >= a && t.span.start + t.span.length <= b));
}

function diffImports(a, b, rel) {
  const lines = (t) => new Set(ts.createSourceFile(rel, t, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).statements.filter(ts.isImportDeclaration).map((s) => s.getText().replace(/\s+/g, ' ')));
  const la = lines(a);
  return [...lines(b)].filter((l) => !la.has(l)).join(' ; ') || 'no new import lines';
}
