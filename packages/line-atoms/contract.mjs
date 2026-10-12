// Line logic atoms (roadmap item 2): the contract. An atom is one piece of common functional logic (a validated
// submit, a paginated query, a multi-step flow...) written once, in TypeScript, as a pure state machine with a test kit
// that drives every state and every event. Domain logic is mostly compositions of atoms; usecases and services use
// them, and Construct flags hand-written code that does an atom's job (LINE-ATOM) with the typed fix "use atom X".
//
// Aligned with Smith (atomic-codemod registry.js): Smith registers an atom as {id, name, kind, code, fingerprint,
// embedding, english} and never lets a registered name be redefined. A Line atom keeps Smith's `name`, `kind` and
// `english` with the same meaning (toSmithEntry gives the registry entry) and EXTENDS it with what a functional atom
// needs: a role, typed inputs and outputs, states and events, the library it wraps and its test kit.
//
// Each atom lives in packages/line-atoms/atoms/<id>/:
//   atom.json        the AtomDescriptor below (descriptors only, never library code)
//   index.ts         the implementation: `export const machine: AtomMachine<...>` plus named pure helpers
//   <id>.test.ts     the test kit (node --test): every state and every event, checked by testkit.mjs coverage()

/** The functional roles an atom can play: the closed list the drafter, the check and the metric speak. */
export const ATOM_ROLES = Object.freeze({
  'form.submit': 'validate a form and submit it',
  'query.loading': 'load data and track whether it is loading, loaded or failed',
  'query.paginate': 'load one page of data at a time from a server',
  'query.infinite': 'load more items as the person scrolls',
  'query.poll': 'load data again on a timer until it is done',
  'data.optimistic': 'show a change at once and undo it if saving fails',
  'data.exportCsv': 'export rows as a CSV file',
  'input.debounce': 'wait until the person stops typing before searching',
  'list.filterSort': 'filter, search and sort a list',
  'list.paginate': 'split a list into pages',
  'flow.step': 'walk through the steps of a multi-step flow',
  'auth.permission': 'check whether a person may do something',
  'date.range': 'pick and check a date range',
  'state.undo': 'undo and redo changes',
});

/** The item kinds that may use an atom (the Line logic kinds that hold behaviour; profiles/line/contract ATOM_USERS). */
export const ATOM_USERS = Object.freeze(['usecases', 'services']);

/** The test runners a test kit may use. */
export const TEST_RUNNERS = Object.freeze(['node', 'jest']);

/** An atom id: lower-case words joined by hyphens, e.g. "validated-submit". */
export const ATOM_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
/** A state or event name: a word in camelCase (states) or UPPER_SNAKE (events). */
const STATE_NAME = /^[a-z][a-zA-Z0-9]*$/;
const EVENT_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * One typed input or output of an atom.
 * @typedef {object} AtomPort
 * @property {string} name      camelCase, as the implementation names it.
 * @property {string} type      The TypeScript type text, e.g. "number", "(values: V) => Promise<R>".
 * @property {string} sentence  Plain English: what it is.
 * @property {boolean} [optional]
 */

/**
 * One event an atom's machine accepts.
 * @typedef {{type: string, sentence: string}} AtomEvent
 */

/**
 * One transition of the machine (`from` "*" means any state).
 * @typedef {{from: string, event: string, to: string}} AtomTransition
 */

/**
 * The library an atom wraps (its concept, not its code), or none.
 * @typedef {{library: string, license: string, concept: string, adapter: string}} AtomWraps
 *   `adapter`: how the library plugs in, e.g. "a zod or valibot schema's safeParse is the validate input".
 */

/**
 * A static sign that hand-written code does this atom's job: every `all` pattern (and at least one `any` pattern,
 * when given) matches inside one function. Patterns are regular expression sources, matched case-sensitively.
 * @typedef {{id: string, all: string[], any?: string[], sentence: string}} AtomSignal
 */

/**
 * The atom's test kit: a node or jest test file that drives every state and every event (testkit.mjs coverage()).
 * @typedef {{file: string, runner: 'node'|'jest'}} AtomTestKit
 */

