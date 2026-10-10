// Smith -- a small framework for the atomic pattern: shared connector atoms
// (Chain, Organism) and single-source comparison logic (Comparable), meant
// to be the FOUNDATION a new project or module is written against from the
// start, not retrofitted onto existing code (see README for why).

export abstract class Chain {
  and(): this {
    return this;
  }

  but(): this {
    return this;
  }

  also(): this {
    return this;
  }

  if(): this {
    return this;
  }

  then(): this {
    return this;
  }

  is(): this {
    return this;
  }
}

export abstract class Organism {
  will(): this {
    return this;
  }
}

// The single canonical place ordering/equality logic lives. Implement
// compareTo() once per value type and every comparison method comes for
// free, instead of each value type hand-rolling its own equals()/
// greaterThan() (which is how the same shape ends up written twice).
export abstract class Comparable<T> {
  protected abstract compareTo(other: T): number;

  equals(other: T): boolean {
    return this.compareTo(other) === 0;
  }

  greaterThan(other: T): boolean {
    return this.compareTo(other) > 0;
  }

  lessThan(other: T): boolean {
    return this.compareTo(other) < 0;
  }

  greaterThanOrEqual(other: T): boolean {
    return this.compareTo(other) >= 0;
  }

  lessThanOrEqual(other: T): boolean {
    return this.compareTo(other) <= 0;
  }
}

// The branch-chain system: converts `if (subject.method(arg)) { return a; }
// else { return b; }` into `ifIt(subject).method(arg).thenItIs(a).orelseIs(b)`
// with zero closures. Every method here is zero- or one-arg, matching the
// same rule Comparable/Chain already follow.
//
// equals()/greaterThan()/etc. DELEGATE to the same-named method on the
// wrapped subject (ifIt(x).equals(y) behaves exactly like x.equals(y), just
// deferred through the chain) -- that's the whole point of subject-passing.
// isSameAs()/isEqualTo() are the raw `===` alternative, for primitives that
// don't have their own .equals() (e.g. ifIt(rule).isSameAs(null)).
export class Conditional<T> {
  constructor(readonly matched: boolean, readonly result: T | undefined) {}

  orifIt<S>(subject: S): Subject<T, S> {
    return new Subject<T, S>(this, subject);
  }

  orelseIs(value: T): T {
    return this.matched ? (this.result as T) : value;
  }
}

export class Subject<T, S> {
  constructor(readonly parent: Conditional<T> | null, readonly value: S) {}

  equals(other: unknown): Clause<T, S> {
    return new Clause<T, S>(this.parent, (this.value as any).equals(other));
  }

  greaterThan(other: unknown): Clause<T, S> {
    return new Clause<T, S>(this.parent, (this.value as any).greaterThan(other));
  }

  lessThan(other: unknown): Clause<T, S> {
    return new Clause<T, S>(this.parent, (this.value as any).lessThan(other));
  }

  greaterThanOrEqual(other: unknown): Clause<T, S> {
    return new Clause<T, S>(this.parent, (this.value as any).greaterThanOrEqual(other));
  }

  lessThanOrEqual(other: unknown): Clause<T, S> {
    return new Clause<T, S>(this.parent, (this.value as any).lessThanOrEqual(other));
  }

  isSameAs(other: S): Clause<T, S> {
    return new Clause<T, S>(this.parent, this.value === other);
  }

  isEqualTo(other: S): Clause<T, S> {
    return new Clause<T, S>(this.parent, this.value === other);
  }

  // Negated pair, same delegating/raw split as equals()/isEqualTo() above.
  // What transform.js emits for !==/!= (status !== 'valid' -> !status.equals('valid')):
  // "!" can't sensibly apply to a Clause object, so the negation has to be
  // its own method instead of wrapping the chain in a unary "!".
  notEquals(other: unknown): Clause<T, S> {
    return new Clause<T, S>(this.parent, !(this.value as any).equals(other));
  }

  isNotEqualTo(other: S): Clause<T, S> {
    return new Clause<T, S>(this.parent, this.value !== other);
  }

