// The static route enumerator: every sensible route for the labelled intent(s) x layers x scope (inside the feature,
// via the library, via the workflow), each built from a tool template with its slot-form steps, expected-output
// expressions, structural delta, cost and risk. Nothing here knows a project's names: it reads slots, their shapes and
// the facts summary, and adds DERIVED slots (a page part T, a fragment G, a problem R, an invented name N) to the
// bindings when a route needs one. Construct's verification (verify.mjs) then keeps, marks or drops each route.
import { KIND_LAYER } from './contract.mjs';

const SINGULAR = { components: 'component', pages: 'page', workflows: 'workflow', fixtures: 'fixture' };
const OBJ_KIND = { component: 'components', page: 'pages', workflow: 'workflows', fixture: 'fixtures' };
const pascal = (s) => String(s).split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
/** The request's own slots of letter L (derived slots a template added are not the request's). */
const slotsOf = (ctx, L) => Object.keys(ctx.bindings).filter((s) => s[0] === L && ctx.bindings[s] !== undefined && !ctx.slots[s]?.derived).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

/**
 * @typedef {{labels: import('./contract.mjs').Labels, slots: Record<string, import('./contract.mjs').SlotShape>, bindings: Record<string, any>, summary: any, words: string[]}} Ctx
 */

/** A new derived slot id for letter L (bindings are extended in place). */
function derive(ctx, L, value, shape) {
  let n = 1;
  while (`${L}${n}` in ctx.bindings) n++;
  const s = `${L}${n}`;
  ctx.bindings[s] = value;
  ctx.slots[s] = { ...shape, derived: true };
  return s;
}
/** The slot already bound to this value (by id), or a new derived one. */
function slotFor(ctx, L, value, shape) {
  const id = typeof value === 'object' ? value.id : value;
  const found = Object.keys(ctx.bindings).find((s) => s[0] === L && (typeof ctx.bindings[s] === 'object' ? ctx.bindings[s].id : ctx.bindings[s]) === id);
  return found ?? derive(ctx, L, value, shape);
}
const libSlot = (ctx, lib) => slotFor(ctx, 'L', { id: lib.id, name: lib.name, kind: lib.kind, file: lib.file }, { kind: 'library', area: 'library', itemKind: lib.kind, layer: 'library' });
const featureOfItemSlot = (ctx, s) => { const b = ctx.bindings[s]; return slotFor(ctx, 'F', b.feature, { kind: 'feature' }); };
/** A slot for a feature item found in the summary (derived letter by kind). */
function itemSlot(ctx, item) {
  const L = { pages: 'P', components: 'C', workflows: 'W', fixtures: 'X' }[item.kind];
  const feature = ctx.summary.features.find((f) => f.items.some((i) => i.id === item.id))?.name;
  return slotFor(ctx, L, { id: item.id, name: item.name, kind: item.kind, feature, file: item.file, base: item.base }, { kind: SINGULAR[item.kind], area: 'feature', itemKind: item.kind, layer: KIND_LAYER[item.kind] });
}
/** A NEW name slot: the person's (N1 from the request) or one a rule invents (marked invented). */
function nameSlot(ctx, invented) {
  const given = slotsOf(ctx, 'N').find((s) => !ctx.slots[s]?.invented);
  if (given) return { slot: given, invented: false };
  return { slot: derive(ctx, 'N', invented, { kind: 'new', isNew: true, invented: true }), invented: true };
}

const BASE_EXPECT = (F, kind, N, L) => [{ itemExists: { feature: F, kind, name: N } }, { itemBasedOn: { feature: F, kind, name: N, libraryId: L } }, { noNewFindings: true }];
const BASE_DELTA = (F, kind, N, L) => [
  { op: 'add-node', node: `${F}/${kind}/${N}`, kind, layer: KIND_LAYER[kind], area: 'feature', feature: F },
  { op: 'add-edge', type: 'base', from: `${F}/${kind}/${N}`, to: L },
  ...(kind === 'fixtures' ? [] : [{ op: 'add-edge', type: 'import', from: `${F}/${kind}/${N}`, to: L }]),
];