/**
 * One logic atom. `name`, `kind` and `english` mean what they mean in Smith's registry (toSmithEntry).
 * @typedef {object} AtomDescriptor
 * @property {1} v
 * @property {string} id            ATOM_ID, also the folder name.
 * @property {string} role          One of ATOM_ROLES.
 * @property {string} title         A short plain name, e.g. "Validated submit".
 * @property {string} name          Smith `name`: the camelCase name of the atom's entry function, e.g. "validatedSubmit".
 * @property {'function'} kind      Smith `kind`: an atom is registered as a function.
 * @property {string} english       Smith `english`: the sentence the atom is registered under (one full sentence).
 * @property {AtomPort[]} inputs
 * @property {AtomPort[]} outputs
 * @property {string[]} states      Every state the machine can be in.
 * @property {string} initial       One of `states`.
 * @property {AtomEvent[]} events
 * @property {AtomTransition[]} transitions
 * @property {AtomWraps|null} wraps
 * @property {AtomTestKit} testKit
 * @property {string[]} phrases     Requests that mean this atom ("add a paginated list"), for the drafter.
 * @property {AtomSignal[]} signals Signs of hand-written code doing this atom's job, for LINE-ATOM.
 * @property {string[]} composes    Other atom ids this one is built from.
 */

/**
 * The machine every atom's index.ts exports as `machine`: pure, no timers, no I/O (effects arrive as events).
 * @typedef {object} AtomMachine
 * @property {string} id                                   The atom id.
 * @property {(input?: any) => any} init                   The initial state value (its `status` is the initial state).
 * @property {(state: any, event: {type: string}) => any} send  The next state value; an event a state ignores returns the same value.
 * @property {(state: any) => string} stateOf              The state name of a state value.
 */

/** @param {unknown} c @param {string} msg */
function must(c, msg) {
  if (!c) throw new TypeError(`Atom contract: ${msg}`);
}

