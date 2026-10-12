// Line logic verification, spec D: the RECORDING-FAKE interfaces isolated execution swaps in for a unit's imports
// (router, fetch/axios, store/dispatch, storage, toast, analytics, timers, the minimal DOM stub), the record each fake
// writes, and the sentinel marker format. Interfaces and the sentinel helpers only; the fakes themselves are step 4.
//
// Reused, not reinvented:
//   op names       the characterizer's effect labels (characterize/runtime.cjs recorder/wrapMethod): `router.push`,
//                  `router.navigate`, `storage.setItem`, `mutation:<name>`, `<export>.<method>` for spied objects
//   arg shapes     G2 graph/runtime/recorder.cjs shapeOf (type tags and keys only, never values)
//   fetch key      G2 recorder.cjs urlPattern (ids become :id, query values dropped) and the method, as RuntimeRecord fetch
//   store key      G2 RuntimeRecord dispatch: the action type
//   fixed env      the characterizer's beforeEachScenario: system time 2026-01-15T10:00:00.000Z, mulberry32(42)
//   network kinds  Morpheus behavior/types.ts NetworkCall {method, url, kind}
import { EFFECT_NAMES } from './contract.mjs';

/** @typedef {import('./contract.mjs').EffectName} EffectName */

/**
 * One thing a fake saw a unit do. Shapes and names from the code only: never a runtime value.
 * @typedef {object} EffectRecord
 * @property {number} seq             Order within the run, from 0.
 * @property {EffectName} effect
 * @property {string} op              The characterizer's label: `router.push`, `storage.setItem`, `toast.success` ...
 * @property {string} [key]           A name the code chose: the action type, storage key, URL pattern, event name.
 * @property {string} [method]        fetch only: GET, POST ...
 * @property {string[]} args          One G2 shapeOf string per argument.
 * @property {string[]} sentinels     Sentinel ids (sentinelId) found anywhere inside the arguments.
 */

/**
 * A state transition a unit made (G2 RuntimeRecord `state`): the state's name and the action type, never the value.
 * @typedef {{seq: number, key: string, action?: string}} StateTransition
 */

/**
 * What isolated execution records for one run of one unit (spec D "Recorded per unit").
 * @typedef {object} UnitRun
 * @property {string[]} inputs        shapeOf per argument (or `event` / `props` for handlers and hooks).
 * @property {string} output          shapeOf the return value (`undefined` when none).
 * @property {string|null} thrown     The error's constructor name, or null.
 * @property {EffectRecord[]} effects
 * @property {StateTransition[]} transitions
 * @property {string[]} sentinels     Sentinel ids found in the output, effects and requests.
 * @property {{covered: number, total: number}} [branches]  V8 branch coverage of the unit.
 */

/**
 * The fixed environment every run gets.
 * @typedef {{now: string, seed: number, locale: string, timeZone: string}} FakeEnv
 */

// ---- the fake interfaces (implemented in step 4) -------------------------------------------------------------------

/**
 * Router: next/navigation, next/router and react-router's navigate. Every call records effect `navigation`, op
 * `router.<method>`, key the target's urlPattern. pathname and search come from the scenario.
 * @typedef {object} RouterFake
 * @property {(href: string, opts?: object) => void} push
 * @property {(href: string, opts?: object) => void} replace
 * @property {() => void} back
 * @property {() => void} forward
 * @property {() => void} refresh
 * @property {(href: string) => void} prefetch
 * @property {(to: string|number, opts?: object) => void} navigate
 * @property {string} pathname
 * @property {URLSearchParams} searchParams
 */

/**
 * A canned answer, keyed `<METHOD> <urlPattern>`; status and body come from the fixture, never the network.
 * @typedef {{status: number, body: unknown, headers?: Record<string, string>}} FakeResponse
 */

/**
 * fetch and axios. Every request records effect `fetch`, op `fetch` or `axios.<method>`, method and key the urlPattern.
 * An unknown route answers 404 and is recorded all the same; nothing leaves the process.
 * @typedef {object} NetworkFake
 * @property {(input: string|{url: string}, init?: {method?: string, body?: unknown}) => Promise<{ok: boolean, status: number, json: () => Promise<unknown>, text: () => Promise<string>}>} fetch
 * @property {{get: Function, post: Function, put: Function, patch: Function, delete: Function, request: Function}} axios
 * @property {(route: string, answer: FakeResponse) => void} answer  Register `<METHOD> <urlPattern>`.
 */

