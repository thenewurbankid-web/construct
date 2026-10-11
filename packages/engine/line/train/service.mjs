// Train Line service: what the server routes (ui/server/src/lineTrainApi.mjs) and the MCP tools (packages/mcp
// src/train.mjs) call. Owner and Claude act through the same functions; `by` says who. Claude can propose cases, list
// them and run eval; only the owner agrees, disagrees or saves an agreed case.
import crypto from 'node:crypto';
import path from 'node:path';
import { INTENTS, INTENT_IDS, TRAIN_TOOLS, TOOL_FAMILY_LABEL, assertDelexicalized, assertTrainCase } from './contract.mjs';
import { LineOpError } from '../contract.mjs';
import { WORLD_IDS, isHeldOut, worldKey, worldOf, worldWords, worldSpec } from './corpus.mjs';
import { factsHash } from './facts.mjs';
import { worldFacts, inSample } from './generate.mjs';
import { bindSlots, fill, buildDomainMap, normalize, refOf, refTable, splitWords } from './slots.mjs';
import { describe } from './exprMirror.mjs';
import { draft as mirrorDraft, intentPhrase } from './drafterMirror.mjs';
import { tryRoute, wordsOf } from './verify.mjs';
import { createTrainStore } from './store.mjs';

const nameOfId = (id) => String(id).split('/').pop();
const baseName = (f) => path.posix.basename(String(f)).replace(/\.(tsx|ts|json)$/, '');
const KIND_WORD = { components: 'components', pages: 'pages', workflows: 'flows', fixtures: 'sample data' };
const lower = (s) => String(s).charAt(0).toLowerCase() + String(s).slice(1);
const joinAnd = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/**
 * Every identifier and word a world names (what a saved case must never contain).
 * @param {any} world @param {any} facts
 * @returns {string[]}
 */
export function worldIdentifiers(world, facts) {
  if (world.kind === 'corpus') return worldWords(world.id);
  const names = [...facts.features.map((f) => f.name), ...facts.library.map((l) => l.name), ...facts.features.flatMap((f) => f.items.map((i) => i.name))];
  return [...new Set([...names, ...names.flatMap(splitWords)])].filter((w) => w.length >= 4 && !['page', 'pages', 'card', 'list', 'button', 'table', 'data', 'flow'].includes(w.toLowerCase()) || /[A-Z]/.test(w));
}

/**
 * One step in plain English.
 * @param {string} tool @param {Record<string, any>} a The filled args. @param {any} facts
 * @returns {string}
 */
export function stepSentence(tool, a, facts) {
  switch (tool) {
    case 'line.baseOn': return `Make ${a.name} in ${a.feature}, based on the library ${nameOfId(a.libraryId)}.`;
    case 'line.promote': return `Move ${nameOfId(a.featureItemId)} from ${String(a.featureItemId).split('/')[0]} into the library.`;
    case 'line.setPageProp': return `Set ${a.prop} on ${baseName(a.file)} to ${JSON.stringify(a.value)}.`;
    case 'line.setFragment': {
      const label = facts.fragments?.[a.file]?.find((g) => g.id === a.fragmentId)?.label ?? 'one piece of its code';
      return `On ${baseName(a.file)}, change ${lower(label)}.`;
    }
    case 'line.fix': {
      const f = facts.findings.find((x) => x.key === a.findingKey);
      return f?.fixes.find((x) => x.id === a.fixId)?.sentence ?? 'Apply a fix that is no longer offered.';
    }
    default: return `Run ${tool}.`;
  }
}

/**
 * A route as the screen shows it, names filled back from the world's facts.
 * @param {any} r @param {Record<string, any>} bound @param {any} facts @param {string} preferred
 * @returns {any}
 */