/** One route object with the defaults filled in. */
function route(r) {
  return {
    pre: [], predicted: null, via: 'template', status: 'unverified', refusal: null, invented: [], failed: [],
    cost: { steps: r.steps.length, files: r.steps.length, layers: r.scope.layers.length }, ...r,
  };
}

// ------------------------------------------------------------------------------------------------ the templates
/** base-on: a new feature item based on a library item, inside one feature. */
function baseOn(ctx, intent, kind) {
  const F = ctx.labels.target && ctx.labels.target[0] === 'F' ? ctx.labels.target : slotsOf(ctx, 'F').at(-1);
  if (!F || !kind) return [];
  const named = slotsOf(ctx, 'L').filter((s) => ctx.bindings[s].kind === kind);
  // An item of another feature named in the request: its base is the library item to build on.
  const fromItems = slotsOf(ctx, ({ pages: 'P', components: 'C', workflows: 'W', fixtures: 'X' })[kind])
    .map((s) => ctx.bindings[s]).filter((b) => b.feature !== ctx.bindings[F] && b.base).map((b) => ctx.summary.library.find((l) => l.id === b.base)).filter(Boolean).map((l) => libSlot(ctx, l));
  const candidates = named.length ? named : fromItems.length ? fromItems : ctx.summary.library.filter((l) => l.kind === kind).slice(0, 3).map((l) => libSlot(ctx, l));
  return candidates.map((L, i) => {
    const lib = ctx.bindings[L];
    const { slot: N, invented } = nameSlot(ctx, `${pascal(ctx.bindings[F])}${pascal(lib.name)}`);
    const guessed = !named.length && !fromItems.length;
    return route({
      id: `base-on:${KIND_LAYER[kind]}:${L}>${F}`, template: 'base-on', intent,
      label: `Add a new ${SINGULAR[kind]} <${N}> to <${F}>, based on the library <${L}>.`,
      scope: { layers: [KIND_LAYER[kind]], features: [F], library: [L], scope: 'feature' },
      steps: [{ tool: 'line.baseOn', args: { libraryId: `<${L}>`, feature: `<${F}>`, name: `<${N}>` } }],
      expect: BASE_EXPECT(`<${F}>`, kind, `<${N}>`, `<${L}>`), delta: BASE_DELTA(`<${F}>`, kind, `<${N}>`, `<${L}>`),
      risk: `Changes only <${F}>; the library and other features stay as they are.`,
      confidence: Math.max(0.05, ctx.labels.intent.confidence * (guessed ? 0.6 - i * 0.1 : fromItems.length && !named.length ? 0.7 : 1) * (invented ? 0.9 : 1)),
      invented: invented ? [N] : [],
    });
  });
}

/** via-library: promote another feature's item into the library, then base a new item on it in the target feature. */
function viaLibrary(ctx, intent, kind) {
  const F = ctx.labels.target && ctx.labels.target[0] === 'F' ? ctx.labels.target : slotsOf(ctx, 'F').at(-1);
  const L = ({ pages: 'P', components: 'C', workflows: 'W', fixtures: 'X' })[kind];
  if (!F || !L) return [];
  return slotsOf(ctx, L).filter((s) => ctx.bindings[s].feature !== ctx.bindings[F]).map((I) => {
    const item = ctx.bindings[I];
    const { slot: N, invented } = nameSlot(ctx, item.name);
    const lib = `${kind}/<${I}.name>`;
    const Fi = featureOfItemSlot(ctx, I);
    return route({
      id: `via-library:${KIND_LAYER[kind]}:${I}>${F}`, template: 'via-library', intent,
      label: `Move <${I}> into the library, then add <${N}> based on it to <${F}>.`,
      scope: { layers: [KIND_LAYER[kind], 'library'], features: [Fi, F], library: [], scope: 'library' },
      steps: [{ tool: 'line.promote', args: { featureItemId: `<${I}>` } }, { tool: 'line.baseOn', args: { libraryId: lib, feature: `<${F}>`, name: `<${N}>` } }],
      expect: [{ libraryHas: lib }, ...BASE_EXPECT(`<${F}>`, kind, `<${N}>`, lib)],
      delta: [{ op: 'move-node', node: `<${I}>`, to: lib, area: 'library' }, ...BASE_DELTA(`<${F}>`, kind, `<${N}>`, lib)],
      risk: `Moves <${I}> out of <${Fi}> into the library, so every feature can use it.`,
      confidence: ctx.labels.intent.confidence * 0.9, invented: invented ? [N] : [],
    });
  });
}

