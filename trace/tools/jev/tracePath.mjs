// #892: a plan as a Trace path, the route through blocks of the owner's resolve flow (2026-09-27):
//
//   page part -> dynamic? -> api | computed -> controller -> hook -> provider -> service -> contract
//
// Each node carries its closed decision: the static pick (or "undecided" where no static logic exists yet), jev's
// shadow pick with its confidence, and FORK when they differ or jev is under the gate. Per layer the decision is the
// stub-first order: existing stub (complete it) | existing fn (map/reuse) | create.
//
// Static sources (nothing invented): Line's page binding (packages/engine/line/pageBinding.mjs readPageBinding: each
// part's data kind and endpoint, each interaction's handler none|stub|function and resolution api|controller|stub|
// unresolved, the typed fixes of an unresolved one) and the page's API contract. hook and provider have no static logic
// anywhere yet, and service has none for "does a service function exist", so they read "undecided".
//
// Node shape (Trace's tree node fields title/sub/state/layer/kind, trace/src/tree/model.mjs, plus the decision):
//   {id, title, sub, layer, kind, state: 'ok'|'placeholder'|'missing'|'ask'|'skip', candidate, decision, children}
//   decision: {key, question, options, facts, static, jev: {pick, confidence}|null, fork: null|'disagree'|'low-confidence'|'both'}
import { jevPick, DEFAULT_GATE } from '../../../packages/engine/line/drafter/classifyJev.mjs';

export const PATH_LAYERS = Object.freeze(['controller', 'hook', 'provider', 'service', 'contract']);
export const STUB = 'existing stub (complete it)';
export const FN = 'existing fn (map/reuse)';
export const CREATE = 'create';
export const LAYER_DECISIONS = Object.freeze([STUB, FN, CREATE]);
export const UNDECIDED = 'undecided';

const STATE_OF = { [STUB]: 'placeholder', [FN]: 'ok', [CREATE]: 'missing', [UNDECIDED]: 'ask' };

/**
 * @param {string} key @param {string} question @param {string[]} options @param {string} pick @param {string[]} facts
 */
const decision = (key, question, options, pick, facts) => ({ key, question, options, facts, static: pick, jev: null, fork: null });

/**
 * @param {string} id @param {string} title @param {string} layer @param {any} d @param {{sub?: string, candidate?: string|null, state?: string, kind?: string}} [o]
 */
function node(id, title, layer, d, o = {}) {
  return { id, title, sub: o.sub ?? '', layer, kind: o.kind ?? layer, state: o.state ?? (d ? STATE_OF[d.static] ?? 'ok' : 'ok'), candidate: o.candidate ?? null, decision: d, children: [] };
}

/** Chain nodes: each the only child of the one before. @param {any[]} list */
function chain(list) {
  for (let i = 0; i < list.length - 1; i++) list[i].children = [list[i + 1]];
  return list[0];
}

/**
 * The static Trace path of one page: a chain per interaction, and per dynamic part without one.
 * @param {any} binding readPageBinding's LinePageBinding
 * @param {{all?: boolean}} [o] `all`: also list static parts with no interaction (one node each).
 * @returns {{page: string, file: string, via: string, note: string|null, parts: any[]}}
 */
