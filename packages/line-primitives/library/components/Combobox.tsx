// @line-level molecule
'use client';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Field, INPUT_LOOK } from './Field';

export type ComboboxOption = { value: string; label: string };
export type ComboboxProps = {
  label: string;
  options: ComboboxOption[];
  /** The chosen option's value (null: none). */
  value?: string | null;
  onValueChange?: (value: string | null) => void;
  /** The typed text changed. */
  onInputChange?: (text: string) => void;
  onOpenChange?: (open: boolean) => void;
  placeholder?: string;
  emptyText?: string;
  /** Which options match the typed text; default: label contains it, ignoring case. */
  filter?: (option: ComboboxOption, text: string) => boolean;
  description?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  /** Shows the chosen option; typing and the list are off. */
  readOnly?: boolean;
  /** Options are loading: a spinner by the label, aria-busy on the input. */
  loading?: boolean;
  className?: string;
};

const contains = (o: ComboboxOption, text: string) => o.label.toLowerCase().includes(text.trim().toLowerCase());

/** A text input that filters a list of options (WAI-ARIA combobox with list autocomplete and aria-activedescendant). */
export function Combobox({ label, options, value, onValueChange, onInputChange, onOpenChange, placeholder, emptyText = 'No results', filter = contains, description, error, disabled, required, readOnly = false, loading, className = '' }: ComboboxProps) {
  const listId = useId();
  const [own, setOwn] = useState<string | null>(null);
  const chosen = value === undefined ? own : value;
  const chosenLabel = options.find((o) => o.value === chosen)?.label ?? '';
  const [text, setText] = useState(chosenLabel);
  const [open, setOpenState] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => options.filter((o) => filter(o, text)), [options, filter, text]);

  const setOpen = (next: boolean) => { if (next !== open && !(next && readOnly)) { setOpenState(next); onOpenChange?.(next); } };
  const choose = (o: ComboboxOption) => {
    setOwn(o.value);
    setText(o.label);
    setOpen(false);
    onValueChange?.(o.value);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) { setOpen(true); setActive(0); return; } setActive((i) => Math.min(i + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && open && matches[active]) { e.preventDefault(); choose(matches[active]); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); }
  };
  const optionId = (i: number) => `${listId}-option-${i}`;
  return (
    <Field label={label} description={description} error={error} required={required} disabled={disabled} readOnly={readOnly} loading={loading} className={className}>
      {(control) => (
        <div className="relative">
          <input
            {...control}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={open && matches[active] ? optionId(active) : undefined}
            autoComplete="off"
            value={text}
            placeholder={placeholder}
            onChange={(e) => { if (readOnly) return; setText(e.target.value); setActive(0); setOpen(true); onInputChange?.(e.target.value); }}
            onKeyDown={onKeyDown}
            onBlur={() => setOpen(false)}
            className={`${INPUT_LOOK} h-10 text-sm`}
          />
          <ComboboxList id={listId} labelledBy={control['aria-labelledby']} open={open} matches={matches} active={active} chosen={chosen} optionId={optionId} onChoose={choose} onHover={setActive} />
          <ComboboxEmpty show={open && matches.length === 0} text={emptyText} />
        </div>
      )}
    </Field>
  );
}

type ListProps = {
  id: string; labelledBy: string; open: boolean; matches: ComboboxOption[]; active: number; chosen: string | null;
  optionId: (i: number) => string; onChoose: (o: ComboboxOption) => void; onHover: (i: number) => void;
};

/** The popup listbox (always in the DOM so aria-controls resolves; hidden while closed). */
function ComboboxList({ id, labelledBy, open, matches, active, chosen, optionId, onChoose, onHover }: ListProps) {
  return (
    <ul id={id} role="listbox" aria-labelledby={labelledBy} hidden={!open || matches.length === 0} className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-md">
      {matches.map((o, i) => (
        <li
          key={o.value}
          id={optionId(i)}
          role="option"
          aria-selected={o.value === chosen}
          data-highlighted={i === active ? '' : undefined}
          onMouseDown={(e) => { e.preventDefault(); onChoose(o); }}
          onMouseEnter={() => onHover(i)}
          className="cursor-pointer rounded px-3 py-1.5 text-sm text-slate-900 data-[highlighted]:bg-slate-100 aria-selected:font-semibold"
        >
          {o.label}
        </li>
      ))}
    </ul>
  );
}

/** "No results", announced politely while the typed text matches nothing. */
function ComboboxEmpty({ show, text }: { show: boolean; text: string }) {
  if (!show) return null;
  return <div role="status" data-part="empty" className="absolute z-50 mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-md">{text}</div>;
}
