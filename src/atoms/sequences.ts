// Atoms shared by text and lists.

/**
 * lengthOf(textOrList) reads "the length of textOrList".
 * Exactly `x.length` for text or a list.
 */
export function lengthOf(value: string | readonly unknown[]): number {
  return value.length;
}

/**
 * contains(textOrList, part) reads "textOrList contains part".
 * Exactly `x.includes(part)`: substring search for text, SameValueZero search for a list (finds NaN).
 */
export function contains(text: string, part: string): boolean;
export function contains<T>(list: readonly T[], item: T): boolean;
export function contains(value: any, part: any): boolean {
  return value.includes(part);
}
