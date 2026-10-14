// compileFacts for a project that is not laid out for Line (no features/<f>/ at the root, no Line config): there is no
// moduleScope, so the scope is the feature folder itself -- every non-test .ts/.tsx file in it, read with the TS
// language service. Same output shape as facts.mjs's Line facts (it uses facts.mjs's assembleFacts), no model.
//
//   buildFeatureIndex(root, dir, {smith})  -> index (mode 'feature')
//   compileFacts({index, target: {name, file?}, step}) dispatches here when index.mode === 'feature'
import fs from 'node:fs';
import path from 'node:path';
import { ts } from './host.mjs';
import { assembleFacts, smithWords, stepsShape } from './facts.mjs';

const LAYERS = { domain: 'domain', domains: 'domain', hooks: 'hook', controllers: 'controller', components: 'component', pages: 'page', services: 'service', usecases: 'workflow', expressions: 'expression' };
const layerOf = (inner) => { for (const p of inner.split('/').slice(0, -1).reverse()) if (LAYERS[p]) return LAYERS[p]; return null; };
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const shorten = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function docOf(node, sf) {
  const lead = sf.getFullText().slice(node.getFullStart(), node.getStart(sf));
  const m = /\/\*\*([\s\S]*?)\*\/\s*$/.exec(lead);
  return m ? m[1].split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean).join(' ') : null;
}

/**
 * Index one feature folder of any TS project: its units (top-level functions, stable id `<feature>/<folder>/<name>`),
 * their quickInfo signatures, stub checks, Smith steps and doc comments; its type aliases; each file's imports, and
 * a `sig(file, name)` lookup (quickInfo) for names a file imports from outside the feature.
 * @param {string} root Project root (its tsconfig resolves the types).
 * @param {string} dir Root-relative feature folder, e.g. src/features/admin-navigation.
 * @param {{smith: (code: string, kind: string, rel: string) => Promise<string[]>, quickInfo?: Function, stubProblems?: Function}} o
 */