/** promote: move a feature item into the library and point its users at the library copy. */
function promote(ctx, intent) {
  const items = ['P', 'C', 'W', 'X'].flatMap((L) => slotsOf(ctx, L));
  return items.slice(0, 3).map((I) => {
    const b = ctx.bindings[I];
    const lib = `${b.kind}/<${I}.name>`;
    const Fi = featureOfItemSlot(ctx, I);
    return route({
      id: `promote:library:${I}`, template: 'promote', intent,
      label: `Move <${I}> from <${Fi}> into the library and point its users at the library copy.`,
      scope: { layers: ['library', KIND_LAYER[b.kind]], features: [Fi], library: [], scope: 'library' },
      steps: [{ tool: 'line.promote', args: { featureItemId: `<${I}>` } }],
      expect: [{ libraryHas: lib }, { not: { itemExists: { feature: `<${Fi}>`, kind: b.kind, name: `<${I}.name>` } } }, { noNewFindings: true }],
      delta: [{ op: 'move-node', node: `<${I}>`, to: lib, area: 'library' }],
      risk: `Every feature that uses <${I}> now uses the library copy.`, confidence: ctx.labels.intent.confidence,
    });
  });
}

/** set-base: point an existing feature item's base link at a library item of the same kind. */
function setBase(ctx, intent) {
  const out = [];
  for (const I of ['P', 'C', 'W', 'X'].flatMap((L) => slotsOf(ctx, L))) {
    const b = ctx.bindings[I];
    for (const L of slotsOf(ctx, 'L').filter((s) => ctx.bindings[s].kind === b.kind && ctx.bindings[s].id !== b.base)) {
      out.push(route({
        id: `set-base:${KIND_LAYER[b.kind]}:${I}>${L}`, template: 'set-base', intent,
        label: `Base <${I}> on the library <${L}>.`, scope: { layers: [KIND_LAYER[b.kind]], features: [featureOfItemSlot(ctx, I)], library: [L], scope: 'feature' },
        steps: [{ tool: 'line.setBase', args: { file: `<${I}.file>`, libraryId: `<${L}>` } }],
        expect: [{ itemBasedOn: { feature: `<${I}.feature>`, kind: b.kind, name: `<${I}.name>`, libraryId: `<${L}>` } }, { noNewFindings: true }],
        delta: [{ op: 'set-base', node: `<${I}>`, to: `<${L}>` }],
        risk: `Changes only what <${I}> is based on.`, confidence: ctx.labels.intent.confidence,
      }));
    }
  }
  return out;
}

