// R9 (ENGLISH-RULES.md): a callback is an `every()` sentence, not an arrow. The item gets a name
// with a placeholder (`every(x)`), the list follows with `in(xs)`, and the body is one atom on
// `x`. With no build step, the body records its step instead of computing it, and the sentence
// turns the record into the callback when it runs:
//
//   every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(2)   // xs.map((x) => x * 2)
//
// The first word decides what the sentence returns: `every(x).in(xs)` a list,
// `checks().if().every(x)` / `checks().if().any(x)` a yes or no, `the().first(x).in(xs)` one item,
// `folds()` one value.
//
// A body is exactly one atom. A longer one (`x => x.price * qty`) is not chained in place: it
// becomes a molecule in the app, named for its use case, so the body words end the sentence:
// nothing chains after them (a type error), and a placeholder that reaches a plain atom or an
// operator throws instead of computing. How a sentence calls a molecule is still open (R9).
import * as atoms from '../atoms';

const MULTI_STEP =
  'a body is one atom. Name a longer body as a molecule in your app, made of existing atoms (for example lineTotal), and call it by name; it is not a new Smith atom (R9)';

/** An imported name for the item in a body: `x`, `y`, `item`, `total`. */
export class Placeholder<N extends string = string> {
  constructor(readonly name: N) {}

  /** Raw JS on a placeholder (`x * 2`, `times(x, 2)`, `${x}`) is a body longer than one atom. */
  [Symbol.toPrimitive](): never {
    throw new TypeError(`${this.name} is a placeholder, not a value: ${MULTI_STEP}`);
  }
}

export const x: Placeholder<'x'> = new Placeholder('x');
export const y: Placeholder<'y'> = new Placeholder('y');
export const item: Placeholder<'item'> = new Placeholder('item');
export const total: Placeholder<'total'> = new Placeholder('total');

/** The placeholders a body can use, by name, with the type each one stands for. */
type Scope = Record<string, unknown>;
/** A value in a body: a constant, or a bound placeholder whose type fits. */
type Operand<S extends Scope, V> = V | { [K in keyof S & string]: S[K] extends V ? Placeholder<K> : never }[keyof S & string];
/** A recorded step: computes its value once the placeholders have values. */
type Step = (values: ReadonlyMap<string, unknown>) => unknown;
/** What the sentence does with its body: turns the step into the callback and runs the list atom. */
type Finish = (step: Step) => unknown;

function valueOf(operand: unknown, values: ReadonlyMap<string, unknown>): unknown {
  if (!(operand instanceof Placeholder)) return operand;
  if (!values.has(operand.name)) throw new ReferenceError(`${operand.name} is not bound here: bind it with every(${operand.name}).in(list)`);
  return values.get(operand.name);
}

/** The callback a sentence hands its list atom: binds the item to the placeholder and runs the step. */
const each = (name: string, step: Step) => (value: unknown): any => step(new Map([[name, value]]));

// ---------------------------------------------------------------- bodies: one atom each

/** `multiplying(a)`: waits for `by(b)`, which ends the body. */
export class Multiplying<S extends Scope, Out> {
  constructor(private readonly a: unknown, private readonly finish: Finish) {}

  by(b: Operand<S, number>): Out {
    return this.finish((v) => atoms.times(valueOf(this.a, v) as number, valueOf(b, v) as number)) as Out;
  }
}

/** `adding(a)`: waits for `to(b)`, which ends the body; `adding(x).to(total)` is `total + x`. */
export class Adding<S extends Scope, Out> {
  constructor(private readonly a: unknown, private readonly finish: Finish) {}

  to(b: Operand<S, number>): Out {
    return this.finish((v) => atoms.plus(valueOf(b, v) as number, valueOf(this.a, v) as number)) as Out;
  }
}

/** A body that computes a value: `by().multiplying(x).by(2)`. Out is what the sentence returns. */
export class ValueBody<S extends Scope, Out> {
  constructor(private readonly finish: Finish) {}

  multiplying(a: Operand<S, number>): Multiplying<S, Out> {
    return new Multiplying<S, Out>(a, this.finish);
  }

  adding(a: Operand<S, number>): Adding<S, Out> {
    return new Adding<S, Out>(a, this.finish);
  }
}

/** A body that asks about its subject: `is().positive()`. V is the subject's type. */
export class BodyIs<V, Out> {
  declare private readonly subject?: V;

  constructor(private readonly operand: unknown, private readonly finish: Finish) {}

  /** `> 0`, through greaterThan. */
  positive(this: BodyIs<number | bigint, Out>): Out {
    return this.finish((v) => atoms.greaterThan(valueOf(this.operand, v) as number, 0)) as Out;
  }
}

/** `if(x)` inside a body: the subject of the question, waiting for `is()`. */
export class BodySubject<V, Out> {
  constructor(private readonly operand: unknown, private readonly finish: Finish) {}

  is(): BodyIs<V, Out> {
    return new BodyIs<V, Out>(this.operand, this.finish);
  }
}

// ---------------------------------------------------------------- every(x).in(xs): a list

/** `kept()`: waits for `if(subject)`; xs.filter. */
export class Kept<S extends Scope, T> {
  constructor(private readonly name: string, private readonly items: readonly T[]) {}

  if<K extends keyof S & string>(subject: Placeholder<K>): BodySubject<S[K], T[]> {
    return new BodySubject<S[K], T[]>(subject, (step) => atoms.keepWhere(this.items, each(this.name, step)));
  }
}

export class MappedToClone<S extends Scope> {
  constructor(private readonly finish: Finish) {}

