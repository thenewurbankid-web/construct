// The System 1 classifier: closed labels only (an intent id from the catalog, the target slot, candidate layers with
// confidence). Static rules over the NORMALIZED request (function words and typed slots; no domain word reaches it)
// and the slots' structure. Tuned for recall: it over-includes layers, the route enumerator and Construct's
// verification cut back. A small trained classifier can replace `classify` with the same input and output.
import { OBJECTS } from './contract.mjs';
import { everydayVerb, handlerShape } from './lexicon.mjs';

/** @type {[string, RegExp][]} */
const VERB_WORDS = [
  ['fix', /^(fix|repair|resolve|solve|correct|broken)$/],
  ['rename', /^rename$/],
  ['promote', /^(promote|share|reusable)$/],
  ['base-on', /^(base|based|rebase)$/],
  ['remove', /^(remove|delete|drop|rid|clear)$/],
  ['move', /^move$/],
  ['wire', /^(wire|connect|hook|link)$/],
  ['split', /^split$/],
  ['merge', /^(merge|combine)$/],
  ['add', /^(add|create|new|put|place|insert|include|build|start|use|reuse)$/],
  ['update', /^(update|change|set|edit|modify|tweak|adjust|alter|replace|swap|turn|make|rename)$/],
];
/** @type {[string, RegExp][]} */
const OBJECT_WORDS = [
  ['problem', /^(problem|problems|issue|issues|error|errors|finding|findings|broken|wrong)$/],
  ['workflow-step', /^(step|steps|transition|transitions|state|states)$/],
  ['feature-flow', /^(flow|flows|process|journey)$/],
  ['handler', /^(click|clicks|clicked|handler|handlers|when|happens)$/],
  ['service', /^(service|services|api|apis|endpoint|endpoints|backend|server|fetch)$/],
  ['data-shape', /^(type|types|shape|shapes|model)$/],
  ['variable', /^(variable|variables)$/],
  ['route', /^(route|routes|url|path)$/],
  ['test', /^(test|tests)$/],
  ['fixture', /^(fixture|fixtures|sample|samples)$/],
  ['layout', /^(layout|folder|folders)$/],
  ['prop', /^(prop|props|property|properties|attribute|attributes|label|text|title)$/],
  ['page', /^(page|pages|screen|screens|view|views)$/],
  ['component', /^(component|components|widget|widgets|button|buttons|card|cards|element|elements|part|parts)$/],
  ['workflow', /^(workflow|workflows|logic)$/],
  ['feature', /^(feature|features)$/],
];
/** @type {[string, RegExp][]} */
const LAYER_WORDS = [
  ['ui', /^(page|pages|screen|screens|view|views|component|components|button|buttons|card|cards|ui|frontend|front|look|style|styles|label|text|title|display|show)$/],
  ['workflow', /^(workflow|workflows|flow|flows|logic|step|steps|state|states|transition|transitions|process)$/],
  ['api', /^(api|apis|service|services|endpoint|endpoints|backend|server|fetch|request)$/],
  ['data', /^(fixture|fixtures|sample|samples|data|type|types|shape|shapes)$/],
  ['library', /^(library|shared|share|common|global|everywhere|reuse|reusable|promote)$/],
];
const OBJ_OF_ITEM = { pages: 'page', components: 'component', workflows: 'workflow', fixtures: 'fixture' };

/** Whether a word reads as an intent verb (a Line verb word or an everyday one). @param {string} w */
export const isVerbWord = (w) => VERB_WORDS.some(([, re]) => re.test(String(w).toLowerCase())) || everydayVerb(String(w)) !== null;

/**
 * Classify a normalized request.
 * @param {{tokens: {t: string, slot?: string, kind?: string}[]}} normalized
 * @param {Record<string, import('./contract.mjs').SlotShape>} slots
 * @param {import('./contract.mjs').IntentEntry[]} catalog
 * @returns {import('./contract.mjs').Labels}
 */
