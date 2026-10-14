// List atoms (Array.prototype / Array). Never mutate the input: every "change" returns a copy.
import type { Ordered } from './comparison';

type Visit<T, R> = (item: T, index: number, list: readonly T[]) => R;

/**
 * firstOf(list) reads "list xs takes first".
 * Exactly `list[0]` (undefined when empty).
 */
export function firstOf<T>(list: readonly T[]): T | undefined {
  return list[0];
}

/**
 * lastOf(list) reads "list xs takes last".
 * Exactly `list[list.length - 1]` (undefined when empty).
 */
export function lastOf<T>(list: readonly T[]): T | undefined {
  return list[list.length - 1];
}

/**
 * positionOf(list, item, fromIndex) reads "the position of item in list".
 * Exactly `list.indexOf(item, fromIndex)` (-1 when absent; strict === matching, so never finds NaN).
 */
export function positionOf<T>(list: readonly T[], item: T, fromIndex?: number): number {
  return list.indexOf(item, fromIndex);
}

/**
 * positionWhere(list, test) reads "the position of the first item in list where test holds".
 * Exactly `list.findIndex(test)` (-1 when none).
 */
export function positionWhere<T>(list: readonly T[], test: Visit<T, unknown>): number {
  return list.findIndex(test);
}

/**
 * mapEach(list, (item) => result) reads "clones list xs and maps each with fn".
 * Exactly `list.map(fn)`.
 */
export function mapEach<T, R>(list: readonly T[], fn: Visit<T, R>): R[] {
  return list.map(fn);
}

/**
 * keepWhere(list, test) reads "clones list xs and keeps where test".
 * Exactly `list.filter(test)`.
 */
export function keepWhere<T, S extends T>(list: readonly T[], test: (item: T, index: number, list: readonly T[]) => item is S): S[];
export function keepWhere<T>(list: readonly T[], test: Visit<T, unknown>): T[];
export function keepWhere<T>(list: readonly T[], test: Visit<T, unknown>): T[] {
  return list.filter(test);
}

/**
 * reduceTo(list, (total, item) => next, start) reads "list reduced to a total, starting from start".
 * Exactly `list.reduce(fn, start)` (the start value is required, so an empty list is fine).
 */
export function reduceTo<T, R>(list: readonly T[], fn: (total: R, item: T, index: number, list: readonly T[]) => R, start: R): R {
  return list.reduce(fn, start);
}

/**
 * findFirst(list, test) reads "list xs finds first where test".
 * Exactly `list.find(test)` (undefined when none).
 */
export function findFirst<T, S extends T>(list: readonly T[], test: (item: T, index: number, list: readonly T[]) => item is S): S | undefined;
export function findFirst<T>(list: readonly T[], test: Visit<T, unknown>): T | undefined;
export function findFirst<T>(list: readonly T[], test: Visit<T, unknown>): T | undefined {
  return list.find(test);
}

/**
 * hasAnyWhere(list, test) reads "checks if xs has any where test".
 * Exactly `list.some(test)`.
 */
export function hasAnyWhere<T>(list: readonly T[], test: Visit<T, unknown>): boolean {
  return list.some(test);
}

/**
 * isEveryWhere(list, test) reads "checks if xs has only items where test".
 * Exactly `list.every(test)`.
 */
export function isEveryWhere<T, S extends T>(list: readonly T[], test: (item: T, index: number, list: readonly T[]) => item is S): list is readonly S[];
export function isEveryWhere<T>(list: readonly T[], test: Visit<T, unknown>): boolean;
export function isEveryWhere<T>(list: readonly T[], test: Visit<T, unknown>): boolean {
  return list.every(test);
}

/** How sortedBy orders: a property name, a one-argument key selector, or a two-argument compare. */
export type SortOrder<T> = keyof T | ((item: T) => Ordered) | ((a: T, b: T) => number);

function byKey<T>(key: (item: T) => any): (a: T, b: T) => number {
  return (a, b) => {
    const left = key(a);
    const right = key(b);
    return left < right ? -1 : left > right ? 1 : 0;
  };
}

/**
 * sortedBy(list, order) reads "clones list xs and sorts by order".
 * Returns a sorted COPY, never sorting in place. order is a property name ('title'), a
 * one-argument key selector (b => b.title), or a two-argument compare ((a, b) => a.id - b.id),
 * which makes it exactly `list.toSorted(compare)`. With no order it is `list.toSorted()`.
 * A function with exactly one declared parameter is treated as a key selector.
 */
export function sortedBy<T>(list: readonly T[], order?: SortOrder<T>): T[] {
  const copy = list.slice();
  if (order === undefined) {
    return copy.sort();
  }
  if (typeof order === 'function') {
    if (order.length === 1) {
      return copy.sort(byKey(order as (item: T) => Ordered));
    }
    return copy.sort(order as (a: T, b: T) => number);
  }
  return copy.sort(byKey((item: T) => item[order]));
}

/**
 * reversed(list) reads "clones list xs and reverses".
 * Exactly `list.toReversed()`: a reversed copy.
 */
export function reversed<T>(list: readonly T[]): T[] {
  return list.slice().reverse();
}

/**
 * part(list, from, to) reads "clones list xs and keeps from from to to".
 * Exactly `list.slice(from, to)`.
 */
export function part<T>(list: readonly T[], from?: number, to?: number): T[] {
  return list.slice(from, to);
}

