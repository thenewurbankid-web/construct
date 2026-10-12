// #904 (part of #900): a Trace example read as the drafter's world, so a request about it gets real readings.
// The static classify() and every NLP arm (arms.mjs) read slots from a domain map; a Line project builds that map from
// its code (facts.mjs factsSummary -> domainMap.mjs buildDomainMap). A Trace example (trace/examples/<x>) has no Line
// code, so its own facts stand in, in the same summary shape, and the same buildDomainMap / normalize / slotShapes /
// classify run over them:
//
//   feature   feature.json `feature` (the example)                         -> F slot
//   page      the example's one page (feature.json `page`), <Feature>Page   -> P slot ("contacts page")
//   props     the page's dynamic values, list fields, form fields and the endpoints' request/response fields -> A slots
//   handlers  the page's actions (top level and per list row) as on<Action>; said as "<action> button", "<action>
//             action", and the bare word ("press Call") unless classify() reads it as a verb ("delete") -> A (handler)
//   weak      the route points at the page. The story (story.md) is NOT a source: every word of it would point at the
//             one feature, so most of a request would read as "<feature:F1>" and the classifier would see nothing.
//
// The facts are the beam's own (readSpec + mergeViewModel(loadViewModel, extract)), so the readings and the runs see
// the same page. Deterministic; no model; nothing is written.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readSpec } from '../contract.mjs';
import { extract } from '../extract.mjs';
import { mergeViewModel, loadViewModel, toExtractedShape } from '../viewmodel.mjs';
import { buildDomainMap, normalize, slotShapes, formsOf } from '../../../packages/engine/line/drafter/domainMap.mjs';
import { classify, isVerbWord } from '../../../packages/engine/line/drafter/classify.mjs';

const pascal = (w) => String(w).split(/[^A-Za-z0-9]+/).filter(Boolean).map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join('');
const keysOf = (v) => (Array.isArray(v) ? keysOf(v[0]) : v && typeof v === 'object' ? Object.keys(v) : []);

/**
 * A Trace example's facts in factsSummary's shape (only the fields buildDomainMap and slotShapes read).
 * @param {string} dir the example folder
 */
export function exampleSummary(dir) {
  const spec = readSpec(dir);
  const feature = String(spec.feature ?? path.basename(dir));
  let source = '';
  try { source = fs.readFileSync(path.join(dir, spec.page ?? 'page.jsx'), 'utf8'); } catch { /* no page: no page facts */ }
  const vm = source ? toExtractedShape(mergeViewModel(loadViewModel(dir), extract(source))) : { values: [], lists: [], actions: [], forms: [] };
  const page = { id: `${feature}/pages/${pascal(feature)}Page`, kind: 'pages', name: `${pascal(feature)}Page`, file: spec.page ?? 'page.jsx', base: null };
  /** @type {Map<string, {name: string, kind: string, value: null, said?: string}>} */
  const props = new Map();
  const prop = (name, said) => { const n = String(name ?? ''); if (n && n !== feature && !props.has(n)) props.set(n, { name: n, kind: 'field', value: null, ...(said ? { said } : {}) }); };
  for (const v of vm.values ?? []) prop(v.name);
  for (const l of vm.lists ?? []) for (const f of l.fields ?? []) prop(f);
  for (const f of vm.forms ?? []) for (const x of f.fields ?? []) prop(typeof x === 'string' ? x : x?.name);
  for (const a of spec.apis ?? []) for (const k of [...keysOf(a.request), ...keysOf(a.response)]) prop(k);
  const actions = [...new Set([...(vm.actions ?? []).map((a) => a.name), ...(vm.lists ?? []).flatMap((l) => l.actions ?? [])].filter(Boolean).map(String))];
  for (const a of actions) prop(`on${pascal(a)}`, a);
  return {
    layout: { state: null },
    features: [{ name: feature, items: [page] }],
    library: [],
    pages: [{ item: page.id, parts: [{ props: [...props.values()] }] }],
    routes: spec.route ? [{ path: String(spec.route), item: page.id }] : [],
    specs: [],
    actions,
    feature,
    page,
  };
}

/**
 * The example's domain map: buildDomainMap over its facts (no project files read: the example's page is not Line code),
 * with each handler also said as "<action> button" / "<action> action" / the bare action word.
 * @param {ReturnType<typeof exampleSummary>} summary
 */
export function exampleMap(summary) {
  const map = buildDomainMap('/nonexistent-trace-example', { ...summary, features: summary.features.map((f) => ({ ...f, items: [] })) });
  // buildDomainMap reads item files for variables; the page item is added here so no file is read.
  map.entries.splice(1, 0, { key: `item:${summary.page.id}`, type: 'item', value: { id: summary.page.id, name: summary.page.name, kind: 'pages', feature: summary.feature, file: summary.page.file, base: null }, forms: formsOf(summary.page.name) });
  for (const p of summary.pages[0].parts[0].props) {
    if (!p.said) continue;
    const e = map.entries.find((x) => x.key === `prop:${p.name}`);
    if (!e) continue;
    e.forms = [...new Set([...e.forms, ...formsOf(p.said), `${p.said} button`, `${p.said} buttons`, `${p.said} action`])];
    // A bare action word that is grammar ("call") names the handler only as a synonym (normalize lets a synonym
    // through); a word classify() reads as a verb ("delete", "edit") stays the verb.
    const w = String(p.said).toLowerCase();
    if (!isVerbWord(w)) map.synonyms[w] = e.key;
  }
  map.stamp = crypto.createHash('sha256').update(JSON.stringify(map.entries.map((x) => x.key))).digest('hex').slice(0, 12);
  return map;
}

/**
 * Read a request against a Trace example: what the static drafter and every arm read (arms.mjs ArmContext), plus the
 * static Labels. Same normalize -> slotShapes -> classify as draft(), over the example's facts.
 * @param {string} dir @param {string} request @param {{id: string}[]} catalog
 */
export function readExample(dir, request, catalog) {
  const summary = exampleSummary(dir);
  const map = exampleMap(summary);
  const n = normalize(String(request), map);
  const slots = slotShapes(n.bindings, n.entries, summary, new Map());
  const labels = classify(n, slots, /** @type {any} */ (catalog));
  return { request: String(request), normalized: { text: n.text, tokens: n.tokens }, slots, bindings: n.bindings, catalog, labels, map: { stamp: map.stamp, entries: map.entries }, example: { dir, feature: summary.feature, page: summary.page.name } };
}

/**
 * A reading's target slot as the eval names a target ({kind, name}). In a Trace example the feature is its one page, so
 * the feature slot, the page slot and no slot at all are that page; a prop or handler slot is that prop.
 * @param {string|null} slot @param {{slots: Record<string, any>, bindings: Record<string, any>, example?: {feature: string}}} ctx
 */
export function targetOf(slot, ctx) {
  const kind = slot ? ctx.slots[slot]?.kind ?? 'slot' : null;
  if (ctx.example && (!slot || kind === 'feature' || kind === 'page')) return { kind: 'page', name: ctx.example.feature };
  if (!slot) return { kind: 'slot', name: '' };
  const v = ctx.bindings[slot];
  return { kind, name: String(v && typeof v === 'object' ? v.name ?? v.id : v ?? slot) };
}
