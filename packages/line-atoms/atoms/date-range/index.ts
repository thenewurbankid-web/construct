// Atom date-range (date.range): pick and check a date range.
// Wraps date-fns' interval ideas (isWithinInterval, areIntervalsOverlapping, startOfDay, endOfDay, subDays,
// differenceInCalendarDays) on whole calendar days in UTC, so the same range means the same days on every machine.
// A range is complete when both ends are set and the start is not after the end; otherwise it says why not.
import type { AtomMachine } from '../types.ts';

const DAY = 86_400_000;

export interface DateRange { start: Date | null; end: Date | null }

export interface RangeState extends DateRange {
  status: 'empty' | 'partial' | 'complete' | 'invalid';
}

export type RangeEvent =
  | { type: 'SET_START'; date: Date | null }
  | { type: 'SET_END'; date: Date | null }
  | { type: 'PRESET'; days: number; today: Date }
  | { type: 'CLEAR' };

/** The start of the date's calendar day (UTC). */
export function startOfDay(d: Date): Date {
  return new Date(Math.floor(d.getTime() / DAY) * DAY);
}

/** The last millisecond of the date's calendar day (UTC). */
export function endOfDay(d: Date): Date {
  return new Date(startOfDay(d).getTime() + DAY - 1);
}

/** Whether a value is a real date (not an Invalid Date). */
export function isValidDate(d: unknown): boolean {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function statusOf(start: Date | null, end: Date | null): RangeState['status'] {
  if (start === null && end === null) {
    return 'empty';
  }
  if (start === null || end === null) {
    return 'partial';
  }
  if (!isValidDate(start) || !isValidDate(end) || start.getTime() > end.getTime()) {
    return 'invalid';
  }
  return 'complete';
}

function range(start: Date | null, end: Date | null): RangeState {
  let s = start;
  let e = end;
  if (s !== null && isValidDate(s)) {
    s = startOfDay(s);
  }
  if (e !== null && isValidDate(e)) {
    e = endOfDay(e);
  }
  return { status: statusOf(s, e), start: s, end: e };
}

/** Whether the date falls on a day of a complete range (both ends included). */
export function contains(r: RangeState, d: Date): boolean {
  if (r.status !== 'complete') {
    return false;
  }
  const t = d.getTime();
  return t >= (r.start as Date).getTime() && t <= (r.end as Date).getTime();
}

/** How many calendar days a complete range covers (both ends included), else 0. */
export function daysIn(r: RangeState): number {
  if (r.status !== 'complete') {
    return 0;
  }
  return Math.round(((r.end as Date).getTime() + 1 - (r.start as Date).getTime()) / DAY);
}

/** Whether two complete ranges share at least one day. */
export function overlaps(a: RangeState, b: RangeState): boolean {
  if (a.status !== 'complete' || b.status !== 'complete') {
    return false;
  }
  return (a.start as Date).getTime() <= (b.end as Date).getTime() && (b.start as Date).getTime() <= (a.end as Date).getTime();
}

/** The last `days` days up to and including today. */
export function lastDays(days: number, today: Date): RangeState {
  return range(new Date(startOfDay(today).getTime() - (days - 1) * DAY), today);
}

export const machine: AtomMachine<RangeState, RangeEvent, Partial<DateRange> | void> = {
  id: 'date-range',
  init(input) {
    return range(input?.start ?? null, input?.end ?? null);
  },
  send(state, event) {
    switch (event.type) {
      case 'SET_START':
        return range(event.date, state.end);
      case 'SET_END':
        return range(state.start, event.date);
      case 'PRESET':
        if (event.days < 1) {
          return state;
        }
        return lastDays(event.days, event.today);
      case 'CLEAR':
        if (state.status === 'empty') {
          return state;
        }
        return range(null, null);
      default:
        return state;
    }
  },
  stateOf(state) {
    return state.status;
  },
};

/** One call: the range from two dates, with its status. */
export function dateRange(start: Date | null, end: Date | null): RangeState {
  return machine.init({ start, end });
}