/** The pages a request points at: a named page, the pages that render a named component, or a feature's pages. */
function pagesFor(ctx) {
  const pages = slotsOf(ctx, 'P').map((s) => ({ slot: s, page: ctx.summary.pages.find((p) => p.item === ctx.bindings[s].id) })).filter((x) => x.page);
  if (pages.length) return pages;
  const comps = slotsOf(ctx, 'C').map((s) => ctx.bindings[s]);
  const libs = slotsOf(ctx, 'L').map((s) => ctx.bindings[s]);
  const tags = new Set([...comps.map((c) => c.name), ...libs.map((l) => l.name)]);
  const libIds = new Set(libs.map((l) => l.id));
  const features = new Set([...slotsOf(ctx, 'F').map((s) => ctx.bindings[s]), ...ctx.summary.features.filter((f) => f.items.some((i) => libIds.has(i.base) && i.kind !== 'components')).map((f) => f.name)]);
  let found = ctx.summary.pages.filter((p) => p.parts.some((x) => tags.has(x.tag)) && (!features.size || features.has(p.item.split('/')[0])));
  if (!found.length && features.size) found = ctx.summary.pages.filter((p) => features.has(p.item.split('/')[0]));
  return found.slice(0, 3).map((p) => ({ slot: itemSlot(ctx, { id: p.item, name: p.item.split('/').pop(), kind: 'pages', file: p.file, base: null }), page: p }));
}

/** set-prop: set one prop of one part of a feature page. */
function setProp(ctx, intent, { needValue = true } = {}) {
  const A = slotsOf(ctx, 'A')[0];
  const V = slotsOf(ctx, 'V')[0];
  if (!A && needValue) return [];
  const tags = new Set([...slotsOf(ctx, 'C'), ...slotsOf(ctx, 'L')].map((s) => ctx.bindings[s].name));
  const out = [];
  for (const { slot: P, page } of pagesFor(ctx)) {
    const prop = A ? ctx.bindings[A].name : null;
    let parts = page.parts.filter((x) => (!tags.size || tags.has(x.tag)) && (!prop || x.props.some((p) => p.name === prop)));
    if (!parts.length) parts = page.parts.filter((x) => !tags.size || tags.has(x.tag)).slice(0, 1);
    for (const part of parts.slice(0, 2)) {
      const T = slotFor(ctx, 'T', { id: `${page.file}#${part.nodeId}`, nodeId: part.nodeId, file: page.file }, { kind: 'part', of: P });
      const Vs = V ?? derive(ctx, 'V', undefined, { kind: 'value', invented: true });
      const Av = A ?? derive(ctx, 'A', undefined, { kind: 'prop', invented: true });
      const value = ctx.bindings[Vs];
      const kind = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string';
      const holes = [...(V ? [] : [Vs]), ...(A ? [] : [Av])];
      out.push(route({
        id: `set-prop:ui:${P}.${part.nodeId}.${Av}`, template: 'set-prop', intent,
        label: `Set <${Av}> on a part of <${P}> to <${Vs}>.`, scope: { layers: ['ui'], features: [featureOfItemSlot(ctx, P)], library: [], scope: 'feature' },
        steps: [{ tool: 'line.setPageProp', args: { file: `<${P}.file>`, nodeId: `<${T}.nodeId>`, prop: `<${Av}>`, kind, value: `<${Vs}>` } }],
        expect: [{ propIs: { file: `<${P}.file>`, nodeId: `<${T}.nodeId>`, prop: `<${Av}>`, value: `<${Vs}>` } }, { noNewFindings: true }],
        delta: [], risk: `Changes one prop on one part of <${P}>; nothing else.`,
        confidence: ctx.labels.intent.confidence * (holes.length ? 0.5 : 1), invented: holes, status: holes.length ? 'needs-model' : 'unverified',
      }));
    }
  }
  return out;
}