/**
 * Store: redux / RTK dispatch. dispatch records effect `store`, op `store.dispatch`, key the action type.
 * @typedef {object} StoreFake
 * @property {(action: {type: string}|Function) => unknown} dispatch
 * @property {() => unknown} getState
 * @property {(fn: () => void) => () => void} subscribe
 */

/**
 * localStorage / sessionStorage. Writes record effect `storage`, op `storage.<method>`, key the storage key.
 * @typedef {object} StorageFake
 * @property {(key: string) => string|null} getItem
 * @property {(key: string, value: string) => void} setItem
 * @property {(key: string) => void} removeItem
 * @property {() => void} clear
 * @property {(i: number) => string|null} key
 * @property {number} length
 */

/**
 * Toast: every method records effect `toast`, op `toast.<method>`.
 * @typedef {{success: Function, error: Function, info: Function, warning: Function, show: Function, dismiss: Function}} ToastFake
 */

/**
 * Analytics: every method records effect `analytics`, op `analytics.<method>`, key the event name.
 * @typedef {{track: Function, page: Function, identify: Function}} AnalyticsFake
 */

/**
 * Timers under a fake clock (FakeEnv.now): scheduling records effect `timer`, op `timer.setTimeout` ...; nothing runs
 * until advance or runAll. Date.now and new Date() read the clock (effect `time` is recorded once per run, not per read).
 * @typedef {object} ClockFake
 * @property {() => number} now
 * @property {(ms: number) => void} advance
 * @property {() => void} runAll
 * @property {Function} setTimeout
 * @property {Function} clearTimeout
 * @property {Function} setInterval
 * @property {Function} clearInterval
 * @property {(cb: Function) => number} requestAnimationFrame
 */

/**
 * The minimal DOM stub, installed only when a unit touches document, window, refs or storage; happy-dom is the
 * fallback when the stub is not enough. Listener adds and the methods below record effect `dom`, op `dom.<name>`.
 * @typedef {object} DomStub
 * @property {{title: string, cookie: string, visibilityState: 'visible'|'hidden', hidden: boolean, getElementById: Function, querySelector: Function, addEventListener: Function, removeEventListener: Function}} document
 * @property {{innerWidth: number, innerHeight: number, scrollX: number, scrollY: number, location: {pathname: string, search: string, href: string}, addEventListener: Function, removeEventListener: Function, scrollTo: Function, matchMedia: (q: string) => object}} window
 * @property {<T>(current?: T) => {current: T|null}} ref
 * @property {(type: string, init?: object) => void} dispatch  Fire a window or document event under the fake clock.
 */

/**
 * Everything one run swaps in, plus what it recorded.
 * @typedef {object} RecordingFakes
 * @property {FakeEnv} env
 * @property {RouterFake} router
 * @property {NetworkFake} network
 * @property {StoreFake} store
 * @property {{local: StorageFake, session: StorageFake}} storage
 * @property {ToastFake} toast
 * @property {AnalyticsFake} analytics
 * @property {ClockFake} clock
 * @property {() => number} random   Seeded (FakeEnv.seed).
 * @property {DomStub|null} dom      null until the unit touches the DOM.
 * @property {() => EffectRecord[]} effects
 * @property {() => StateTransition[]} transitions
 * @property {() => void} reset
 */

/** The fixed environment (the characterizer's time and seed; a fixed locale and time zone). */
export const FAKE_ENV = Object.freeze(/** @type {FakeEnv} */ ({ now: '2026-01-15T10:00:00.000Z', seed: 42, locale: 'en-US', timeZone: 'UTC' }));
/** The fakes a run may install, and the effect each records. */
export const FAKE_EFFECTS = Object.freeze(/** @type {Record<string, EffectName>} */ ({
  router: 'navigation', network: 'fetch', store: 'store', storage: 'storage', toast: 'toast', analytics: 'analytics', clock: 'timer', random: 'random', dom: 'dom',
}));
/** happy-dom is used only when the stub is not enough. */
export const DOM_FALLBACK = 'happy-dom';

// ---- sentinels -----------------------------------------------------------------------------------------------------
// A sentinel is a unique string planted in fixture data; finding it in an output, an effect's arguments or a request
// proves the data flowed there, without recording the value. Format: `__line_<seed 8 hex>_<n>__`. ASCII letters,
// digits and underscores only, so it survives JSON, URL encoding, HTML and template literals unchanged. Numbers and
// booleans cannot carry a marker; their flow is shown by shape alone.

/** One sentinel (not global: callers that scan text use findSentinels). */
export const SENTINEL_PATTERN = /__line_([0-9a-f]{8})_(\d+)__/;

/**
 * The n-th sentinel of a run.
 * @param {number} seed Unsigned 32-bit run seed.
 * @param {number} n From 0.
 * @returns {string}
 */
