// #617 -- the decision-provider seam: given a chooser's summary (chooser.mjs `chooserSummary`), a provider suggests ONE
// enabled option, a short reason and a runner-up. It only suggests. It never executes, never sees a path, a credential
// or a project file, and nothing it returns is trusted:
//
//   provider   { name, version, suggest(summary) => { option, reason, score?, runnerUp? } | null | Promise<...> }
//   'rules'    built in, frozen, deterministic, needs no model: the first enabled option, the next one as runner-up.
//   'off'      built in: never suggests (the per-project switch-off).
//   plugin     registered by name (`registerDecisionProvider`), e.g. the jev decision model (#633), or loaded for one project
//              from architecture.yml (decision-plugin.mjs, decision-project.mjs). It receives a deep-frozen COPY of the
//              summary and nothing else.
//
// `suggest()` is the only entry point a caller uses: it hands the provider the frozen summary copy, then validates what
// comes back (the option must be an enabled option of THIS summary, the reason a short string) and answers `null` on
// anything else, a throw or a hang included. A plugin returning junk therefore costs a person nothing.
// #633: `askProvider` is the same call with a verdict (`ok`, `abstained`, `timeout`, `error`, `invalid`, `bad-summary`), which
// the project suggester needs to fall back to the rules provider on an ERROR but not on an abstention. The summary a provider
// gets is reduced to the four fixed fields, path-hidden, refused when a secret is in it, and frozen.
// Pure: no filesystem, no network, no model of its own. Decision record: docs/BLOCK-CONTRACT.md ("Choosers"), docs/DECISION-PROVIDERS.md.
import { hidePathsDeep, looksLikeSecret } from './redaction.mjs';

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

/** Longest reason kept; a provider's reason is one short line for a person to read. */
export const REASON_MAX_LENGTH = 200;
/** How long `suggest` waits for a provider before answering `null` (a hung plugin never blocks a chooser). */
export const DEFAULT_TIMEOUT_MS = 3000;
/** The most a summary handed to a provider may weigh, and the most options it may hold: a summary has a fixed, small size. */
export const SUMMARY_LIMITS = Object.freeze({ bytes: 16 * 1024, maxOptions: 5 });
/** The provider used when none is named. */
export const DEFAULT_PROVIDER = 'rules';

/**
 * @typedef {{ option: string, reason: string, runnerUp: string | null, provider: string, version: string, score?: number }} Suggestion
 * A validated suggestion: `option` and `runnerUp` are enabled option ids of the summary the provider was given; `score`
 * (0 to 1) is kept only when the provider gave a valid one; `version` is the provider's own, `unversioned` when it has none.
 *
 * @typedef {{ name?: string, version?: string, suggest: (summary: object) => any }} DecisionProvider
 * The whole interface. `suggest` receives the chooser summary only and may be sync or async.
 *
 * @typedef {'ok' | 'abstained' | 'timeout' | 'error' | 'invalid' | 'bad-summary'} AskStatus
 * `ok` a valid suggestion; `abstained` the provider answered null or nothing (it does not know); `timeout` no answer in
 * time; `error` it threw or rejected; `invalid` it answered something that is not an enabled option and a reason;
 * `bad-summary` the summary itself was refused (not a summary, too big, a secret in it) and no provider was called.
 */

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
};

const enabledIds = (summary) => summary.options.filter((o) => o.enabled).map((o) => o.id);

const rulesProvider = deepFreeze({
  name: 'rules',
  version: '1', // recorded beside every suggestion in a decision trace (#643); a plugin may carry its own `version`
  suggest(summary) {
    const [first, second] = enabledIds(summary);
    return first === undefined ? null : { option: first, reason: 'first available step', runnerUp: second ?? null };
  },
});

const offProvider = deepFreeze({ name: 'off', version: '1', suggest: () => null });

const BUILT_IN = Object.freeze({ rules: rulesProvider, off: offProvider });
const registry = new Map(Object.entries(BUILT_IN));