export function routeView(r, bound, facts, preferred) {
  const steps = r.steps.map((s) => { const args = fill(s.args, bound, { asArg: true }); return { tool: s.tool, args, sentence: stepSentence(s.tool, args, facts) }; });
  const features = (r.scope?.features ?? []).map((f) => (bound[f] ? bound[f].text : f));
  const layers = (r.scope?.layers ?? []).map((l) => KIND_WORD[l] ?? l);
  const touches = r.outcome === 'question' ? 'Changes nothing: Line asks first.'
    : r.outcome === 'refusal' ? 'Changes nothing: Construct refuses it.'
      : `Touches ${joinAnd(layers) || 'files'}${features.length ? ` in ${joinAnd(features)}` : ''}${r.scope?.library ? ', and the library (every feature that uses it)' : ''}.`;
  return {
    id: r.id, label: fill(r.label, bound), touches, steps,
    checks: (r.expect ?? []).map((x) => describe(fill(x, bound, { asArg: true }))),
    cost: r.cost, risk: r.risk, outcome: r.outcome, preferred: r.id === preferred,
    ...(r.question ? { sentence: fill(r.question.sentence, bound) } : {}),
  };
}

/**
 * The Train Line service over one training root (cases, drafts, Try it, reviews, eval).
 * @param {{root?: string, seedFrom?: string, now?: () => string}} [o]
 * @returns {any}
 */