/** set-fragment: replace one code fragment (a handler, a prop expression) of a feature file. */
function setFragment(ctx, intent, layer) {
  const K = slotsOf(ctx, 'K')[0];
  const A = slotsOf(ctx, 'A')[0];
  const want = A ? ctx.bindings[A].name : null;
  // Without code in the request only a flow change offers code routes (a model writes the code); a prop change does not.
  if (!K && !/[.](feature-flow|workflow|workflow-step|variable)$/.test(intent)) return [];
  const all = ctx.summary.features.flatMap((f) => f.items);
  const libIds = new Set(slotsOf(ctx, 'L').map((s) => ctx.bindings[s].id));
  const itemIds = new Set([...['P', 'C', 'W', 'X'].flatMap((L) => slotsOf(ctx, L)).map((s) => ctx.bindings[s].id), ...all.filter((i) => libIds.has(i.base)).map((i) => i.id)]);
  const features = new Set([...slotsOf(ctx, 'F').map((s) => ctx.bindings[s]), ...all.filter((i) => libIds.has(i.base)).map((i) => i.id.split('/')[0])]);
  const wide = intent.endsWith('.feature-flow');
  const inLayer = (id) => KIND_LAYER[all.find((i) => i.id === id)?.kind] === layer;
  const wanted = (id) => inLayer(id) && (itemIds.has(id) || ((wide || !itemIds.size) && features.has(id.split('/')[0])));
  let frags = ctx.summary.fragments.filter((g) => wanted(g.item));
  if (want) frags = frags.filter((g) => g.id.endsWith(`:${want}`));
  const object = intent.split('.')[1];
  const kindWanted = object === 'handler' ? 'handler' : object === 'prop' ? 'prop-expression' : null;
  if (kindWanted && frags.some((g) => g.kind === kindWanted)) frags = frags.filter((g) => g.kind === kindWanted);
  if (!frags.length) {
    // The item has no editable piece Line can point at yet: a model writes the change (needs-model), Construct checks it.
    return all.filter((i) => wanted(i.id)).slice(0, 1).map((item) => {
      const I = itemSlot(ctx, item);
      const G = derive(ctx, 'G', undefined, { kind: 'fragment', of: I, invented: true });
      const Ks = slotsOf(ctx, 'K')[0] ?? derive(ctx, 'K', undefined, { kind: 'code', invented: true });
      return route({
        id: `set-fragment:${layer}:${I}`, template: 'set-fragment', intent, label: `Change the code of <${I}>; a local model or you write the new code.`,
        scope: { layers: [layer], features: [featureOfItemSlot(ctx, I)], library: [], scope: 'feature' },
        steps: [{ tool: 'line.setFragment', args: { file: `<${I}.file>`, fragmentId: `<${G}>`, code: `<${Ks}>`, contentHash: `<${G}.hash>` } }],
        expect: [{ fileContains: { path: `<${I}.file>`, text: `<${Ks}>` } }, { noNewFindings: true }], delta: [],
        risk: `Changes the code of <${I}>; its checks still run.`, confidence: ctx.labels.intent.confidence * 0.4, invented: [G, Ks], status: 'needs-model',
      });
    });
  }
  return frags.slice(0, 2).map((g) => {
    const item = ctx.summary.features.flatMap((f) => f.items).find((i) => i.id === g.item);
    const I = itemSlot(ctx, item);
    const G = slotFor(ctx, 'G', { id: g.id, hash: g.contentHash }, { kind: 'fragment', of: I });
    const Ks = K ?? derive(ctx, 'K', undefined, { kind: 'code', invented: true });
    return route({
      id: `set-fragment:${layer}:${I}.${G}`, template: 'set-fragment', intent,
      label: `Replace one piece of code in <${I}> with <${Ks}>.`, scope: { layers: [layer], features: [featureOfItemSlot(ctx, I)], library: [], scope: layer === 'workflow' ? 'feature' : 'feature' },
      steps: [{ tool: 'line.setFragment', args: { file: `<${I}.file>`, fragmentId: `<${G}>`, code: `<${Ks}>`, contentHash: `<${G}.hash>` } }],
      expect: [{ fileContains: { path: `<${I}.file>`, text: `<${Ks}>` } }, { noNewFindings: true }],
      delta: [], risk: `Changes one piece of code in <${I}>; its checks still run.`,
      confidence: ctx.labels.intent.confidence * (K ? 1 : 0.5), invented: K ? [] : [Ks], status: K ? 'unverified' : 'needs-model',
    });
  });
}

