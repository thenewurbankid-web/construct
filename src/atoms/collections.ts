// Map and Set atoms. Never mutate the input: "changes" return a new Map/Set.

/**
 * setOf(items) reads "the set of items".
 * Exactly `new Set(items)`.
 */
export function setOf<T>(items: Iterable<T> = []): Set<T> {
  return new Set(items);
}

/**
 * isInSet(set, item) reads "whether item is in set".
 * Exactly `set.has(item)`.
 */
export function isInSet<T>(set: ReadonlySet<T>, item: T): boolean {
  return set.has(item);
}

/**
 * withMember(set, item) reads "set with item added".
 * Exactly `new Set(set).add(item)` (the copy-returning set.add).
 */
export function withMember<T>(set: ReadonlySet<T>, item: T): Set<T> {
  return new Set(set).add(item);
}

/**
 * mapOf(pairs) reads "the map of pairs".
 * Exactly `new Map(pairs)`.
 */
export function mapOf<K, V>(pairs: Iterable<readonly [K, V]> = []): Map<K, V> {
  return new Map(pairs);
}

/**
 * getFrom(map, key) reads "the value for key in map".
 * Exactly `map.get(key)`.
 */
export function getFrom<K, V>(map: ReadonlyMap<K, V>, key: K): V | undefined {
  return map.get(key);
}

/**
 * withEntry(map, key, value) reads "map with key set to value".
 * Exactly `new Map(map).set(key, value)` (the copy-returning map.set).
 */
export function withEntry<K, V>(map: ReadonlyMap<K, V>, key: K, value: V): Map<K, V> {
  return new Map(map).set(key, value);
}

/**
 * sizeOf(mapOrSet) reads "the size of mapOrSet".
 * Exactly `x.size`.
 */
export function sizeOf(collection: ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>): number {
  return collection.size;
}
