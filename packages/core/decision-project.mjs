// #633 (epic #616) -- the decision provider of ONE project: read `decision: { provider, plugin, timeoutMs }` from
// architecture.yml, load the plugin lazily (only when it is named and is not `rules` or `off`), and answer "which option would
// you suggest?" for any closed question of a chain, with a fallback that costs the person nothing.
//
//   const decision = await openDecision(root);                 // reads the setting, loads a named plugin
//   const s = await decision.suggest(summary);                 // Suggestion | null (never throws, never executes)
//   decision.provider   // { name, version }: who actually answers (the rules provider after a fallback)
//   decision.notes      // path-free lines: every load and every fallback, also handed to `options.log`
//
// The rules:
//   - `rules` (the default) and `off` are built in; a plugin is loaded only for another name, from `decision.plugin` inside the
//     project (decision-plugin.mjs), or found in the registry when a caller registered it (tests, `--plugin`);
//   - a plugin that cannot be loaded, is not allowed here (`allowPlugins: false`), throws, is slow (`timeoutMs`, default 3 s)
//     or answers junk is REPLACED by the rules provider for that question, and the line says so. After one such failure in a
//     request the plugin is not called again by this object: a slow model costs one timeout per request, not one per question.
//     An abstention (the plugin answers null) is not a failure: there is simply no suggestion;
//   - every line is path-free and secret-free (a line that would hold either is replaced by a generic one), so it can be logged,
//     returned by an API and kept next to a decision trace;
//   - the plugin's answers are cached per (project, provider, version, summary) so a stateless caller that replays a whole chain
//     on every request asks the model once per question, not once per request. Only answers and abstentions are cached, never a
//     failure, so a plugin that gets fixed recovers.
// Suggest-only: nothing here writes a file or applies an option. Decision record: docs/DECISION-PROVIDERS.md.
import { loadConfig, DEFAULT_DECISION } from './config.mjs';
import { getDecisionProvider, askProvider, DEFAULT_TIMEOUT_MS } from './decision-provider.mjs';
import { loadDecisionPlugin } from './decision-plugin.mjs';
import { hidePaths, looksLikeSecret } from './redaction.mjs';

const CACHE_MAX = 500;
const answerCache = new Map();
const remember = (key, value) => {
  if (answerCache.size >= CACHE_MAX) answerCache.delete(answerCache.keys().next().value);
  answerCache.set(key, value);
};

/**
 * What one closed question of a chain looks like to a provider: `{ id, question, options: [{ id, label, enabled, why }], chosen: null }`
 * (the question as it is OFFERED; never the answer). Card questions, placement questions and offers all reduce to it.
 *
 * @param {{ id: string, question: string, options: { id: string, label?: string, enabled?: boolean, why?: string }[] }} q A question.
 * @returns {{ id: string, question: string, options: object[], chosen: null }} The summary.
 *
 * @example
 * questionSummary(card.open[0] && openQuestion(card, card.open[0])).chosen; // => null
 */
export function questionSummary(q) {
  return {
    id: q.id,
    question: q.question,
    options: (q.options ?? []).map((o) => ({ id: o.id, label: o.label ?? '', enabled: o.enabled !== false, why: o.why ?? '' })),
    chosen: null,
  };
}

/**
 * The provider's suggestion for each question, by question id: `{ option, reason, runnerUp, score?, provider: { name, version },
 * fellBackFrom? }`. A question the provider gave no suggestion for is left out. When the rules provider answers a question that
 * already carries a rule of its own with the same option (the list offer of `placeCard` knows WHY a plural data object wants a
 * list), that more specific reason is kept instead of "first available step". Suggest-only: nothing is chosen.
 *
 * @param {ProjectDecision} decision From `openDecision`.
 * @param {{ id: string, question: string, options: object[], suggestion?: { option: string, reason: string } }[]} questions The open questions and offers.
 * @returns {Promise<Record<string, { option: string, reason: string, runnerUp: string | null, score?: number, provider: { name: string, version: string }, fellBackFrom?: string }>>} Suggestions by question id.
 *
 * @example
 * (await suggestForQuestions(decision, open))['o1'].option; // => 'entity'
 */
export async function suggestForQuestions(decision, questions) {
  const out = {};
  for (const q of questions) {
    const s = await decision.suggest(questionSummary(q));
    if (!s) continue;
    const own = s.provider === 'rules' && q.suggestion?.option === s.option ? q.suggestion.reason : null;
    out[q.id] = {
      option: s.option,
      reason: own ?? s.reason,
      runnerUp: s.runnerUp,
      ...(s.score === undefined ? {} : { score: s.score }),
      provider: { name: s.provider, version: s.version },
      ...(s.fellBackFrom ? { fellBackFrom: s.fellBackFrom } : {}),
    };
  }
  return out;
}

/** Forget every cached plugin answer (tests, and a server that wants a clean slate). */
export function clearDecisionCache() {
  answerCache.clear();
}

const safeLine = (text) => {
  const line = hidePaths(String(text)).replace(/\s+/g, ' ').trim().slice(0, 240);
  return looksLikeSecret(line) ? 'decision: (a line that held a secret-shaped text was replaced)' : line;
};

