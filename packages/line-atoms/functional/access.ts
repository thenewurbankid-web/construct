// @line-atoms functional 939c25c: generated from smith-functional src/atoms/access.ts by packages/line-atoms/runtime.mjs --write; do not edit.
// Access atoms: property and index reads with optional-chaining semantics.

/**
 * get(obj, key) reads "the key of obj".
 * Exactly `obj?.[key]`: undefined when obj is null or undefined.
 */
export function get<T, K extends keyof NonNullable<T>>(obj: T, key: K): NonNullable<T>[K] | (T extends null | undefined ? undefined : never) {
  if (obj === null || obj === undefined) {
    return undefined as never;
  }
  return (obj as NonNullable<T>)[key];
}

/**
 * at(list, index) reads "the item at index of list".
 * Exactly `list?.at(index)`: negative indexes count from the end; undefined when out of range
 * or when list is null or undefined.
 */
export function at<T>(list: readonly T[] | null | undefined, index: number): T | undefined {
  if (list === null || list === undefined) {
    return undefined;
  }
  const whole = Math.trunc(index) || 0;
  const position = whole < 0 ? list.length + whole : whole;
  return position >= 0 && position < list.length ? list[position] : undefined;
}
