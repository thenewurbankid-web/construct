// Type-check atoms: all are type guards.

/**
 * isText(value) reads "whether value is text".
 * Exactly `typeof value === 'string'`.
 */
export function isText(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * isNumber(value) reads "whether value is a number".
 * Exactly `typeof value === 'number'` (NaN included, as typeof does).
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

/**
 * isBoolean(value) reads "whether value is a yes/no value".
 * Exactly `typeof value === 'boolean'`.
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/**
 * isNothing(value) reads "whether value is nothing".
 * Exactly `value == null` (null or undefined, nothing else).
 */
export function isNothing(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * hasKey(obj, key) reads "whether obj has key".
 * Exactly `Object.hasOwn(obj, key)` for objects (own keys only, inherited ones don't count);
 * false for null, undefined and primitives.
 */
export function hasKey<T, K extends PropertyKey>(obj: T, key: K): obj is T & Record<K, unknown> {
  return typeof obj === 'object' && obj !== null && Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * isA(value, Type) reads "whether value is a Type".
 * Exactly `value instanceof Type`.
 */
export function isA<C extends abstract new (...args: any[]) => unknown>(value: unknown, type: C): value is InstanceType<C> {
  return value instanceof type;
}
