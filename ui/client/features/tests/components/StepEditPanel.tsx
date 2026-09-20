import { Select } from '@/components/ui';
import type { MachineInfo, StepFields, StepRowView } from '../types';

type StepEditPanelProps = {
  row: StepRowView | null;
  machine: MachineInfo;
  onPatch: (patch: Partial<StepFields>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
};

const WAITS = [2000, 5000, 10000, 30000];

/** The edit panel for the selected step: ordinary form fields (a pick-list of the flow's real events and states, a
 * text box, a wait), move up / move down buttons (the keyboard path for reordering) and Remove. No code is typed
 * anywhere. "What this becomes" is a read-only preview; the authoritative text is the diff at review. */
export function StepEditPanel({ row, machine, onPatch, onMove, onRemove }: StepEditPanelProps) {
  if (!row || row.removed) return <p className="hint ts-pad" data-testid="panel-empty">Select a step to edit it.</p>;
  const s = row.step;
  const waits = 'timeout' in s && s.timeout && !WAITS.includes(s.timeout) ? [...WAITS, s.timeout].sort((a, b) => a - b) : WAITS;
  return (
    <div className="ts-panel" data-testid="step-panel">
      <div className="ts-panel-head">
        <span className={`ts-kw ts-kw--${row.keyword.toLowerCase()}`}>{row.keyword}</span>
        <h3 className="ts-panel-title">Step {row.n}</h3>
        <span className="ts-panel-tools">
          <button type="button" className="ts-btn" data-testid="step-up" aria-label={`Move step ${row.n} up`} disabled={!row.canUp} onClick={() => onMove(-1)}>Up</button>
          <button type="button" className="ts-btn" data-testid="step-down" aria-label={`Move step ${row.n} down`} disabled={!row.canDown} onClick={() => onMove(1)}>Down</button>
          {s.kind !== 'goto' && <button type="button" className="ts-btn" data-testid="step-remove" onClick={onRemove}>Remove</button>}
        </span>
      </div>

      {s.kind === 'goto' && (
        <label className="ts-label">
          Page to open
          <input className="ts-input" data-testid="field-url" value={s.url ?? ''} placeholder="/refunds/new" onChange={(e) => onPatch({ url: e.target.value })} spellCheck={false} />
          <span className="ts-fieldhint">A path on this site. No other site, no "..".</span>
        </label>
      )}
      {s.kind === 'event' && (
        <label className="ts-label">
          Which event happens
          <Select className="ts-input" data-testid="field-event" value={s.event} onChange={(e) => onPatch({ event: e.target.value })}>
            {!machine.events.some((e) => e.event === s.event) && <option value={s.event}>{s.event} (not in this flow now)</option>}
            {machine.events.map((e) => <option key={e.event} value={e.event}>{e.label} ({e.testId})</option>)}
          </Select>
          <span className="ts-fieldhint">Only events this flow really has. The test clicks <code>[data-testid="{s.testId}"]</code>.</span>
        </label>
      )}
      {s.kind === 'state' && (
        <label className="ts-label">
          The flow should be in
          <Select className="ts-input" data-testid="field-state" value={s.state} onChange={(e) => onPatch({ state: e.target.value })}>
            {!machine.states.includes(s.state) && <option value={s.state}>{s.state} (not in this flow now)</option>}
            {machine.states.map((st) => <option key={st} value={st}>{st}</option>)}
          </Select>
        </label>
      )}
      {s.kind === 'check-text' && (
        <>
          <label className="ts-label">
            The page shows this text
            <input className="ts-input" data-testid="field-text" value={s.text} maxLength={200} placeholder="A reviewer will check this refund" onChange={(e) => onPatch({ text: e.target.value })} />
          </label>
          <label className="ts-label">
            Wait up to
            <Select className="ts-input" data-testid="field-wait" value={String(s.timeout)} onChange={(e) => onPatch({ timeout: Number(e.target.value) })}>
              {waits.map((w) => <option key={w} value={w}>{w / 1000} seconds</option>)}
            </Select>
          </label>
        </>
      )}
      {'note' in s || s.kind === 'state' || s.kind === 'event' || s.kind === 'check-text' ? (
        <label className="ts-label">
          Note (optional)
          <input className="ts-input" data-testid="field-note" value={'note' in s && s.note ? s.note : ''} maxLength={200} onChange={(e) => onPatch({ note: e.target.value })} />
        </label>
      ) : null}

      <div>
        <h4 className="ts-h">What this becomes <span className="ts-det">DETERMINISTIC</span></h4>
        <pre className="ts-pre" data-testid="step-code" tabIndex={0} aria-label="Code this step becomes, read-only">{row.code}</pre>
        <p className="ts-fieldhint">Written by a Construct block from the choices above. No model is involved, and you never have to read this.</p>
      </div>
    </div>
  );
}
