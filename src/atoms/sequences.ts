// Atoms shared by text and lists.

/**
 * lengthOf(textOrList) reads "the length of textOrList".
 * Exactly `x.length` for text or a list.
 */
export function lengthOf(value: string | readonly unknown[]): number {
  return value.length;
}

/**
 * hasText(text, part, position) reads "whether text has part in it".
 * Exactly `text.includes(part, position)` (substring search).
 */
export function hasText(text: string, part: string, position?: number): boolean {
  return text.includes(part, position);
}

/**
 * hasItem(list, item, fromIndex) reads "whether list has item in it".
 * Exactly `list.includes(item, fromIndex)` (SameValueZero, so it finds NaN).
 */
export function hasItem<T>(list: readonly T[], item: T, fromIndex?: number): boolean {
  return list.includes(item, fromIndex);
}