/** The delta of a fix's step (the fix tools are Line tools too). */
function fixDelta(ctx, step) {
  const a = step.args;
  const item = (file) => ctx.summary.features.flatMap((f) => f.items).find((i) => i.file === file);
  if (step.tool === 'line.setBase') { const i = item(a.file); const lib = ctx.summary.library.find((l) => l.id === a.libraryId); return i && lib ? [{ op: 'set-base', node: `<${itemSlot(ctx, i)}>`, to: `<${libSlot(ctx, lib)}>` }] : null; }
  if (step.tool === 'line.promote') { const i = ctx.summary.features.flatMap((f) => f.items).find((x) => x.id === a.featureItemId); if (!i) return null; const I = itemSlot(ctx, i); return [{ op: 'move-node', node: `<${I}>`, to: `${i.kind}/<${I}.name>`, area: 'library' }]; }
  if (step.tool === 'line.createLayout') return [];
  return null;
}

/** fix: apply one typed fix of one finding (one route per fix), or the recommended fix of every finding. */
function fix(ctx, intent, all) {
  const files = new Set(['P', 'C', 'W', 'X'].flatMap((L) => slotsOf(ctx, L)).map((s) => ctx.bindings[s].file));
  const features = new Set(slotsOf(ctx, 'F').map((s) => ctx.bindings[s]));
  const libs = new Set(slotsOf(ctx, 'L').map((s) => ctx.bindings[s].file));
  let findings = ctx.summary.findings.filter((x) => x.fixes.some((y) => y.step));
  const pointed = findings.filter((x) => files.has(x.file) || libs.has(x.file) || [...features].some((f) => x.file.includes(`/${f}/`)));
  if (pointed.length) findings = pointed;
  const R = (x) => slotFor(ctx, 'R', { id: x.key, ...Object.fromEntries(x.fixes.map((y, i) => [`fix${i + 1}`, y.id])) }, { kind: 'problem', rule: x.rule });
  if (all) {
    if (findings.length < 2) return [];
    const steps = findings.map((x) => ({ tool: 'line.fix', args: { findingKey: `<${R(x)}>`, fixId: `<${R(x)}.fix1>` } }));
    const deltas = findings.map((x) => fixDelta(ctx, x.fixes[0].step));
    return [route({
      id: 'fix-all', template: 'fix-all', intent, label: `Apply the recommended fix of each of the ${findings.length} problems.`,
      scope: { layers: ['ui'], features: [...new Set(findings.map((x) => x.file.split('/')[1]))].map((f) => slotFor(ctx, 'F', f, { kind: 'feature' })), library: [], scope: 'cross-feature' },
      steps, expect: [...findings.map((x) => ({ findingGone: `<${R(x)}>` })), { noNewFindings: true }], delta: deltas.every(Boolean) ? deltas.flat() : [],
      risk: 'Touches every feature with a problem.', confidence: ctx.labels.intent.confidence,
    })];
  }
  const out = [];
  for (const x of findings.slice(0, 4)) {
    const r = R(x);
    x.fixes.forEach((y, i) => {
      if (!y.step) return;
      const d = fixDelta(ctx, y.step);
      out.push(route({
        id: `fix:${r}:${i + 1}`, template: 'fix', intent, label: `Fix the ${x.rule} problem with its ${i === 0 ? 'recommended' : `option ${i + 1}`} fix.`,
        scope: { layers: [KIND_LAYER[ctx.summary.features.flatMap((f) => f.items).find((it) => it.file === x.file)?.kind] ?? 'ui'], features: [], library: [], scope: y.step.tool === 'line.promote' ? 'library' : 'feature' },
        steps: [{ tool: 'line.fix', args: { findingKey: `<${r}>`, fixId: `<${r}.fix${i + 1}>` } }],
        expect: [{ findingGone: `<${r}>` }, { noNewFindings: true }], delta: d ?? [],
        risk: y.step.tool === 'line.promote' ? 'Moves an item into the library, so other features use the library copy.' : 'Changes only the file with the problem.',
        confidence: ctx.labels.intent.confidence * (i === 0 ? 1 : 0.6) * (ctx.words.includes('all') || ctx.words.includes('every') ? 0.6 : 1),
      }));
    });
  }
  return out;
}

