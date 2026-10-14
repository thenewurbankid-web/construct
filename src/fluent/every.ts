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
// Types travel along the chain: `x` only names a slot. `every(x)` records 'x', `.in(xs)` binds
// 'x' to the item type in a type-level scope S that every later word carries, and each body word
// looks its placeholder up in S. A placeholder that is unbound or of the wrong type is a tsc error
// that reads as a sentence: "multiplying needs a number; x is a string". Nested callbacks add to
// S: `every(y).in(x)` binds 'y' to the item type of x.
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

// ---------------------------------------------------------------- the type-level scope

/** The placeholders bound so far, by name, with the type each one stands for. */
type Scope = object;
/** S with N bound to T (a nested callback reusing a name is refused before this). */
type Bind<S, N extends string, T> = { [K in keyof S | N]: K extends N ? T : K extends keyof S ? S[K] : never };
type ItemOf<L> = L extends readonly (infer I)[] ? I : never;
type NameOf<A> = A extends Placeholder<infer K> ? K : never;

/** How a type reads in a message: "x is a string". */
type Describe<T> = [T] extends [never]
  ? 'never'
  : [T] extends [string]
    ? 'a string'
    : [T] extends [number]
      ? 'a number'
      : [T] extends [bigint]
        ? 'a bigint'
        : [T] extends [boolean]
          ? 'a boolean'
          : [T] extends [null | undefined]
            ? 'nothing'
            : [T] extends [readonly unknown[]]
              ? 'a list'
              : [T] extends [(...args: never[]) => unknown]
                ? 'a function'
                : [T] extends [object]
                  ? 'a record'
                  : 'a mix of types';

type Unbound<Word extends string, K extends string> = `${Word}: ${K} is not bound here; bind it with every(${K}).in(list)`;

/**
 * An argument of word Word that must be a Need: a constant of type V, or a placeholder bound to a
 * V. Anything else turns the parameter into the message, so tsc reports it as written.
 */
type Arg<S, A, V, Word extends string, Need extends string> =
  A extends Placeholder<infer K>
    ? K extends keyof S
      ? [S[K]] extends [V]
        ? A
        : `${Word} needs ${Need}; ${K} is ${Describe<S[K]>}`
      : Unbound<Word, K>
    : [A] extends [V]
      ? A
      : `${Word} needs ${Need}`;

/** The list after `in`: a list, or a placeholder bound to one (a nested callback). */
type ListArg<S, A> =
  A extends Placeholder<infer K>
    ? K extends keyof S
      ? [S[K]] extends [readonly unknown[]]
        ? A
        : `in needs a list; ${K} is ${Describe<S[K]>}`
      : Unbound<'in', K>
    : A extends readonly unknown[]
      ? A
      : 'in needs a list';
type ItemIn<S, A> = A extends Placeholder<infer K> ? ItemOf<S[K & keyof S]> : ItemOf<A>;

/** The placeholder a binder names: one not bound yet, since nested callbacks use different names. */
type Fresh<S, A, Word extends string> =
  A extends Placeholder<infer K>
    ? K extends keyof S
      ? `${Word}(${K}): ${K} is already bound; nested callbacks use different names`
      : A
    : `${Word} needs a placeholder: x, y, item or total`;

/** A placeholder the sentence has bound. */
type Bound<S, A, Word extends string> =
  A extends Placeholder<infer K> ? (K extends keyof S ? A : Unbound<Word, K>) : `${Word} needs a placeholder: x, y, item or total`;

/**
 * What the sentence returns, given what its body returns. Each enclosing sentence adds a layer,
 * innermost last: 'list' collects the body's values (map), Fixed<O> returns O whatever the body
 * returns (filter, every, some, find, fold).
 */
interface Fixed<O> {
  // Not `fixed`: every string has a `fixed()` method (String.prototype.fixed), so 'list' would match.
  readonly layer: 'fixed';
  readonly returns: O;
}
type Layer = 'list' | Fixed<unknown>;
type Apply<W extends readonly Layer[], R> = W extends readonly [...infer Rest extends readonly Layer[], infer Last]
  ? Apply<Rest, Last extends Fixed<infer O> ? O : R[]>
  : R;

// ---------------------------------------------------------------- the runtime record

/** A recorded step: computes its value once the placeholders have values. */
type Step = (values: ReadonlyMap<string, unknown>) => unknown;
/** What the enclosing sentence does with a step: runs it (outermost), or makes it its body (nested). */
type Close = (step: Step) => unknown;

/** The outermost sentence runs as soon as its body is complete, with nothing bound yet. */
const run: Close = (step) => step(new Map());

function valueOf(operand: unknown, values: ReadonlyMap<string, unknown>): unknown {
  if (!(operand instanceof Placeholder)) return operand;
  if (!values.has(operand.name)) throw new ReferenceError(`${operand.name} is not bound here: bind it with every(${operand.name}).in(list)`);
  return values.get(operand.name);
}

