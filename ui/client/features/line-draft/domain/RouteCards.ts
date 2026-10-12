// Pure (DOMAIN-001): the drafter's answer as cards and any server answer as a DraftAnswer.
import type { DraftAnswer, DraftView, RouteCard } from '../types.ts';

const LABELS: Record<RouteCard['status'], string> = {
  ok: 'Checked',
  refused: 'Refused by Construct',
  'wrong-shape': 'Held back',
  failed: 'A check failed',
  'needs-model': 'Needs your input',
  unverified: 'Not checked yet',
};
const HOW: Record<string, string> = { template: 'a Line rule', retrieval: 'an earlier approved change', model: 'a local model' };

/** The routes as cards, best first; only a route Construct checked can be added. */
export function routeCards(view: DraftView | null): RouteCard[] {
  if (!view) return [];
  return view.routes.map((r) => ({
    id: r.id,
    label: r.label,
    risk: r.risk,
    sentence: r.sentence,
    status: r.status,
    statusLabel: r.id === view.recommended ? `Recommended · ${LABELS[r.status]}` : LABELS[r.status],
    recommended: r.id === view.recommended,
    canAdd: r.status === 'ok',
    fix: r.fix ? r.fix.sentence : null,
    repair: r.repair ? { sentence: r.repair.sentence, progress: r.repair.progress, tries: r.repair.tries.map((t) => `Attempt ${t.n}: ${t.reason || 'no reason given'}${t.refusal ? `; Construct refused it: ${t.refusal}` : t.outcome === 'landed' ? '; Construct accepted it' : ''}`.replace(/[.!?]?$/, '.')) } : null,
    calls: r.steps.map((s) => `${s.tool} ${JSON.stringify(s.args)}`),
    memory: r.memory ?? null,
    how: `Found by ${HOW[r.via] ?? r.via}; ${r.cost.steps === 1 ? '1 step' : `${r.cost.steps} steps`}, ${r.cost.files === 1 ? '1 file' : `${r.cost.files} files`}; confidence ${Math.round(r.confidence * 100)}%; route ${r.id}.`,
  }));
}

/** Any server answer as a DraftAnswer: `ok` bodies are the value, a refusal is its sentence. */
export function toDraftAnswer<T>(body: unknown): DraftAnswer<T> {
  const b = (body && typeof body === 'object' ? body : {}) as { ok?: unknown; sentence?: unknown; code?: unknown };
  if (b.ok === true) return { ok: true, value: body as T };
  const sentence = typeof b.sentence === 'string' && b.sentence ? b.sentence : 'Cockpit could not draft that; nothing was changed.';
  return { ok: false, sentence, ...(typeof b.code === 'string' ? { code: b.code } : {}) };
}
