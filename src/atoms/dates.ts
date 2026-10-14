// Date atoms: a small, timezone-independent set (days are UTC 24-hour days). now() is in impure.ts.

const DAY_MS = 86_400_000;

/**
 * dateFrom(input) reads "the date given by input".
 * Exactly `new Date(input)` (a copy when input is already a Date).
 */
export function dateFrom(input: string | number | Date): Date {
  return new Date(input instanceof Date ? input.getTime() : input);
}

/**
 * formatDate(date, locale, options) reads "date formatted for locale".
 * Exactly `new Intl.DateTimeFormat(locale, options).format(date)`. Defaults: locale 'en-US' and
 * timeZone 'UTC', so the result never depends on the machine it runs on.
 */
export function formatDate(date: Date | number, locale = 'en-US', options: Intl.DateTimeFormatOptions = { timeZone: 'UTC' }): string {
  return new Intl.DateTimeFormat(locale, options).format(date);
}

/**
 * addDays(date, days) reads "date plus days days".
 * Exactly `new Date(date.getTime() + days * 86400000)` (whole 24-hour days, not calendar days across DST).
 */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * daysBetween(from, to) reads "the number of days from from to to".
 * Exactly `Math.trunc((to.getTime() - from.getTime()) / 86400000)` (negative when to is earlier).
 */
export function daysBetween(from: Date, to: Date): number {
  return Math.trunc((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * isBefore(a, b) reads "a is before b".
 * Exactly `a.getTime() < b.getTime()`.
 */
export function isBefore(a: Date, b: Date): boolean {
  return a.getTime() < b.getTime();
}

/**
 * isAfter(a, b) reads "a is after b".
 * Exactly `a.getTime() > b.getTime()`.
 */
export function isAfter(a: Date, b: Date): boolean {
  return a.getTime() > b.getTime();
}