export async function buildFeatureIndex(root, dir, o) {
  const quickInfo = o.quickInfo ?? (await import('./index.mjs')).quickInfo;
  const stubProblems = o.stubProblems ?? (await import('../line/path/stubs.mjs')).stubProblems;
  const cache = new Map();
  const sig = (rel, name) => {
    const k = `${rel}#${name}`;
    if (!cache.has(k)) { let v = null; try { const q = quickInfo(root, rel, name); v = q?.ok ? q.type.replace(/\s+/g, ' ') : null; } catch { v = null; } cache.set(k, v); }
    return cache.get(k);
  };
  const feature = path.posix.basename(dir);
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = `${d}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else if (/\.tsx?$/.test(e.name) && !/\.(test|spec|stories)\.|\.d\.ts$/.test(e.name)) files.push(r);
    }
  };
  walk(dir);
  const units = []; const types = []; const imports = {};
  for (const rel of files) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, /\.tsx$/.test(rel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const inner = rel.slice(dir.length + 1);
    imports[rel] = [];
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st)) {
        const from = /** @type {any} */ (st.moduleSpecifier).text;
        const c = st.importClause;
        const names = [];
        if (c?.name) names.push(c.name.text);
        if (c?.namedBindings && ts.isNamedImports(c.namedBindings)) for (const e of c.namedBindings.elements) names.push(e.name.text);
        if (c?.namedBindings && ts.isNamespaceImport(c.namedBindings)) names.push(c.namedBindings.name.text);
        imports[rel].push({ text: st.getText(sf).replace(/\s+/g, ' '), from, names, external: !from.startsWith('.'), typeOnly: !!c?.isTypeOnly });
        continue;
      }
      if (ts.isTypeAliasDeclaration(st)) { types.push({ name: st.name.text, file: rel, type: sig(rel, st.name.text) }); continue; }
      let name = null; let code = null;
      if (ts.isFunctionDeclaration(st) && st.body && st.name) { name = st.name.text; code = st.getText(sf).replace(/^export\s+(default\s+)?/, ''); }
      else if (ts.isVariableStatement(st) && st.declarationList.declarations.length === 1) {
        const d = st.declarationList.declarations[0];
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) { name = d.name.text; code = st.getText(sf).replace(/^export\s+/, ''); }
      }
      if (!name) continue;
      let stub = [];
      try { stub = stubProblems(src, name).map((p) => p.code).filter((x) => x !== 'NO_STUB'); } catch { stub = []; }
      const folder = inner.split('/').slice(0, -1).join('/') || '.';
      units.push({ id: `${feature}/${folder}/${name}`, name, file: rel, layer: layerOf(inner), signature: sig(rel, name), stub, doc: docOf(st, sf), lines: code.split('\n').length, code, steps: await o.smith(code, 'function', rel) });
    }
  }
  const indexFile = files.find((f) => f === `${dir}/index.ts`) ?? null;
  const surface = indexFile ? [...fs.readFileSync(path.join(root, indexFile), 'utf8').matchAll(/export \{ (?:default as )?(\w+)/g)].map((m) => m[1]) : [];
  return { mode: 'feature', feature: { name: feature, dir, files, surface, index: indexFile }, units, types, imports, sig };
}

/**
 * The units of the feature a unit's Smith steps name: by its Smith words ("get admin navigation") or as written
 * (a JSX tag); a match inside a longer unit's match ("use admin navigation" holds "admin navigation") does not count.
 * @param {any} u
 * @param {any[]} units
 */
export function usedUnits(u, units) {
  const text = u.steps.join(' ');
  const spans = [];
  for (const x of units) {
    if (x === u) continue;
    for (const re of [new RegExp(`\\b${esc(smithWords(x.name)).replace(/ /g, '\\s+')}\\b`, 'gi'), new RegExp(`\\b${esc(x.name)}\\b`, 'g')]) {
      for (const m of text.matchAll(re)) spans.push({ x, start: m.index, end: m.index + m[0].length });
    }
  }
  const kept = spans.filter((s) => !spans.some((o) => o !== s && o.x !== s.x && o.start <= s.start && o.end >= s.end && o.end - o.start > s.end - s.start));
  return units.filter((x) => kept.some((s) => s.x === x));
}

/** A rendered element kept short: the tag with only its attribute names when the full form is long. */
const shortElement = (el) => (el.length <= 100 ? el : `<${/^<([\w.]+)/.exec(el)?.[1] ?? '?'} ${[...el.matchAll(/ (\w[\w-]*)=/g)].map((m) => m[1]).join(' ')}>`);

/**
 * The facts for one function of a feature folder: the scope used, every unit in it (stable id, layer, signature,
 * what it renders and which units it uses, from Smith), the types the target names, what it takes from outside the
 * feature (with quickInfo types), the gaps, the exact import lines, the one next step.
 * @param {{index: any, target: {name: string, file?: string}, step: any, refusal?: any, fetch?: boolean}} input
 */
export function compileFeatureFacts(input) {
  const { index, target } = input;
  const F = index.feature;
  const T = index.units.find((u) => u.name === target.name && (!target.file || u.file === target.file));
  if (!T) throw new Error(`no function ${target.name} in ${F.dir}`);
  const facts = [];
  facts.push(`Scope: feature ${F.name} = the folder ${F.dir} (${F.files.length} files, tests left out; not a Line project, so no moduleScope: read with the TS language service)${F.surface.length ? `; its public surface is ${F.index} exporting ${list(F.surface)}` : ''}. [ls; quickInfo]`);
  const usesOf = (u) => usedUnits(u, index.units);
  // In scope: the target and its neighbours (the units it uses, the units that use it) in full; the rest by name.
  const near = new Set([T, ...usesOf(T), ...index.units.filter((x) => usesOf(x).includes(T))]);
  for (const u of index.units.filter((x) => near.has(x))) {
    const sh = stepsShape(u.steps);
    const meta = [u.layer ?? 'unit', `\`${shorten(u.signature ?? `function ${u.name}(…)`, 160)}\``];
    if (sh.renders) meta.push(`renders ${shortElement(sh.renders)}`);
    const uses = usesOf(u).map((x) => x.name);
    if (uses.length) meta.push(`uses ${list(uses)}`);
    if (u.stub.length) meta.push(`stub check: ${u.stub.join(', ')}`);
    facts.push(`${u === T ? 'THE TARGET ' : ''}${u.id} (${u.file}): ${meta.join('; ')}. [quickInfo; Smith]`);
  }
  const rest = index.units.filter((x) => !near.has(x));
  if (rest.length) facts.push(`Also in the feature (not used by or using the target): ${list(rest.map((x) => `${x.name} (${x.layer ?? 'unit'})`))}. [ls]`);
  const named = (n) => new RegExp(`\\b${esc(n)}\\b`).test(`${T.code} ${T.signature ?? ''}`);
  for (const t of index.types.filter((x) => named(x.name))) facts.push(`Type ${t.name} (${t.file}): \`${shorten(t.type ?? t.name, 400)}\`. [quickInfo]`);
  const used = (index.imports[T.file] ?? []).map((i) => ({ ...i, names: i.names.filter((n) => new RegExp(`\\b${esc(n)}\\b`).test(T.code)) })).filter((i) => i.names.length);
  const outside = used.filter((i) => i.external && !i.typeOnly);
  const unresolved = [];
  for (const i of outside) {
    const typed = i.names.map((n) => { const s = index.sig(T.file, n); if (!s) unresolved.push(n); return `${n}: \`${shorten(s ?? 'type not resolved', 110)}\``; });
    facts.push(`Outside the feature, from ${i.from}: ${typed.join('; ')}. [quickInfo]`);
  }
  if (unresolved.length) facts.push(`Missing: ${list(unresolved)} ${unresolved.length > 1 ? 'do' : 'does'} not resolve from ${T.file}. [quickInfo]`);
  if (T.stub.length) facts.push(`Missing: ${T.name} fails its stub check (${T.stub.join(', ')}). [stubs]`);
  if (!unresolved.length && !T.stub.length) facts.push('Nothing the target names is missing: its imports resolve and its stub check is clean. [quickInfo; stubs]');
  facts.push(`Use exactly: ${used.map((i) => i.text).join(' ') || '(no imports)'} [${T.file}]`);
  return assembleFacts(facts, input);
}
