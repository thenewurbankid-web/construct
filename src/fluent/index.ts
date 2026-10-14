// The fluent facade: the same atoms, read as a sentence. Every chain here ends in a plain
// value and delegates to exactly one atom, so `checks().if(a).is().equalTo(b)` is `equals(a, b)`.
// The catalog's `fluent` field is the list of forms; test/fluent.test.mjs holds each one to its atom.
//
// Imported as `smith/fluent`, apart from the plain atoms: when, choose, match and attempt
// share their names with the atoms they wrap.
import * as atoms from '../atoms';
import type { Ordered } from '../atoms/comparison';
import type { FalsyOf, Lazy } from '../atoms/logic';
import type { SortOrder } from '../atoms/lists';

type Visit<T, R> = (item: T, index: number, list: readonly T[]) => R;
type Constructor = abstract new (...args: any[]) => unknown;

/** The comparisons and type checks after `is()`; `not()` flips the answer of the one that follows. */
export class Is<A> {
  constructor(private readonly value: A, private readonly negated: boolean = false) {}

  private answer(result: boolean): boolean {
    return this.negated ? !result : result;
  }

  not(): Is<A> {
    return new Is<A>(this.value, !this.negated);
  }

  equalTo(other: A): boolean {
    return this.answer(atoms.equals(this.value, other));
  }

  lessThan(other: A & Ordered): boolean {
    return this.answer(atoms.lessThan(this.value as A & Ordered, other));
  }

  atMost(other: A & Ordered): boolean {
    return this.answer(atoms.atMost(this.value as A & Ordered, other));
  }

  greaterThan(other: A & Ordered): boolean {
    return this.answer(atoms.greaterThan(this.value as A & Ordered, other));
  }

  atLeast(other: A & Ordered): boolean {
    return this.answer(atoms.atLeast(this.value as A & Ordered, other));
  }

  text(): boolean {
    return this.answer(atoms.isText(this.value));
  }

  number(): boolean {
    return this.answer(atoms.isNumber(this.value));
  }

  boolean(): boolean {
    return this.answer(atoms.isBoolean(this.value));
  }

  nothing(): boolean {
    return this.answer(atoms.isNothing(this.value));
  }

  a(type: Constructor): boolean {
    return this.answer(atoms.isA(this.value, type));
  }
}

/** The ownership checks after `has()`. */
export class Has<A> {
  constructor(private readonly value: A) {}

  key(key: PropertyKey): boolean {
    return atoms.hasKey(this.value, key);
  }
}

/** One value under test: `checks().if(value)`. */
export class Check<A> {
  constructor(private readonly value: A) {}

  is(): Is<A> {
    return new Is<A>(this.value);
  }

  has(): Has<A> {
    return new Has<A>(this.value);
  }

  /** `a && b`: other only runs when the value is truthy. */
  and<B>(other: Lazy<B>): FalsyOf<A> | B {
    return atoms.and(this.value, other);
  }
}

export class Checks {
  if<A>(value: A): Check<A> {
    return new Check<A>(value);
  }
}

/** checks().if(a).is().equalTo(b) reads "checks if a is equal to b". */
export function checks(): Checks {
  return new Checks();
}

export class Text {
  constructor(private readonly value: string) {}

  lowerCase(): string {
    return atoms.lowerCase(this.value);
  }

  upperCase(): string {
    return atoms.upperCase(this.value);
  }

  trimmed(): string {
    return atoms.trimmed(this.value);
  }

  splitBy(separator: string | RegExp, limit?: number): string[] {
    return atoms.splitBy(this.value, separator, limit);
  }

  replaceEvery(pattern: string | RegExp, replacement: string): string {
    return atoms.replaceEvery(this.value, pattern, replacement);
  }

  replaceFirst(pattern: string | RegExp, replacement: string): string {
    return atoms.replaceFirst(this.value, pattern, replacement);
  }
}

/** text(s).lowerCase() reads "text s, lower case". */
export function text(value: string): Text {
  return new Text(value);
}

export class List<T> {
  constructor(private readonly items: readonly T[]) {}

  hasItem(item: T, fromIndex?: number): boolean {
    return atoms.hasItem(this.items, item, fromIndex);
  }

  joinWith(separator?: string): string {
    return atoms.joinWith(this.items, separator);
  }

  firstOf(): T | undefined {
    return atoms.firstOf(this.items);
  }