/**
 * Register a decision provider (a plugin) under a name. The built-ins `rules` and `off` cannot be replaced.
 *
 * @param {string} name A non-empty name, e.g. `jev`.
 * @param {DecisionProvider} provider An object with a `suggest(summary)` function.
 * @returns {DecisionProvider} The provider.
 * @throws {TypeError} For a bad name or provider, or an attempt to replace a built-in (a wiring mistake, not user input).
 *
 * @example
 * registerDecisionProvider('jev', { suggest: async (summary) => ({ option: 'new-feature', reason: 'no feature yet', runnerUp: null }) });
 */
export function registerDecisionProvider(name, provider) {
  if (!isNonEmptyString(name)) throw new TypeError('A decision provider needs a non-empty name.');
  if (Object.hasOwn(BUILT_IN, name)) throw new TypeError(`"${name}" is a built-in decision provider and cannot be replaced.`);
  if (!provider || typeof provider !== 'object') throw new TypeError(`Decision provider "${name}" must be an object with a suggest(summary) function.`);
  if (typeof provider?.suggest !== 'function') throw new TypeError(`Decision provider "${name}" must have a suggest(summary) function.`);
  registry.set(name, provider);
  return provider;
}

/**
 * Remove a registered plugin (the per-project "switch it off", and test cleanup). The built-ins stay.
 *
 * @param {string} name The plugin's name.
 * @returns {boolean} `true` when a plugin was removed.
 *
 * @example
 * unregisterDecisionProvider('jev'); // => true
 */
export function unregisterDecisionProvider(name) {
  return !Object.hasOwn(BUILT_IN, name) && registry.delete(name);
}

/**
 * Look a provider up by name.
 *
 * @param {string} [name] Provider name; defaults to `rules`.
 * @returns {DecisionProvider | undefined} The provider, or `undefined` when none is registered under that name.
 *
 * @example
 * getDecisionProvider('rules').suggest(summary);
 */
export function getDecisionProvider(name = DEFAULT_PROVIDER) {
  return registry.get(name);
}

/**
 * The registered provider names, built-ins first, in registration order.
 *
 * @returns {string[]} Names.
 *
 * @example
 * listDecisionProviders(); // => ['rules', 'off']
 */
export function listDecisionProviders() {
  return [...registry.keys()];
}

function isSummary(summary) {
  return isPlainObject(summary) && isNonEmptyString(summary.id) && Array.isArray(summary.options)
    && summary.options.every((o) => isPlainObject(o) && isNonEmptyString(o.id) && typeof o.enabled === 'boolean');
}

/**
 * The summary a provider receives: exactly `{ id, question, options: [{ id, label, enabled, why }], chosen }`, every path
 * hidden, deep-frozen, and nothing else of what the caller held. `null` when the input is not a summary, has more than
 * `SUMMARY_LIMITS.maxOptions` options, weighs more than `SUMMARY_LIMITS.bytes`, or holds a secret-shaped string (a secret
 * is refused, never repaired).
 *
 * @param {unknown} summary A chooser summary, or a card or placement question in the same shape.
 * @returns {object | null} The frozen copy a provider gets, or `null`.
 *
 * @example
 * providerInput({ id: 'q', question: 'Read /etc/x?', options: [{ id: 'a', enabled: true }], chosen: null }).question; // => 'Read [path]?'
 */
export function providerInput(summary) {
  if (!isSummary(summary) || summary.options.length > SUMMARY_LIMITS.maxOptions) return null;
  const text = (v) => (typeof v === 'string' ? v : '');
  const copy = hidePathsDeep({
    id: summary.id,
    question: text(summary.question),
    options: summary.options.map((o) => ({ id: o.id, label: text(o.label), enabled: o.enabled, why: text(o.why) })),
    chosen: typeof summary.chosen === 'string' ? summary.chosen : null,
  });
  const json = JSON.stringify(copy);
  if (json.length > SUMMARY_LIMITS.bytes || looksLikeSecret(json)) return null;
  return deepFreeze(copy);
}

const versionOf = (provider) => (isNonEmptyString(provider?.version) ? provider.version : 'unversioned');