export function sentinel(seed, n) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError('The sentinel seed must be an unsigned 32-bit integer.');
  if (!Number.isInteger(n) || n < 0) throw new TypeError('The sentinel number must be an integer from 0.');
  return `__line_${seed.toString(16).padStart(8, '0')}_${n}__`;
}

/**
 * The sentinel ids (`<seed>_<n>`) inside a string, in order of first appearance, each once.
 * @param {string} text
 * @returns {string[]}
 */
export function findSentinels(text) {
  const out = new Set();
  for (const m of String(text).matchAll(new RegExp(SENTINEL_PATTERN.source, 'g'))) out.add(`${m[1]}_${m[2]}`);
  return [...out];
}

// ---- shape checks --------------------------------------------------------------------------------------------------

const fail = (where, what) => { throw new TypeError(`${where} must ${what}.`); };
const SENTINEL_ID = /^[0-9a-f]{8}_\d+$/;
// A shape never holds a quote (a string value) or a sentinel (a planted value).
const leaks = (s) => typeof s !== 'string' || s.length === 0 || /["'`]/.test(s) || /__line_[0-9a-f]{8}_\d+__/.test(s);

/**
 * Throw a one-sentence TypeError unless `r` is an EffectRecord holding shapes and names only.
 * @param {any} r
 * @param {string} [where]
 * @returns {asserts r is EffectRecord}
 */
export function assertEffectRecord(r, where = 'The effect record') {
  if (!r || typeof r !== 'object') fail(where, 'be an object');
  if (!Number.isInteger(r.seq) || r.seq < 0) fail(`${where}'s seq`, 'be an integer from 0');
  if (!EFFECT_NAMES.includes(r.effect)) fail(`${where}'s effect`, `be one of ${EFFECT_NAMES.join(', ')}`);
  if (leaks(r.op)) fail(`${where}'s op`, 'be a label like router.push, never a value');
  if (r.key !== undefined && leaks(r.key)) fail(`${where}'s key`, 'be a name from the code, never a value');
  if (r.method !== undefined && !/^[A-Z]+$/.test(r.method)) fail(`${where}'s method`, 'be an upper-case HTTP method');
  if (!Array.isArray(r.args)) fail(`${where}'s args`, 'be an array');
  r.args.forEach((a, i) => { if (leaks(a)) fail(`${where}'s args[${i}]`, 'be a shape, never a value'); });
  if (!Array.isArray(r.sentinels)) fail(`${where}'s sentinels`, 'be an array');
  r.sentinels.forEach((s, i) => { if (!SENTINEL_ID.test(s)) fail(`${where}'s sentinels[${i}]`, 'be a sentinel id like 0000002a_0'); });
  const extra = Object.keys(r).filter((k) => !['seq', 'effect', 'op', 'key', 'method', 'args', 'sentinels'].includes(k));
  if (extra.length) fail(`${where}'s field ${extra[0]}`, 'not exist, because a record holds shapes and names only');
}

/**
 * Throw a one-sentence TypeError unless `u` is a UnitRun.
 * @param {any} u
 * @returns {asserts u is UnitRun}
 */
export function assertUnitRun(u) {
  if (!u || typeof u !== 'object') fail('The unit run', 'be an object');
  if (!Array.isArray(u.inputs) || u.inputs.some(leaks)) fail("The unit run's inputs", 'be shapes, never values');
  if (leaks(u.output)) fail("The unit run's output", 'be a shape, never a value');
  if (u.thrown !== null && (typeof u.thrown !== 'string' || !/^[A-Z]\w*$/.test(u.thrown))) fail("The unit run's thrown", 'be null or an error constructor name');
  if (!Array.isArray(u.effects)) fail("The unit run's effects", 'be an array');
  u.effects.forEach((r, i) => assertEffectRecord(r, `Effect record ${i}`));
  if (!Array.isArray(u.transitions)) fail("The unit run's transitions", 'be an array');
  u.transitions.forEach((t, i) => { if (!t || !Number.isInteger(t.seq) || leaks(t.key) || (t.action !== undefined && leaks(t.action))) fail(`State transition ${i}`, 'be {seq, key, action?} with names only'); });
  if (!Array.isArray(u.sentinels) || u.sentinels.some((s) => !SENTINEL_ID.test(s))) fail("The unit run's sentinels", 'be sentinel ids');
  if (u.branches !== undefined && !(Number.isInteger(u.branches?.covered) && Number.isInteger(u.branches.total) && u.branches.covered <= u.branches.total)) fail("The unit run's branches", 'be {covered, total} with covered at most total');
}