/** new-feature: start a feature by basing its first page on a library page. Construct decides whether it can. */
function newFeature(ctx, intent) {
  const N = slotsOf(ctx, 'N')[0];
  if (!N) return [];
  const lib = slotsOf(ctx, 'L').map((s) => ctx.bindings[s]).find((l) => l.kind === 'pages') ?? ctx.summary.library.find((l) => l.kind === 'pages');
  if (!lib) return [];
  const L = libSlot(ctx, lib);
  const P = derive(ctx, 'N', `${pascal(ctx.bindings[N])}${pascal(lib.name)}`, { kind: 'new', isNew: true, invented: true });
  return [route({
    id: `new-feature:ui:${L}>${N}`, template: 'new-feature', intent, label: `Start a new feature <${N}> with a page <${P}> based on the library <${L}>.`,
    scope: { layers: ['ui'], features: [N], library: [L], scope: 'feature' },
    steps: [{ tool: 'line.baseOn', args: { libraryId: `<${L}>`, feature: `<${N}>`, name: `<${P}>` } }],
    expect: BASE_EXPECT(`<${N}>`, 'pages', `<${P}>`, `<${L}>`), delta: BASE_DELTA(`<${N}>`, 'pages', `<${P}>`, `<${L}>`),
    risk: 'Creates a new feature folder.', confidence: ctx.labels.intent.confidence * 0.8, invented: [P],
  })];
}

function createLayout(ctx, intent) {
  return [route({
    id: 'create-layout', template: 'create-layout', intent, label: 'Create the library folder so the project is laid out as Line.',
    scope: { layers: ['library'], features: [], library: [], scope: 'library' }, steps: [{ tool: 'line.createLayout', args: {} }],
    expect: [{ noNewFindings: true }], delta: [], risk: 'Adds one folder; nothing else changes.', confidence: ctx.labels.intent.confidence,
  })];
}

/**
 * Every route for the labels. Layers below `minLayer` confidence are not explored; api routes are dropped with a sentence.
 * @param {Ctx} ctx  `bindings` and `slots` are extended with derived slots.
 * @param {import('./contract.mjs').IntentEntry[]} catalog
 * @param {{minIntent?: number, minLayer?: number}} [o]
 * @returns {{routes: import('./contract.mjs').Route[], dropped: {id: string, sentence: string}[]}}
 */
