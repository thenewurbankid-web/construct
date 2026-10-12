// Line Import v2, step 4 (docs/line/import-v2/CONTRACT.md "Fit"): fit an app's existing logic into Line's blocks.
//
//   fitLogic(map, closure, o?)        every logic unit of the map goes to exactly ONE block (FitProposal); a unit no rule
//                                     claims is listed as unassigned with one sentence
//   planFitSteps(proposal, o)         the proposal as plan steps (line.import.extract*, splitPage), nothing written
//
// The fitting rules, in order (the first that claims a unit wins):
//   1. service   data hooks and adapters: top-level functions in an adapter/api/service file, and hooks or functions
//                that fetch (data or io units)
//   2. domain    pure transforms and sort/filter rules: top-level functions with no effects, no JSX and no hooks
//   3. usecase   orchestration of data, state and navigation for one user goal: a component's logic (everything before
//                its JSX: hooks, effects, handlers that save, toast or track), which line.import.splitPage moves into
//                a use<Component> hook
//   4. workflow  screen flow, URL state and navigation between views: navigation and URL reads outside a user-goal
//                handler, the state of a component that reads the URL, and functions that build URL state
//   5. component or page   JSX with its render-ifs and handlers (a page: a route entry or a file in a pages folder)
//   6. fixture   sample data: functions and files named mock, sample, fixture or dummy
// The presentation/logic split is read the way Construct's page transformer reads a page (pageTransformer.mjs
// transformPristineSource: the JSX's interactive slots stay with the presentation), JSX branches are named with
// extractExpression.mjs's subjectOf, and whether a file is shared with other routes comes from Line Import's
// import graph (import.mjs importGraph): shared files go to the library.
import fs from 'node:fs';
import path from 'node:path';
import { ts, parseToAst } from '@construct/ast';
import { subjectOf } from '@line/construct-core/extract-expression';
import { listFiles } from '@line/construct-core/profiles/line/checks';
import { findReactSpaRoutesFile } from '@line/construct-core/route-resolver';
import { transformPristineSource } from '../../pageTransformer.mjs';
import { importGraph } from '../import.mjs';
import { familyFeature, commonFolder } from './route.mjs';
import { KIND_FOLDER } from './contract.mjs';

const posix = path.posix;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const EFFECT_KINDS = new Set(['state', 'effect', 'data', 'io', 'storage', 'analytics', 'toast', 'navigation', 'url-read', 'handler', 'render-if', 'derived']);
const ORCHESTRATION = new Set(['data', 'io', 'toast', 'storage', 'analytics']);
const FLOW_KINDS = new Set(['navigation', 'url-read']);
const MOCK = /mock|sample|fixture|dummy|seed/i;
const URL_STATE = /url|searchParams|queryString|queryParams|routeParams/i;
const ADAPTER_FILE = /(^|\/)(adapters?|api|apis|services?|clients?)\/|adapter\.[cm]?[jt]sx?$|Api\.[cm]?[jt]sx?$/i;
const PAGES_DIR = /(^|\/)[^/]*pages?\//i;
const keyOf = (u) => u.fingerprint ?? u.id;
const stem = (rel) => posix.basename(rel).replace(/\.[^.]+$/, '');
const camel = (s) => s.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c) => (c ? c.toUpperCase() : '')).replace(/^[A-Z]/, (c) => c.toLowerCase());
const pascal = (s) => camel(s).replace(/^[a-z]/, (c) => c.toUpperCase());
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ------------------------------------------------------------------------------------------------- reading a file

/** The prototype logic map's function naming (docs/line/import-v2/logicmap.mjs nameOf), so units find their function. */
function nameOf(sf, n) {
  if (n.name && n.name.getText) return n.name.getText(sf);
  const p = n.parent;
  if (ts.isVariableDeclaration(p)) return p.name.getText(sf);
  if (ts.isPropertyAssignment(p)) return p.name.getText(sf);
  if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent)) return `on:${p.parent.name.getText(sf)}`;
  return '<anon>';
}

/**
 * One file's shape: its top-level declarations (component, hook, function, value or type), every function with its line
 * span and top-level owner, and where each component's JSX starts.
 * @param {string} rel @param {string} src
 */