const isSentence = (s) => typeof s === 'string' && /^[A-Z"]/.test(s) && /[.?!]$/.test(s) && s.trim().split(/\s+/).length >= 2;
const isText = (s) => typeof s === 'string' && s.trim().length > 0;

/**
 * Throws a TypeError naming the first broken rule of an AtomDescriptor; returns it otherwise.
 * @param {any} a
 * @returns {AtomDescriptor}
 */
export function assertAtom(a) {
  must(a && typeof a === 'object', 'an atom is an object');
  must(a.v === 1, 'v is 1');
  must(typeof a.id === 'string' && ATOM_ID.test(a.id), `id "${a?.id}" is lower-case words joined by hyphens`);
  const at = `atom ${a.id}`;
  must(Object.hasOwn(ATOM_ROLES, a.role), `${at}: role "${a.role}" is one of ${Object.keys(ATOM_ROLES).join(', ')}`);
  must(isText(a.title), `${at}: title is text`);
  must(typeof a.name === 'string' && /^[a-z][a-zA-Z0-9]*$/.test(a.name), `${at}: name is a camelCase function name (Smith's registry name)`);
  must(a.kind === 'function', `${at}: kind is "function" (Smith's registry kind)`);
  must(isSentence(a.english), `${at}: english is one full sentence`);
  for (const [field, list] of [['inputs', a.inputs], ['outputs', a.outputs]]) {
    must(Array.isArray(list) && list.length > 0, `${at}: ${field} is a non-empty list`);
    for (const p of list) {
      must(p && /^[a-z][a-zA-Z0-9]*$/.test(p.name), `${at}: every ${field} entry has a camelCase name`);
      must(isText(p.type), `${at}: ${field} ${p.name} has a type`);
      must(isSentence(p.sentence), `${at}: ${field} ${p.name} has a sentence`);
    }
  }
  must(Array.isArray(a.states) && a.states.length > 0 && a.states.every((s) => STATE_NAME.test(s)), `${at}: states are camelCase names`);
  must(new Set(a.states).size === a.states.length, `${at}: states are unique`);
  must(a.states.includes(a.initial), `${at}: initial is one of the states`);
  must(Array.isArray(a.events) && a.events.length > 0, `${at}: events is a non-empty list`);
  for (const e of a.events) {
    must(e && EVENT_NAME.test(e.type), `${at}: every event type is UPPER_SNAKE`);
    must(isSentence(e.sentence), `${at}: event ${e.type} has a sentence`);
  }
  const eventTypes = new Set(a.events.map((e) => e.type));
  must(eventTypes.size === a.events.length, `${at}: event types are unique`);
  must(Array.isArray(a.transitions) && a.transitions.length > 0, `${at}: transitions is a non-empty list`);
  for (const t of a.transitions) {
    must(t.from === '*' || a.states.includes(t.from), `${at}: transition from "${t.from}" is a state or "*"`);
    must(a.states.includes(t.to), `${at}: transition to "${t.to}" is a state`);
    must(eventTypes.has(t.event), `${at}: transition event "${t.event}" is an event`);
  }
  for (const e of eventTypes) must(a.transitions.some((t) => t.event === e), `${at}: event ${e} appears in a transition`);
  for (const s of a.states) must(s === a.initial || a.transitions.some((t) => t.to === s), `${at}: state ${s} is reachable`);
  if (a.wraps !== null) {
    must(a.wraps && isText(a.wraps.library) && isText(a.wraps.license) && isText(a.wraps.concept) && isSentence(a.wraps.adapter), `${at}: wraps is null or {library, license, concept, adapter}`);
  }
  must(a.testKit && TEST_RUNNERS.includes(a.testKit.runner) && isText(a.testKit.file), `${at}: testKit names a file and a runner (node or jest)`);
  must(Array.isArray(a.phrases) && a.phrases.length > 0 && a.phrases.every(isText), `${at}: phrases is a non-empty list of requests`);
  must(Array.isArray(a.signals), `${at}: signals is a list`);
  for (const s of a.signals) {
    must(isText(s.id) && Array.isArray(s.all) && s.all.length > 0 && isSentence(s.sentence), `${at}: every signal has an id, at least one "all" pattern and a sentence`);
    for (const p of [...s.all, ...(s.any ?? [])]) {
      try { new RegExp(p); } catch { must(false, `${at}: signal ${s.id} pattern ${p} is a regular expression`); }
    }
  }
  must(Array.isArray(a.composes) && a.composes.every((c) => ATOM_ID.test(c) && c !== a.id), `${at}: composes lists other atom ids`);
  return a;
}

/**
 * The atom as an entry of Smith's registry (atomic-codemod registry.js): the same `name`, `kind` and `english`, with
 * the id in Smith's "<kind>:<name>:<n>" form. `code` is the atom's source when given; the fingerprint and embedding
 * are left for Smith to compute when it registers the entry.
 * @param {AtomDescriptor} atom
 * @param {{n?: number, code?: string}} [o]
 * @returns {{id: string, name: string, kind: 'function', code: string|null, english: string, line: {atom: string, role: string}}}
 */
export function toSmithEntry(atom, o = {}) {
  return { id: `${atom.kind}:${atom.name}:${o.n ?? 0}`, name: atom.name, kind: atom.kind, code: o.code ?? null, english: atom.english, line: { atom: atom.id, role: atom.role } };
}

/**
 * A LINE-ATOM finding: hand-written code that does an atom's job.
 * @typedef {object} AtomFinding
 * @property {'LINE-ATOM'} rule
 * @property {string} file
 * @property {number} line
 * @property {string} fn          The enclosing function's name ("<module>" at the top level).
 * @property {string} atom        The atom id.
 * @property {string} signal      The signal id that matched.
 * @property {string} message     Full plain-English sentences: what is wrong and what to do.
 * @property {AtomFix[]} fixes
 */

/**
 * The typed fix of a LINE-ATOM finding, "use atom X". `step` is a plan step when Line can make the change itself, else
 * null with the sentence saying what to do (rewriting hand-written logic is not mechanical yet).
 * @typedef {{id: string, sentence: string, rank: number, atom: string, import: string, step: null}} AtomFix
 */

/**
 * What the drafter gets back for a request that names an atom's job.
 * @typedef {{id: string, role: string, title: string, sentence: string, confidence: number, import: string}} AtomMatch
 */

/**
 * One unit of a logic map mapped onto an atom (or not), for the north-star metric.
 * @typedef {{id: string, kind: string, atom: string|null, role: string|null, via: string}} UnitAtom
 */