export function classify(normalized, slots, catalog) {
  const words = normalized.tokens.filter((x) => !x.slot).map((x) => x.t);
  const slotIds = normalized.tokens.filter((x) => x.slot).map((x) => x.slot);
  const has = (L) => slotIds.some((s) => s[0] === L);
  const first = (L) => slotIds.find((s) => s[0] === L) ?? null;
  const items = slotIds.filter((s) => 'PCWX'.includes(s[0]));
  // A missing feature or library item (named, but nothing in the project) stands where a feature or library item would.
  const features = slotIds.filter((s) => s[0] === 'F' || (s[0] === 'M' && slots[s]?.of === 'feature'));
  const lib = slotIds.filter((s) => s[0] === 'L' || (s[0] === 'M' && slots[s]?.of === 'library'));

  // Verb: the first verb word wins; "use <item of one feature> in <another feature>" is an add. Everyday verbs from the
  // shared lexicon ("needs", "want", "give" -> add; "clear" -> remove) count when no Line verb is there.
  let verb = null; let verbConf = 0;
  let verbWord = '';
  const valued = has('V') || has('K');
  /** A handler prop named ("onMore", said as "when more is asked for"): code for it is a handler. */
  const handlerProp = slotIds.some((s) => s[0] === 'A' && slots[s]?.handler);
  for (const w of words) {
    const v = VERB_WORDS.find(([, re]) => re.test(w))?.[0] ?? everydayVerb(w);
    if (!v || (v === 'add' && valued && !VERB_WORDS.some(([, re]) => re.test(w)))) continue;
    verb = v; verbConf = 0.5; verbWord = w; break;
  }
  // "... has no base; fix it": a fix verb anywhere is the request (it names what to do about the rest).
  if (verb !== 'fix' && words.some((w) => /^(fix|repair|resolve|solve)$/.test(w))) { verb = 'fix'; verbWord = 'fix'; verbConf = 0.5; }
  // "make <a new name> ...", "make something new ..." create something: an add, not an update.
  if (verb === 'update' && verbWord === 'make' && (has('N') || ((words.includes('new') || words.includes('another')) && !valued))) verb = 'add';
  if (words.includes('rename')) verb = valued ? 'update' : 'rename';
  if (!verb && valued) { verb = 'update'; verbConf = 0.3; }
  // "let me <do something> ...": a new action for the person (a handler to add), whatever verb follows.
  const letMe = !valued && words.some((w, i) => w === 'let' && /^(me|us)$/.test(words[i + 1] ?? ''));
  if (letMe) { verb = 'add'; verbConf = 0.3; }
  // "when I click <a handler prop> ...": changing what an existing handler does.
  if (!verb && handlerProp) { verb = 'update'; verbConf = 0.3; }
  // "<feature> should also show <an item of another feature or the library>": using it there is an add, not a change.
  if (verb === 'update' && /^(show|shows|display|displays)$/.test(verbWord) && (lib.length || (items.length && features.some((f) => f !== slots[items[0]]?.of)))) verb = 'add';
  // "make <item> a library item", "move <item> into the library": a promote.
  if ((verb === 'move' || verb === 'add' || (verb === 'update' && verbWord === 'make')) && words.includes('library') && items.length && !features.length) verb = 'promote';
  if (verb === 'promote' && items.length === 0 && lib.length === 0) verb = null;
  // "clear the problem": removing a problem is fixing it.
  if (verb === 'remove' && words.some((w) => OBJECT_WORDS[0][1].test(w))) verb = 'fix';

  // Object: words first, then the slots' kinds.
  const objWords = words.map((w) => OBJECT_WORDS.find(([, re]) => re.test(w))?.[0]).filter(Boolean);
  let object = null; let objConf = 0;
  const itemObj = items.length ? OBJ_OF_ITEM[slots[items[0]]?.itemKind] : null;
  const libObj = lib.length ? OBJ_OF_ITEM[slots[lib[0]]?.itemKind] : null;
  const newKind = (() => { const i = normalized.tokens.findIndex((x) => x.kind === 'new'); if (i < 0) return null; const near = [normalized.tokens[i + 1]?.t, normalized.tokens[i - 1]?.t, normalized.tokens[i - 2]?.t]; return near.map((w) => OBJECT_WORDS.find(([, re]) => re.test(w ?? ''))?.[0]).find((o) => ['page', 'component', 'workflow', 'fixture', 'feature'].includes(o)) ?? null; })();
  if (letMe) { object = 'handler'; objConf = 0.35; }
  else if (verb === 'fix' || objWords.includes('problem')) { object = 'problem'; objConf = 0.4; if (!verb) { verb = 'fix'; verbConf = 0.4; } }
  else if (has('K')) { object = slots[items[0]]?.itemKind === 'workflows' || objWords.includes('workflow-step') ? 'workflow-step' : objWords.includes('handler') || handlerProp ? 'handler' : has('A') ? 'prop' : itemObj === 'workflow' ? 'workflow-step' : 'handler'; objConf = 0.4; }
  // "log "..."", "go to ...", "call ...": what a handler should do (the handler templates write the code).
  else if (words.some((w) => ['log', 'navigate', 'call'].includes(handlerShape(w) ?? '')) && (has('V') || has('S') || has('P') || has('A'))) { object = 'handler'; objConf = 0.4; if (!verb) { verb = 'update'; verbConf = 0.3; } }
  // "when I click the Forecast button, open ...": a handler prop named with no value is about what the handler does.
  else if (handlerProp && !has('V')) { object = 'handler'; objConf = 0.35; }
  else if (has('A') || (has('V') && (itemObj === 'page' || itemObj === 'component'))) { object = 'prop'; objConf = 0.4; }
  else if (verb === 'add' && newKind === 'feature') { object = 'feature'; objConf = 0.4; }
  else if ((verb === 'add' || verb === 'base-on') && newKind && newKind !== 'feature') { object = newKind; objConf = 0.4; }
  else if ((verb === 'add' || verb === 'base-on') && libObj) { object = libObj; objConf = 0.4; }
  else if ((verb === 'add' || verb === 'base-on') && itemObj && features.length) { object = itemObj; objConf = 0.35; }
  // "make something new for <feature>": a new part of the feature (its base is asked).
  else if (verb === 'add' && features.length && !items.length && !lib.length && !objWords.length) { object = 'component'; objConf = 0.25; }
  else if (verb === 'promote' || verb === 'move') { object = itemObj ?? libObj ?? 'library-item'; objConf = itemObj ? 0.4 : 0.2; }
  else if (objWords.includes('feature-flow') || objWords.includes('workflow-step')) { object = objWords.includes('workflow-step') ? 'workflow-step' : 'feature-flow'; objConf = 0.35; }
  else if (objWords.includes('layout')) { object = 'layout'; objConf = 0.35; }
  else if (objWords.length) { object = objWords[0]; objConf = 0.3; }
  else if (itemObj) { object = itemObj; objConf = 0.25; }
  else if (features.length && verb === 'update') { object = 'feature-flow'; objConf = 0.2; }
  if (verb === 'update' && object === 'feature') object = 'feature-flow';

  const ids = new Set(catalog.map((e) => e.id));
  const id = verb && object ? `${verb}.${object}` : null;
  const inCatalog = id !== null && ids.has(id);
  // "share <item> with <another feature>": moving it into the library, or using it there through the library, are both
  // readings; the rules are not sure which (a model or the person confirms).
  const elsewhere = verb === 'promote' && items.length && features.some((f) => slots[f]?.kind === 'feature' && f !== slots[items[0]]?.of) && words.includes('with');
  const confidence = inCatalog ? Math.min(1, Math.round((verbConf + objConf + (items.length || features.length || lib.length ? 0.1 : 0)) * (elsewhere ? 0.45 : 1) * 100) / 100) : 0;
  /** Alternatives: the same verb with the other objects the request points at, and add <-> base-on. */
  const alt = new Set();
  if (inCatalog) {
    for (const o of objWords) if (`${verb}.${o}` !== id) alt.add(`${verb}.${o}`);
    if (itemObj && `${verb}.${itemObj}` !== id) alt.add(`${verb}.${itemObj}`);
    if (verb === 'update' && object === 'prop' && has('K')) alt.add('update.handler');
    if (verb === 'update' && features.length && object !== 'feature-flow') alt.add('update.feature-flow');
    if (verb === 'base-on' && object) alt.add(`add.${object}`);
    if (verb === 'add' && object && ['component', 'page', 'workflow', 'fixture'].includes(object) && items.length) alt.add(`base-on.${object}`);
  }
  const alternatives = [...alt].filter((x) => ids.has(x)).slice(0, 3).map((x) => ({ id: x, confidence: Math.round(confidence * 0.6 * 100) / 100 }));

  // Layers (recall): the object's layers, the words, the slots' layers, the target feature's layers.
  const layer = new Map();
  const bump = (l, c) => layer.set(l, Math.max(layer.get(l) ?? 0, c));
  for (const w of words) for (const [l, re] of LAYER_WORDS) if (re.test(w)) bump(l, 0.9);
  for (const s of slotIds) { const sh = slots[s]; if (sh?.layer && sh.layer !== 'library') bump(sh.layer, 0.8); if (sh?.area === 'library') bump('library', 0.5); }
  if (object && OBJECTS[object]) for (const l of OBJECTS[object]) bump(l, 0.5);
  const target = (object === 'feature-flow' || object === 'feature' || verb === 'add' || verb === 'base-on') && features.length ? features[features.length - 1] : items[0] ?? features[0] ?? lib[0] ?? first('N');
  if (target && slots[target]?.kind === 'feature') for (const l of slots[target].layers ?? []) bump(l, 0.4);
  if (verb === 'add' && items.length && features.some((f) => f !== slots[items[0]]?.of)) bump('library', 0.6);
  return {
    intent: inCatalog ? { id: /** @type {string} */ (id), confidence } : { id: 'unknown', confidence: 0 },
    alternatives,
    inCatalog,
    target: target ?? null,
    layers: [...layer].map(([l, c]) => ({ layer: l, confidence: c })).sort((a, b) => b.confidence - a.confidence || a.layer.localeCompare(b.layer)),
    via: 'rules',
  };
}