/** A list atom called on the sentence's list, with the body as its callback (the item bound to name). */
type ListAtom = (items: any, callback: (value: unknown) => any) => unknown;
const sentence =
  (close: Close, list: ListAtom, name: string, items: unknown) =>
  (body: Step): unknown =>
    close((values) => list(valueOf(items, values), (value) => body(new Map(values).set(name, value))));

// ---------------------------------------------------------------- bodies: one atom each

/** `multiplying(a)`: waits for `by(b)`, which ends the body. */
export class Multiplying<S extends Scope, W extends readonly Layer[]> {
  constructor(private readonly a: unknown, private readonly finish: Close) {}

  by<A>(b: Arg<S, A, number, 'by', 'a number'>): Apply<W, number> {
    return this.finish((v) => atoms.times(valueOf(this.a, v) as number, valueOf(b, v) as number)) as Apply<W, number>;
  }
}

/** `adding(a)`: waits for `to(b)`, which ends the body; `adding(x).to(total)` is `total + x`. */
export class Adding<S extends Scope, W extends readonly Layer[]> {
  constructor(private readonly a: unknown, private readonly finish: Close) {}

  to<A>(b: Arg<S, A, number, 'to', 'a number'>): Apply<W, number> {
    return this.finish((v) => atoms.plus(valueOf(b, v) as number, valueOf(this.a, v) as number)) as Apply<W, number>;
  }
}

/** A body that computes a value: `by().multiplying(x).by(2)`, or a nested `by().every(y).in(x)…`. */
export class ValueBody<S extends Scope, W extends readonly Layer[]> {
  constructor(private readonly finish: Close) {}

  multiplying<A>(a: Arg<S, A, number, 'multiplying', 'a number'>): Multiplying<S, W> {
    return new Multiplying<S, W>(a, this.finish);
  }

  adding<A>(a: Arg<S, A, number, 'adding', 'a number'>): Adding<S, W> {
    return new Adding<S, W>(a, this.finish);
  }

  /** A nested list: each value is itself an every() sentence, `every(y).in(x)…`. Not in a fold's body. */
  every<A>(
    this: W extends readonly [...unknown[], 'list'] ? ValueBody<S, W> : "every: a fold's body is one atom on its total, not a nested sentence",
    placeholder: Fresh<S, A, 'every'>,
  ): Every<S, NameOf<A>, W> {
    return new Every<S, NameOf<A>, W>((placeholder as Placeholder).name as NameOf<A>, (this as ValueBody<S, W>).finish);
  }
}

/** A body that asks about its subject K (of type V): `is().positive()`. */
export class BodyIs<K extends string, V, W extends readonly Layer[]> {
  declare private readonly subject?: [K, V];

  constructor(private readonly operand: unknown, private readonly finish: Close) {}

  /** `> 0`, through greaterThan. */
  positive(this: [V] extends [number | bigint] ? BodyIs<K, V, W> : `positive needs a number; ${K} is ${Describe<V>}`): Apply<W, boolean> {
    const self = this as BodyIs<K, V, W>;
    return self.finish((v) => atoms.greaterThan(valueOf(self.operand, v) as number, 0)) as Apply<W, boolean>;
  }
}

/** The subject of a body question, waiting for `is()`. */
export class BodySubject<K extends string, V, W extends readonly Layer[]> {
  constructor(private readonly operand: unknown, private readonly finish: Close) {}

  is(): BodyIs<K, V, W> {
    return new BodyIs<K, V, W>(this.operand, this.finish);
  }
}

// ---------------------------------------------------------------- every(x).in(xs): a list

/** `kept()`: waits for `if(x)` (a question about x), or `if()` (a nested every/any question); xs.filter. */
export class Kept<S extends Scope, T, W extends readonly Layer[]> {
  constructor(private readonly finish: Close) {}

  if(): ChecksIfEach<S, [...W, Fixed<T[]>]>;
  if<A>(subject: Bound<S, A, 'if'>): BodySubject<NameOf<A>, S[NameOf<A> & keyof S], [...W, Fixed<T[]>]>;
  if(...subject: [unknown?]): unknown {
    return subject.length ? new BodySubject(subject[0], this.finish) : new ChecksIfEach(this.finish);
  }
}

export class MappedToClone<S extends Scope, W extends readonly Layer[]> {
  constructor(private readonly finish: Close) {}

  by(): ValueBody<S, [...W, 'list']> {
    return new ValueBody<S, [...W, 'list']>(this.finish);
  }
}

export class MappedTo<S extends Scope, W extends readonly Layer[]> {
  constructor(private readonly finish: Close) {}

  /** The new list is a copy; xs is left alone, and the items are whatever the body returns. */
  clone(): MappedToClone<S, W> {
    return new MappedToClone<S, W>(this.finish);
  }
}

export class Mapped<S extends Scope, W extends readonly Layer[]> {
  constructor(private readonly finish: Close) {}

  to(): MappedTo<S, W> {
    return new MappedTo<S, W>(this.finish);
  }
}