export function enumerateRoutes(ctx, catalog, o = {}) {
  const minIntent = o.minIntent ?? 0.2; const minLayer = o.minLayer ?? 0.2;
  const byId = new Map(catalog.map((e) => [e.id, e]));
  // The top intent first; the alternatives only when the top one gives no route (precision over noise).
  const top = [ctx.labels.intent].filter((x) => byId.has(x.id));
  const alts = ctx.labels.alternatives.filter((x) => byId.has(x.id) && x.confidence >= Math.min(minIntent, ctx.labels.intent.confidence));
  let intents = top;
  const layers = new Set(ctx.labels.layers.filter((l) => l.confidence >= minLayer).map((l) => l.layer));
  const all = ctx.words.includes('all') || ctx.words.includes('every') || ctx.words.includes('everything');
  /** @type {import('./contract.mjs').Route[]} */
  let routes = [];
  const dropped = [];
  for (let round = 0; round < 2; round++) {
  if (round === 1) { if (routes.length || !alts.length) break; intents = alts; }
  for (const it of intents) {
    const entry = byId.get(it.id);
    const sub = { ...ctx, labels: { ...ctx.labels, intent: it } };
    const kind = OBJ_KIND[entry.object];
    for (const t of entry.templates) {
      if (t === 'base-on') routes.push(...baseOn(sub, it.id, kind));
      else if (t === 'via-library') routes.push(...viaLibrary(sub, it.id, kind));
      else if (t === 'promote') routes.push(...promote(sub, it.id));
      else if (t === 'set-base') routes.push(...setBase(sub, it.id));
      else if (t === 'set-prop') routes.push(...setProp(sub, it.id, { needValue: entry.object !== 'feature-flow' }));
      else if (t === 'set-fragment') { for (const l of ['ui', 'workflow']) if (layers.has(l)) routes.push(...setFragment(sub, it.id, l)); }
      else if (t === 'fix') routes.push(...fix(sub, it.id, false));
      else if (t === 'fix-all' && all) routes.push(...fix(sub, it.id, true));
      else if (t === 'new-feature') routes.push(...newFeature(sub, it.id));
      else if (t === 'create-layout') routes.push(...createLayout(sub, it.id));
    }
    if (!entry.templates.length && round === 0) dropped.push({ id: `intent:${it.id}`, sentence: `Line knows "${it.id.replace('.', ' ')}" as an operation but has no static route for it yet, so a local model or you decide.` });
  }
  }
  if (layers.has('api')) dropped.push({ id: 'layer:api', sentence: 'Line has no API or service layer in this project yet, so no route changes one.' });
  // A route on a strongly labelled layer ranks above one on a weakly labelled layer.
  const layerConf = new Map(ctx.labels.layers.map((l) => [l.layer, l.confidence]));
  routes = routes.map((r) => ({ ...r, confidence: r.confidence * (0.5 + 0.5 * Math.max(0, ...r.scope.layers.filter((l) => l !== 'library').map((l) => layerConf.get(l) ?? 0), r.scope.layers.every((l) => l === 'library') ? 1 : 0)) }));
  // Keep a route only when its layers were labelled (recall-tuned labels), except the library scope which a template chose.
  routes = routes.filter((r) => r.scope.layers.some((l) => layers.has(l) || l === 'library'));
  // Multi-layer intents also get the combined routes (one per pair of single-layer routes on different layers).
  if (byId.get(ctx.labels.intent.id)?.object === 'feature-flow') {
    const singles = routes.filter((r) => r.scope.layers.length === 1);
    for (let i = 0; i < singles.length; i++) for (let j = i + 1; j < singles.length; j++) {
      const a = singles[i]; const b = singles[j];
      if (a.scope.layers[0] === b.scope.layers[0]) continue;
      routes.push(route({
        id: `${a.id}+${b.id}`, template: 'combo', intent: a.intent, label: `${a.label.replace(/[.]$/, '')}, and ${b.label.charAt(0).toLowerCase()}${b.label.slice(1)}`,
        scope: { layers: [...a.scope.layers, ...b.scope.layers], features: [...new Set([...a.scope.features, ...b.scope.features])], library: [...new Set([...a.scope.library, ...b.scope.library])], scope: 'feature' },
        steps: [...a.steps, ...b.steps], expect: [...a.expect, ...b.expect.filter((e) => !('noNewFindings' in e))], delta: [...a.delta, ...b.delta],
        risk: `Changes both the ${a.scope.layers[0]} and the ${b.scope.layers[0]} layer.`, confidence: Math.min(a.confidence, b.confidence) * 0.8,
        invented: [...a.invented, ...b.invented], status: a.status === 'needs-model' || b.status === 'needs-model' ? 'needs-model' : 'unverified',
      }));
    }
  }
  // Duplicates (the same steps) are dropped, keeping the more confident.
  const seen = new Map();
  for (const r of routes.sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id))) {
    const sig = JSON.stringify(r.steps);
    if (seen.has(sig) || [...seen.values()].some((x) => x.id === r.id)) continue;
    seen.set(sig, r);
  }
  return { routes: [...seen.values()].map((r) => ({ ...r, confidence: Math.round(Math.min(1, r.confidence) * 100) / 100 })), dropped };
}