/**
 * @typedef {import('./decision-provider.mjs').Suggestion & { fellBackFrom?: string }} ProjectSuggestion
 * A suggestion; `fellBackFrom` names the plugin that failed when the rules provider answered in its place.
 *
 * @typedef {{
 *   requested: string,
 *   provider: { name: string, version: string },
 *   fellBackFrom: string | null,
 *   notes: string[],
 *   timeoutMs: number,
 *   suggest: (summary: object) => Promise<ProjectSuggestion | null>,
 * }} ProjectDecision
 * `requested` is what the setting (or the caller) asked for; `provider` is who answers now; `fellBackFrom` is set when that is
 * the rules provider because the requested one could not be used; `notes` are the lines logged so far.
 */

/**
 * Open the decision provider of a project. Never throws: an unreadable setting, an unknown provider, a plugin that is refused or
 * fails to load all end with the rules provider answering and a line saying why.
 *
 * @param {string} root The project root (its `architecture.yml` holds the setting).
 * @param {{ provider?: string, plugin?: string, timeoutMs?: number, allowPlugins?: boolean, log?: (line: string) => void }} [options]
 *   `provider` and `plugin` override the setting for this call (the `--provider` and `--plugin` flags of `construct decide`);
 *   `allowPlugins: false` refuses to import any plugin file (a hosted server that has not opted in); `log` receives each new line.
 * @returns {Promise<ProjectDecision>} The project's decision provider.
 *
 * @example
 * const decision = await openDecision(root);
 * const s = await decision.suggest(summary); // => { option: 'entity', reason: 'first available step', runnerUp: 'state', provider: 'rules', version: '1' }
 */
export async function openDecision(root, options = {}) {
  const notes = [];
  const note = (text) => {
    const line = safeLine(text);
    if (notes.includes(line)) return;
    notes.push(line);
    try {
      options.log?.(line);
    } catch {
      // a broken logger must not break a suggestion
    }
  };

  let setting = { ...DEFAULT_DECISION };
  try {
    setting = loadConfig(root).decision ?? setting;
  } catch {
    note('decision: architecture.yml could not be read, so the rules provider is used');
  }
  const plugin = options.plugin ?? setting.plugin;
  const requested = options.provider ?? setting.provider ?? null;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : (setting.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const rules = getDecisionProvider('rules');

  const wanted = requested ?? (plugin ? 'plugin' : 'rules');
  let active = rules;
  let activeName = 'rules';
  let fellBackFrom = null;
  if (requested === 'rules' || requested === 'off') {
    active = getDecisionProvider(requested);
    activeName = requested;
  } else if (plugin) {
    if (options.allowPlugins === false) {
      fellBackFrom = wanted;
      note(`decision: the plugin for provider "${wanted}" was not loaded because plugins are not enabled here (CONSTRUCT_DECISION_PLUGINS=on); the rules provider is used`);
    } else {
      const loaded = await loadDecisionPlugin(plugin, { root, expectName: requested, strict: true });
      if (loaded.ok) {
        active = loaded.provider;
        activeName = loaded.provider.name;
        note(`decision: loaded provider "${activeName}" version ${loaded.provider.version} from the plugin file named in architecture.yml`);
      } else {
        fellBackFrom = wanted;
        note(`decision: the plugin for provider "${wanted}" was not used (${loaded.code}: ${loaded.message}); the rules provider is used`);
      }
    }
  } else if (requested && getDecisionProvider(requested)) {
    active = getDecisionProvider(requested);
    activeName = requested;
  } else if (requested) {
    fellBackFrom = wanted;
    note(`decision: no provider named "${requested}" is available (no plugin file is set in architecture.yml); the rules provider is used`);
  }

  const builtIn = activeName === 'rules' || activeName === 'off';
  const version = typeof active.version === 'string' && active.version ? active.version : 'unversioned';
  let broken = false;

  /** Rules answer in place of a failed plugin, with the plugin's name on the suggestion. */
  const fallback = async (summary, reason) => {
    note(`decision: provider "${activeName}" ${reason}; the rules provider answered instead`);
    const r = await askProvider(rules, summary, { name: 'rules' });
    return r.suggestion ? { ...r.suggestion, fellBackFrom: activeName } : null;
  };

  const suggest = async (summary) => {
    if (activeName === 'off') return null;
    if (builtIn) {
      const r = await askProvider(active, summary, { name: activeName, timeoutMs });
      return r.suggestion ? { ...r.suggestion, ...(fellBackFrom ? { fellBackFrom } : {}) } : null;
    }
    if (broken) return fallback(summary, 'failed earlier in this request');
    const key = `${root}\0${activeName}@${version}\0${JSON.stringify(summary)}`;
    if (answerCache.has(key)) return answerCache.get(key);
    const r = await askProvider(active, summary, { name: activeName, timeoutMs });
    if (r.status === 'ok' || r.status === 'abstained') {
      remember(key, r.suggestion);
      return r.suggestion;
    }
    if (r.status === 'bad-summary') return null;
    broken = true;
    return fallback(summary, `failed (${r.status}${r.detail ? `: ${r.detail}` : ''})`);
  };

  return {
    requested: fellBackFrom ?? activeName,
    provider: { name: activeName, version },
    /** Set once the requested provider could not be used, at load time or after a failed answer. */
    get fellBackFrom() {
      return fellBackFrom ?? (broken ? activeName : null);
    },
    notes,
    timeoutMs,
    suggest,
  };
}