  lastOf(): T | undefined {
    return atoms.lastOf(this.items);
  }

  mapEach<R>(fn: Visit<T, R>): R[] {
    return atoms.mapEach(this.items, fn);
  }

  keepWhere(test: Visit<T, unknown>): T[] {
    return atoms.keepWhere(this.items, test);
  }

  findFirst(test: Visit<T, unknown>): T | undefined {
    return atoms.findFirst(this.items, test);
  }

  hasAnyWhere(test: Visit<T, unknown>): boolean {
    return atoms.hasAnyWhere(this.items, test);
  }

  isEveryWhere(test: Visit<T, unknown>): boolean {
    return atoms.isEveryWhere(this.items, test);
  }

  sortedBy(order?: SortOrder<T>): T[] {
    return atoms.sortedBy(this.items, order);
  }

  reversed(): T[] {
    return atoms.reversed(this.items);
  }

  part(from?: number, to?: number): T[] {
    return atoms.part(this.items, from, to);
  }

  flattened<D extends number = 1>(depth?: D): FlatArray<readonly T[], D>[] {
    return atoms.flattened(this.items, depth);
  }

  uniqueOf(): T[] {
    return atoms.uniqueOf(this.items);
  }
}

/** list(xs).mapEach(fn) reads "list xs, map each with fn". */
export function list<T>(items: readonly T[]): List<T> {
  return new List<T>(items);
}

export class Yielding<A> {
  constructor(private readonly condition: unknown, private readonly then: Lazy<A>) {}

  otherwise<B>(otherwise: Lazy<B>): A | B {
    return atoms.when(this.condition, this.then, otherwise);
  }
}

export class When {
  constructor(private readonly condition: unknown) {}

  yields<A>(then: Lazy<A>): Yielding<A> {
    return new Yielding<A>(this.condition, then);
  }
}

/** when(c).yields(() => a).otherwise(() => b) reads "when c yields a, otherwise b". */
export function when(condition: unknown): When {
  return new When(condition);
}

export class Choice<R> {
  constructor(private readonly cases: ReadonlyArray<readonly [atoms.Condition, Lazy<unknown>]>) {}

  /** A condition may be a thunk, so it is only evaluated when reached, as in a real else-if. */
  when<A>(condition: atoms.Condition, body: Lazy<A>): Choice<R | A> {
    return new Choice<R | A>([...this.cases, [condition, body]]);
  }

  otherwise<F>(fallback: Lazy<F>): R | F {
    return atoms.choose(this.cases, fallback) as R | F;
  }
}

/** choose().when(c1, () => a).when(c2, () => b).otherwise(() => fallback) reads "choose: when c1, a; when c2, b; otherwise fallback". */
export function choose(): Choice<never> {
  return new Choice<never>([]);
}

export class Matching<R> {
  constructor(private readonly value: string | number, private readonly cases: Readonly<Record<string, Lazy<unknown>>>) {}

  on<A>(key: string | number, body: Lazy<A>): Matching<R | A> {
    return new Matching<R | A>(this.value, { ...this.cases, [key]: body });
  }

  otherwise<F>(fallback: Lazy<F>): R | F {
    return atoms.match(this.value, this.cases, fallback) as R | F;
  }
}

/** match(value).on(k, () => a).otherwise(() => fallback) reads "match value: on k, a; otherwise fallback". */
export function match(value: string | number): Matching<never> {
  return new Matching<never>(value, {});
}

export class Recovering<T, C> {
  constructor(private readonly body: () => T, private readonly recover: (error: unknown) => C) {}

  /** Runs the body, then recover on an error, then cleanup, always last. */
  finally(cleanup: () => void): T | C {
    return atoms.attempt(this.body, this.recover, cleanup);
  }
}

export class Attempt<T> {
  constructor(private readonly body: () => T) {}

  onFailure<C>(recover: (error: unknown) => C): Recovering<T, C> {
    return new Recovering<T, C>(this.body, recover);
  }

  /** try/finally: runs the body, then cleanup; an error is rethrown. */
  finally(cleanup: () => void): T {
    return atoms.attempt(this.body, undefined, cleanup);
  }
}

/** attempt(() => body).onFailure((e) => recover).finally(() => cleanup) reads "attempt body; on failure, recover; finally, clean up". */
export function attempt<T>(body: () => T): Attempt<T> {
  return new Attempt<T>(body);
}