/** `is()` after `every(x).in(xs)`: what happens to each item. */
export class EveryIs<S extends Scope, N extends string, T, W extends readonly Layer[]> {
  constructor(private readonly close: Close, private readonly name: N, private readonly items: unknown) {}

  /** xs.map */
  mapped(): Mapped<S, W> {
    return new Mapped<S, W>(sentence(this.close, atoms.mapEach, this.name, this.items));
  }

  /** xs.filter */
  kept(): Kept<S, T, W> {
    return new Kept<S, T, W>(sentence(this.close, atoms.keepWhere, this.name, this.items));
  }
}

export class EveryIn<S extends Scope, N extends string, T, W extends readonly Layer[]> {
  constructor(private readonly close: Close, private readonly name: N, private readonly items: unknown) {}

  is(): EveryIs<S, N, T, W> {
    return new EveryIs<S, N, T, W>(this.close, this.name, this.items);
  }
}

export class Every<S extends Scope, N extends string, W extends readonly Layer[]> {
  constructor(private readonly name: N, private readonly close: Close) {}

  in<A>(items: ListArg<S, A>): EveryIn<Bind<S, N, ItemIn<S, A>>, N, ItemIn<S, A>, W> {
    return new EveryIn(this.close, this.name, items);
  }
}

/** every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(2) is `xs.map((x) => x * 2)`. */
export function every<N extends string>(placeholder: Placeholder<N>): Every<{}, N, []> {
  return new Every<{}, N, []>(placeholder.name, run);
}

// ---------------------------------------------------------------- checks().if().every(x) / any(x): a yes or no

export class AllIn<K extends string, T, W extends readonly Layer[]> {
  constructor(private readonly finish: Close, private readonly name: K) {}

  is(): BodyIs<K, T, W> {
    return new BodyIs<K, T, W>(new Placeholder(this.name), this.finish);
  }
}

export class All<S extends Scope, N extends string, W extends readonly Layer[]> {
  constructor(private readonly close: Close, private readonly name: N, private readonly test: ListAtom) {}

  in<A>(items: ListArg<S, A>): AllIn<N, ItemIn<S, A>, [...W, Fixed<boolean>]> {
    return new AllIn(sentence(this.close, this.test, this.name, items), this.name);
  }
}

/** `checks().if()` with no subject: a question about every item of a list, or any. */
export class ChecksIfEach<S extends Scope = {}, W extends readonly Layer[] = []> {
  constructor(private readonly close: Close = run) {}

  /** xs.every */
  every<A>(placeholder: Fresh<S, A, 'every'>): All<S, NameOf<A>, W> {
    return new All<S, NameOf<A>, W>(this.close, (placeholder as Placeholder).name as NameOf<A>, atoms.isEveryWhere);
  }

  /** xs.some */
  any<A>(placeholder: Fresh<S, A, 'any'>): All<S, NameOf<A>, W> {
    return new All<S, NameOf<A>, W>(this.close, (placeholder as Placeholder).name as NameOf<A>, atoms.hasAnyWhere);
  }
}

// ---------------------------------------------------------------- the().first(x).in(xs): one item

export class TheFirstIn<N extends string, T> {
  constructor(private readonly finish: Close, private readonly name: N) {}

  that(): BodySubject<N, T, [Fixed<T | undefined>]> {
    return new BodySubject<N, T, [Fixed<T | undefined>]>(new Placeholder(this.name), this.finish);
  }
}

export class TheFirst<N extends string> {
  constructor(private readonly name: N) {}

  in<T>(items: readonly T[]): TheFirstIn<N, T> {
    return new TheFirstIn<N, T>(sentence(run, atoms.findFirst, this.name, items), this.name);
  }
}

export class The {
  /** xs.find */
  first<N extends string>(placeholder: Placeholder<N>): TheFirst<N> {
    return new TheFirst<N>(placeholder.name);
  }
}

/** the().first(x).in(xs).that().is().positive() is `xs.find((x) => x > 0)`. */
export function the(): The {
  return new The();
}

// ---------------------------------------------------------------- folds(): one value

export class FoldsFrom<S extends Scope, A> {
  constructor(private readonly finish: Close) {}

  by(): ValueBody<S, [Fixed<A>]> {
    return new ValueBody<S, [Fixed<A>]>(this.finish);
  }
}

export class FoldsStarting<N extends string, T, M extends string> {
  constructor(private readonly name: N, private readonly items: readonly T[], private readonly into: M) {}

  at<A>(start: A): FoldsFrom<Bind<Bind<{}, N, T>, M, A>, A> {
    return new FoldsFrom((body) =>
      atoms.reduceTo(this.items, (sofar: A, value: T) => body(new Map<string, unknown>([[this.into, sofar], [this.name, value]])) as A, start),
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

  into<A>(placeholder: Fresh<Bind<{}, N, T>, A, 'into'>): FoldsInto<N, T, NameOf<A>> {
    return new FoldsInto<N, T, NameOf<A>>(this.name, this.items, (placeholder as Placeholder).name as NameOf<A>);
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