  // Only callable when S is boolean (the `this` parameter enforces that at
  // compile time) -- for a compound and(...)/or(...) condition that's
  // already a yes/no value, with no "other" to compare against.
  isTrue(this: Subject<T, boolean>): Clause<T, boolean> {
    return new Clause<T, boolean>(this.parent, this.value);
  }
}

export class Clause<T, S> {
  constructor(readonly parent: Conditional<T> | null, readonly matched: boolean) {}

  thenItIs(value: T): Conditional<T> {
    if (this.parent && this.parent.matched) {
      return this.parent; // an earlier clause already matched -- keep its result
    }
    return new Conditional<T>(this.matched, this.matched ? value : undefined);
  }

  // Fluent replacement for the free and(a, b) function: instead of
  // `and(x.greaterThan(a), y.lessThan(b))`, `ifIt(x).greaterThan(a).and(y)
  // .lessThan(b)` -- same "both sides always evaluate" semantics and()
  // already had (these are plain values, not closures), just read left to
  // right as one sentence instead of two nested calls.
  and<S2>(subject: S2): AndSubject<S2> {
    return new AndSubject<S2>(this.matched, subject);
  }

  or<S2>(subject: S2): OrSubject<S2> {
    return new OrSubject<S2>(this.matched, subject);
  }
}

// Same method surface as Subject, but each method combines its own result
// with the boolean accumulated so far (via && ) instead of starting a fresh
// Clause -- a leaf combinator, not a branch, so it returns a plain boolean,
// not another Conditional-bound Clause.
export class AndSubject<S> {
  constructor(readonly priorMatched: boolean, readonly value: S) {}

  equals(other: unknown): boolean {
    return this.priorMatched && (this.value as any).equals(other);
  }

  greaterThan(other: unknown): boolean {
    return this.priorMatched && (this.value as any).greaterThan(other);
  }

  lessThan(other: unknown): boolean {
    return this.priorMatched && (this.value as any).lessThan(other);
  }

  greaterThanOrEqual(other: unknown): boolean {
    return this.priorMatched && (this.value as any).greaterThanOrEqual(other);
  }

  lessThanOrEqual(other: unknown): boolean {
    return this.priorMatched && (this.value as any).lessThanOrEqual(other);
  }

  isSameAs(other: S): boolean {
    return this.priorMatched && this.value === other;
  }

  isEqualTo(other: S): boolean {
    return this.priorMatched && this.value === other;
  }

  notEquals(other: unknown): boolean {
    return this.priorMatched && !(this.value as any).equals(other);
  }

  isNotEqualTo(other: S): boolean {
    return this.priorMatched && this.value !== other;
  }
}

// Same shape as AndSubject, combining with || instead of &&.
export class OrSubject<S> {
  constructor(readonly priorMatched: boolean, readonly value: S) {}

  equals(other: unknown): boolean {
    return this.priorMatched || (this.value as any).equals(other);
  }

  greaterThan(other: unknown): boolean {
    return this.priorMatched || (this.value as any).greaterThan(other);
  }

  lessThan(other: unknown): boolean {
    return this.priorMatched || (this.value as any).lessThan(other);
  }

  greaterThanOrEqual(other: unknown): boolean {
    return this.priorMatched || (this.value as any).greaterThanOrEqual(other);
  }

  lessThanOrEqual(other: unknown): boolean {
    return this.priorMatched || (this.value as any).lessThanOrEqual(other);
  }

  isSameAs(other: S): boolean {
    return this.priorMatched || this.value === other;
  }

  isEqualTo(other: S): boolean {
    return this.priorMatched || this.value === other;
  }

  notEquals(other: unknown): boolean {
    return this.priorMatched || !(this.value as any).equals(other);
  }

  isNotEqualTo(other: S): boolean {
    return this.priorMatched || this.value !== other;
  }
}

export function ifIt<T, S>(subject: S): Subject<T, S> {
  return new Subject<T, S>(null, subject);
}

// && / || as free functions, not methods -- a.and(b) would assume `a` has
// its own .and() method, but && and || almost always combine plain
// booleans (the result of a comparison), and booleans have no such method.
export function and(a: boolean, b: boolean): boolean {
  return a && b;
}

export function or(a: boolean, b: boolean): boolean {
  return a || b;
}
