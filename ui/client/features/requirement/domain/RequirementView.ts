// Pure (DOMAIN-001): the screen state as the words and flags the components draw. Nothing here is decided by a model: every
// label is a fixed table and every count is taken from what the server returned.
import type { ApproveView, BlockView, CardView, OpenView, RequirementView, ResultView } from '../types.ts';
import { EXAMPLES } from './Examples.ts';
import { NOUN_LABEL, PLACEMENT_LABEL, VERB_LABEL } from './Labels.ts';
import { QUESTIONS } from './PlacementQuestions.ts';
import type { CardNoun, ReadResult, ScreenState } from './RequirementTypes.ts';
import { offerViews } from './ShapeOffer.ts';
import { toTimeline } from './Timeline.ts';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function cardView(result: ReadResult): CardView {
  const { nouns, verbs, checks } = result.card;
  const byId = new Map<string, CardNoun>(nouns.map((n) => [n.id, n]));
  return {
    counts: `${plural(nouns.length, 'noun')}, ${plural(verbs.length, 'verb')}, ${plural(checks.length, 'check')}`,
    nouns: nouns.map((n) => ({ id: n.id, text: n.text, kind: n.kind, kindLabel: NOUN_LABEL[n.kind] ?? n.kind, properties: (n.properties ?? []).join(', ') })),
    verbs: verbs.map((v) => ({ id: v.id, text: v.text, kind: v.kind, kindLabel: VERB_LABEL[v.kind] ?? v.kind, acts: v.on.map((id) => byId.get(id)?.text ?? id).join(', ') })),
    checks: checks.map((c) => ({ id: c.id, name: c.name, from: c.from, why: c.why })),
  };
}

function openViews(result: ReadResult): OpenView[] {
  return result.open.map((q) => ({ id: q.id, question: q.question, source: q.source, options: q.options.filter((o) => o.enabled).map((o) => ({ id: o.id, label: o.label, why: o.why })) }));
}

function blockViews(result: ReadResult): BlockView[] | null {
  if (!result.placement) return null;
  return result.placement.blocks.map((b) => ({
    id: b.id,
    label: b.label,
    kind: b.placement,
    kindLabel: PLACEMENT_LABEL[b.placement] ?? b.placement,
    answers: QUESTIONS.map((q) => ({ question: q.text, answer: b.answers[q.key] ? 'Yes' : 'No', yes: b.answers[q.key] })),
    why: b.why,
    layers: b.layers.map((l) => `${l.layer} ${l.name}`),
    checks: b.checkNames,
    files: result.files[b.id] ?? [],
  }));
}

/** Every file once, in the order the blocks list them. */
function allFiles(files: Record<string, string[]>): string[] {
  return [...new Set(Object.values(files).flat())];
}

function approveView(state: ScreenState, result: ReadResult): ApproveView {
  const { approve, note } = state;
  const open = result.open.length;
  const hint = result.plan ? null : open ? `Answer ${plural(open, 'open question')} first.` : 'There is no plan to approve yet.';
  return {
    // An offer (the screen shape) is not an open question: it never disables Approve. A read in flight does: the plan on screen may be about to change.
    canApprove: result.plan !== null && open === 0 && state.read.status !== 'loading' && approve.status !== 'running' && approve.status !== 'started',
    running: approve.status === 'running',
    started: approve.status === 'started',
    processId: approve.processId,
    error: approve.error,
    hint,
    saveState: note.status,
    saveError: note.error,
  };
}

function resultView(state: ScreenState, result: ReadResult): ResultView {
  return {
    card: cardView(result),
    open: openViews(result),
    offers: offerViews(result),
    blocks: blockViews(result),
    notes: result.placement?.notes ?? [],
    errors: (result.placement?.errors ?? []).map((e) => e.message),
    warnings: result.warnings,
    timeline: toTimeline(result.placement),
    files: allFiles(result.files),
    approve: approveView(state, result),
  };
}

export function buildRequirementView(state: ScreenState): RequirementView {
  const busy = state.read.status === 'loading';
  return {
    text: state.text,
    busy,
    canRead: state.text.trim().length > 0 && !busy,
    error: state.read.status === 'failed' ? state.read.error : null,
    result: state.read.result ? resultView(state, state.read.result) : null,
    examples: EXAMPLES,
  };
}