  by(): ValueBody<S, number[]> {
    return new ValueBody<S, number[]>(this.finish);
  }
}

export class MappedTo<S extends Scope> {
  constructor(private readonly finish: Finish) {}

  /** The new list is a copy; xs is left alone, and the items are whatever the body returns. */
  clone(): MappedToClone<S> {
    return new MappedToClone<S>(this.finish);
  }
}

export class Mapped<S extends Scope> {
  constructor(private readonly finish: Finish) {}

  to(): MappedTo<S> {
    return new MappedTo<S>(this.finish);
  }
}

/** `is()` after `every(x).in(xs)`: what happens to each item. */
export class EveryIs<S extends Scope, T> {
  constructor(private readonly name: string, private readonly items: readonly T[]) {}

  /** xs.map */
  mapped(): Mapped<S> {
    return new Mapped<S>((step) => atoms.mapEach(this.items, each(this.name, step)));
  }

  /** xs.filter */
  kept(): Kept<S, T> {
    return new Kept<S, T>(this.name, this.items);
  }
}

export class EveryIn<S extends Scope, T> {
  constructor(private readonly name: string, private readonly items: readonly T[]) {}

  is(): EveryIs<S, T> {
    return new EveryIs<S, T>(this.name, this.items);
  }
}

export class Every<N extends string> {
  constructor(private readonly name: N) {}

  in<T>(items: readonly T[]): EveryIn<Record<N, T>, T> {
    return new EveryIn<Record<N, T>, T>(this.name, items);
  }
}

/** every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(2) is `xs.map((x) => x * 2)`. */
export function every<N extends string>(placeholder: Placeholder<N>): Every<N> {
  return new Every<N>(placeholder.name);
}

// ---------------------------------------------------------------- checks().if().every(x) / any(x): a yes or no

export class AllIn<T> {
  constructor(private readonly name: string, private readonly items: readonly T[], private readonly test: typeof atoms.hasAnyWhere) {}

  is(): BodyIs<T, boolean> {
    const placeholder = new Placeholder(this.name);
    return new BodyIs<T, boolean>(placeholder, (step) => this.test(this.items, each(this.name, step)));
  }
}

export class All {
  constructor(private readonly name: string, private readonly test: typeof atoms.hasAnyWhere) {}

  in<T>(items: readonly T[]): AllIn<T> {
    return new AllIn<T>(this.name, items, this.test);
  }
}

/** `checks().if()` with no subject: a question about every item, or any. */
export class ChecksIfEach {
  /** xs.every */
  every(placeholder: Placeholder): All {
    return new All(placeholder.name, atoms.isEveryWhere);
  }

  /** xs.some */
  any(placeholder: Placeholder): All {
    return new All(placeholder.name, atoms.hasAnyWhere);
  }
}

// ---------------------------------------------------------------- the().first(x).in(xs): one item

export class TheFirstIn<T> {
  constructor(private readonly name: string, private readonly items: readonly T[]) {}

  that(): BodySubject<T, T | undefined> {
    const placeholder = new Placeholder(this.name);
    return new BodySubject<T, T | undefined>(placeholder, (step) => atoms.findFirst(this.items, each(this.name, step)));
  }
}

export class TheFirst {
  constructor(private readonly name: string) {}

  in<T>(items: readonly T[]): TheFirstIn<T> {
    return new TheFirstIn<T>(this.name, items);
  }
}

export class The {
  /** xs.find */
  first(placeholder: Placeholder): TheFirst {
    return new TheFirst(placeholder.name);
  }
}

/** the().first(x).in(xs).that().is().positive() is `xs.find((x) => x > 0)`. */
export function the(): The {
  return new The();
}

// ---------------------------------------------------------------- folds(): one value

export class FoldsFrom<S extends Scope, A> {
  constructor(private readonly finish: Finish) {}

  by(): ValueBody<S, A> {
    return new ValueBody<S, A>(this.finish);
  }
}

export class FoldsStarting<N extends string, T, M extends string> {
  constructor(private readonly name: N, private readonly items: readonly T[], private readonly into: M) {}

  at<A>(start: A): FoldsFrom<Record<N, T> & Record<M, A>, A> {
    return new FoldsFrom<Record<N, T> & Record<M, A>, A>((step) =>
      atoms.reduceTo(this.items, (sofar: A, value: T) => step(new Map<string, unknown>([[this.into, sofar], [this.name, value]])) as A, start),
    );
  }
}

export class FoldsInto<N extends string, T, M extends string> {
  constructor(private readonly name: N, private readonly items: readonly T[], private readonly into: M) {}

  starting(): FoldsStarting<N, T, M> {
    return new FoldsStarting<N, T, M>(this.name, this.items, this.into);
  }
}

export class FoldsIn<N extends string, T> {
  constructor(private readonly name: N, private readonly items: readonly T[]) {}

  into<M extends string>(placeholder: Placeholder<M>): FoldsInto<N, T, M> {
    return new FoldsInto<N, T, M>(this.name, this.items, placeholder.name);
  }
}

export class FoldsEvery<N extends string> {
  constructor(private readonly name: N) {}

  in<T>(items: readonly T[]): FoldsIn<N, T> {
    return new FoldsIn<N, T>(this.name, items);
  }
}

export class Folds {
  every<N extends string>(placeholder: Placeholder<N>): FoldsEvery<N> {
    return new FoldsEvery<N>(placeholder.name);
  }
}

/** folds().every(x).in(xs).into(total).starting().at(0).by().adding(x).to(total) is `xs.reduce((total, x) => total + x, 0)`. */
export function folds(): Folds {
  return new Folds();
}
