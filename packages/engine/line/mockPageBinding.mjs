// cu5 contract mock (mock.mjs): a page's two bindings over the mock project's in-memory files, with no parser and no
// Trace, so it also runs in the browser (Line mock mode). A small tag scanner reads the parts; the mock contract below
// stands in for each feature's openapi.json; the verbs follow Trace's match.mjs (create, update, save, delete, reload
// need an endpoint; select and clear are controller functions). The real one is pageBinding.mjs over Trace's page map.
import { LineOpError } from './contract.mjs';
import { mockHash } from './mockFragments.mjs';

/** Each mock feature's API contract: the endpoints Trace would read from its openapi.json. */
export const MOCK_CONTRACTS = Object.freeze({
  orders: [
    { method: 'GET', path: '/api/orders', role: 'list' },
    { method: 'POST', path: '/api/orders', role: 'create' },
    { method: 'DELETE', path: '/api/orders/:id', role: 'remove' },
  ],
});
const ROLE_VERB = { list: 'reload', create: 'create', update: 'update', remove: 'delete' };
const ROLE_WORDS = { list: 'reload the list', create: 'create a new item', update: 'update the selected item', remove: 'delete this item' };
const VERB_KIND = { create: 'create', add: 'create', new: 'create', update: 'update', save: 'save', submit: 'save', delete: 'remove', remove: 'remove', edit: 'select', select: 'select', open: 'select', cancel: 'clear', reset: 'clear', close: 'clear', clear: 'clear', refresh: 'reload', reload: 'reload' };
const KIND_ROLES = { create: ['create'], update: ['update'], save: ['create', 'update'], remove: ['remove'], reload: ['list'] };
const CONTROLLER = { select: 'select this item (no API call)', clear: 'clear the selection (no API call)' };
const TEXT_PROPS = new Set(['title', 'label', 'text', 'placeholder', 'alt']);
const LOAD_WORDS = /^(more|load|show|view|next|refresh|reload|fetch|list)$/i;
const nameOf = (file) => file.split('/').pop().replace(/\.[^.]+$/, '');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The opening tags of a source, in order: tag, attributes (with their source ranges), start, end, self-closing. */
function scanTags(src) {
  const out = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '<' || !/[A-Za-z]/.test(src[i + 1] ?? '')) continue;
    let j = i + 1;
    while (/[\w.]/.test(src[j] ?? '')) j++;
    const tag = src.slice(i + 1, j);
    const nameEnd = j;
    const props = [];
    for (;;) {
      while (/\s/.test(src[j] ?? '')) j++;
      if (j >= src.length || src[j] === '>' || (src[j] === '/' && src[j + 1] === '>')) break;
      const n0 = j;
      while (/[\w:-]/.test(src[j] ?? '')) j++;
      const name = src.slice(n0, j);
      if (!name) { j++; continue; }
      if (src[j] !== '=') { props.push({ name, kind: 'boolean', value: true }); continue; }
      j++;
      if (src[j] === '"' || src[j] === "'") {
        const q = src[j];
        const end = src.indexOf(q, j + 1);
        props.push({ name, kind: 'string', value: src.slice(j + 1, end) });
        j = end + 1;
      } else if (src[j] === '{') {
        let depth = 0;
        const v0 = j;
        for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
        props.push({ name, kind: 'expression', value: src.slice(v0 + 1, j).trim() });
        j++;
      }
    }
    const selfClosing = src[j] === '/';
    out.push({ tag, props, start: i, nameEnd, end: j + (selfClosing ? 2 : 1), selfClosing });
  }
  return out;
}

/** The imports of a source: local name -> {from, line text}. */
function importsOf(src) {
  const out = new Map();
  for (const m of src.matchAll(/^import\s+(?:(\w+)|\{\s*([^}]+)\})\s+from\s+'([^']+)';?$/gm)) {
    const names = m[1] ? [m[1]] : m[2].split(',').map((s) => s.trim().split(/\s+as\s+/).pop());
    for (const n of names) out.set(n, { from: m[3], line: m[0], index: /** @type {number} */ (m.index) });
  }
  return out;
}

/** A relative specifier from `file` as a root-relative path (no extension). */
function resolveRel(file, spec) {
  const segs = file.split('/').slice(0, -1);
  for (const s of spec.split('/')) { if (s === '..') segs.pop(); else if (s !== '.') segs.push(s); }
  return segs.join('/');
}

