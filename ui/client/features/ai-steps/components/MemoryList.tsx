import type { MemoryPanel, MemoryRow } from '../types';

type Forget = { busy: boolean; forget: (step: string) => void };

/** Forget this step's memory: one click, only when there is something to forget. */
function ForgetButton({ row, busy, forget }: Forget & { row: MemoryRow }) {
  if (!row.canForget) return null;
  return (
    <button type="button" className="ais-forget" onClick={() => forget(row.step)} disabled={busy} aria-label={`Forget this step's memory: ${row.label}`}>
      Forget this step&apos;s memory
    </button>
  );
}

/** One memory step: what it remembers and how much. */
function MemoryItem({ row, ...f }: Forget & { row: MemoryRow }) {
  return (
    <li className="ais-step" data-testid="memory-step" data-step={row.step}>
      <p className="ais-label">{row.label}</p>
      <p className="ais-how" data-testid="memory-size">
        {row.sizeText}
      </p>
      <ForgetButton row={row} {...f} />
    </li>
  );
}

/** The last Forget's sentence; nothing before one. */
function Message({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="hint" role="status" data-testid="memory-message">
      {message}
    </p>
  );
}

/** im3 + j5: what Line remembers for this project, per step, each with Forget. */
export function MemoryList({ memory }: { memory: MemoryPanel }) {
  const items = memory.rows.map((row) => <MemoryItem key={row.step} row={row} busy={memory.busy} forget={memory.forget} />);
  return (
    <div className="ais-memory" data-testid="ai-memory">
      <h3>Memory</h3>
      <p className="hint" data-testid="memory-sentence">
        {memory.sentence}
      </p>
      <Message message={memory.message} />
      <ul className="ais-steps" aria-label="Memory per step">
        {items}
      </ul>
    </div>
  );
}
