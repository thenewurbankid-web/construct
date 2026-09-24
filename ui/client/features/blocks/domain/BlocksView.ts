// Pure (DOMAIN-001): the Blocks tab as everything it shows, already worked out: the cards in registry order, each with
// its plain-words facts, its settings and its refusal, plus the filter, the one-line summary and the empty/failed states.
import type { BlockCardView, BlocksView } from '../types.ts';
import type { BlockRow, ScreenState } from './BlockTypes.ts';
import { runBlocked } from './BlockRun.ts';
import { KIND_READ, KIND_WRITE, MODEL_NONE, MODEL_OPTIONAL, OFF_HINT, argKind, commandText, runsText } from './BlockText.ts';

/** Does the block match what was typed in the filter? Every word must appear in its id or purpose. */
export function matchesFilter(row: BlockRow, text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${row.id} ${row.purpose}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** "25 blocks, 2 turned off". */
export function summaryText(blocks: BlockRow[]): string {
  const off = blocks.filter((b) => !b.settings.enabled).length;
  const total = `${blocks.length} ${blocks.length === 1 ? 'block' : 'blocks'}`;
  return off > 0 ? `${total}, ${off} turned off` : total;
}

function cardOf(row: BlockRow, state: ScreenState): BlockCardView {
  const refusal = state.refusal?.id === row.id ? state.refusal.message : null;
  const canAi = row.engines.includes('ai');
  return {
    id: row.id,
    purpose: row.purpose,
    enabled: row.settings.enabled,
    offNote: !row.offered ? row.notOffered ?? 'The Cockpit does not offer this block.' : row.settings.enabled ? null : OFF_HINT,
    kind: row.writesFiles ? { label: KIND_WRITE, tone: 'write' } : { label: KIND_READ, tone: 'read' },
    model: row.modelCalls === 'none' ? { label: MODEL_NONE, tone: 'none' } : { label: MODEL_OPTIONAL, tone: 'optional' },
    reads: row.reads,
    writes: row.writes ?? 'Nothing: it never changes a file.',
    runs: runsText(row.runs),
    args: row.args.map((a) => ({ name: a.name, label: a.required ? `${a.name} (needed)` : a.name, kind: argKind(a), description: a.description ?? null })),
    example: row.example ? { title: row.example.title, command: commandText(row.example.argv) } : null,
    engine: canAi ? { value: row.settings.engine === 'ai' ? 'ai' : 'mechanical', model: row.settings.model ?? '', provider: row.settings.provider ?? state.provider } : null,
    runBlocked: runBlocked(row),
    refusal,
    saving: state.saving === row.id || state.saving === '*',
    locked: !row.offered,
  };
}

export function buildBlocksView(state: ScreenState): BlocksView {
  const shown = state.blocks.filter((b) => matchesFilter(b, state.filter));
  const cardRefusal = state.refusal && state.refusal.id !== null && state.blocks.some((b) => b.id === state.refusal?.id);
  return {
    status: state.status,
    error: state.error,
    unreadable: state.unreadable,
    summary: summaryText(state.blocks),
    filter: state.filter,
    cards: shown.map((b) => cardOf(b, state)),
    notice: state.refusal && !cardRefusal ? state.refusal.message : null,
    empty: state.status === 'ready' && shown.length === 0 ? (state.filter.trim() ? 'No block matches that.' : 'This project has no blocks to show.') : null,
  };
}