/**
 * The cu5 mock operations over `files` (shared with the rest of the mock).
 * @param {{files: Record<string, string>}} o
 * @returns {Pick<import('./contract.mjs').LineOps, 'readPageBinding'|'planBindPart'|'planBindInteraction'>}
 */
export function createMockPageBinding({ files }) {
  const readPage = (file) => {
    const m = typeof file === 'string' ? file.match(/^features\/([^/]+)\/pages\/[^/]+\.tsx$/) : null;
    if (!m || typeof files[file] !== 'string') throw new LineOpError(`There is no page "${file}" in this project.`, 'UNKNOWN_ITEM');
    return { feature: m[1], source: files[file] };
  };
  const components = () => Object.keys(files).filter((f) => /^library\/components\/\w+\.tsx$/.test(f)).sort().map((f) => ({ id: `components/${nameOf(f)}`, name: nameOf(f) }));

  /** @returns {import('./contract.mjs').PartBase} */
  const baseOf = (file, feature, tag, imports) => {
    if (/^[a-z]/.test(tag)) return { kind: 'html', libraryId: null, from: null, sentence: `A plain <${tag}> element, not a library component.` };
    const imp = imports.get(tag.split('.')[0]);
    if (!imp) return { kind: 'outside', libraryId: null, from: null, sentence: `${tag} is not imported, so it is not a library component.` };
    const rel = resolveRel(file, imp.from);
    const [area, a, b] = rel.split('/');
    if (area === 'library') return { kind: 'library', libraryId: `${a}/${b}`, from: `${rel}.tsx`, sentence: `The library ${a === 'pages' ? 'page' : 'component'} ${b} (${a}/${b}).` };
    if (area === 'features') {
      const base = (files[`${rel}.tsx`] ?? '').match(/@line-base\s+(\S+)/)?.[1] ?? null;
      const where = a === feature ? `this feature's ${tag}` : `${tag} from the feature ${a}`;
      return { kind: 'feature', libraryId: base, from: `${rel}.tsx`, sentence: base ? `${cap(where)}, based on the library ${base.split('/')[1]}.` : `${cap(where)}, which has no library base.` };
    }
    return { kind: 'outside', libraryId: null, from: imp.from, sentence: `${tag} comes from ${imp.from}, not from your library.` };
  };

  /** @returns {import('./contract.mjs').LinePageBinding} */
  function readPageBinding(_root, file) {
    const { feature, source } = readPage(file);
    const imports = importsOf(source);
    const eps = (MOCK_CONTRACTS[feature] ?? []).map((e) => ({ id: `${e.method} ${e.path}`, method: e.method, path: e.path, role: e.role, says: ROLE_WORDS[e.role] }));
    const byRole = Object.fromEntries(eps.map((e) => [e.role, e]));
    const parts = [];
    const interactions = [];
    scanTags(source).forEach((t, i) => {
      const id = `n${i}`;
      const texts = t.props.filter((p) => p.kind === 'string' && TEXT_PROPS.has(p.name));
      const part = { id, tag: t.tag, depth: 0, line: source.slice(0, t.start).split('\n').length, base: baseOf(file, feature, t.tag, imports), data: { kind: texts.length ? 'static' : 'none', endpoint: null, field: null, sentence: texts.length ? 'Static text, no data.' : 'No data.' }, states: [], interactions: [] };
      const h = t.props.find((p) => /^on[A-Z]/.test(p.name));
      if (h && /^[A-Z]/.test(t.tag)) {
        const action = t.props.find((p) => p.name === 'data-action' && p.kind === 'string')?.value;
        const label = h.name.slice(2).replace(/([a-z0-9])([A-Z])/g, '$1 $2');
        const verb = typeof action === 'string' ? action : label.replace(/\s+/g, '').replace(/^./, (c) => c.toLowerCase());
        const handler = /^\(\s*\w*\s*\)\s*=>\s*\{\s*\}$/.test(String(h.value)) ? 'stub' : 'function';
        const kind = VERB_KIND[verb.toLowerCase()] ?? null;
        const ep = (KIND_ROLES[kind] ?? []).map((r) => byRole[r]).find(Boolean) ?? null;
        let resolution, sentence, endpoint = null;
        if (kind && CONTROLLER[kind]) { resolution = 'controller'; sentence = `"${label}" is handled on the page: ${CONTROLLER[kind]}.`; }
        else if (kind && ep) { resolution = 'api'; endpoint = ep.id; sentence = `"${label}" calls ${ep.id} (${ep.says}).`; }
        else if (!kind && handler === 'stub') { resolution = 'stub'; sentence = `"${label}" has a marked stub to write.`; }
        else { resolution = 'unresolved'; sentence = `"${label}" has no home yet: "${verb}" ${kind ? 'needs an endpoint the contract lacks' : 'is not a known action and the handler is not a stub'}.`; }
        const iid = `${id}:${h.name}`;
        interactions.push({ id: iid, partId: id, prop: h.name, label, verb, handler, resolution, endpoint, sentence });
        part.interactions.push(iid);
      }
      parts.push(part);
    });
    const findings = interactions.filter((i) => i.resolution === 'unresolved').map((it) => {
      const step = (args) => ({ tool: /** @type {const} */ ('line.bindInteraction'), args: { file, interactionId: it.id, ...args } });
      const fixes = [
        ...['list', 'create', 'update', 'remove'].filter((r) => byRole[r]).map((r) => ({ score: r === 'list' && LOAD_WORDS.test(it.verb) ? 3 : r === 'list' ? 1 : 0, id: `endpoint:${byRole[r].id}`, sentence: `Bind "${it.label}" to ${byRole[r].id} (${byRole[r].says}).`, step: step({ to: 'endpoint', endpoint: byRole[r].id }) })),
        ...(it.handler !== 'function' ? [{ score: eps.length ? 0.5 : 2, id: 'stub', sentence: `Give "${it.label}" a marked stub to write later: (event) => {}.`, step: step({ to: 'stub' }) }] : []),
        ...Object.entries(CONTROLLER).map(([v, says]) => ({ score: -1, id: `controller:${v}`, sentence: `Handle "${it.label}" on the page as a controller function: ${says}.`, step: step({ to: 'controller', verb: v }) })),
      ].map((f, i) => ({ ...f, i })).sort((a, b) => b.score - a.score || a.i - b.i).map(({ score: _s, i: _i, ...f }, n) => ({ ...f, rank: n + 1 }));  
      const tag = parts.find((p) => p.id === it.partId)?.tag;
      return { key: `${file}|${it.id}`, partId: it.partId, interactionId: it.id, sentence: `${it.label} on ${tag} is not bound to the API: ${it.sentence.replace(/^"[^"]*" has no home yet: /, '')}`, fixes };
    });
    const count = (r) => interactions.filter((i) => i.resolution === r).length;
    const total = interactions.length;
    return {
      file, feature, page: nameOf(file), contentHash: mockHash(source), via: 'trace', note: null,
      contract: eps.length
        ? { file: 'openapi.json', state: 'ok', sentence: `The API contract of ${feature} (openapi.json) has ${eps.length} endpoints.`, endpoints: eps }
        : { file: null, state: 'none', sentence: `${feature} has no API contract yet; add its openapi.json beside spec.md so Trace can bind this page's actions to endpoints.`, endpoints: [] },
      parts, interactions, findings,
      coverage: { total, api: count('api'), controller: count('controller'), stub: count('stub'), unresolved: count('unresolved'), rate: total ? Math.round(((total - count('unresolved')) / total) * 100) : 100 },
      components: components(),
    };
  }

  const stale = (b, contentHash) => { if (contentHash !== undefined && contentHash !== b.contentHash) throw new LineOpError(`The page ${b.page} changed since you opened it; reload it and try again.`, 'STALE'); };

  /** Set one attribute on the tag at `start` (replace it, or add it after the last one). */
  const setAttr = (source, t, name, text) => {
    const at = source.indexOf(` ${name}=`, t.start);
    if (at >= 0 && at < t.end) {
      const v = source.slice(at + name.length + 2);
      const len = v[0] === '"' ? v.indexOf('"', 1) + 1 : v.indexOf('}') + 1;
      return source.slice(0, at) + ` ${name}=${text}` + source.slice(at + name.length + 2 + len);
    }
    const close = t.selfClosing ? t.end - 2 : t.end - 1;
    const before = source.slice(0, close).replace(/\s+$/, '');
    return `${before} ${name}=${text}${t.selfClosing ? ' ' : ''}${source.slice(close)}`;
  };

  return {
    readPageBinding,
    planBindInteraction(root, { file, interactionId, to, endpoint, verb, contentHash } = /** @type {any} */ ({})) {
      const b = readPageBinding(root, file);
      stale(b, contentHash);
      const it = b.interactions.find((i) => i.id === interactionId);
      if (!it) throw new LineOpError(`The page ${b.page} has no action "${interactionId}"; reload the page and pick it again.`, 'UNKNOWN_ITEM');
      const { source } = readPage(file);
      const t = scanTags(source)[Number(it.partId.slice(1))];
      const where = `"${it.label}" on ${t.tag} in the page ${b.page}`;
      if (to === 'endpoint') {
        const e = b.contract.endpoints.find((x) => x.id === endpoint);
        if (!e) throw new LineOpError(b.contract.state === 'ok' ? `${b.feature}'s API contract has no endpoint "${endpoint}"; pick one of ${b.contract.endpoints.map((x) => x.id).join(', ')}.` : b.contract.sentence, 'UNKNOWN_ENDPOINT');
        return { summary: `Binds ${where} to ${e.id} (${e.says}).`, files: [{ path: file, content: setAttr(source, t, 'data-action', `"${ROLE_VERB[e.role]}"`) }] };
      }
      if (to === 'controller') {
        if (!Object.hasOwn(CONTROLLER, verb ?? '')) throw new LineOpError(`A controller action is one of select or clear; "${verb ?? ''}" is not.`, 'BAD_REQUEST');
        return { summary: `Binds ${where} to a controller function: ${CONTROLLER[verb]}.`, files: [{ path: file, content: setAttr(source, t, 'data-action', `"${verb}"`) }] };
      }
      if (to === 'stub') {
        if (it.handler === 'function') throw new LineOpError(`${cap(where)} already runs code; bind it to an endpoint or a controller, or change its code with Edit code.`, 'HAS_CODE');
        return { summary: `Gives ${where} a marked stub to write later (${it.prop}).`, files: [{ path: file, content: setAttr(source, t, it.prop ?? 'onClick', '{(event) => {}}') }] };
      }
      throw new LineOpError('Say what to bind the action to: an endpoint, a controller or a stub.', 'BAD_REQUEST');
    },
    planBindPart(root, { file, partId, libraryId, contentHash } = /** @type {any} */ ({})) {
      const b = readPageBinding(root, file);
      stale(b, contentHash);
      const lib = components().find((c) => c.id === libraryId);
      if (!lib) throw new LineOpError(`The library has no component "${libraryId}"; pick one of its components.`, 'UNKNOWN_ITEM');
      const part = b.parts.find((p) => p.id === partId);
      if (!part) throw new LineOpError(`The page ${b.page} has no part "${partId}"; reload the page and pick it again.`, 'UNKNOWN_ITEM');
      if (part.base.kind === 'library' && part.base.libraryId === libraryId) throw new LineOpError(`${part.tag} in the page ${b.page} is already the library component ${lib.name}.`, 'ALREADY_BOUND');
      const { source } = readPage(file);
      const imports = importsOf(source);
      const spec = `${'../'.repeat(file.split('/').length - 1)}library/components/${lib.name}`;
      const t = scanTags(source)[Number(partId.slice(1))];
      let content = source.slice(0, t.start + 1) + lib.name + source.slice(t.nameEnd);
      if (!t.selfClosing) content = content.replace(`</${t.tag}>`, `</${lib.name}>`);
      if (!imports.has(lib.name)) {
        const last = [...imports.values()].sort((a, c) => c.index - a.index)[0];
        const at = last ? content.indexOf(last.line) + last.line.length : 0;
        content = `${content.slice(0, at)}${last ? '\n' : ''}import { ${lib.name} } from '${spec}';${last ? '' : '\n'}${content.slice(at)}`;
      }
      return { summary: `Replaces ${part.tag} in the page ${b.page} with the library component ${lib.name}.`, files: [{ path: file, content }] };
    },
  };
}