function readShape(rel, src) {
  const kind = /x$/.test(posix.extname(rel)) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, kind);
  const line = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  /** @type {Map<string, {name: string, kind: string, start: number, end: number, jsxFrom: number|null, exported: boolean, refs: Set<string>}>} */
  const tops = new Map();
  /** @type {{name: string, start: number, end: number, top: string|null, depth: number, jsx: boolean}[]} */
  const fns = [];
  const hasJsx = (n) => { let f = false; const v = (x) => { if (f) return; if (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x) || ts.isJsxFragment(x)) { f = true; return; } ts.forEachChild(x, v); }; v(n); return f; };
  const isFn = (n) => ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n);
  const returnsHere = (st) => { let f = false; const v = (x) => { if (f || isFn(x)) return; if (ts.isReturnStatement(x)) { f = true; return; } ts.forEachChild(x, v); }; v(st); return f; };
  for (const st of sf.statements) {
    const exported = Boolean(ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
    const add = (name, fn, node) => {
      const jsx = fn ? hasJsx(fn) : false;
      const k = fn ? (PASCAL.test(name) && jsx ? 'component' : /^use[A-Z]/.test(name) ? 'hook' : 'function') : (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ? 'type' : 'value');
      let jsxFrom = null;
      if (k === 'component' && fn.body && ts.isBlock(fn.body)) { const cut = fn.body.statements.find(returnsHere); jsxFrom = cut ? line(cut.getStart(sf)) : null; } else if (k === 'component') jsxFrom = line(fn.getStart(sf));
      const refs = new Set();
      const collect = (x) => { if (ts.isIdentifier(x)) refs.add(x.text); ts.forEachChild(x, collect); };
      collect(node);
      tops.set(name, { name, kind: k, start: line(node.getStart(sf)), end: line(node.getEnd()), jsxFrom, exported, refs });
    };
    if (ts.isFunctionDeclaration(st)) add(st.name?.text ?? 'default', st, st);
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        let init = d.initializer;
        while (init && ts.isCallExpression(init) && init.arguments[0] && /^(memo|forwardRef|React\.memo|React\.forwardRef)$/.test(init.expression.getText(sf))) init = init.arguments[0];
        add(d.name.text, init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : null, st);
      }
    } else if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) {
      if (st.name) add(st.name.text, null, st);
    }
  }
  const topAt = (ln) => [...tops.values()].find((t) => t.start <= ln && ln <= t.end)?.name ?? null;
  const visit = (n, depth) => {
    const f = isFn(n);
    if (f) fns.push({ name: nameOf(sf, n), start: line(n.getStart(sf)), end: line(n.getEnd()), top: topAt(line(n.getStart(sf))), depth, jsx: hasJsx(n) });
    ts.forEachChild(n, (c) => visit(c, f ? depth + 1 : depth));
  };
  visit(sf, 0);
  return { tops, fns, topAt };
}

/** Where a unit sits: its top-level declaration and its innermost named function. */
function locate(shape, u) {
  if (u.fn === '<module>') {
    const fromDetail = String(u.detail ?? '').replace(/^function\s+/, '').split(',').map((s) => s.trim()).find((n) => shape.tops.has(n));
    return { top: fromDetail ?? shape.topAt(u.line), fn: null };
  }
  const cands = shape.fns.filter((f) => f.name === u.fn && f.start <= u.line && u.line <= f.end).sort((a, b) => (a.end - a.start) - (b.end - b.start));
  const fn = cands[0] ?? null;
  return { top: fn?.top ?? shape.topAt(u.line), fn };
}

// ------------------------------------------------------------------------------------------------- fitting

/**
 * Fit every unit of a logic map into Line's blocks for one route family.
 * @param {{units: import('./contract.mjs').LogicUnit[]} | import('./contract.mjs').LogicUnit[]} map
 * @param {import('./contract.mjs').RouteClosure} closure
 * @param {{feature?: string, shared?: Set<string>}} [o] `shared`: files other routes use too (default: read from the
 *   app's import graph); `feature`: the feature name (default: from the family route).
 * @returns {import('./contract.mjs').FitProposal}
 */
