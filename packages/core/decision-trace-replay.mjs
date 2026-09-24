// #643 (epic #616) -- the yardstick: replay recorded `decision-trace.v1` decisions through any registered decision provider and
// score it against what people chose, against the outcomes that vouched for a choice, and against the `rules` baseline.
//
//   traceStats(decisions)                       counts per chooser, acceptance rate of suggestions, per provider
//   replayTraces(decisions, { provider, ... })  agreement, outcome agreement, coverage, baseline comparison, a verdict
//   renderTraceList / renderTraceStats / renderReplay   the plain-text forms the `construct traces` command prints
//
// Deterministic, read-only, no model call and no network of its own: each recorded summary (exactly what was offered, `chosen`
// null) goes through `suggest()` of decision-provider.mjs, so a provider gets the frozen summary and nothing else and a
// provider that throws or hangs simply abstains. A provider is promotable only when it BEATS the baseline on at least
// `minTraces` person-made traces. Decision record: docs/DECISION-TRACES.md.
import { getDecisionProvider, listDecisionProviders, suggest, DEFAULT_PROVIDER } from './decision-provider.mjs';
import { isGoodOutcome, TRACE_SOURCES } from './decision-trace.mjs';

/** The number of person-made traces a provider must beat the baseline on before it can be promoted (a flag overrides it). */
export const DEFAULT_MIN_TRACES = 30;

const ratio = (n, d) => (d ? n / d : null);
const pct = (x) => (x === null || x === undefined ? 'n/a' : `${Math.round(x * 1000) / 10}%`);
const providerKey = (p) => `${p.name}@${p.version}`;
const tally = () => ({ asked: 0, accepted: 0, overridden: 0, acceptanceRate: null });
const settle = (t) => ({ ...t, acceptanceRate: ratio(t.accepted, t.asked) });

/**
 * Counts over recorded decisions: per chooser (how many, who chose), how often a suggestion was taken or overridden (overall
 * and per provider, taken means the suggested option is the chosen one), and how many carry each outcome label.
 *
 * @param {import('./decision-trace.mjs').DecisionTrace[]} decisions Decisions with their outcomes merged (`readTraces`).
 * @returns {{ total: number, byChooser: Record<string, { traces: number, by: Record<string, number>, suggestions: object }>, suggestions: { asked: number, accepted: number, overridden: number, acceptanceRate: number | null }, byProvider: Record<string, { asked: number, accepted: number, overridden: number, acceptanceRate: number | null }>, outcomes: Record<string, number> }} The statistics.
 *
 * @example
 * traceStats(decisions).suggestions.acceptanceRate; // => 0.42
 */
export function traceStats(decisions) {
  const list = Array.isArray(decisions) ? decisions : [];
  const overall = tally();
  const byChooser = {};
  const byProvider = {};
  const outcomes = { planValidated: 0, testsPassed: 0, reverted: 0, accepted: 0, good: 0 };
  for (const d of list) {
    const c = (byChooser[d.chooser.id] ??= { traces: 0, by: Object.fromEntries(TRACE_SOURCES.map((s) => [s, 0])), suggestions: tally() });
    c.traces += 1;
    c.by[d.by] += 1;
    if (d.suggestion) {
      const taken = d.suggestion.option === d.chosen;
      const p = (byProvider[d.provider ? providerKey(d.provider) : 'unknown'] ??= tally());
      for (const t of [overall, c.suggestions, p]) {
        t.asked += 1;
        t[taken ? 'accepted' : 'overridden'] += 1;
      }
    }
    for (const k of ['planValidated', 'testsPassed', 'reverted', 'accepted']) if (d.outcome?.[k] === true) outcomes[k] += 1;
    if (isGoodOutcome(d.outcome)) outcomes.good += 1;
  }
  for (const c of Object.values(byChooser)) c.suggestions = settle(c.suggestions);
  for (const [k, p] of Object.entries(byProvider)) byProvider[k] = settle(p);
  return { total: list.length, byChooser, suggestions: settle(overall), byProvider, outcomes };
}

/** One provider's picks for every trace (`null` = abstained): the recorded summary through `suggest()`, sequentially so a run is reproducible. */
async function picks(traces, provider, timeoutMs) {
  const out = [];
  for (const t of traces) out.push((await suggest(t.summary, { provider, timeoutMs }))?.option ?? null);
  return out;
}

