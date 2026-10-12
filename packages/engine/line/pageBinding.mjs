// cu5 -- a page's two bindings, side by side (contract.mjs LinePageBinding). Morpheus binds each part of a feature page
// to a library component (the page tree, its props, the base links); Trace binds the same parts to API data: Trace's
// page map (inventory, states, interactions, the contract's example data) and its wiring of every interaction to an API
// endpoint, a controller function or a marked stub. Trace's engine is reused through its package entry
// (tracePagemap.mjs, `line-matcher/pagemap`); nothing of it is copied here.
//
//   readPageBinding(root, file)              LinePageBinding: parts with their library base, data source and states,
//                                            the interactions and how each resolves, unresolved ones as findings with
//                                            typed fixes (line.bindInteraction steps)
//   planBindPart(root, BindPartRequest)      line.bindPart: the part becomes the library component (its tag, or the
//                                            import its name comes from, now points at the library)
//   planBindInteraction(root, BindInteractionRequest)  line.bindInteraction: Trace's own marker on the part
//                                            (data-action="<verb>" for an endpoint or a controller), or a marked stub
//                                            handler `(event) => {}`
//
// Pure: both planners read the page and return a StagedChange, or throw a LineOpError; the write happens only in
// applyChange, through Construct's writer, after a person approves the plan step (planTools.mjs). When Trace's page map
// cannot be loaded, the binding keeps Morpheus's side and says so in one sentence (`via: 'static'`).
import fs from 'node:fs';
import path from 'node:path';
import { parseToAst } from '@construct/ast';
import { loadConfig } from '@line/construct-core/config';
import { normalizeLineConfig } from '@line/construct-core/profiles/line/contract';
import { resolveLayout } from '@line/construct-core/profiles/line/checks';
import { parsePageTree, hashOf } from '../pagesEditor.mjs';
import { LineOpError } from './contract.mjs';
import { readPageSource, planSetProp } from './pageProp.mjs';
import { loadTracePagemap } from './tracePagemap.mjs';

/** Trace's page map, loaded once when this module loads (the planners are synchronous). */
const TRACE = await loadTracePagemap();

/** The verb Trace's matcher reads for each endpoint role (match.mjs VERBS; the role is findEndpoints'). */
export const ROLE_VERB = Object.freeze({ list: 'reload', create: 'create', update: 'update', remove: 'delete' });
/** The roles each verb kind needs (match.mjs NEEDS), to name the endpoint an `api` interaction calls. */
const KIND_ROLES = Object.freeze({ create: ['create'], update: ['update'], save: ['create', 'update'], remove: ['remove'], reload: ['list'] });
/** The controller verbs a person can bind an interaction to (match.mjs: no API call). */
export const CONTROLLER_VERBS = Object.freeze({ select: 'select this item (no API call)', clear: 'clear the selection (no API call)' });
/** The stub Trace recognises as "a marked stub to write" (interactions.mjs handlerStub: an unused input). */
export const STUB_HANDLER = '(event) => {}';
const ROLE_WORDS = Object.freeze({ list: 'reload the list', create: 'create a new item', update: 'update the selected item', remove: 'delete this item', summary: 'read the summary', extra: 'another endpoint' });
/** Verbs that read like "load more of the list": their recommended home is the list endpoint. */
const LOAD_WORDS = /^(more|load|loadmore|show|showmore|view|next|refresh|reload|fetch|list)$/i;
const CODE_EXT = ['.tsx', '.ts', '.jsx', '.js', '.mjs'];
/** Props whose text a person reads (the data side looks for API values in these, never in classes or icons). */
const TEXT_PROPS = new Set(['title', 'label', 'text', 'heading', 'subtitle', 'description', 'message', 'placeholder', 'alt', 'aria-label', 'helpText', 'value']);
const KIND_WORD = Object.freeze({ components: 'component', pages: 'page', workflows: 'workflow', fixtures: 'fixture' });