export function fitLogic(map, closure, o = {}) {
  const units = Array.isArray(map) ? map : map.units;
  const feature = o.feature ?? closure.feature ?? familyFeature(closure.routes[0]?.route ?? '/');
  const shared = o.shared ?? sharedFiles(closure);
  const entries = new Set(closure.routes.map((r) => r.entry));
  const sources = new Map();
  const shapes = new Map();
  const shapeOf = (rel) => {
    if (!shapes.has(rel)) {
      let src = '';
      try { src = fs.readFileSync(path.join(closure.appRoot, rel), 'utf8'); } catch { src = ''; }
      sources.set(rel, src);
      shapes.set(rel, src ? readShape(rel, src) : null);
    }
    return shapes.get(rel);
  };

  // Each top-level declaration's unit kinds (what it does, across its nested functions).
  /** @type {Map<string, Set<string>>} */
  const kindsOfTop = new Map();
  /** @type {Map<string, Set<string>>} */
  const kindsOfFn = new Map();
  const placed = units.map((u) => {
    const shape = shapeOf(u.file);
    const at = shape ? locate(shape, u) : { top: null, fn: null };
    const tkey = `${u.file}#${at.top}`;
    if (at.top) { if (!kindsOfTop.has(tkey)) kindsOfTop.set(tkey, new Set()); kindsOfTop.get(tkey).add(u.kind); }
    if (at.fn) { const fk = `${u.file}#${at.fn.name}@${at.fn.start}`; if (!kindsOfFn.has(fk)) kindsOfFn.set(fk, new Set()); kindsOfFn.get(fk).add(u.kind); }
    return { u, shape, ...at };
  });

  /** @type {Map<string, {kind: string, name: string, units: string[], from: Set<string>, files: Set<string>, why: string, meta: any}>} */
  const blocks = new Map();
  /** @type {{unit: string, sentence: string}[]} */
  const unassigned = [];
  const put = (kind, name, p, why, meta = {}) => {
    const k = `${kind}:${name}`;
    if (!blocks.has(k)) blocks.set(k, { kind, name, units: [], from: new Set(), files: new Set(), why, meta });
    const b = /** @type {any} */ (blocks.get(k));
    b.units.push(keyOf(p.u));
    if (p.top) b.from.add(`${p.u.file}#${p.top}`); else b.from.add(p.u.file);
    b.files.add(p.u.file);
    Object.assign(b.meta, meta);
  };
  const flowName = `${pascal(feature)}Flow`;
  // One service or domain block per file, named after it; a second file with the same name adds its folder's name.
  const fileNames = new Map();
  const fileName = (kind, rel) => {
    const k = `${kind}:${rel}`;
    if (fileNames.has(k)) return fileNames.get(k);
    let name = camel(stem(rel));
    const taken = new Set([...fileNames.entries()].filter(([x]) => x.startsWith(`${kind}:`)).map(([, v]) => v));
    if (taken.has(name)) name = `${name}${pascal(posix.basename(posix.dirname(rel)))}`;
    fileNames.set(k, name);
    return name;
  };
  const isPageFile = (rel) => entries.has(rel) || PAGES_DIR.test(rel.replace(/(^|\/)app\//, '$1'));

  for (const p of placed) {
    const { u, shape, top } = p;
    if (!shape) { unassigned.push({ unit: keyOf(u), sentence: `${u.file} could not be read, so Line cannot tell which block ${u.kind} at line ${u.line} belongs to.` }); continue; }
    const t = top ? shape.tops.get(top) : null;
    if (!t) { unassigned.push({ unit: keyOf(u), sentence: `The ${u.kind} at line ${u.line} of ${posix.basename(u.file)} runs at the top of the module, outside any function, so no block owns it yet.` }); continue; }
    const tk = `${u.file}#${t.name}`;
    const kinds = kindsOfTop.get(tk) ?? new Set();
    const fileStem = stem(u.file);
    const isMock = MOCK.test(t.name) || MOCK.test(u.file);
    // A value or function that hands out the file's own components (a toast API over its buttons) belongs with them.
    const usesOwnComponent = t.kind !== 'component' && [...shape.tops.values()].some((o) => o.kind === 'component' && o.name !== t.name && t.refs.has(o.name));
    if (usesOwnComponent) { put(isPageFile(u.file) ? 'page' : 'component', pascal(fileStem), p, 'renders JSX and hands out its own parts', { component: pascal(fileStem), file: u.file }); continue; }
    // 1. service
    if (t.kind !== 'component' && !isMock && t.kind !== 'type' && (ADAPTER_FILE.test(u.file) || ((t.kind === 'hook' || t.kind === 'function') && [...kinds].some((k) => k === 'data' || k === 'io')))) {
      const name = ADAPTER_FILE.test(u.file) ? fileName('service', u.file) : t.name;
      put('service', name, p, ADAPTER_FILE.test(u.file) ? 'adapts the app\'s data' : 'fetches data');
      continue;
    }
    // 2. domain
    if ((t.kind === 'function' || t.kind === 'value' || t.kind === 'type') && !isMock && !URL_STATE.test(t.name) && ![...kinds].some((k) => EFFECT_KINDS.has(k))) {
      put('domain', fileName('domain', u.file), p, 'holds pure rules and transforms');
      continue;
    }
    // 6 (named): sample data is never logic to keep in a service or a domain.
    if (isMock && t.kind !== 'component') { put('fixture', `${camel(fileStem)}Samples`, p, 'is sample data'); continue; }
    if (t.kind === 'component') {
      const compName = t.name === 'default' ? fileStem : t.name;
      const inJsx = u.kind === 'export' || u.fn?.startsWith?.('on:') || (t.jsxFrom !== null && u.line >= t.jsxFrom) || (p.fn && p.fn.jsx && p.fn.depth > 1 && p.fn.name !== t.name);
      const h = p.fn && p.fn.name !== t.name && !String(p.fn.name).startsWith('on:') ? p.fn : null;
      const hKinds = h ? (kindsOfFn.get(`${u.file}#${h.name}@${h.start}`) ?? new Set()) : new Set();
      const goal = h && [...hKinds].some((k) => ORCHESTRATION.has(k));
      const flowComp = [...kinds].some((k) => FLOW_KINDS.has(k));
      // 3. usecase (and 4. workflow, for the flow parts of a component's logic)
      if (!inJsx) {
        if (FLOW_KINDS.has(u.kind) && !goal) { put('workflow', flowName, p, 'is the feature\'s screen flow', { flow: true }); continue; }
        if (u.kind === 'state' && flowComp) { put('workflow', flowName, p, 'is the feature\'s screen flow', { flow: true }); continue; }
        put('usecase', `use${compName}`, p, 'orchestrates data, state and navigation for the component\'s goals', { component: compName, file: u.file });
        continue;
      }
      // 4. workflow: navigation from the JSX (a link or a click that changes view)
      if (FLOW_KINDS.has(u.kind)) { put('workflow', flowName, p, 'is the feature\'s screen flow', { flow: true }); continue; }
      // 5. component or page
      put(isPageFile(u.file) ? 'page' : 'component', compName, p, 'renders JSX with its render-ifs and handlers', { component: compName, file: u.file });
      continue;
    }
    // 3. usecase: a hook or function that orchestrates without fetching itself
    if ((t.kind === 'hook' || t.kind === 'function') && [...kinds].some((k) => ORCHESTRATION.has(k) || k === 'state' || k === 'effect') && !URL_STATE.test(t.name)) {
      put('usecase', t.kind === 'hook' ? t.name : camel(t.name), p, 'orchestrates one user goal');
      continue;
    }
    // 4. workflow: URL state builders and navigation outside components
    if (URL_STATE.test(t.name) || FLOW_KINDS.has(u.kind)) { put('workflow', flowName, p, 'is the feature\'s screen flow', { flow: true }); continue; }
    unassigned.push({ unit: keyOf(u), sentence: `${t.name} in ${posix.basename(u.file)} is a ${t.kind} that none of the fitting rules claims for its ${u.kind}, so a person decides where it goes.` });
  }

  // Sentences: what each block holds and where it comes from.
  const out = [...blocks.values()].map((b) => {
    const files = [...b.files].sort();
    const area = files.every((f) => shared.has(f)) ? 'library' : 'feature';
    const where = files.length === 1 ? posix.basename(files[0]) : `${files.length} files`;
    let extra = '';
    if ((b.kind === 'page' || b.kind === 'component') && b.meta.file) extra = presentationNote(sources.get(b.meta.file) ?? '', b.meta.component, units.filter((u) => b.units.includes(keyOf(u))));
    const areaNote = area === 'library' ? '; other routes use it too, so it goes to the library' : '';
    return {
      kind: /** @type {any} */ (b.kind), name: b.name, units: b.units, from: [...b.from].sort(),
      sentence: `${b.name} is a ${b.kind}: it ${b.why} (${plural(b.units.length, 'unit')} from ${where})${extra}${areaNote}.`,
      area: /** @type {'feature'|'library'} */ (area),
    };
  }).sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.name.localeCompare(b.name));
  return { feature, blocks: out, unassigned };
}

const KIND_RANK = { service: 0, domain: 1, usecase: 2, workflow: 3, page: 4, component: 5, fixture: 6 };

/** A page's or component's presentation in words: its interactive slots (page transformer) and what its JSX branches on. */
function presentationNote(src, component, units) {
  let slots = 0;
  try { slots = transformPristineSource(src, { feature: 'imported', name: component }).slots.length; } catch { slots = 0; }
  const subjects = new Set();
  for (const u of units.filter((x) => x.kind === 'render-if').slice(0, 40)) {
    try { const ast = /** @type {any} */ (parseToAst(`(${u.detail});`)); const s = subjectOf(ast.body[0]?.expression); if (s) subjects.add(s); } catch { /* a detail that is not an expression */ }
  }
  const shown = [...subjects].slice(0, 4);
  return `${slots ? `, ${plural(slots, 'interactive slot')}` : ''}${shown.length ? `, showing parts on ${shown.join(', ')}` : ''}`;
}

/**
 * The closure's files that code outside the family imports too (they go to the library).
 * @param {import('./contract.mjs').RouteClosure} closure
 * @returns {Set<string>}
 */
export function sharedFiles(closure) {
  const inside = new Set(closure.files);
  const graph = importGraph(closure.appRoot, listFiles(closure.appRoot));
  // The route table (a react-spa src/App.tsx) imports every route entry only to route to it: that is not another
  // route using the file.
  let table = null;
  try { table = path.relative(closure.appRoot, findReactSpaRoutesFile(closure.appRoot)).split(path.sep).join('/'); } catch { table = null; }
  const entries = new Set(closure.routes.map((r) => r.entry));
  const out = new Set();
  for (const f of closure.files) if ([...(graph.importers.get(f) ?? [])].some((u) => !inside.has(u) && !(u === table && entries.has(f)))) out.add(f);
  return out;
}

// ------------------------------------------------------------------------------------------------- planning

/**
 * The proposal as plan steps, in an order where each builds on the one before: services, domains and usecases moved
 * out of their files, then the feature's workflow (read from a component's flow), then each page's or component's logic
 * split into its hook.
 * @param {import('./contract.mjs').FitProposal} proposal
 * @param {{folder: string, closure: import('./contract.mjs').RouteClosure, typedContracts?: string}} o `folder`: the
 *   import folder (app-relative); block files outside it are left for a person.
 * @returns {{steps: import('./contract.mjs').FitStep[], skipped: {block: string, sentence: string}[]}}
 */
export function planFitSteps(proposal, { folder, closure, typedContracts }) {
  const f = folder.replace(/\/+$/, '');
  const inFolder = (rel) => rel.startsWith(`${f}/`);
  const local = (rel) => rel.slice(f.length + 1);
  /** @type {import('./contract.mjs').FitStep[]} */
  const steps = [];
  const skipped = [];
  const add = (tool, args, sentence, blocks) => steps.push({ id: `fit-${steps.length + 1}`, tool, args: { folder: f, ...args }, sentence, blocks });
  const toolOf = { service: 'line.import.extractService', domain: 'line.import.extractDomain', usecase: 'line.import.extractUsecase' };
  const claimedNames = new Map();
  for (const b of proposal.blocks.filter((x) => x.kind === 'service' || x.kind === 'domain' || (x.kind === 'usecase' && !fromComponent(x)))) {
    const byFile = new Map();
    for (const fr of b.from) { const [file, name] = fr.split('#'); if (!name) continue; if (!byFile.has(file)) byFile.set(file, new Set()); byFile.get(file).add(name); }
    for (const [file, names] of byFile) {
      if (!inFolder(file)) { skipped.push({ block: `${b.kind}:${b.name}`, sentence: `${posix.basename(file)} is outside ${f}, so ${b.name} stays where it is.` }); continue; }
      const key = `${file}`;
      const taken = claimedNames.get(key) ?? new Set();
      const own = [...names].filter((n) => !taken.has(n)).sort();
      own.forEach((n) => taken.add(n));
      claimedNames.set(key, taken);
      if (!own.length) continue;
      const name = byFile.size > 1 ? `${b.name}${pascal(stem(file))}` : b.name;
      add(toolOf[b.kind], { from: local(file), names: own, name, ...(b.area === 'library' ? {} : { feature: proposal.feature }), ...(typedContracts && b.kind !== 'usecase' ? { typedContracts } : {}) },
        `Moves ${own.length === 1 ? own[0] : `${own.length} functions`} of ${posix.basename(file)} into the ${b.kind} ${name}${b.area === 'library' ? ' in the library' : ` of feature ${proposal.feature}`}.`, [`${b.kind}:${b.name}`]);
    }
  }
  // The workflow reads the component's flow before splitPage moves that logic into the hook.
  for (const b of proposal.blocks.filter((x) => x.kind === 'workflow')) {
    // The component the flow comes from: the one whose file holds most of the workflow's units.
    const counts = new Map();
    for (const fr of b.from) { const [file, comp] = fr.split('#'); if (comp && PASCAL.test(comp)) counts.set(fr, (counts.get(fr) ?? 0) + 1); }
    const best = [...counts.keys()].find((fr) => entryOf(closure, fr)) ?? [...counts.keys()][0];
    if (!best) { skipped.push({ block: `workflow:${b.name}`, sentence: `${b.name} has no component to read its screen flow from, so a person draws it.` }); continue; }
    const [file, component] = best.split('#');
    if (!inFolder(file)) { skipped.push({ block: `workflow:${b.name}`, sentence: `${posix.basename(file)} is outside ${f}, so ${b.name} is not made.` }); continue; }
    add('line.import.extractWorkflow', { from: local(file), component, name: b.name, feature: proposal.feature },
      `Makes the workflow ${b.name} from ${component}'s URL state and navigation, in the library with feature ${proposal.feature}'s workflow based on it.`, [`workflow:${b.name}`]);
  }
  for (const b of proposal.blocks.filter((x) => x.kind === 'usecase' && fromComponent(x))) {
    const fr = b.from.find((x) => x.includes('#')) ?? '';
    const [file, component] = fr.split('#');
    if (!file || !inFolder(file)) { skipped.push({ block: `usecase:${b.name}`, sentence: `${b.name}'s component is outside ${f}, so its logic stays where it is.` }); continue; }
    add('line.import.splitPage', { from: local(file), component: component === 'default' ? stem(file) : component, name: b.name, ...(b.area === 'library' ? {} : { feature: proposal.feature }) },
      `Splits ${component}: its logic moves into the usecase ${b.name}${b.area === 'library' ? ' in the library' : ` of feature ${proposal.feature}`}, and ${component} keeps what it renders.`, [`usecase:${b.name}`]);
  }
  for (const b of proposal.blocks.filter((x) => x.kind === 'page' || x.kind === 'component' || x.kind === 'fixture')) {
    skipped.push({ block: `${b.kind}:${b.name}`, sentence: `${b.name} stays in its file for now; Import's route plan (planImport with {route}) moves it into ${b.area === 'library' ? 'the library' : `feature ${proposal.feature}`}'s ${KIND_FOLDER[b.kind]}.` });
  }
  return { steps, skipped };
}

/** True when a usecase block is a component's logic (its code sits in a PascalCase component: line.import.splitPage),
 * not a hook or function of its own (line.import.extractUsecase). */
function fromComponent(b) {
  return b.from.some((fr) => PASCAL.test(fr.split('#')[1] ?? '') || /#default$/.test(fr));
}

/** True when `file#name` is (or is rendered by) a route entry of the closure. */
function entryOf(closure, fr) {
  const [file] = fr.split('#');
  const dirs = new Set(closure.routes.map((r) => posix.dirname(r.entry)));
  return dirs.has(posix.dirname(file));
}

/**
 * The folder a route-seeded import works in: the deepest folder holding every closure file (app-relative).
 * @param {import('./contract.mjs').RouteClosure} closure
 * @returns {string}
 */
export const closureFolder = (closure) => commonFolder(closure.files);
