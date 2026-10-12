import type { StageBlock } from '@/lib/liveStage';

export type ShownBlock = StageBlock & { leaving?: boolean };
type LiveStageProps = { blocks: ShownBlock[]; open: boolean; onToggle: () => void; note: string | null };

const GLYPH: Record<string, string> = { folder: '▤', page: '▭', block: '◧', flow: '⇄', step: '◷', flag: '⚑' };
const TONE: Record<string, string> = { fit: 'fit', gap: 'gap', problem: 'gap', wait: 'wait', open: 'open' };

const block = (b: ShownBlock) => <StageCard key={b.id} block={b} />;
const stateChip = (s: string) => (
  <li key={s} className="lm-state" data-testid="lm-stage-state">
    {s}
  </li>
);

function StageStates({ states }: { states: string[] }) {
  if (!states.length) return null;
  return (
    <div className="lm-states">
      <ul aria-label="UI states this step shows">{states.map(stateChip)}</ul>
      <span className="lm-stub" title="From the tool's presentation, not live data yet">stub</span>
    </div>
  );
}

function Line({ text, className, prefix = '' }: { text: string | null; className: string; prefix?: string }) {
  if (!text) return null;
  return <span className={className}>{`${prefix}${text}`}</span>;
}

function FixChip({ fix }: { fix: string | null }) {
  if (!fix) return null;
  return (
    <span className="ln-chip lm-fix" data-tone="gap" data-testid="lm-stage-fix">
      Fix: {fix}
    </span>
  );
}

function StageCard({ block: b }: { block: ShownBlock }) {
  return (
    <li className="lm-block" data-testid="lm-stage-block" data-block={b.id} data-kind={b.kind} data-status={b.status} data-focus={b.focus || undefined} data-leaving={b.leaving || undefined}>
      <span className="lm-block-top">
        <span className="lm-block-icon" aria-hidden="true">
          {GLYPH[b.icon] ?? '◇'}
        </span>
        <span className="lm-block-name">{b.name}</span>
        <span className="ln-chip" data-tone={TONE[b.status]} data-testid="lm-stage-status">
          {b.statusLabel}
        </span>
      </span>
      <Line text={b.base} className="lm-block-base" prefix="Based on " />
      <Line text={b.sentence} className="lm-block-text" />
      <FixChip fix={b.fix} />
      <StageStates states={b.states} />
    </li>
  );
}

function StageNote({ open, note }: { open: boolean; note: string | null }) {
  if (!open || !note) return null;
  return (
    <p className="lm-stage-note" data-testid="lm-stage-note">
      {note}
    </p>
  );
}

/** Chat mode's live stage: what is active under the hood right now, as small read-only blocks (the place's levels, the
 * plan's open steps, the last step's "after"). Collapsible; hidden on narrow screens. Any action stays in the chat or
 * the Plan. */
export function LiveStage({ blocks, open, onToggle, note }: LiveStageProps) {
  const items = blocks.map(block);
  return (
    <aside className="lm-stage" aria-label="Live stage" data-testid="lm-stage" data-open={open}>
      <button type="button" className="lm-stage-toggle" aria-expanded={open} onClick={onToggle} data-testid="lm-stage-toggle">
        {open ? 'Hide what is happening' : 'Show what is happening'}
      </button>
      <ul className="lm-blocks" hidden={!open} aria-live="polite">
        {items}
      </ul>
      <StageNote open={open} note={note} />
    </aside>
  );
}