const sentence = (s) => { const t = String(s ?? '').trim(); return /[.?!]$/.test(t) ? t : `${t}.`; };
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const posix = (p) => p.split(path.sep).join('/');
const handlerWords = (prop) => prop.replace(/^on/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
const pageName = (file) => path.basename(file).replace(/\.[^.]+$/, '');

/** The project's Line layout (library and features folders). */
function layoutOf(root) {
  return resolveLayout(root, normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line));
}

/** The library components a part can be bound to: `components/<Name>` for every code file in `<library>/components`. */
function libraryComponents(root, library) {
  const dir = path.join(root, library, 'components');
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => CODE_EXT.includes(path.extname(f)) && !/\.(test|spec|stories)\./.test(f)); } catch { names = []; }
  return names.map((f) => ({ id: `components/${pageName(f)}`, name: pageName(f), file: `${library}/components/${f}` })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Every top-level import of the page: local name -> where it comes from, and the declaration it sits in. */
function importsOf(source) {
  /** @type {Map<string, {from: string, imported: string, decl: any}>} */
  const out = new Map();
  let ast;
  try { ast = parseToAst(source); } catch { return { map: out, decls: [] }; }
  const decls = ast.body.filter((n) => n.type === 'ImportDeclaration');
  for (const d of decls) {
    for (const s of d.specifiers) {
      const imported = s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportNamespaceSpecifier' ? '*' : (s.imported.name ?? s.imported.value);
      out.set(s.local.name, { from: d.source.value, imported, decl: d });
    }
  }
  return { map: out, decls };
}

/** A specifier resolved to a root-relative code file, or null (a package, or nothing there). */
function resolveSpecifier(root, pageFile, spec) {
  let bases = [];
  if (spec.startsWith('.')) bases = [path.resolve(root, path.dirname(pageFile), spec)];
  else if (spec.startsWith('@/')) bases = [path.join(root, 'src', spec.slice(2)), path.join(root, spec.slice(2))];
  for (const b of bases) {
    for (const c of [b, ...CODE_EXT.map((e) => b + e), ...CODE_EXT.map((e) => path.join(b, `index${e}`))]) {
      try { if (fs.statSync(c).isFile()) return posix(path.relative(root, c)); } catch { /* try the next */ }
    }
  }
  return null;
}

/** The base link (`// @line-base <kind>/<Name>`) at the top of a file, or null. */
function baseLinkOf(root, rel) {
  try { return /^\s*\/\/\s*@line-base\s+(\S+)/m.exec(fs.readFileSync(path.join(root, rel), 'utf8').split('\n').slice(0, 5).join('\n'))?.[1] ?? null; } catch { return null; }
}

/**
 * Morpheus's side of one part: which library component it is, or why it is not one.
 * @returns {import('./contract.mjs').PartBase}
 */
function baseOf(root, file, layout, feature, tag, imports, source) {
  if (!tag || tag === 'Fragment') return { kind: 'html', libraryId: null, from: null, sentence: 'A fragment groups the parts inside it.' };
  if (/^[a-z]/.test(tag)) return { kind: 'html', libraryId: null, from: null, sentence: `A plain <${tag}> element, not a library component.` };
  const name = tag.split('.')[0];
  const imp = imports.get(name);
  if (!imp) {
    const local = new RegExp(`(function|const|let|class)\\s+${name}\\b`).test(source);
    return { kind: local ? 'local' : 'outside', libraryId: null, from: null, sentence: local ? `${name} is written inside this page, not taken from the library.` : `${name} is not imported, so it is not a library component.` };
  }
  const rel = resolveSpecifier(root, file, imp.from);
  if (rel && rel.startsWith(`${layout.library}/`)) {
    const [kind] = rel.slice(layout.library.length + 1).split('/');
    const libraryId = `${kind}/${pageName(rel)}`;
    const word = KIND_WORD[kind] ?? kind.replace(/s$/, '');
    const part = tag.includes('.') ? `${tag} is part of the library ${word} ${name}` : `The library ${word} ${name}`;
    return { kind: 'library', libraryId, from: rel, sentence: `${part} (${libraryId}).` };
  }
  if (rel && rel.startsWith(`${layout.features}/`)) {
    const owner = rel.slice(layout.features.length + 1).split('/')[0];
    const base = baseLinkOf(root, rel);
    const where = owner === feature ? `this feature's ${name}` : `${name} from the feature ${owner}`;
    return { kind: 'feature', libraryId: base, from: rel, sentence: base ? `${cap(where)}, based on the library ${base.split('/')[1]}.` : `${cap(where)}, which has no library base.` };
  }
  return { kind: 'outside', libraryId: null, from: imp.from, sentence: `${tag.includes('.') ? `${tag} is part of ${name}, which` : name} comes from ${imp.from}, not from your library.` };
}

/** One endpoint of the contract as the screen lists it. */
function endpointsOf(pm, spec) {
  if (!spec?.contract?.usable) return { list: [], byRole: {} };
  const found = pm.findEndpoints(spec.apis, spec.list);
  const roleOf = new Map();
  for (const r of ['list', 'create', 'update', 'remove', 'summary']) if (found[r]) roleOf.set(found[r], r);
  for (const e of found.extra ?? []) if (!roleOf.has(e)) roleOf.set(e, 'extra');
  const list = spec.apis.map((a) => { const role = roleOf.get(a) ?? 'extra'; return { id: `${a.method} ${a.path}`, method: a.method, path: a.path, role, says: ROLE_WORDS[role] }; });
  const byRole = Object.fromEntries(list.filter((e) => e.role !== 'extra').map((e) => [e.role, e]));
  return { list, byRole };
}

/** The contract line: what Trace has to bind this feature's actions to. */
function contractView(feature, spec, endpoints, traceOk) {
  if (!traceOk) return { file: null, state: /** @type {const} */ ('none'), sentence: 'Trace is not available, so the API contract was not read.', endpoints: [] };
  const c = spec?.contract;
  if (!c || c.state === 'none') return { file: null, state: /** @type {const} */ ('none'), sentence: `${feature} has no API contract yet; add its openapi.json beside spec.md so Trace can bind this page's actions to endpoints.`, endpoints: [] };
  if (!c.usable) return { file: c.file, state: c.state, sentence: sentence(c.notice ?? `The API contract ${c.file} cannot be used`), endpoints: [] };
  return { file: c.file, state: /** @type {const} */ ('ok'), sentence: `The API contract of ${feature} (${c.file}) has ${endpoints.length} endpoint${endpoints.length === 1 ? '' : 's'}.`, endpoints };
}

/** A state record (Trace states.mjs) in plain English. */
function stateView(s) {
  const kind = s.stateKind === 'conditional' ? 'Shown' : cap(s.stateKind);
  const cond = String(s.condition).replace(/\s+/g, ' ').slice(0, 80);
  const text = s.source === 'text' ? `${kind}: its text says so (${cond}).` : s.stateKind === 'conditional' ? `Shown only when ${cond}.` : s.source === 'conditional' ? `${kind} state: shown only when ${cond}.` : `${kind} when ${cond}.`;
  return { id: s.id, kind: s.stateKind, condition: String(s.condition), sentence: text, team: s.team, requirement: s.requirement };
}

/**
 * Trace's side of one part: the data it shows (a list, a value, an input, static text, nothing).
 * @returns {import('./contract.mjs').PartData}
 */
function dataOf(pm, inv, invNode, proposals, matcher, part, endpoints) {
  const listEp = endpoints.byRole.list?.id ?? null;
  const p = invNode ? proposals[invNode.id] : null;
  if (p?.cls === 'list') return { kind: 'list', endpoint: listEp, field: p.name ?? null, sentence: `Shows a list${p.name ? ` (${p.name})` : ''}${listEp ? ` from ${listEp}` : ''}.` };
  if (invNode?.kind === 'input') { const name = p?.name ?? (typeof invNode.props?.name === 'string' ? invNode.props.name : null); return { kind: 'input', endpoint: null, field: name, sentence: `Takes input${name ? ` (${name})` : ''}.` }; }
  const own = invNode ? invNode.children.map((id) => inv.byId.get(id)).filter((c) => c?.kind === 'text' && c.textKind !== 'attribute') : [];
  const dyn = own.find((t) => proposals[t.id]?.cls === 'dynamic');
  const texts = [...own.map((t) => t.text), ...part.props.filter((x) => x.kind === 'string' && typeof x.value === 'string' && TEXT_PROPS.has(x.name ?? '')).map((x) => /** @type {string} */ (x.value))];
  const hit = matcher ? texts.map((t) => matcher.lookup(t)[0]).find(Boolean) : null;
  if (hit) return { kind: 'value', endpoint: listEp, field: hit.field, sentence: `Shows ${hit.field}${listEp ? ` of ${listEp}` : ''}.` };
  if (dyn) { const name = proposals[dyn.id]?.name ?? null; return { kind: 'value', endpoint: null, field: name, sentence: `Shows a value${name ? ` (${name})` : ''} that is not bound to the API yet.` }; }
  if (texts.length) return { kind: 'static', endpoint: null, field: null, sentence: 'Static text, no data.' };
  return { kind: 'none', endpoint: null, field: null, sentence: 'No data.' };
}

/** The endpoint an `api` interaction calls (the first role its verb kind needs). */
function endpointFor(kind, endpoints) {
  for (const r of KIND_ROLES[kind] ?? []) if (endpoints.byRole[r]) return endpoints.byRole[r].id;
  return null;
}

/** One interaction in plain English. */
function interactionSentence(label, r, endpoint) {
  if (r.resolution === 'api') return `"${label}" calls ${endpoint ?? 'the API'} (${r.detail.replace(/ \((GET|POST|PUT|DELETE|POST \/ PUT)\)$/, '')}).`;
  if (r.resolution === 'controller') return `"${label}" is handled on the page: ${r.detail}.`;
  if (r.resolution === 'stub') return `"${label}" has ${r.detail}.`;
  return `"${label}" has no home yet: ${r.detail}.`;
}

/** The typed fixes of an unresolved interaction, recommended first. */
function fixesFor(file, it, endpoints) {
  const step = (args) => ({ tool: /** @type {const} */ ('line.bindInteraction'), args: { file, interactionId: it.id, ...args } });
  const out = [];
  for (const role of ['list', 'create', 'update', 'remove']) {
    const e = endpoints.byRole[role];
    if (!e) continue;
    const words = ROLE_VERB[role] === 'reload' ? LOAD_WORDS.test(it.verb) : new RegExp(`^${ROLE_VERB[role]}|^${role}`, 'i').test(it.verb);
    out.push({ id: `endpoint:${e.id}`, sentence: `Bind "${it.label}" to ${e.id} (${e.says}).`, score: words ? 3 : role === 'list' ? 1 : 0, step: step({ to: 'endpoint', endpoint: e.id }) });
  }
  if (it.handler !== 'function') out.push({ id: 'stub', sentence: `Give "${it.label}" a marked stub to write later: ${STUB_HANDLER}.`, score: endpoints.list.length ? 0.5 : 2, step: step({ to: 'stub' }) });
  for (const [verb, says] of Object.entries(CONTROLLER_VERBS)) out.push({ id: `controller:${verb}`, sentence: `Handle "${it.label}" on the page as a controller function: ${says}.`, score: /^(select|open|edit|cancel|close|reset|clear)/i.test(it.verb) ? 2.5 : -1, step: step({ to: 'controller', verb }) });
  return out
    .map((f, i) => ({ ...f, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ score: _s, i: _i, ...f }, n) => ({ ...f, rank: n + 1 }));  
}

/**
 * A feature page's two bindings: each part with its library base (Morpheus) and its data source and states (Trace),
 * every interaction and how it resolves, and the unresolved ones as findings with typed fixes.
 * @param {string} root Project root.
 * @param {string} file Root-relative feature page path.
 * @param {{trace?: import('./tracePagemap.mjs').TraceLoad}} [o] `trace` replaces the loaded page map (tests).
 * @returns {import('./contract.mjs').LinePageBinding}
 * @throws {LineOpError} UNKNOWN_ITEM when there is no such page or it does not parse.
 */
export function readPageBinding(root, file, o = {}) {
  const { feature, source } = readPageSource(root, file);
  let tree;
  try { tree = parsePageTree(source); } catch { throw new LineOpError(`The page "${file}" does not parse, so its parts cannot be bound until it is fixed.`, 'UNKNOWN_ITEM'); }
  const layout = layoutOf(root);
  const { map: imports } = importsOf(source);
  const trace = o.trace ?? TRACE;
  const pm = trace.ok ? trace.pagemap : null;

  // Trace's page map of the same source; its element nodes are matched to the page-tree parts by source offset.
  let inv = null, proposals = {}, traced = [], spec = null, matcher = null, note = trace.ok ? null : /** @type {{sentence: string}} */ (trace).sentence;
  if (pm) {
    try {
      spec = pm.specOfFolder(path.join(root, layout.features, feature));
      inv = pm.buildInventory(source, { file: path.basename(file) });
      matcher = pm.contractMatcher(spec);
      proposals = pm.classify(inv, pm.collapse(inv), source, { contract: matcher }).proposals;
      traced = pm.resolveInteractions(inv, source, proposals, spec);
    } catch {
      inv = null; proposals = {}; traced = []; note = 'Trace could not read this page, so only the library side of it is shown.';
    }
  }
  const usable = pm && inv ? pm.usableSpec(spec) : null;
  const endpoints = pm && inv ? endpointsOf(pm, spec) : { list: [], byRole: {} };
  const invAt = new Map((inv?.nodes ?? []).filter((n) => n.kind !== 'text' && n.id !== 'root').map((n) => [n.start, n]));
  const tracedById = new Map(traced.map((t) => [t.id, t]));

  /** @type {import('./contract.mjs').PagePartBinding[]} */
  const parts = [];
  /** @type {import('./contract.mjs').PageInteraction[]} */
  const interactions = [];
  const partOfInv = new Map();
  const walk = (node, depth) => {
    if (!node.isFragment) {
      const invNode = invAt.get(node.start) ?? null;
      if (invNode) partOfInv.set(invNode.id, node.id);
      const part = { id: node.id, tag: node.tag, depth, line: node.line, base: baseOf(root, file, layout, feature, node.tag, imports, source), data: /** @type {any} */ (null), states: [], interactions: [] };
      if (inv) part.data = dataOf(pm, inv, invNode, proposals, matcher, node, endpoints);
      else part.data = { kind: 'none', endpoint: null, field: null, sentence: 'Not read: Trace is not available.' };
      // Interactions: Trace's own (a button, a link, a form), else a component's handler prop (onMore) resolved the same way.
      const own = invNode ? tracedById.get(invNode.id) : null;
      const handlerProp = node.props.find((x) => x.name && /^on[A-Z]/.test(x.name));
      if (inv && (own || (node.isCustomComponent && handlerProp))) {
        const prop = own ? (node.props.find((x) => x.name === 'onClick' || x.name === 'onSubmit')?.name ?? null) : handlerProp.name;
        const action = node.props.find((x) => x.name === 'data-action' && x.kind === 'string')?.value;
        const r = own ?? { ...pm.resolveAction({ verb: typeof action === 'string' ? action : handlerWords(handlerProp.name).replace(/\s+/g, '').replace(/^./, (c) => c.toLowerCase()), element: node.tag, handlerText: `${handlerProp.name}={${handlerProp.value}}` }, usable), label: handlerWords(handlerProp.name) };
        const kind = own ? (pm.resolveAction({ verb: own.verb, element: node.tag, handlerText: '' }, usable).kind) : r.kind;
        const endpoint = r.resolution === 'api' ? endpointFor(kind, endpoints) : null;
        const label = String(r.label || node.tag).slice(0, 40);
        const id = `${node.id}:${prop ?? 'self'}`;
        interactions.push({ id, partId: node.id, prop, label, verb: r.verb, handler: r.handler, resolution: r.resolution, endpoint, sentence: interactionSentence(label, r, endpoint) });
        part.interactions.push(id);
      }
      parts.push(part);
    }
    for (const c of node.children) walk(c, node.isFragment ? depth : depth + 1);
  };
  for (const r of tree.roots) walk(r, 0);

  // States: Trace's state records, each on the part it affects (a text's state goes to the element holding it).
  for (const s of inv?.states ?? []) {
    let n = inv.byId.get(s.target);
    while (n && !partOfInv.has(n.id)) n = n.parent ? inv.byId.get(n.parent) : null;
    const part = n ? parts.find((p) => p.id === partOfInv.get(n.id)) : null;
    if (part) part.states.push(stateView(s));
  }

  const findings = interactions.filter((i) => i.resolution === 'unresolved').map((i) => {
    const part = parts.find((p) => p.id === i.partId);
    return { key: `${file}|${i.id}`, partId: i.partId, interactionId: i.id, sentence: sentence(`${i.label} on ${part?.tag} is not bound to the API: ${i.sentence.replace(/^"[^"]*" has no home yet: /, '').replace(/\.$/, '')}`), fixes: fixesFor(file, i, endpoints) };
  });
  const coverage = pm ? pm.interactionCoverage(interactions) : { total: interactions.length, api: 0, controller: 0, stub: 0, unresolved: 0, rate: 100, resolvedStrict: 0, rateStrict: 100 };
  const { resolvedStrict: _r, rateStrict: _s, ...cov } = coverage;  
  return {
    file, feature, page: pageName(file), contentHash: hashOf(source),
    via: inv ? 'trace' : 'static', note,
    contract: contractView(feature, spec, endpoints.list, !!(pm && inv)),
    parts, interactions, findings, coverage: cov,
    components: libraryComponents(root, layout.library).map(({ id, name }) => ({ id, name })),
  };
}

/** The binding again, refusing a stale request (`contentHash` from the binding the person looked at). */
function freshBinding(root, file, contentHash, o) {
  const b = readPageBinding(root, file, o);
  if (contentHash !== undefined && contentHash !== b.contentHash) throw new LineOpError(`The page ${b.page} changed since you opened it; reload it and try again.`, 'STALE');
  return b;
}

/**
 * Stage binding one interaction: to an endpoint of the feature's contract or a controller verb (Trace's own marker,
 * `data-action="<verb>"`, on the part), or to a marked stub handler. Pure.
 * @param {string} root
 * @param {import('./contract.mjs').BindInteractionRequest} req
 * @param {{trace?: import('./tracePagemap.mjs').TraceLoad}} [o]
 * @returns {import('./contract.mjs').StagedChange}
 * @throws {LineOpError} UNKNOWN_ITEM, BAD_REQUEST, UNKNOWN_ENDPOINT, HAS_CODE, STALE, NO_TRACE.
 */
export function planBindInteraction(root, { file, interactionId, to, endpoint, verb, contentHash } = /** @type {any} */ ({}), o = {}) {
  const b = freshBinding(root, file, contentHash, o);
  if (b.via !== 'trace') throw new LineOpError(`${b.note ?? 'Trace is not available'} Binding an action needs it.`.replace(/\.\s+Binding/, '; binding').replace(/\.$/, '') + '.', 'NO_TRACE');
  const it = b.interactions.find((i) => i.id === interactionId);
  if (!it) throw new LineOpError(`The page ${b.page} has no action "${interactionId}"; reload the page and pick it again.`, 'UNKNOWN_ITEM');
  const part = /** @type {import('./contract.mjs').PagePartBinding} */ (b.parts.find((p) => p.id === it.partId));
  const where = `"${it.label}" on ${part.tag} in the page ${b.page}`;
  const mark = (value, summary) => ({ summary, files: planSetProp(root, { file, nodeId: it.partId, prop: 'data-action', kind: 'string', value }).files });
  if (to === 'endpoint') {
    const e = b.contract.endpoints.find((x) => x.id === endpoint);
    if (!e) throw new LineOpError(b.contract.state === 'ok' ? `${b.feature}'s API contract has no endpoint "${endpoint}"; pick one of ${b.contract.endpoints.map((x) => x.id).join(', ')}.` : b.contract.sentence, 'UNKNOWN_ENDPOINT');
    const v = ROLE_VERB[e.role];
    if (!v) throw new LineOpError(`${e.id} is not one a page action can call (only the list, create, update and delete endpoints are); pick another.`, 'UNKNOWN_ENDPOINT');
    return mark(v, `Binds ${where} to ${e.id} (${e.says}).`);
  }
  if (to === 'controller') {
    if (!Object.hasOwn(CONTROLLER_VERBS, verb ?? '')) throw new LineOpError(`A controller action is one of ${Object.keys(CONTROLLER_VERBS).join(' or ')}; "${verb ?? ''}" is not.`, 'BAD_REQUEST');
    return mark(/** @type {string} */ (verb), `Binds ${where} to a controller function: ${CONTROLLER_VERBS[/** @type {'select'|'clear'} */ (verb)]}.`);
  }
  if (to === 'stub') {
    if (it.handler === 'function') throw new LineOpError(`${cap(where)} already runs code; bind it to an endpoint or a controller, or change its code with Edit code.`, 'HAS_CODE');
    const prop = it.prop ?? 'onClick';
    return { summary: `Gives ${where} a marked stub to write later (${prop}).`, files: planSetProp(root, { file, nodeId: it.partId, prop, kind: 'expression', value: STUB_HANDLER }).files };
  }
  throw new LineOpError('Say what to bind the action to: an endpoint, a controller or a stub.', 'BAD_REQUEST');
}

/** `import ... from '<rel>'` for a library component, in the style its file exports it. */
function importLine(root, pageFile, lib) {
  let spec = posix(path.relative(path.dirname(path.join(root, pageFile)), path.join(root, lib.file))).replace(/\.[^.]+$/, '');
  if (!spec.startsWith('.')) spec = `./${spec}`;
  let text = '';
  try { text = fs.readFileSync(path.join(root, lib.file), 'utf8'); } catch { /* named by default */ }
  const named = new RegExp(`export\\s+(function|const|class)\\s+${lib.name}\\b|export\\s*\\{[^}]*\\b${lib.name}\\b`).test(text);
  return { spec, text: named || !/export\s+default/.test(text) ? `import { ${lib.name} } from '${spec}';` : `import ${lib.name} from '${spec}';` };
}

/** The declaration rebuilt without one of its names (simple specifiers only). */
function withoutSpecifier(source, decl, local) {
  const keep = decl.specifiers.filter((s) => s.local.name !== local);
  const def = keep.find((s) => s.type === 'ImportDefaultSpecifier');
  const ns = keep.find((s) => s.type === 'ImportNamespaceSpecifier');
  const named = keep.filter((s) => s.type === 'ImportSpecifier').map((s) => source.slice(s.range[0], s.range[1]));
  const parts = [def?.local.name, ns ? source.slice(ns.range[0], ns.range[1]) : null, named.length ? `{ ${named.join(', ')} }` : null].filter(Boolean);
  return `import ${parts.join(', ')} from ${source.slice(decl.source.range[0], decl.source.range[1])};`;
}

/**
 * Stage binding one part to a library component. A part whose name is the component's (a `Button` imported from
 * somewhere else) gets its import pointed at the library; any other part (a plain element, another component) is
 * replaced by the library component, which the page then imports. Pure.
 * @param {string} root
 * @param {import('./contract.mjs').BindPartRequest} req
 * @returns {import('./contract.mjs').StagedChange}
 * @throws {LineOpError} UNKNOWN_ITEM, BAD_PART, ALREADY_BOUND, NAME_TAKEN, STALE.
 */
export function planBindPart(root, { file, partId, libraryId, contentHash } = /** @type {any} */ ({})) {
  const { source } = readPageSource(root, file);
  const page = pageName(file);
  if (contentHash !== undefined && contentHash !== hashOf(source)) throw new LineOpError(`The page ${page} changed since you opened it; reload it and try again.`, 'STALE');
  const layout = layoutOf(root);
  const lib = libraryComponents(root, layout.library).find((c) => c.id === libraryId);
  if (!lib) throw new LineOpError(`The library has no component "${libraryId}"; pick one of its components.`, 'UNKNOWN_ITEM');
  let tree;
  try { tree = parsePageTree(source); } catch { throw new LineOpError(`The page "${file}" does not parse, so its parts cannot be bound until it is fixed.`, 'UNKNOWN_ITEM'); }
  const node = typeof partId === 'string' ? tree.byId.get(partId) : undefined;
  if (!node) throw new LineOpError(`The page ${page} has no part "${partId}"; reload the page and pick it again.`, 'UNKNOWN_ITEM');
  if (node.isFragment) throw new LineOpError('A fragment (<>...</>) is not a part to bind; pick a part inside it.', 'BAD_PART');
  if (node.tag.includes('.')) throw new LineOpError(`${node.tag} is a piece of ${node.tag.split('.')[0]}; bind ${node.tag.split('.')[0]} itself instead.`, 'BAD_PART');
  const { map: imports } = importsOf(source);
  const base = baseOf(root, file, layout, readPageSource(root, file).feature, node.tag, imports, source);
  if (base.kind === 'library' && base.libraryId === libraryId) throw new LineOpError(`${node.tag} in the page ${page} is already the library component ${lib.name}.`, 'ALREADY_BOUND');
  const line = importLine(root, file, lib);
  const own = imports.get(lib.name);
  const ownIsLib = own && resolveSpecifier(root, file, own.from) === lib.file;

  /** @type {{start: number, end: number, text: string}[]} */
  const edits = [];
  let summary;
  if (node.tag === lib.name) {
    // The page's own Button comes from elsewhere: point that import at the library (every Button here follows).
    if (!own) throw new LineOpError(`${node.tag} is written inside this page; rename it before binding it to the library ${lib.name}.`, 'NAME_TAKEN');
    const d = own.decl;
    edits.push({ start: d.range[0], end: d.range[1], text: d.specifiers.length === 1 ? line.text : `${withoutSpecifier(source, d, lib.name)}\n${line.text}` });
    const uses = [...tree.byId.values()].filter((n) => n.tag === lib.name).length;
    summary = `Points ${lib.name} in the page ${page} at the library component ${lib.name}${uses > 1 ? ` (all ${uses} ${lib.name} parts on this page)` : ''}, instead of ${own.from}.`;
  } else {
    if (own && !ownIsLib) throw new LineOpError(`The page ${page} already uses another ${lib.name} (from ${own.from}); bind that part first.`, 'NAME_TAKEN');
    const open = node.start + 1;
    edits.push({ start: open, end: open + node.tag.length, text: lib.name });
    const close = `</${node.tag}>`;
    if (source.slice(node.end - close.length, node.end) === close) edits.push({ start: node.end - close.length + 2, end: node.end - 1, text: lib.name });
    if (!own) {
      const last = [...importsOf(source).decls].pop();
      edits.push(last ? { start: last.range[1], end: last.range[1], text: `\n${line.text}` } : { start: 0, end: 0, text: `${line.text}\n` });
    }
    summary = `Replaces ${/^[a-z]/.test(node.tag) ? `the <${node.tag}> element` : node.tag} in the page ${page} with the library component ${lib.name}.`;
  }
  let content = source;
  for (const e of edits.sort((a, b) => b.start - a.start)) content = content.slice(0, e.start) + e.text + content.slice(e.end);
  try { parsePageTree(content); } catch { throw new LineOpError(`Binding ${node.tag} to ${lib.name} would leave the page unparseable, so nothing was planned.`, 'BAD_PART'); }
  return { summary, files: [{ path: file, content }] };
}

/** The cu5 operations (LineOps). */
export const PAGE_BINDING_OPS = Object.freeze({ readPageBinding, planBindPart, planBindInteraction });