export function createTrainService(o = {}) {
  const store = createTrainStore(o);
  const now = o.now ?? (() => new Date().toISOString());

  const mapOf = (world) => buildDomainMap(worldFacts(world), { words: wordsOf(world), synonyms: store.synonyms(worldKey(world)) });

  /** A stored case with its names filled back. */
  function view(c) {
    const facts = worldFacts(c.world);
    const b = bindSlots(c.slots, facts, wordsOf(c.world));
    const filled = b.ok
      ? { request: fill(c.request, b.bound), intentPhrase: intentPhrase(c.intent), routes: c.gold.routes.map((r) => routeView(r, b.bound, facts, c.gold.preferred)), world: worldLabel(c.world) }
      : { request: c.request, intentPhrase: intentPhrase(c.intent), routes: [], world: worldLabel(c.world), sentence: `This case no longer fits its world: ${lower(b.sentence)}` };
    return { ...c, filled };
  }

  function worldLabel(world) {
    if (world.kind === 'sample') return 'The Line sample project';
    const w = worldSpec(world.id);
    const variant = world.variant === 'clean' ? '' : world.variant === 'cross-feature' ? ', with a cross-feature problem' : ', with a missing base';
    return `Imaginary ${w.domain} project ${world.id}${variant}`;
  }

  /** Turn raw values (ids from the closed choices) into slotted args, adding slots as needed. */
  function routeFromRaw(world, slots, tool, raw, label) {
    if (!TRAIN_TOOLS.includes(tool)) throw new LineOpError('Pick one of the five Line tools Train Line offers.', 'UNKNOWN_TOOL');
    const facts = worldFacts(world);
    const table = refTable(facts, wordsOf(world));
    const map = mapOf(world);
    const count = (t) => Object.values(slots).filter((s) => s.type === t).length;
    const LET = { feature: 'F', library: 'L', item: 'I', name: 'N', text: 'T', number: 'V', fragment: 'G', code: 'C', finding: 'P', fix: 'X' };
    const add = (type, def) => {
      const hit = Object.entries(slots).find(([, s]) => JSON.stringify(s) === JSON.stringify({ type, ...def }));
      if (hit) return hit[0];
      let n = count(type) + 1; while (slots[`${LET[type]}${n}`]) n++;
      slots[`${LET[type]}${n}`] = { type, ...def };
      return `${LET[type]}${n}`;
    };
    const ref = (type, value) => { const r = refOf(table, type, value); if (!r) throw new LineOpError(`"${value}" is not in this world; pick it from the list.`, 'UNKNOWN_ITEM'); return r; };
    const nameSlot = (value) => {
      const n = normalize(String(value), map);
      const m = n.request.match(/^<name:([A-Z]\d+)>$/);
      if (m) {
        const def = { ...n.slots[m[1]] };
        if (def.of) def.of = add(n.slots[def.of].type, { ...n.slots[def.of] });
        return add('name', def);
      }
      return add('name', { role: splitWords(value).join(' ') });
    };
    const a = /** @type {Record<string, any>} */ (raw ?? {});
    /** @type {Record<string, unknown>} */
    const args = {};
    let expect = [];
    const F = (v) => `<feature:${add('feature', { ref: ref('feature', v) })}>`;
    if (tool === 'line.baseOn') {
      const kind = String(a.libraryId).split('/')[0];
      const L = add('library', { ref: ref('library', a.libraryId), kind });
      args.libraryId = `<library:${L}>`; args.feature = F(a.feature); args.name = `<name:${nameSlot(a.name)}>`;
      expect = [{ hasItem: `${args.feature}/${kind}/${args.name}` }, { basedOn: [`${args.feature}/${kind}/${args.name}`, args.libraryId] }, { noNewFindings: true }];
    } else if (tool === 'line.promote') {
      const I = add('item', { ref: ref('item', a.featureItemId), kind: String(a.featureItemId).split('/')[1] });
      const N = add('name', { of: I });
      args.featureItemId = `<item:${I}>`;
      expect = [{ hasLibrary: `${String(a.featureItemId).split('/')[1]}/<name:${N}>` }, { not: { hasItem: `<item:${I}>` } }, { noNewFindings: true }];
    } else if (tool === 'line.setPageProp' || tool === 'line.setFragment') {
      const item = facts.features.flatMap((f) => f.items).find((i) => i.file === a.file);
      if (!item) throw new LineOpError('Pick a page from the list.', 'UNKNOWN_ITEM');
      const I = add('item', { ref: ref('item', item.id), kind: item.kind });
      args.file = `<file:${I}>`;
      if (tool === 'line.setPageProp') {
        Object.assign(args, { nodeId: String(a.nodeId ?? 'n0'), prop: String(a.prop ?? 'title'), kind: String(a.kind ?? 'string') });
        if (args.kind === 'number') { const V = add('number', { literal: Number(a.value) }); args.value = `<number:${V}>`; expect = [{ fileContains: [args.file, `${args.prop}={<number:${V}>}`] }]; }
        else { const t = normalize(`"${a.value}"`, map); const m = t.request.match(/<text:([A-Z]\d+)>/); const def = { ...t.slots[m[1]] }; if (def.of) def.of = add('feature', { ...t.slots[def.of] }); const T = add('text', def); args.value = `<text:${T}>`; expect = [{ fileContains: [args.file, `${args.prop}="<text:${T}>"`] }]; }
      } else {
        const list = facts.fragments?.[item.file] ?? [];
        const gi = Math.max(0, list.findIndex((g) => g.id === a.fragmentId));
        const t = normalize(`"${a.said ?? a.code ?? ''}"`, map); const m = t.request.match(/<text:([A-Z]\d+)>/); const def = { ...t.slots[m[1]] }; if (def.of) def.of = add('feature', { ...t.slots[def.of] });
        const T = add('text', def);
        Object.assign(args, { fragmentId: `<fragment:${add('fragment', { of: I, ref: `fragment#${gi}` })}>`, code: `<code:${add('code', { of: T })}>`, contentHash: `<hash:${I}>` });
        expect = [{ fileContains: [args.file, `<text:${T}>`] }];
      }
      expect.push({ noNewFindings: true });
    } else if (tool === 'line.fix') {
      const P = add('finding', { ref: ref('finding', a.findingKey) });
      const f = facts.findings.find((x) => x.key === a.findingKey);
      const fx = f.fixes.find((x) => x.id === a.fixId);
      if (!fx) throw new LineOpError('Pick one of the fixes Construct offers for this problem.', 'UNKNOWN_FIX');
      args.findingKey = `<finding:${P}>`; args.fixId = `<fix:${add('fix', { of: P, rank: fx.rank })}>`;
      expect = [{ noFinding: { rule: f.rule } }, { noNewFindings: true }];
    }
    const layer = tool === 'line.baseOn' ? String(a.libraryId).split('/')[0] : tool === 'line.promote' ? String(a.featureItemId).split('/')[1] : tool === 'line.fix' ? 'components' : 'pages';
    const features = [...new Set(Object.values(args).flatMap((v) => String(v).match(/<feature:([A-Z]\d+)>/g) ?? []).map((m) => m.slice(9, -1)))];
    return { id: `r-${crypto.randomBytes(3).toString('hex')}`, label: label ?? `Your route: ${tool.replace('line.', '')}`, scope: { layers: [layer], features, library: tool === 'line.promote' }, steps: [{ tool, args }], expect, cost: 1, risk: tool === 'line.promote' ? 'medium' : 'low', outcome: 'change' };
  }

  /** Verify every route of a case; refuse with one sentence naming the first that fails. */
  function verifyAll(world, slots, routes) {
    const at = now();
    const verified = {};
    for (const r of routes) {
      const t = tryRoute({ world, slots, route: r });
      if (!t.ok) {
        const b = bindSlots(slots, worldFacts(world), wordsOf(world));
        throw new LineOpError(`"${b.ok ? fill(r.label, b.bound) : r.label}" does not pass in a scratch copy (${lower(t.sentence)}); mark it as not valid or change it.`, 'ROUTE_FAILS');
      }
      verified[r.id] = { ok: true, at };
    }
    return verified;
  }

  /** Build, check and store one case. */
  function storeCase(input, by) {
    const world = input.world;
    const facts = worldFacts(world);
    const c = {
      id: input.id ?? `tc-${crypto.createHash('sha256').update(JSON.stringify([worldKey(world), input.request, input.slots, now()])).digest('hex').slice(0, 12)}`,
      intent: input.intent, request: input.request, slots: input.slots, world,
      split: world.kind === 'corpus' && isHeldOut(world.id) ? 'heldout' : 'train',
      factsHash: factsHash(facts), gold: { routes: input.routes, preferred: input.preferred },
      labelledBy: by, status: by === 'owner' ? 'agreed' : 'draft', notes: input.note ? [{ by, text: String(input.note), at: now() }] : [],
      sample: false, verified: { routes: {} }, createdAt: now(),
    };
    c.sample = by === 'claude' && inSample(c.id);
    try { assertTrainCase(c); } catch (e) { throw new LineOpError(`This case is not complete: ${lower(String(/** @type {any} */ (e).message).replace(/^[^:]*: /, ''))}.`.replace(/\.\.$/, '.'), 'BAD_CASE'); }
    try { assertDelexicalized(JSON.stringify(c), worldIdentifiers(world, facts)); } catch (e) {
      throw new LineOpError(`This case still names something of the project (${String(/** @type {any} */ (e).message).match(/"([^"]+)"/)?.[1] ?? 'a name'}); pick it from the lists so it is saved as a slot.`, 'NOT_DELEXICALIZED');
    }
    c.verified = { routes: verifyAll(world, c.slots, c.gold.routes) };
    store.put([c], by, by === 'owner' ? 'save' : 'propose');
    return view(c);
  }

  const service = {
    store,
    /** The worlds offered on the screen: the sample, then a few imaginary ones of the train split. */
    worlds: () => ({ worlds: [{ key: 'sample', label: worldLabel({ kind: 'sample' }) }, ...WORLD_IDS.filter((id) => !isHeldOut(id)).slice(0, 6).map((id) => ({ key: `${id}:clean`, label: worldLabel({ kind: 'corpus', id, variant: 'clean' }) }))] }),
    /** Cases for the screen: `sample` (Claude's cases the owner reviews, unreviewed first), `claude`, `mine`, `all`. */
    cases({ filter = 'sample', limit = 5, offset = 0 } = {}) {
      let list = store.all();
      if (filter === 'sample') list = list.filter((c) => c.sample && c.labelledBy === 'claude').sort((a, b) => Number(a.status !== 'draft') - Number(b.status !== 'draft'));
      else if (filter === 'claude') list = list.filter((c) => c.labelledBy === 'claude');
      else if (filter === 'mine') list = list.filter((c) => c.labelledBy === 'owner');
      const total = list.length;
      const open = list.filter((c) => c.status === 'draft').length;
      return { total, open, cases: list.slice(offset, offset + Math.min(50, limit)).map(view) };
    },
    /** The closed choices of a world, and its domain map (for the collapsed Details). */
    choices(key) {
      const world = worldOf(key);
      const facts = worldFacts(world);
      const t = refTable(facts, wordsOf(world));
      const of = (type) => [...t].filter(([, v]) => v.type === type);
      return {
        world: key, label: worldLabel(world),
        features: of('feature').map(([ref, v]) => ({ ref, name: v.value })),
        library: of('library').map(([ref, v]) => ({ ref, id: v.value, name: v.text, kind: String(v.value).split('/')[0] })),
        items: of('item').map(([ref, v]) => ({ ref, id: v.value, name: v.text, kind: String(v.value).split('/')[1], feature: String(v.value).split('/')[0], file: v.file })),
        findings: facts.findings.map((f, i) => ({ ref: `finding#${i}`, key: f.key, sentence: f.sentence, fixes: f.fixes.filter((x) => x.step).map((x) => ({ id: x.id, sentence: x.sentence })) })),
        fragments: facts.fragments,
        tools: TRAIN_TOOLS.map((name) => ({ name, label: TOOL_FAMILY_LABEL[name] })),
        intents: INTENTS.map((i) => ({ id: i.id, phrase: i.phrase })),
        map: mapOf(world).entries.map((e) => ({ ref: e.ref, type: e.type, name: e.name, words: e.words, synonyms: e.synonyms })),
        suggestions: suggestions(world),
      };
    },
    /** The drafter's routes for a typed request, filled for the screen. */
    draft({ request, world: key = 'sample' }) {
      if (typeof request !== 'string' || request.trim().length < 3) throw new LineOpError('Type what you want Line to do, in a sentence.', 'NO_REQUEST');
      const world = worldOf(key);
      const d = mirrorDraft(request, { map: mapOf(world), cases: store.all(), facts: worldFacts(world), words: wordsOf(world) });
      const facts = worldFacts(world);
      const b = bindSlots(d.slots, facts, wordsOf(world));
      const routes = b.ok ? d.routes.map((r) => ({ ...routeView(r, b.bound, facts, d.recommended), via: r.via, confidence: r.confidence })) : [];
      return {
        ...d, world: key, intentPhrase: intentPhrase(d.intent), routes: d.routes, filled: { routes, request: b.ok ? fill(d.request, b.bound) : request }, values: b.ok ? textsOf(b.bound) : {},
        ...(b.ok ? {} : { sentence: `The draft needs a correction first: ${lower(b.sentence)}` }),
      };
    },
    /** Rebind (preview) a corrected draft: the same routes with the person's slot choices, filled for the screen. */
    preview({ world: key = 'sample', slots, routes, preferred, request }) {
      const world = worldOf(key);
      const facts = worldFacts(world);
      const b = bindSlots(slots, facts, wordsOf(world));
      if (!b.ok) return { ok: false, sentence: `This does not fit the project yet: ${lower(b.sentence)}`, routes: [] };
      return { ok: true, request: request ? fill(request, b.bound) : '', routes: routes.map((r) => routeView(r, b.bound, facts, preferred)), values: textsOf(b.bound) };
    },
    /** A route the person adds with closed choices (tool + values from the lists). */
    addRoute({ world: key = 'sample', slots, tool, args, label }) {
      const s = JSON.parse(JSON.stringify(slots ?? {}));
      const route = routeFromRaw(worldOf(key), s, tool, args, label);
      return { slots: s, route };
    },
    /** "Try it": one route in a scratch copy of the world. */
    try({ world: key = 'sample', slots, route }) { return tryRoute({ world: worldOf(key), slots, route }); },
    /** The owner saves a case (agreed): the routes marked valid, the starred one preferred. */
    save(input) {
      if (!INTENT_IDS.includes(input?.intent)) throw new LineOpError('Pick what kind of request this is.', 'NO_INTENT');
      const world = worldOf(input.world ?? 'sample');
      return { case: storeCase({ ...input, world, slots: normalizeLiterals(input.slots ?? {}, mapOf(world)) }, 'owner') };
    },
    /**
     * Claude proposes a case: a plain-English request over a world and its routes as tool calls with real values.
     * Stored delexicalized, labelled 'claude', status 'draft'; kept only when every route passes in a scratch copy.
     */
    propose({ world: key = 'sample', request, intent, routes, preferred = 0, note }) {
      const world = worldOf(key);
      if (!INTENT_IDS.includes(intent)) throw new LineOpError(`Pick an intent of the catalog: ${INTENT_IDS.join(', ')}.`, 'NO_INTENT');
      if (!Array.isArray(routes) || !routes.length) throw new LineOpError('Give at least one route (its steps as Line tool calls).', 'NO_ROUTES');
      const n = normalize(request, mapOf(world));
      const slots = { ...n.slots };
      const built = routes.map((r, i) => {
        const steps = r.steps ?? [];
        if (!steps.length) throw new LineOpError('Each route needs at least one step.', 'NO_STEPS');
        const parts = steps.map((s) => routeFromRaw(world, slots, s.tool, s.args));
        const label = r.label ? mergeInto(normalize(String(r.label), mapOf(world)), slots) : parts.map((p) => p.label).join(', then ');
        return { ...parts[0], id: `r${i + 1}`, label, steps: parts.flatMap((p) => p.steps), expect: parts.flatMap((p) => p.expect).filter((x, j, all) => all.findIndex((y) => JSON.stringify(y) === JSON.stringify(x)) === j), cost: steps.length, scope: { layers: [...new Set(parts.flatMap((p) => p.scope.layers))], features: [...new Set(parts.flatMap((p) => p.scope.features))], library: parts.some((p) => p.scope.library) }, risk: parts.some((p) => p.risk === 'medium') ? 'medium' : 'low' };
      });
      return { case: storeCase({ world, request: n.request, intent, slots, routes: built, preferred: built[Math.min(Math.max(0, Number(preferred) || 0), built.length - 1)].id, note }, 'claude') };
    },
    /** The owner agrees or disagrees with one of Claude's cases. Only the owner may. */
    review({ id, verdict, note }, by = 'owner') {
      if (by !== 'owner') throw new LineOpError('Only the owner agrees or disagrees with a case.', 'NOT_OWNER');
      const c = store.get(id);
      if (!c) throw new LineOpError('That case is no longer there; reload the list.', 'UNKNOWN_CASE');
      if (c.labelledBy !== 'claude') throw new LineOpError('Only cases Claude proposed are agreed or disagreed with.', 'NOT_CLAUDES');
      if (!['agree', 'disagree'].includes(verdict)) throw new LineOpError('Choose agree or disagree.', 'BAD_VERDICT');
      const text = verdict === 'disagree' ? (String(note ?? '').trim() || 'The owner disagrees.') : String(note ?? '').trim();
      const next = { ...c, status: verdict === 'agree' ? 'agreed' : 'disputed', notes: [...c.notes, ...(text ? [{ by: 'owner', text, at: now() }] : [])] };
      store.put([next], 'owner', verdict);
      return { case: view(next) };
    },
    /** "Did you mean ...?": the owner's answer goes into that world's map as a synonym. */
    addSynonym({ world: key, word, ref }) {
      const world = worldOf(key);
      if (!refTable(worldFacts(world), wordsOf(world)).has(ref)) throw new LineOpError('Pick one of the names offered.', 'UNKNOWN_ITEM');
      if (!/^[a-z][a-z-]{1,40}$/i.test(String(word))) throw new LineOpError('Only a single word can become a synonym.', 'BAD_WORD');
      store.addSynonym(worldKey(world), word, ref, 'owner');
      return { ok: true, sentence: `From now on "${word}" means ${refTable(worldFacts(world), wordsOf(world)).get(ref).text} in this project.` };
    },
    /** Eval: draft every held-out case, compare with its gold, keep the numbers. */
    runEval(by = 'owner') {
      const result = evaluateAll(store.all(), now());
      store.saveEval(result, by);
      return service.scoreboard();
    },
    /** The scoreboard: last eval numbers plus the live owner agreement on the sample. */
    scoreboard() { return scoreboard(store.all(), store.lastEval()); },
    view,
  };
  return service;
}

/** Each bound slot's text, for the screen's inputs. */
const textsOf = (bound) => Object.fromEntries(Object.entries(bound).map(([k, v]) => [k, String(v.text)]));

/** A name or text the owner typed is stored as slots too (a library item's or feature's name inside it becomes `of`). */
function normalizeLiterals(slots, map) {
  const out = JSON.parse(JSON.stringify(slots));
  for (const [k, s] of Object.entries(slots)) {
    if (typeof s.literal !== 'string' || !['name', 'text'].includes(s.type)) continue;
    const n = normalize(s.type === 'text' ? `"${s.literal}"` : s.literal, map);
    const m = n.request.match(/<(?:name|text):([A-Z]\d+)>/);
    if (!m || n.slots[m[1]].type !== s.type) continue;
    const def = { ...n.slots[m[1]] };
    if (def.of) def.of = `${mergeInto({ request: `<x:${def.of}>`, slots: { [def.of]: n.slots[def.of] } }, out).match(/<x:([A-Z]\d+)>/)[1]}`;
    out[k] = def;
  }
  return out;
}

/** A normalized text's slots merged into `slots` (same definition = same slot); the text renamed to match. */
function mergeInto(n, slots) {
  const LET = { feature: 'F', library: 'L', item: 'I', name: 'N', text: 'T', number: 'V', fragment: 'G', code: 'C', finding: 'P', fix: 'X', missing: 'M' };
  const names = {};
  const order = Object.keys(n.slots).sort((a, b) => Number(Boolean(n.slots[a].of)) - Number(Boolean(n.slots[b].of)));
  for (const k of order) {
    const def = { ...n.slots[k], ...(n.slots[k].of ? { of: names[n.slots[k].of] ?? n.slots[k].of } : {}) };
    const hit = Object.entries(slots).find(([, x]) => JSON.stringify(x) === JSON.stringify(def));
    if (hit) { names[k] = hit[0]; continue; }
    let i = 1; while (slots[`${LET[def.type]}${i}`]) i++;
    names[k] = `${LET[def.type]}${i}`;
    slots[names[k]] = def;
  }
  return n.request.replace(/<([a-z]+):([A-Z]\d+)>/g, (m, form, k) => `<${form}:${names[k] ?? k}>`);
}

/** A few requests to start from (the sample's own names, filled). */
function suggestions(world) {
  const facts = worldFacts(world);
  const f0 = facts.features[0]?.name; const f1 = facts.features[1]?.name ?? f0;
  const atom = facts.library.find((l) => l.kind === 'components')?.name;
  const page = facts.features[0]?.items.find((i) => i.kind === 'pages')?.name;
  const comp = facts.features[0]?.items.find((i) => i.kind === 'components')?.name;
  return [
    atom && f0 && `Make Status${atom} in ${f0}, based on ${atom}.`,
    comp && f1 && `${f1} should use ${comp} from ${f0} too.`,
    page && `Change the title of ${page} to "All ${f0}".`,
    facts.findings[0] && `Fix the problem in ${baseName(facts.findings[0].file)}.`,
  ].filter(Boolean);
}

// ------------------------------------------------------------------------------------------------- eval
const sigOf = (r, bound) => (r.outcome === 'question' ? `ask:${r.question?.about}` : JSON.stringify(r.steps.map((s) => { const a = fill(s.args, bound, { asArg: true }); delete a.contentHash; return [s.tool, a]; })));
const familyOf = (c) => c.gold.routes.find((r) => r.id === c.gold.preferred)?.steps[0]?.tool ?? 'none';
const familyKey = (c) => (c.gold.routes.find((r) => r.id === c.gold.preferred)?.outcome === 'change' ? familyOf(c) : 'none');

/**
 * Draft every held-out case (retrieval from the train split only) and score it against its gold.
 * @param {any[]} cases @param {string} at
 * @returns {{at: string, cases: any[]}}
 */
export function evaluateAll(cases, at) {
  const train = cases.filter((c) => c.split === 'train');
  const per = [];
  for (const c of cases.filter((x) => x.split === 'heldout' && x.status !== 'disputed')) {
    const facts = worldFacts(c.world);
    const words = wordsOf(c.world);
    const gb = bindSlots(c.slots, facts, words);
    if (!gb.ok) continue;
    const request = fill(c.request, gb.bound);
    const d = mirrorDraft(request, { map: buildDomainMap(facts, { words }), cases: train, facts, words });
    const db = bindSlots(d.slots, facts, words);
    const gold = new Map(c.gold.routes.map((r) => [sigOf(r, gb.bound), r.id]));
    const drafted = db.ok ? d.routes.map((r) => [sigOf(r, db.bound), r.id]) : [];
    const hit = drafted.filter(([s]) => gold.has(s)).length;
    const goldPreferred = sigOf(c.gold.routes.find((r) => r.id === c.gold.preferred), gb.bound);
    const rec = drafted.find(([, id]) => id === d.recommended)?.[0] ?? null;
    per.push({ id: c.id, intent: c.intent, family: familyKey(c), recall: hit / gold.size, precision: drafted.length ? hit / drafted.length : 0, preferred: rec === goldPreferred ? 1 : 0, noRepair: rec !== null && gold.has(rec) ? 1 : 0, via: d.via });
  }
  return { at, cases: per };
}

const share = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
function row(cases, evals) {
  const sampled = cases.filter((c) => c.sample && c.labelledBy === 'claude');
  const agreed = sampled.filter((c) => c.status === 'agreed').length;
  const disagreed = sampled.filter((c) => c.status === 'disputed').length;
  return {
    cases: cases.length, heldout: evals.length,
    recall: share(evals.map((e) => e.recall)), precision: share(evals.map((e) => e.precision)), preferred: share(evals.map((e) => e.preferred)), noRepair: share(evals.map((e) => e.noRepair)),
    sampled: sampled.length, agreed, disagreed, agreement: agreed + disagreed ? Math.round((agreed / (agreed + disagreed)) * 100) / 100 : null,
  };
}

/**
 * The scoreboard: the last eval's numbers per family and intent, plus the live owner agreement on the sample.
 * @param {any[]} cases @param {any} last
 * @returns {import('./contract.mjs').Scoreboard}
 */
export function scoreboard(cases, last) {
  const evals = last?.cases ?? [];
  const byFamily = {};
  for (const fam of [...TRAIN_TOOLS, 'none']) {
    const cs = cases.filter((c) => familyKey(c) === fam);
    if (cs.length) byFamily[fam] = { ...row(cs, evals.filter((e) => e.family === fam)), label: TOOL_FAMILY_LABEL[fam] };
  }
  const byIntent = {};
  for (const i of INTENTS) {
    const cs = cases.filter((c) => c.intent === i.id);
    if (cs.length) byIntent[i.id] = { ...row(cs, evals.filter((e) => e.intent === i.id)), label: i.phrase };
  }
  const total = row(cases, evals);
  const sentence = last
    ? `Last eval on ${evals.length} held-out cases: ${Math.round((total.recall ?? 0) * 100)}% of the valid routes found, ${Math.round((total.preferred ?? 0) * 100)}% picked the preferred one.`
    : 'No eval has run yet; press Run eval.';
  return { ok: true, lastRun: last?.at ?? null, byFamily, byIntent, total, sentence };
}
