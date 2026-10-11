import type { Scoreboard, ScoreLine, ScoreRow } from '../types';

/** 0.84 -> "84%", no number yet -> "–". */
export function percent(x: number | null): string {
  if (x === null || Number.isNaN(x)) return '–';
  return `${Math.round(x * 100)}%`;
}

function line(key: string, r: ScoreRow): ScoreLine {
  const agreement = r.agreed + r.disagreed ? `${percent(r.agreement)} (${r.agreed} of ${r.agreed + r.disagreed})` : 'not reviewed yet';
  return {
    key, label: r.label ?? key, cases: String(r.cases), heldout: String(r.heldout),
    recall: percent(r.recall), precision: percent(r.precision), preferred: percent(r.preferred), noRepair: percent(r.noRepair), agreement,
  };
}

/** The scoreboard as table lines: per tool family, per kind of request (intent), and the total last. */
export function scoreLines(b: Scoreboard | null): { lines: ScoreLine[]; intents: ScoreLine[]; sentence: string; lastRun: string } {
  if (!b) return { lines: [], intents: [], sentence: 'Loading the scoreboard.', lastRun: '' };
  const lines = [...Object.entries(b.byFamily).map(([k, r]) => line(k, r)), line('total', { ...b.total, label: 'All cases' })];
  const intents = Object.entries(b.byIntent).map(([k, r]) => line(k, r));
  const lastRun = b.lastRun ? `Last run ${b.lastRun.replace('T', ' ').slice(0, 16)} UTC.` : 'Eval has not run yet.';
  return { lines, intents, sentence: b.sentence, lastRun };
}