/**
 * concatenated(a, b, …) reads "a followed by b".
 * Exactly `[...a, ...b]`.
 */
export function concatenated<T>(...lists: ReadonlyArray<readonly T[]>): T[] {
  const out: T[] = [];
  for (const list of lists) {
    out.push(...list);
  }
  return out;
}

/**
 * flattened(list, depth) reads "clones list xs and flattens".
 * Exactly `list.flat(depth)` (depth defaults to 1).
 */
export function flattened<A extends readonly unknown[], D extends number = 1>(list: A, depth?: D): FlatArray<A, D>[] {
  return list.flat(depth) as FlatArray<A, D>[];
}

/**
 * flatMapEach(list, (item) => results) reads "each item of list mapped to results, flattened".
 * Exactly `list.flatMap(fn)`.
 */
export function flatMapEach<T, R>(list: readonly T[], fn: Visit<T, R | readonly R[]>): R[] {
  return list.flatMap(fn);
}

/**
 * uniqueOf(list) reads "clones list xs and drops duplicates".
 * Exactly `[...new Set(list)]` (first occurrence kept; SameValueZero, so NaN dedupes).
 */
export function uniqueOf<T>(list: readonly T[]): T[] {
  return Array.from(new Set(list));
}

/**
 * countOf(list, test) reads "how many items of list pass test".
 * Exactly `list.filter(test).length`.
 */
export function countOf<T>(list: readonly T[], test: Visit<T, unknown>): number {
  let count = 0;
  list.forEach((item, index, whole) => {
    if (test(item, index, whole)) {
      count += 1;
    }
  });
  return count;
}

/**
 * groupedBy(list, (item) => key) reads "list grouped by key".
 * Exactly `Object.groupBy(list, fn)`: a null-prototype object of key -> items in order.
 */
export function groupedBy<T, K extends PropertyKey>(list: readonly T[], key: (item: T, index: number) => K): Partial<Record<K, T[]>> {
  const groups: Partial<Record<K, T[]>> = Object.create(null);
  list.forEach((item, index) => {
    const name = key(item, index);
    const group = groups[name];
    if (group) {
      group.push(item);
    } else {
      groups[name] = [item];
    }
  });
  return groups;
}

/**
 * chunked(list, size) reads "list in chunks of size".
 * Consecutive copies of at most size items (size must be a whole number >= 1).
 */
export function chunked<T>(list: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`chunked: size must be a whole number >= 1, got ${String(size)}`);
  }
  const out: T[][] = [];
  for (let start = 0; start < list.length; start += size) {
    out.push(list.slice(start, start + size));
  }
  return out;
}

/**
 * range(from, to, step) reads "the numbers from from up to (not including) to, by step".
 * Exactly `Array.from({ length: Math.max(0, Math.ceil((to - from) / step)) }, (_, i) => from + i * step)`.
 * All arguments must be finite and step non-zero, so a range is always bounded.
 */
export function range(from: number, to: number, step = 1): number[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(step) || step === 0) {
    throw new RangeError('range: from, to and step must be finite, and step non-zero');
  }
  return Array.from({ length: Math.max(0, Math.ceil((to - from) / step)) }, (_, i) => from + i * step);
}

/**
 * listFrom(source, (item, index) => result) reads "a list from source".
 * Exactly `Array.from(source, fn)`.
 */
export function listFrom<T>(source: Iterable<T> | ArrayLike<T>): T[];
export function listFrom<T, R>(source: Iterable<T> | ArrayLike<T>, fn: (item: T, index: number) => R): R[];
export function listFrom(source: any, fn?: any): unknown[] {
  return fn === undefined ? Array.from(source) : Array.from(source, fn);
}

/**
 * added(list, item) reads "list with item added at the end".
 * Exactly `[...list, item]` (the copy-returning push).
 */
export function added<T>(list: readonly T[], item: T): T[] {
  return [...list, item];
}

/**
 * prepended(list, item) reads "list with item added at the start".
 * Exactly `[item, ...list]` (the copy-returning unshift).
 */
export function prepended<T>(list: readonly T[], item: T): T[] {
  return [item, ...list];
}

/**
 * removedAt(list, index) reads "list without the item at index".
 * Exactly `list.toSpliced(index, 1)` (the copy-returning splice; negative counts from the end).
 */
export function removedAt<T>(list: readonly T[], index: number): T[] {
  const copy = list.slice();
  copy.splice(index, 1);
  return copy;
}

/**
 * insertedAt(list, index, item) reads "list with item inserted at index".
 * Exactly `list.toSpliced(index, 0, item)`.
 */
export function insertedAt<T>(list: readonly T[], index: number, item: T): T[] {
  const copy = list.slice();
  copy.splice(index, 0, item);
  return copy;
}

/**
 * replacedAt(list, index, item) reads "list with the item at index replaced by item".
 * Exactly `list.with(index, item)` (the copy-returning `list[index] = item`; RangeError when out of range).
 */
export function replacedAt<T>(list: readonly T[], index: number, item: T): T[] {
  const whole = Math.trunc(index) || 0;
  const position = whole < 0 ? list.length + whole : whole;
  if (position < 0 || position >= list.length) {
    throw new RangeError(`Invalid index : ${String(index)}`);
  }
  const copy = list.slice();
  copy[position] = item;
  return copy;
}
