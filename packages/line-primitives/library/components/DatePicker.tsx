// @line-level molecule
'use client';
import { Popover } from 'radix-ui';
import {
  addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format as formatDate, isAfter, isBefore,
  isSameDay, isSameMonth, isToday, startOfDay, startOfMonth, startOfWeek,
} from 'date-fns';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Field, INPUT_LOOK } from './Field';

export type DatePickerProps = {
  label: string;
  value?: Date | null;
  defaultValue?: Date | null;
  onValueChange?: (date: Date) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Earliest day that can be chosen. */
  min?: Date;
  /** Latest day that can be chosen. */
  max?: Date;
  placeholder?: string;
  /** date-fns format of the chosen date on the trigger. */
  format?: string;
  description?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
};

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const KEY_MOVES: Record<string, (d: Date) => Date> = {
  ArrowRight: (d) => addDays(d, 1),
  ArrowLeft: (d) => addDays(d, -1),
  ArrowDown: (d) => addWeeks(d, 1),
  ArrowUp: (d) => addWeeks(d, -1),
  PageDown: (d) => addMonths(d, 1),
  PageUp: (d) => addMonths(d, -1),
  Home: (d) => startOfWeek(d, { weekStartsOn: 1 }),
  End: (d) => startOfDay(endOfWeek(d, { weekStartsOn: 1 })),
};

/** Pick a date from a calendar grid in a popover; all date maths is date-fns. */
export function DatePicker({ label, value, defaultValue = null, onValueChange, open, onOpenChange, min, max, placeholder = 'Pick a date', format = 'PPP', description, error, disabled, required, className = '' }: DatePickerProps) {
  const [own, setOwn] = useState<Date | null>(defaultValue);
  const chosen = value === undefined ? own : value;
  const [ownOpen, setOwnOpen] = useState(false);
  const isOpen = open ?? ownOpen;
  const setOpen = (next: boolean) => { setOwnOpen(next); onOpenChange?.(next); };
  const choose = (d: Date) => { setOwn(d); onValueChange?.(d); setOpen(false); };
  return (
    <Field label={label} description={description} error={error} required={required} disabled={disabled} announceRequired className={className}>
      {({ required: _required, ...control }) => (
        <Popover.Root open={isOpen} onOpenChange={setOpen}>
          <Popover.Trigger {...control} aria-haspopup="dialog" className={`${INPUT_LOOK} flex h-10 items-center justify-between text-left text-sm`}>
            <span data-part="value">{chosen ? formatDate(chosen, format) : placeholder}</span>
            <span aria-hidden="true">📅</span>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content aria-label={`Choose ${label}`} sideOffset={4} className="z-50 rounded-md border border-slate-200 bg-white p-3 shadow-md">
              <Calendar chosen={chosen} min={min} max={max} onChoose={choose} onClose={() => setOpen(false)} />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </Field>
  );
}

type CalendarProps = { chosen: Date | null; min?: Date; max?: Date; onChoose: (d: Date) => void; onClose: () => void };

/** The month grid: role="grid", one button per day, arrow keys move the focused day (roving tabindex). */
function Calendar({ chosen, min, max, onChoose, onClose }: CalendarProps) {
  const [focused, setFocused] = useState(() => startOfDay(chosen ?? new Date()));
  const gridRef = useRef<HTMLTableElement>(null);
  const month = startOfMonth(focused);
  const days = eachDayOfInterval({ start: startOfWeek(month, { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }) });
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));
  const outOfRange = (d: Date) => Boolean((min && isBefore(d, startOfDay(min))) || (max && isAfter(d, startOfDay(max))));
  const title = formatDate(month, 'MMMM yyyy');

  useEffect(() => {
    gridRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
  }, [focused]);

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    const move = KEY_MOVES[e.key];
    if (move) { e.preventDefault(); setFocused(move(focused)); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!outOfRange(focused)) onChoose(focused); return; }
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };
  return (
    <div data-part="calendar" className="flex flex-col gap-2">
      <div data-part="header" className="flex items-center justify-between">
        <button type="button" aria-label="Previous month" data-part="prevMonth" onClick={() => setFocused(addMonths(focused, -1))} className="h-8 w-8 rounded hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900"><span aria-hidden="true">‹</span></button>
        <h2 aria-live="polite" className="text-sm font-semibold text-slate-900">{title}</h2>
        <button type="button" aria-label="Next month" data-part="nextMonth" onClick={() => setFocused(addMonths(focused, 1))} className="h-8 w-8 rounded hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900"><span aria-hidden="true">›</span></button>
      </div>
      <table ref={gridRef} role="grid" aria-label={title} onKeyDown={onKeyDown} className="border-collapse">
        <thead>
          <tr>{WEEKDAYS.map((w) => <th key={w} scope="col" className="h-8 w-9 text-xs font-medium text-slate-500">{w}</th>)}</tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0].toISOString()}>
              {week.map((d) => (
                <DayCell key={d.toISOString()} day={d} month={month} chosen={chosen} focused={focused} unavailable={outOfRange(d)} onChoose={onChoose} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type DayCellProps = { day: Date; month: Date; chosen: Date | null; focused: Date; unavailable: boolean; onChoose: (d: Date) => void };

/** One day: a gridcell holding a button named by its full date; today has aria-current="date". */
function DayCell({ day, month, chosen, focused, unavailable, onChoose }: DayCellProps) {
  const selected = Boolean(chosen && isSameDay(day, chosen));
  return (
    <td role="gridcell" aria-selected={selected} className="p-0 text-center">
      <button
        type="button"
        tabIndex={isSameDay(day, focused) ? 0 : -1}
        aria-label={formatDate(day, 'EEEE d MMMM yyyy')}
        aria-current={isToday(day) ? 'date' : undefined}
        aria-disabled={unavailable || undefined}
        data-outside={isSameMonth(day, month) ? undefined : ''}
        data-selected={selected ? '' : undefined}
        onClick={() => { if (!unavailable) onChoose(day); }}
        className="h-9 w-9 rounded text-sm text-slate-900 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900 aria-[current=date]:font-bold aria-disabled:cursor-not-allowed aria-disabled:opacity-40 data-[outside]:text-slate-400 data-[selected]:bg-slate-900 data-[selected]:text-white"
      >
        {formatDate(day, 'd')}
      </button>
    </td>
  );
}