/** The scores of a set of picks against what was recorded. Agreement counts an abstention as a miss; `agreementWhenAnswered` does not. */
function score(traces, pickList) {
  let persons = 0;
  let hits = 0;
  let answered = 0;
  let personAnswered = 0;
  let outcomeTraces = 0;
  let outcomeHits = 0;
  traces.forEach((t, i) => {
    const pick = pickList[i];
    if (pick !== null) answered += 1;
    if (t.by === 'person') {
      persons += 1;
      if (pick !== null) personAnswered += 1;
      if (pick === t.chosen) hits += 1;
    }
    if (isGoodOutcome(t.outcome)) {
      outcomeTraces += 1;
      if (pick === t.chosen) outcomeHits += 1;
    }
  });
  return {
    traces: traces.length,
    persons,
    hits,
    agreement: ratio(hits, persons),
    agreementWhenAnswered: ratio(hits, personAnswered),
    answered,
    abstained: traces.length - answered,
    coverage: ratio(answered, traces.length),
    outcomeTraces,
    outcomeHits,
    outcomeAgreement: ratio(outcomeHits, outcomeTraces),
  };
}

/** `beats`, `ties` or `loses`, comparing hits against person choices on the same traces (same denominator), and whether it may be promoted. */
function compare(provider, baseline, minTraces) {
  const verdict = provider.hits > baseline.hits ? 'beats' : provider.hits === baseline.hits ? 'ties' : 'loses';
  const promotable = verdict === 'beats' && provider.persons >= minTraces;
  const reason = promotable
    ? `beats the baseline on ${provider.persons} person-made traces (needs ${minTraces})`
    : verdict !== 'beats'
      ? `does not beat the baseline (${verdict})`
      : `beats the baseline but on only ${provider.persons} person-made traces (needs ${minTraces})`;
  return { verdict, promotable, reason };
}

/**
 * Replay recorded decisions through a provider and score it. For every trace the recorded summary (what was offered) goes to
 * `suggest()`; the pick is compared with what the person chose (agreement over person-made traces, an abstention counts as a
 * miss), with the choices whose outcome vouched for them (`isGoodOutcome`), and with the `baseline` provider on the same traces.
 * `coverage` is how often the provider answered rather than abstained. `verdict` is `beats`, `ties` or `loses` on hits against
 * person choices; `promotable` needs `beats` on at least `minTraces` person-made traces. Read-only and deterministic; nothing is
 * written, no model or network is used by this function.
 *
 * @param {import('./decision-trace.mjs').DecisionTrace[]} decisions Decisions with outcomes merged (`readTraces`).
 * @param {{ provider: string, baseline?: string, chooser?: string, minTraces?: number, timeoutMs?: number }} options The provider name (from the registry: `rules`, `off`, a plugin), the baseline (default `rules`), an optional chooser id to replay, the minimum traces to promote (default 30) and the per-suggestion wait.
 * @returns {Promise<{ ok: true, provider: string, baseline: string, minTraces: number, chooser: string | null, overall: object, byChooser: Record<string, object> } | { ok: false, error: string }>} The report, or why it could not run (an unregistered provider).
 *
 * @example
 * const report = await replayTraces(decisions, { provider: 'jev', minTraces: 30 });
 * report.overall.verdict; // => 'beats' | 'ties' | 'loses'
 */
export async function replayTraces(decisions, options) {
  const name = options?.provider;
  const baselineName = options?.baseline ?? DEFAULT_PROVIDER;
  if (typeof name !== 'string' || !getDecisionProvider(name)) return { ok: false, error: `No decision provider named ${JSON.stringify(name)} is registered. Known: ${listDecisionProviders().join(', ')}.` };
  if (!getDecisionProvider(baselineName)) return { ok: false, error: `No baseline provider named ${JSON.stringify(baselineName)} is registered. Known: ${listDecisionProviders().join(', ')}.` };
  const minTraces = Number.isInteger(options.minTraces) && options.minTraces >= 0 ? options.minTraces : DEFAULT_MIN_TRACES;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 2000;
  const traces = (Array.isArray(decisions) ? decisions : []).filter((d) => !options.chooser || d.chooser.id === options.chooser);
  const mine = await picks(traces, name, timeoutMs);
  const base = name === baselineName ? mine : await picks(traces, baselineName, timeoutMs);
  const position = new Map(traces.map((t, i) => [t, i]));
  const report = (subset) => {
    const idx = subset.map((t) => position.get(t));
    const p = score(subset, idx.map((i) => mine[i]));
    const b = score(subset, idx.map((i) => base[i]));
    return { ...p, baseline: b, ...compare(p, b, minTraces) };
  };
  const byChooser = {};
  for (const id of [...new Set(traces.map((t) => t.chooser.id))].sort()) byChooser[id] = report(traces.filter((t) => t.chooser.id === id));
  return { ok: true, provider: name, baseline: baselineName, minTraces, chooser: options.chooser ?? null, overall: report(traces), byChooser };
}

