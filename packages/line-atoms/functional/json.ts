// @line-atoms functional 939c25c: generated from smith-functional src/atoms/json.ts by packages/line-atoms/runtime.mjs --write; do not edit.
// JSON atoms. parseJson never throws.

/** The outcome of an operation that can fail, as a value instead of an exception. */
export type Result<T, E = unknown> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/**
 * parseJson(text) reads "the value written as JSON in text".
 * `JSON.parse(text)` as a Result: { ok: true, value } or { ok: false, error } -- never throws.
 */
export function parseJson<T = unknown>(text: string): Result<T, SyntaxError> {
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (error) {
    return { ok: false, error: error as SyntaxError };
  }
}

/**
 * toJson(value, indent) reads "value written as JSON".
 * Exactly `JSON.stringify(value, null, indent)` (undefined for undefined/functions; throws on cycles and bigints, like JSON.stringify).
 */
export function toJson(value: unknown, indent?: number | string): string | undefined {
  return JSON.stringify(value, null, indent);
}
