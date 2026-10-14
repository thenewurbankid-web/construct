// @line-atoms functional 939c25c: generated from smith-functional src/atoms/checks.ts by packages/line-atoms/runtime.mjs --write; do not edit.
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
 * hasProperty(obj, key) reads "whether obj has the property key".
 * Exactly `key in obj`: own and inherited keys alike (hasKey counts own keys only);
 * throws on a primitive, as `in` does.
 */
export function hasProperty<K extends PropertyKey>(obj: object, key: K): boolean {
  return key in obj;
}

/**
 * typeOf(value) reads "the type of value".
 * Exactly `typeof value`.
 */
export function typeOf(value: unknown): 'string' | 'number' | 'bigint' | 'boolean' | 'symbol' | 'undefined' | 'object' | 'function' {
  return typeof value;
}

/**
 * isFunction(value) reads "whether value is a function".
 * Exactly `typeof value === 'function'`.
 */
export function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === 'function';
}

/**
 * isObjectType(value) reads "whether the type of value is object".
 * Exactly `typeof value === 'object'`: null included, as typeof does, functions not.
 */
export function isObjectType(value: unknown): value is object | null {
  return typeof value === 'object';
}

/**
 * isA(value, Type) reads "whether value is a Type".
 * Exactly `value instanceof Type`.
 */
export function isA<C extends abstract new (...args: any[]) => unknown>(value: unknown, type: C): value is InstanceType<C> {
  return value instanceof type;
}