export function staticPagePath(binding, o = {}) {
  const endpoints = new Set((binding.contract?.endpoints ?? []).map((e) => e.id));
  const parts = [];
  for (const p of binding.parts ?? []) {
    const ixs = (binding.interactions ?? []).filter((x) => x.partId === p.id);
    const dyn = ['list', 'value', 'input'].includes(p.data?.kind);
    if (!ixs.length && !dyn && !o.all) continue;
    const partNode = node(`${p.id}`, `${p.tag}`, 'part', null, { sub: `part ${p.id}${p.base?.libraryId ? `, based on ${p.base.libraryId}` : ''}`, candidate: p.base?.libraryId ?? null, kind: 'page part' });
    const units = ixs.length ? ixs : [null];
    for (const ix of units) {
      const facts = [`part ${p.tag}: ${p.data?.sentence ?? 'no data'}`, ix ? `action ${ix.label}: ${ix.sentence}` : 'no action', `contract: ${binding.contract?.sentence ?? 'none'}`];
      const at = ix ? ix.id : `${p.id}:data`;
      const dynPick = ix ? 'dynamic' : dyn ? 'dynamic' : p.data?.kind === 'static' ? 'static' : UNDECIDED;
      const nDyn = node(`${at}/dynamic`, 'dynamic?', 'dynamic', decision('path.dynamic', 'Is this part dynamic (data or an action) or static?', ['dynamic', 'static'], dynPick, facts), { sub: ix ? `action ${ix.prop ?? ix.label}` : p.data?.sentence });
      const list = [nDyn];
      if (dynPick === 'dynamic') {
        // api | computed: a bound endpoint is api; a controller (UI-only function) is computed; an unresolved action takes
        // its recommended typed fix; a stub or a value with no endpoint is undecided.
        const fix1 = ix?.resolution === 'unresolved' ? (binding.findings ?? []).find((f) => f.interactionId === ix.id)?.fixes?.[0] ?? null : null;
        const src = p.data?.endpoint || ix?.resolution === 'api' ? 'api' : ix?.resolution === 'controller' ? 'computed' : fix1 ? (fix1.step.args.to === 'endpoint' ? 'api' : 'computed') : UNDECIDED;
        const endpoint = p.data?.endpoint ?? ix?.endpoint ?? (fix1?.step.args.to === 'endpoint' ? fix1.step.args.endpoint : null);
        list.push(node(`${at}/source`, 'api | computed', 'source', decision('path.source', 'Does the data come from the API or is it computed (no API call)?', ['api', 'computed'], src, facts), { candidate: endpoint ?? (fix1 ? fix1.id : null), sub: fix1 ? `recommended fix: ${fix1.sentence}` : '', state: src === UNDECIDED ? 'ask' : 'ok' }));
        const fixes = ix ? (binding.findings ?? []).find((f) => f.interactionId === ix.id)?.fixes ?? [] : [];
        if (fixes.length > 1) list.push(node(`${at}/home`, 'which home', 'source', decision('path.home', `Where does "${ix.label}" go?`, fixes.map((f) => f.id), fixes[0].id, facts), { sub: 'typed fixes, recommended first', candidate: fixes[0].id }));
        const ctl = ix ? ({ stub: STUB, function: FN, none: CREATE })[ix.handler] ?? UNDECIDED : UNDECIDED;
        list.push(node(`${at}/controller`, 'controller', 'controller', decision('path.controller', 'For the controller: complete an existing stub, map an existing function, or create one?', [...LAYER_DECISIONS], ctl, facts), { candidate: ix ? `${ix.id}${ix.prop ? ` (${ix.prop})` : ''}` : null }));
        for (const layer of ['hook', 'provider']) list.push(node(`${at}/${layer}`, layer, layer, decision(`path.${layer}`, `For the ${layer}: complete an existing stub, map an existing function, or create one?`, [...LAYER_DECISIONS], UNDECIDED, facts)));
        if (src === 'computed') {
          for (const layer of ['service', 'contract']) list.push(node(`${at}/${layer}`, layer, layer, null, { state: 'skip', sub: 'not on the path: computed, no API call' }));
        } else {
          list.push(node(`${at}/service`, 'service', 'service', decision('path.service', 'For the service: complete an existing stub, map an existing function, or create one?', [...LAYER_DECISIONS], UNDECIDED, facts), { candidate: endpoint }));
          const con = endpoint ? (endpoints.has(endpoint) ? FN : CREATE) : UNDECIDED;
          list.push(node(`${at}/contract`, 'contract', 'contract', decision('path.contract', 'For the contract: map an existing endpoint or create one?', [...LAYER_DECISIONS], con, facts), { candidate: endpoint }));
        }
      }
      partNode.children.push(chain(list));
    }
    parts.push(partNode);
  }
  return { page: binding.page, file: binding.file, via: binding.via, note: binding.note ?? null, parts };
}

/** Every decision node of a path (depth first). @param {any[]} nodes @returns {any[]} */
export function decisionNodes(nodes) {
  const out = [];
  const walk = (n) => { if (n.decision) out.push(n); for (const c of n.children ?? []) walk(c); };
  nodes.forEach(walk);
  return out;
}

/**
 * Ask jev each decision of the path in shadow; fills `decision.jev` and `decision.fork`. Never throws.
 * @param {any[]} pages staticPagePath results @param {{choose?: any, baseUrl?: string, gate?: number, timeoutMs?: number}} [o]
 * @returns {Promise<{decision: string, node: string, static: string, jev: string|null, confidence: number|null, fork: string|null}[]>} shadow records
 */
