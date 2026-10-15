// @line-atoms functional 939c25c: generated from smith-functional src/atoms/text.ts by packages/line-atoms/runtime.mjs --write; do not edit.
// Text atoms (String.prototype / String). Pure; strings are immutable anyway.

/**
 * lowerCase(text) reads "text in lower case".
 * Exactly `text.toLowerCase()`.
 */
export function lowerCase(text: string): string {
  return text.toLowerCase();
}

/**
 * upperCase(text) reads "text in upper case".
 * Exactly `text.toUpperCase()`.
 */
export function upperCase(text: string): string {
  return text.toUpperCase();
}

/**
 * trimmed(text) reads "text without surrounding spaces".
 * Exactly `text.trim()`.
 */
export function trimmed(text: string): string {
  return text.trim();
}

/**
 * doesStartWith(text, part, position) reads "whether text starts with part".
 * Exactly `text.startsWith(part, position)`.
 */
export function doesStartWith(text: string, part: string, position?: number): boolean {
  return text.startsWith(part, position);
}

/**
 * doesEndWith(text, part, endPosition) reads "whether text ends with part".
 * Exactly `text.endsWith(part, endPosition)`.
 */
export function doesEndWith(text: string, part: string, endPosition?: number): boolean {
  return text.endsWith(part, endPosition);
}

/**
 * splitBy(text, separator, limit) reads "text split by separator".
 * Exactly `text.split(separator, limit)`.
 */
export function splitBy(text: string, separator: string | RegExp, limit?: number): string[] {
  return text.split(separator, limit);
}

/**
 * joinWith(list, separator) reads "list joined with separator".
 * Exactly `list.join(separator)` (separator defaults to ",").
 */
export function joinWith(list: readonly unknown[], separator?: string): string {
  return list.join(separator);
}

function globalCopy(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
}

function nonGlobalCopy(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.replace('g', ''));
}

/**
 * replaceEvery(text, pattern, replacement) reads "text with every pattern replaced by replacement".
 * Exactly `text.replaceAll(pattern, replacement)`; a RegExp without the g flag is treated as
 * global (replaceAll would throw), and the caller's RegExp is never touched.
 */
export function replaceEvery(text: string, pattern: string | RegExp, replacement: string): string {
  return text.replaceAll(typeof pattern === 'string' ? pattern : globalCopy(pattern), replacement);
}

/**
 * replaceFirst(text, pattern, replacement) reads "text with the first pattern replaced by replacement".
 * Exactly `text.replace(pattern, replacement)` for a string or non-global RegExp; a global
 * RegExp still only replaces the first match.
 */
export function replaceFirst(text: string, pattern: string | RegExp, replacement: string): string {
  return text.replace(typeof pattern === 'string' ? pattern : nonGlobalCopy(pattern), replacement);
}

/**
 * padLeft(text, length, fill) reads "text padded on the left to length with fill".
 * Exactly `text.padStart(length, fill)` (fill defaults to a space).
 */
export function padLeft(text: string, length: number, fill?: string): string {
  return text.padStart(length, fill);
}

/**
 * padRight(text, length, fill) reads "text padded on the right to length with fill".
 * Exactly `text.padEnd(length, fill)` (fill defaults to a space).
 */
export function padRight(text: string, length: number, fill?: string): string {
  return text.padEnd(length, fill);
}

/**
 * sliceText(text, from, to) reads "the part of text from from to to".
 * Exactly `text.slice(from, to)`.
 */
export function sliceText(text: string, from?: number, to?: number): string {
  return text.slice(from, to);
}

/**
 * letterAt(text, index) reads "the letter at index of text".
 * Exactly `text.charAt(index)` ('' when out of range).
 */
export function letterAt(text: string, index: number): string {
  return text.charAt(index);
}

/**
 * repeatText(text, count) reads "text repeated count times".
 * Exactly `text.repeat(count)` (RangeError for a negative or infinite count).
 */
export function repeatText(text: string, count: number): string {
  return text.repeat(count);
}
