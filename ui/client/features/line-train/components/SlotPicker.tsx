import type { SlotChoice } from '../types';

const option = (o: { value: string; label: string }) => <option key={o.value} value={o.value}>{o.label}</option>;

/** One name in the request, corrected with a closed choice (two clicks) or a typed value. */
function Slot({ s, setSlot }: { s: SlotChoice; setSlot: (name: string, value: string) => void }) {
  if (s.kind === 'pick') {
    return (
      <label className="ltr-field">
        {s.label}
        <select className="ltr-select" value={s.current} data-testid={`train-slot-${s.name}`} onChange={(e) => setSlot(s.name, e.target.value)}>
          {s.options.map(option)}
        </select>
      </label>
    );
  }
  return (
    <label className="ltr-field">
      {s.label}
      <input className="ltr-input" defaultValue={s.current} data-testid={`train-slot-${s.name}`} type={s.kind === 'number' ? 'number' : 'text'} onBlur={(e) => setSlot(s.name, e.target.value)} />
    </label>
  );
}

/** Every name the request uses, each one correctable in place. */
export function SlotPicker({ slots, setSlot }: { slots: SlotChoice[]; setSlot: (name: string, value: string) => void }) {
  const one = (s: SlotChoice) => <Slot key={`${s.name}-${s.current}`} s={s} setSlot={setSlot} />;
  return <div className="ltr-fields" aria-label="Names in the request">{slots.map(one)}</div>;
}