export async function shadowPath(pages, o = {}) {
  const gate = o.gate ?? DEFAULT_GATE;
  const out = [];
  for (const pg of pages) {
    for (const n of decisionNodes(pg.parts)) {
      const d = n.decision;
      const a = await jevPick({ part: `${pg.page} ${n.layer}`, question: d.question, options: d.options, facts: d.facts }, o);
      if (a) {
        d.jev = { pick: a.option, confidence: a.confidence };
        const differ = a.option !== d.static; const low = a.confidence < gate;
        d.fork = differ && low ? 'both' : differ ? 'disagree' : low ? 'low-confidence' : null;
        if (d.fork) n.state = 'ask';
      }
      out.push({ decision: d.key, node: n.id, static: d.static, jev: a ? a.option : null, confidence: a ? a.confidence : null, fork: d.fork });
    }
  }
  return out;
}

const pad = (s, n) => String(s).padEnd(n);
const conf = (c) => (c === null || c === undefined ? '' : ` (${Number(c).toFixed(2)})`);

/** One decision as a line: "static: api | jev: computed (0.03) FORK". @param {any} d */
export function decisionLine(d) {
  if (!d) return '';
  const j = d.jev ? `jev: ${d.jev.pick}${conf(d.jev.confidence)}` : 'jev: -';
  return `static: ${d.static} | ${j}${d.fork ? `  FORK (${d.fork})` : ''}`;
}

/**
 * The terminal tree of an ask result (see ask.mjs for the shape).
 * @param {any} r
 * @returns {string}
 */
export function renderAsk(r) {
  const out = [];
  out.push(`Request     ${r.request}`, `Project     ${r.project}`, `Normalized  ${r.normalized}`, '');
  out.push(`${pad('Labels', 10)}${pad('static', 34)}${pad('jev (confidence)', 40)}fork`);
  for (const k of ['intent', 'object', 'slot', 'layers']) {
    const s = r.labels.static?.[k]; const j = r.labels.jev?.[k];
    const f = (r.labels.forks ?? []).find((x) => x.label === k);
    const show = (v) => (Array.isArray(v) ? v.join('+') || '-' : v ?? '-');
    const c = r.labels.jevConfidence ? (k === 'layers' ? Math.min(...Object.values(r.labels.jevConfidence.layers)) : r.labels.jevConfidence[k]) : null;
    out.push(`  ${pad(k, 8)}${pad(show(s), 34)}${pad(r.labels.jev ? `${show(j)}${conf(c)}` : 'jev not running', 40)}${f ? `FORK (${f.reason})` : ''}`);
  }
  out.push('', `Plan (${r.plan.defer ?? 'static drafter'})`);
  if (r.plan.route) {
    out.push(`  route ${r.plan.route.id} [${r.plan.route.status}] ${r.plan.route.label}`);
    r.plan.route.steps.forEach((s, i) => out.push(`    ${i + 1}. ${s.tool} ${JSON.stringify(s.args)}`));
  } else out.push('  no route');
  if (r.plan.others) out.push(`  (+${r.plan.others} other routes)`);
  out.push('', 'Trace path (page part -> dynamic? -> api | computed -> controller -> hook -> provider -> service -> contract)');
  if (!r.path.length) out.push(`  ${r.pathNote ?? 'no page in this request'}`);
  for (const pg of r.path) {
    out.push(`  ${pg.page} (${pg.file})${pg.via !== 'trace' ? ` [${pg.note ?? pg.via}]` : ''}`);
    if (!pg.parts.length) out.push('    no dynamic part and no action on this page');
    const walk = (n, depth, last) => {
      const lead = `    ${'   '.repeat(depth)}${last ? '└─' : '├─'} `;
      const head = `${n.title}${n.candidate ? ` [${n.candidate}]` : ''}${n.state === 'skip' ? ` (${n.sub})` : ''}`;
      out.push(`${lead}${pad(head, Math.max(10, 46 - depth * 3))} ${n.decision ? decisionLine(n.decision) : n.state !== 'skip' && n.sub ? n.sub : ''}`);
      (n.children ?? []).forEach((c, i, a) => walk(c, depth + 1, i === a.length - 1));
    };
    pg.parts.forEach((p, i, a) => walk(p, 0, i === a.length - 1));
  }
  const forks = (r.labels.forks ?? []).length + (r.shadow ?? []).filter((x) => x.fork).length;
  out.push('', `${forks} fork${forks === 1 ? '' : 's'} (gate ${r.gate}); logged to ${r.logged ?? 'nowhere'}. Turn it into gold: node trace/tools/jev/intent-label.mjs from-last`);
  return out.join('\n');
}
