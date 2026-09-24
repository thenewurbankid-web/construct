// #617 -- the decision-provider seam: given a chooser's summary (chooser.mjs `chooserSummary`), a provider suggests ONE
// enabled option, a short reason and a runner-up. It only suggests. It never executes, never sees a path, a credential
// or a project file, and nothing it returns is trusted:
//
//   provider   { suggest(summary) => { option, reason, runnerUp? } | null | Promise<...> }
//   'rules'    built in, frozen, deterministic, needs no model: the first enabled option, the next one as runner-up.
//   'off'      built in: never suggests (the per-project switch-off).
//   plugin     registered by name (`registerDecisionProvider`), e.g. the jev decision model (#633). It receives a deep-frozen
//              COPY of the summary and nothing else.
//
// `suggest()` is the only entry point a caller uses: it hands the provider the frozen summary copy, then validates what
// comes back (the option must be an enabled option of THIS summary, the reason a short string) and answers `null` on
// anything else, a throw or a hang included. A plugin returning junk therefore costs a person nothing.
// Pure: no filesystem, no network, no model of its own. Decision record: docs/BLOCK-CONTRACT.md ("Choosers").

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

/** Longest reason kept; a provider's reason is one short line for a person to read. */
export const REASON_MAX_LENGTH = 200;
/** How long `suggest` waits for a provider before answering `null` (a hung plugin never blocks a chooser). */
export const DEFAULT_TIMEOUT_MS = 5000;
/** The provider used when none is named. */
export const DEFAULT_PROVIDER = 'rules';

/**
 * @typedef {{ option: string, reason: string, runnerUp: string | null, provider: string }} Suggestion
 * A validated suggestion: `option` and `runnerUp` are enabled option ids of the summary the provider was given.
 *
 * @typedef {{ suggest: (summary: object) => any }} DecisionProvider
 * The whole interface. `suggest` receives the chooser summary only and may be sync or async.
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
  suggest(summary) {
    const [first, second] = enabledIds(summary);
    return first === undefined ? null : { option: first, reason: 'first available step', runnerUp: second ?? null };
  },
});

const offProvider = deepFreeze({ name: 'off', suggest: () => null });

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

/** What a provider answered, reduced to the fields we accept, or null. Nothing else it returned (functions, extra keys) survives. */
function accept(raw, summary, provider) {
  if (!isPlainObject(raw)) return null;
  const enabled = enabledIds(summary);
  if (!enabled.includes(raw.option)) return null;
  if (!isNonEmptyString(raw.reason)) return null;
  const reason = raw.reason.replace(/\s+/g, ' ').trim().slice(0, REASON_MAX_LENGTH);
  if (!reason) return null;
  const runnerUp = enabled.includes(raw.runnerUp) && raw.runnerUp !== raw.option ? raw.runnerUp : null;
  return { option: raw.option, reason, runnerUp, provider };
}

/**
 * Ask a provider which option to take, from the summary alone. Never throws: an unknown provider, a provider that
 * throws, hangs, or answers with anything but an enabled option of this summary and a reason yields `null`, and the
 * caller falls back to the person's own choice. The provider gets a deep-frozen copy of the summary and nothing else.
 *
 * @param {object} summary A `chooserSummary` result.
 * @param {{ provider?: string, timeoutMs?: number }} [options] Provider name (default `rules`) and the wait limit.
 * @returns {Promise<Suggestion | null>} The validated suggestion, or `null`.
 *
 * @example
 * await suggest(chooserSummary(chooser, {}), { provider: 'rules' });
 * // => { option: 'new-feature', reason: 'first available step', runnerUp: 'new-unit', provider: 'rules' }
 */
export async function suggest(summary, options = {}) {
  const name = options.provider ?? DEFAULT_PROVIDER;
  const provider = typeof name === 'string' ? getDecisionProvider(name) : undefined;
  if (!provider || !isSummary(summary)) return null;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  let timer;
  try {
    const copy = deepFreeze(structuredClone(summary));
    const raw = await Promise.race([
      Promise.resolve().then(() => provider.suggest(copy)),
      new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs, null); }),
    ]);
    return accept(raw, summary, name);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
