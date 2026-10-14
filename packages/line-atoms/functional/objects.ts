// @line-atoms functional 939c25c: generated from smith-functional src/atoms/objects.ts by packages/line-atoms/runtime.mjs --write; do not edit.
// Object atoms. Never mutate the input: every "change" returns a shallow copy.

/**
 * keysOf(obj) reads "the keys of obj".
 * Exactly `Object.keys(obj)`.
 */
export function keysOf<T extends object>(obj: T): Array<Extract<keyof T, string>> {
  return Object.keys(obj) as Array<Extract<keyof T, string>>;
}

/**
 * valuesOf(obj) reads "the values of obj".
 * Exactly `Object.values(obj)`.
 */
export function valuesOf<T extends object>(obj: T): Array<T[keyof T]> {
  return Object.values(obj) as Array<T[keyof T]>;
}

/**
 * entriesOf(obj) reads "the key/value pairs of obj".
 * Exactly `Object.entries(obj)`.
 */
export function entriesOf<T extends object>(obj: T): Array<[Extract<keyof T, string>, T[keyof T]]> {
  return Object.entries(obj) as Array<[Extract<keyof T, string>, T[keyof T]]>;
}

/**
 * fromEntries(pairs) reads "an object from pairs".
 * Exactly `Object.fromEntries(pairs)`.
 */
export function fromEntries<K extends PropertyKey, V>(pairs: Iterable<readonly [K, V]>): Record<K, V> {
  return Object.fromEntries(pairs) as Record<K, V>;
}

/** The type of `{ ...A, ...B }`: B's keys override A's. */
export type Merge<A, B> = Omit<A, keyof B> & B;

/**
 * merged(a, b, …) reads "a merged with b".
 * Exactly `{ ...a, ...b }` (a new object; later keys win; the copy-returning Object.assign).
 */
export function merged<A extends object, B extends object>(a: A, b: B): Merge<A, B>;
export function merged<A extends object, B extends object, C extends object>(a: A, b: B, c: C): Merge<Merge<A, B>, C>;
export function merged(...objects: object[]): object;
export function merged(...objects: object[]): object {
  let out = {};
  for (const obj of objects) {
    out = { ...out, ...obj };
  }
  return out;
}

/**
 * withKey(obj, key, value) reads "obj with key set to value".
 * Exactly `{ ...obj, [key]: value }` (the copy-returning `obj[key] = value`).
 */
export function withKey<T extends object, K extends PropertyKey, V>(obj: T, key: K, value: V): Merge<T, Record<K, V>> {
  return { ...obj, [key]: value } as Merge<T, Record<K, V>>;
}

/**
 * withoutKey(obj, key) reads "obj without key".
 * Exactly `(({ [key]: _, ...rest }) => rest)(obj)` (the copy-returning `delete obj[key]`).
 */
export function withoutKey<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const copy: any = { ...obj };
  delete copy[key];
  return copy;
}

/**
 * pick(obj, keys) reads "only keys of obj".
 * Exactly `Object.fromEntries(keys.filter((k) => Object.hasOwn(obj, k)).map((k) => [k, obj[k]]))`.
 */
export function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const out: any = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      Object.defineProperty(out, key, { value: obj[key], enumerable: true, writable: true, configurable: true });
    }
  }
  return out;
}

/**
 * omit(obj, keys) reads "obj without keys".
 * A copy of obj with each of keys removed (withoutKey for several keys).
 */
export function omit<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const copy: any = { ...obj };
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
}
