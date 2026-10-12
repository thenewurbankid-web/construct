// Pure (DOMAIN-001): "How smart is it" as cards a person reads: the number in words, its trend, how to improve it.
import type { Metric, MetricCard, MetricGroup, SmartTabView, SmartView } from '@/lib/lineKnowsContract';

export const GROUP_LABEL: Record<MetricGroup, string> = { coverage: 'Logic coverage', health: 'Graph health', ai: 'AI accuracy', fixes: 'Fixes', memory: 'Memory effect' };
const GROUPS: MetricGroup[] = ['coverage', 'health', 'ai', 'fixes', 'memory'];
/** Numbers where going down is the good direction (problems, edits, refusals). */
const LOWER_IS_BETTER = new Set(['health.crossFeature', 'health.noBase', 'health.unresolved', 'health.duplicates', 'ai.edited', 'ai.refused']);

const pct = (x: number) => `${Math.round(x * 100)}%`;
const isShare = (m: Metric) => m.value !== null || (m.group !== 'health' && m.count === undefined);
const fmt = (m: Metric, x: number | null) => (x === null ? '–' : isShare(m) ? pct(x) : String(x));

/** The trend in words ("25% → 50%") and whether it got better. */
export function trendText(m: Metric): { text: string; direction: MetricCard['trendDirection'] } {
  const t = m.trend.filter((x): x is number => x !== null);
  if (!t.length) return { text: 'No trend yet', direction: 'none' };
  if (t.length === 1) return { text: 'First measurement', direction: 'none' };
  const first = t[0];
  const last = t[t.length - 1];
  const better = LOWER_IS_BETTER.has(m.id) ? last < first : last > first;
  return { text: `${fmt(m, first)} → ${fmt(m, last)}`, direction: first === last ? 'flat' : better ? 'up' : 'down' };
}

/** One number as a card. */
export function metricCard(m: Metric): MetricCard {
  const display = m.value !== null ? `${pct(m.value)}${m.count !== undefined ? ` of ${m.count}` : ''}` : m.count !== undefined ? String(m.count) : 'No data yet';
  const t = trendText(m);
  return { id: m.id, group: m.group, groupLabel: GROUP_LABEL[m.group], label: m.label, display, trend: t.text, trendDirection: t.direction, improve: m.improve, items: m.items, open: m.open, details: m.details, ...(m.empty ? { empty: m.empty } : {}) };
}

/** The tab: the numbers grouped, in the order a person reads them. */
export function smartTab(v: SmartView): SmartTabView {
  const groups = GROUPS.map((group) => ({ group, label: GROUP_LABEL[group], cards: v.metrics.filter((m) => m.group === group).map(metricCard) })).filter((g) => g.cards.length);
  return { sentence: v.sentence, groups };
}