const pad = (s, n) => String(s).padEnd(n);

/**
 * The plain-text list of decisions, one line each: time, chooser, chosen of the options, who, the suggestion and its fate, the outcome.
 *
 * @param {import('./decision-trace.mjs').DecisionTrace[]} decisions Decisions (`readTraces`).
 * @param {{ limit?: number }} [options] `limit`: show only the last N.
 * @returns {string} The text (ends without a newline).
 *
 * @example
 * renderTraceList(decisions, { limit: 10 });
 */
export function renderTraceList(decisions, options = {}) {
  const list = Array.isArray(decisions) ? decisions : [];
  const shown = Number.isInteger(options.limit) && options.limit > 0 ? list.slice(-options.limit) : list;
  if (!shown.length) return 'No decision traces recorded.';
  const lines = shown.map((d) => {
    const sug = d.suggestion ? `suggested ${d.suggestion.option} (${d.suggestion.option === d.chosen ? 'taken' : 'overridden'})` : 'no suggestion';
    const out = d.outcome ? Object.entries(d.outcome).map(([k, v]) => `${k}=${v}`).join(' ') : '-';
    return `${d.at}  ${pad(d.chooser.id, 34)} chose ${pad(d.chosen, 12)} by ${pad(d.by, 14)} ${pad(sug, 34)} ${out}`.trimEnd();
  });
  return `${shown.length} of ${list.length} decision trace(s):\n${lines.join('\n')}`;
}

/**
 * The plain-text statistics.
 *
 * @param {ReturnType<typeof traceStats>} stats The result of `traceStats`.
 * @returns {string} The text.
 *
 * @example
 * renderTraceStats(traceStats(decisions));
 */
export function renderTraceStats(stats) {
  if (!stats.total) return 'No decision traces recorded.';
  const lines = [`${stats.total} decision(s)`, '', 'Per chooser:'];
  for (const [id, c] of Object.entries(stats.byChooser)) {
    lines.push(`  ${pad(id, 36)} ${pad(c.traces, 5)} (${Object.entries(c.by).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ')}); suggestions taken ${c.suggestions.accepted}/${c.suggestions.asked} (${pct(c.suggestions.acceptanceRate)})`);
  }
  lines.push('', `Suggestions: ${stats.suggestions.accepted} taken, ${stats.suggestions.overridden} overridden of ${stats.suggestions.asked} (acceptance ${pct(stats.suggestions.acceptanceRate)})`);
  for (const [k, p] of Object.entries(stats.byProvider)) lines.push(`  ${pad(k, 24)} ${p.accepted}/${p.asked} taken (${pct(p.acceptanceRate)})`);
  const o = stats.outcomes;
  lines.push('', `Outcomes: planValidated ${o.planValidated}, testsPassed ${o.testsPassed}, reverted ${o.reverted}, accepted ${o.accepted}; vouched for ${o.good}`);
  return lines.join('\n');
}

const line = (label, m) => `${pad(label, 20)} traces ${pad(m.traces, 4)} persons ${pad(m.persons, 4)} agreement ${pad(pct(m.agreement), 7)} when answered ${pad(pct(m.agreementWhenAnswered), 7)} outcome ${pad(pct(m.outcomeAgreement), 7)} coverage ${pct(m.coverage)}`;

/**
 * The plain-text replay report.
 *
 * @param {Extract<Awaited<ReturnType<typeof replayTraces>>, { ok: true }>} report A successful `replayTraces` result.
 * @returns {string} The text.
 *
 * @example
 * renderReplay(await replayTraces(decisions, { provider: 'rules' }));
 */
export function renderReplay(report) {
  const lines = [`Replay of "${report.provider}" against "${report.baseline}"${report.chooser ? ` on ${report.chooser}` : ''} (promote needs ${report.minTraces} person-made traces)`, ''];
  const block = (label, r) => {
    lines.push(line(label, r), line(`  ${report.baseline}`, r.baseline), `  verdict: ${r.verdict}; ${r.reason}`, '');
  };
  for (const [id, r] of Object.entries(report.byChooser)) block(id, r);
  block('overall', report.overall);
  lines.pop();
  return lines.join('\n');
}