/** What a provider answered, reduced to the fields we accept, or null. Nothing else it returned (functions, extra keys) survives. */
function accept(raw, summary, name, provider) {
  if (!isPlainObject(raw)) return null;
  const enabled = enabledIds(summary);
  if (!enabled.includes(raw.option)) return null;
  if (!isNonEmptyString(raw.reason)) return null;
  const reason = raw.reason.replace(/\s+/g, ' ').trim().slice(0, REASON_MAX_LENGTH);
  if (!reason) return null;
  const runnerUp = enabled.includes(raw.runnerUp) && raw.runnerUp !== raw.option ? raw.runnerUp : null;
  const out = { option: raw.option, reason, runnerUp, provider: name, version: versionOf(provider) };
  if (typeof raw.score === 'number' && Number.isFinite(raw.score) && raw.score >= 0 && raw.score <= 1) out.score = raw.score;
  return out;
}

/**
 * Ask ONE provider object which option to take, and say how it went. The provider gets `providerInput(summary)` and nothing
 * else (no second argument); what it answers is validated and reduced to a `Suggestion`. Never throws.
 *
 * @param {DecisionProvider} provider The provider (a built-in, a registered plugin or a plugin loaded for one project).
 * @param {object} summary A chooser summary.
 * @param {{ name?: string, timeoutMs?: number }} [options] The name recorded on the suggestion (default the provider's own) and the wait limit.
 * @returns {Promise<{ status: AskStatus, suggestion: Suggestion | null, detail?: string }>} The verdict; `suggestion` is set only for `ok`.
 *
 * @example
 * (await askProvider(getDecisionProvider('rules'), summary)).status; // => 'ok'
 */
export async function askProvider(provider, summary, options = {}) {
  const name = options.name ?? provider?.name ?? 'unnamed';
  const input = providerInput(summary);
  if (!input) return { status: 'bad-summary', suggestion: null, detail: 'the summary is not a fixed-size summary without a secret' };
  if (typeof provider?.suggest !== 'function') return { status: 'error', suggestion: null, detail: 'the provider has no suggest function' };
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const TIMED_OUT = Symbol('timeout');
  let timer;
  try {
    const raw = await Promise.race([
      Promise.resolve().then(() => provider.suggest(input)),
      new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs, TIMED_OUT); }),
    ]);
    if (raw === TIMED_OUT) return { status: 'timeout', suggestion: null, detail: `no answer within ${timeoutMs} ms` };
    if (raw === null || raw === undefined) return { status: 'abstained', suggestion: null };
    const suggestion = accept(raw, input, name, provider);
    return suggestion ? { status: 'ok', suggestion } : { status: 'invalid', suggestion: null, detail: 'the answer is not an enabled option of the summary with a reason' };
  } catch (e) {
    return { status: 'error', suggestion: null, detail: String(e?.message ?? e).split('\n')[0].slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask a registered provider which option to take, from the summary alone. Never throws: an unknown provider, a provider that
 * throws, hangs, or answers with anything but an enabled option of this summary and a reason yields `null`, and the
 * caller falls back to the person's own choice. The provider gets a deep-frozen, path-hidden copy of the summary and nothing else.
 *
 * @param {object} summary A `chooserSummary` result.
 * @param {{ provider?: string, timeoutMs?: number }} [options] Provider name (default `rules`) and the wait limit (default 3 s).
 * @returns {Promise<Suggestion | null>} The validated suggestion, or `null`.
 *
 * @example
 * await suggest(chooserSummary(chooser, {}), { provider: 'rules' });
 * // => { option: 'new-feature', reason: 'first available step', runnerUp: 'new-unit', provider: 'rules', version: '1' }
 */
export async function suggest(summary, options = {}) {
  const name = options.provider ?? DEFAULT_PROVIDER;
  const provider = typeof name === 'string' ? getDecisionProvider(name) : undefined;
  if (!provider) return null;
  return (await askProvider(provider, summary, { name, timeoutMs: options.timeoutMs })).suggestion;
}
