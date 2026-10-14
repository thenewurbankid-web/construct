// R9 (ENGLISH-RULES.md): a callback is an `every()` sentence, not an arrow. The item gets a name
// with a placeholder (`every(x)`), the list follows with `in(xs)`, and the body is one atom on
// `x`. With no build step, the body records its step instead of computing it, and the sentence
// turns the record into the callback when it runs:
//
//   every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(2)   // xs.map((x) => x * 2)
//
// The first word decides what the sentence returns: `every(x).in(xs)` a list,
// `checks().if().every(x)` / `checks().if().any(x)` a yes or no, `the().first(x).in(xs)` one item,
// `folds()` one value, `does()` nothing.
//
// The other callback shapes: the index is bound with `at(i)` (`every(x).at(i).in(xs)`), `does()`
// returns nothing (xs.forEach), and an async body makes the sentence return a Promise and run one
// item at a time, unless it says `all().at().once()` (Promise.all) right after `in(xs)`.
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
/** The index of the item: `every(x).at(i).in(xs)` is `xs.map((x, i) => …)`. */
export const i: Placeholder<'i'> = new Placeholder('i');

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

type Unbound<Word extends string, K extends string> = K extends 'i'
  ? `${Word}: i is not bound here; bind the index with every(x).at(i).in(list)`
  : `${Word}: ${K} is not bound here; bind it with every(${K}).in(list)`;

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
/** 'list' collects the body's values (map); 'nothing' returns nothing (does); Fixed<O> returns O. */
type Layer = 'list' | 'nothing' | Fixed<unknown>;
type Settled<W extends readonly Layer[], R> = W extends readonly [...infer Rest extends readonly Layer[], infer Last]
  ? Settled<Rest, Last extends Fixed<infer O> ? O : Last extends 'nothing' ? void : R[]>
  : R;
/** An async body (one that returns a Promise) makes the whole sentence return a Promise. */
type Apply<W extends readonly Layer[], R> = [R] extends [Promise<infer U>] ? Promise<Settled<W, U>> : Settled<W, R>;
/** Where a body may wait: in a list (map) or for nothing (does), never in a fold or a question. */
type Waits<W extends readonly Layer[]> = W extends readonly [...unknown[], 'list' | 'nothing'] ? true : false;

// ---------------------------------------------------------------- the runtime record

/** A recorded step: computes its value once the placeholders have values. Marked when it is async. */
type Step = ((values: ReadonlyMap<string, unknown>) => unknown) & { readonly async?: boolean };
/** What the enclosing sentence does with a step: runs it (outermost), or makes it its body (nested). */
type Close = (step: Step) => unknown;

/** The outermost sentence runs as soon as its body is complete, with nothing bound yet. */
const run: Close = (step) => step(new Map());
const later = (step: (values: ReadonlyMap<string, unknown>) => unknown): Step => Object.assign(step, { async: true });

function valueOf(operand: unknown, values: ReadonlyMap<string, unknown>): unknown {
  if (!(operand instanceof Placeholder)) return operand;
  if (!values.has(operand.name)) throw new ReferenceError(`${operand.name} is not bound here: bind it with every(${operand.name}).in(list)`);
  return values.get(operand.name);
}

/** Who the sentence binds and over what: the item's name, the index's name (`at(i)`), the list. */
interface Binding {
  readonly close: Close;
  readonly name: string;
  readonly index?: string;
  readonly items: unknown;
  /** `all().at().once()`: an async body runs on every item at once. */
  readonly parallel?: boolean;
}

/**
 * How a list atom runs a body. `sync` is the atom with the body as its callback. An async body is
 * awaited first, one item at a time (stopping where `stop` says the answer is known, as a loop
 * with an early return would) or all at once, and `settle` hands the atom the awaited answers.
 */
interface Shape {
  readonly sync: (items: readonly unknown[], callback: (value: unknown, index: number) => unknown) => unknown;
  readonly settle: (items: readonly unknown[], answers: readonly unknown[]) => unknown;
  readonly stop?: (answer: unknown) => boolean;
}
const answered = (answers: readonly unknown[]) => (_: unknown, index: number) => answers[index];
const MAP: Shape = { sync: atoms.mapEach, settle: (items, answers) => atoms.mapEach(items, answered(answers)) };
const FILTER: Shape = { sync: atoms.keepWhere, settle: (items, answers) => atoms.keepWhere(items, answered(answers)) };
const EVERY: Shape = {
  sync: atoms.isEveryWhere,
  settle: (items, answers) => atoms.isEveryWhere(atoms.part(items, 0, answers.length), answered(answers)),
  stop: (answer) => !answer,
};
const SOME: Shape = {
  sync: atoms.hasAnyWhere,
  settle: (items, answers) => atoms.hasAnyWhere(atoms.part(items, 0, answers.length), answered(answers)),
  stop: (answer) => !!answer,
};
const FIND: Shape = {
  sync: atoms.findFirst,
  settle: (items, answers) => atoms.findFirst(atoms.part(items, 0, answers.length), answered(answers)),
  stop: (answer) => !!answer,
};
const EACH: Shape = { sync: atoms.each, settle: () => undefined };

async function oneAtATime(items: readonly unknown[], callback: (value: unknown, index: number) => unknown, shape: Shape): Promise<unknown> {
  const answers: unknown[] = [];
  for (let index = 0; index < items.length; index++) {
    answers.push(await callback(items[index], index));
    if (shape.stop?.(answers[index])) break;
  }
  return shape.settle(items, answers);
}

/** The finish of a sentence: given its body, runs the list atom (now, or as the body of the sentence around it). */
const sentence =
  (b: Binding, shape: Shape): Close =>
  (body) => {
    const step = (values: ReadonlyMap<string, unknown>): unknown => {
      const items = valueOf(b.items, values) as readonly unknown[];
      const callback = (value: unknown, index: number) => {
        const bound = new Map(values).set(b.name, value);
        return body(b.index === undefined ? bound : bound.set(b.index, index));
      };
      if (!body.async) return shape.sync(items, callback);
      if (b.parallel) return atoms.allOf(atoms.mapEach(items, callback)).then((answers) => shape.settle(items, answers));
      return oneAtATime(items, callback, shape);
    };
    return b.close(body.async ? later(step) : step);
  };

/** `all().at()`: waits for `once()`. */
export class AllAt<Next> {
  constructor(private readonly next: () => Next) {}

  once(): Next {
    return this.next();
  }
}

/** `all().at().once()`: an async body runs on every item at once (Promise.all), not one at a time. */
export class AllAtOnce<Next> {
  constructor(private readonly next: () => Next) {}

  at(): AllAt<Next> {
    return new AllAt<Next>(this.next);
  }
}

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

/**
 * A body that computes a value or has an effect: `by().multiplying(x).by(2)`, `by().waiting(x)`,
 * or a nested `by().every(y).in(x)…`.
 */
export class ValueBody<S extends Scope, W extends readonly Layer[]> {
  constructor(private readonly finish: Close) {}

  multiplying<A>(a: Arg<S, A, number, 'multiplying', 'a number'>): Multiplying<S, W> {
    return new Multiplying<S, W>(a, this.finish);
  }

  adding<A>(a: Arg<S, A, number, 'adding', 'a number'>): Adding<S, W> {
    return new Adding<S, W>(a, this.finish);
  }

  /** Waits ms milliseconds (delay, an impure atom): an async body, so the sentence returns a Promise. */
  waiting<A>(
    this: Waits<W> extends true ? ValueBody<S, W> : "waiting: only a list (every) or an effect (does) waits, not a fold or a question",
    ms: Arg<S, A, number, 'waiting', 'a number'>,
  ): Apply<W, Promise<undefined>> {
    const self = this as ValueBody<S, W>;
    return self.finish(later((v) => atoms.delay(valueOf(ms, v) as number))) as Apply<W, Promise<undefined>>;
  }

  /** A nested list: each value is itself an every() sentence, `every(y).in(x)…`. Not in a fold's body. */
  every<A>(
    this: W extends readonly [...unknown[], 'list' | 'nothing'] ? ValueBody<S, W> : "every: a fold's body is one atom on its total, not a nested sentence",
    placeholder: Fresh<S, A, 'every'>,
  ): Every<S, NameOf<A>, W> {
    return new Every<S, NameOf<A>, W>((this as ValueBody<S, W>).finish, (placeholder as Placeholder).name as NameOf<A>);
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
export class EveryIs<S extends Scope, T, W extends readonly Layer[]> {
  constructor(private readonly binding: Binding) {}

  /** xs.map */
  mapped(): Mapped<S, W> {
    return new Mapped<S, W>(sentence(this.binding, MAP));
  }

  /** xs.filter */
  kept(): Kept<S, T, W> {
    return new Kept<S, T, W>(sentence(this.binding, FILTER));
  }
}

export class EveryIn<S extends Scope, T, W extends readonly Layer[]> {
  constructor(private readonly binding: Binding) {}

  is(): EveryIs<S, T, W> {
    return new EveryIs<S, T, W>(this.binding);
  }

  all(): AllAtOnce<Omit<EveryIn<S, T, W>, 'all'>> {
    return new AllAtOnce(() => new EveryIn<S, T, W>({ ...this.binding, parallel: true }));
  }
}

export class Every<S extends Scope, N extends string, W extends readonly Layer[]> {
  constructor(private readonly close: Close, private readonly name: N, private readonly index?: string) {}

  /** Binds the index too: `every(x).at(i).in(xs)` is `xs.map((x, i) => …)`. */
  at<A>(index: Fresh<Bind<S, N, unknown>, A, 'at'>): Omit<Every<Bind<S, NameOf<A>, number>, N, W>, 'at'> {
    return new Every<Bind<S, NameOf<A>, number>, N, W>(this.close, this.name, (index as Placeholder).name);
  }

  in<A>(items: ListArg<S, A>): EveryIn<Bind<S, N, ItemIn<S, A>>, ItemIn<S, A>, W> {
    return new EveryIn({ close: this.close, name: this.name, index: this.index, items });
  }
}

/** every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(2) is `xs.map((x) => x * 2)`. */
export function every<N extends string>(placeholder: Placeholder<N>): Every<{}, N, []> {
  return new Every<{}, N, []>(run, placeholder.name);
}

// ---------------------------------------------------------------- checks().if().every(x) / any(x): a yes or no

export class AllIn<K extends string, T, W extends readonly Layer[]> {
  constructor(private readonly binding: Binding, private readonly shape: Shape) {}

  is(): BodyIs<K, T, W> {
    return new BodyIs<K, T, W>(new Placeholder(this.binding.name), sentence(this.binding, this.shape));
  }

  all(): AllAtOnce<Omit<AllIn<K, T, W>, 'all'>> {
    return new AllAtOnce(() => new AllIn<K, T, W>({ ...this.binding, parallel: true }, this.shape));
  }
}

export class All<S extends Scope, N extends string, W extends readonly Layer[]> {
  constructor(private readonly close: Close, private readonly name: N, private readonly shape: Shape, private readonly index?: string) {}

  at<A>(index: Fresh<Bind<S, N, unknown>, A, 'at'>): Omit<All<Bind<S, NameOf<A>, number>, N, W>, 'at'> {
    return new All<Bind<S, NameOf<A>, number>, N, W>(this.close, this.name, this.shape, (index as Placeholder).name);
  }

  in<A>(items: ListArg<S, A>): AllIn<N, ItemIn<S, A>, [...W, Fixed<boolean>]> {
    return new AllIn({ close: this.close, name: this.name, index: this.index, items }, this.shape);
  }
}

/** `checks().if()` with no subject: a question about every item of a list, or any. */
export class ChecksIfEach<S extends Scope = {}, W extends readonly Layer[] = []> {
  constructor(private readonly close: Close = run) {}

  /** xs.every */
  every<A>(placeholder: Fresh<S, A, 'every'>): All<S, NameOf<A>, W> {
    return new All<S, NameOf<A>, W>(this.close, (placeholder as Placeholder).name as NameOf<A>, EVERY);
  }

  /** xs.some */
  any<A>(placeholder: Fresh<S, A, 'any'>): All<S, NameOf<A>, W> {
    return new All<S, NameOf<A>, W>(this.close, (placeholder as Placeholder).name as NameOf<A>, SOME);
  }
}

// ---------------------------------------------------------------- the().first(x).in(xs): one item

export class TheFirstIn<N extends string, T> {
  constructor(private readonly binding: Binding) {}

  that(): BodySubject<N, T, [Fixed<T | undefined>]> {
    return new BodySubject<N, T, [Fixed<T | undefined>]>(new Placeholder(this.binding.name), sentence(this.binding, FIND));
  }

  all(): AllAtOnce<Omit<TheFirstIn<N, T>, 'all'>> {
    return new AllAtOnce(() => new TheFirstIn<N, T>({ ...this.binding, parallel: true }));
  }
}

export class TheFirst<N extends string> {
  constructor(private readonly name: N, private readonly index?: string) {}

  at<A>(index: Fresh<Bind<{}, N, unknown>, A, 'at'>): Omit<TheFirst<N>, 'at'> {
    return new TheFirst<N>(this.name, (index as Placeholder).name);
  }

  in<T>(items: readonly T[]): TheFirstIn<N, T> {
    return new TheFirstIn<N, T>({ close: run, name: this.name, index: this.index, items });
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

export class FoldsStarting<S extends Scope, N extends string, T, M extends string> {
  constructor(private readonly binding: Binding, private readonly into: M) {}

  at<A>(start: A): FoldsFrom<Bind<Bind<S, N, T>, M, A>, A> {
    const { name, index, items } = this.binding;
    return new FoldsFrom((body) =>
      atoms.reduceTo(
        items as readonly T[],
        (sofar: A, value: T, at: number) => {
          const values = new Map<string, unknown>([[this.into, sofar], [name, value]]);
          return body(index === undefined ? values : values.set(index, at)) as A;
        },
        start,
      ),
    );
  }
}

export class FoldsInto<S extends Scope, N extends string, T, M extends string> {
  constructor(private readonly binding: Binding, private readonly into: M) {}

  starting(): FoldsStarting<S, N, T, M> {
    return new FoldsStarting<S, N, T, M>(this.binding, this.into);
  }
}

export class FoldsIn<S extends Scope, N extends string, T> {
  constructor(private readonly binding: Binding) {}

  into<A>(placeholder: Fresh<Bind<S, N, T>, A, 'into'>): FoldsInto<S, N, T, NameOf<A>> {
    return new FoldsInto<S, N, T, NameOf<A>>(this.binding, (placeholder as Placeholder).name as NameOf<A>);
  }
}

export class FoldsEvery<S extends Scope, N extends string> {
  constructor(private readonly name: N, private readonly index?: string) {}

  at<A>(index: Fresh<Bind<S, N, unknown>, A, 'at'>): Omit<FoldsEvery<Bind<S, NameOf<A>, number>, N>, 'at'> {
    return new FoldsEvery<Bind<S, NameOf<A>, number>, N>(this.name, (index as Placeholder).name);
  }

  in<T>(items: readonly T[]): FoldsIn<S, N, T> {
    return new FoldsIn<S, N, T>({ close: run, name: this.name, index: this.index, items });
  }
}

export class Folds {
  every<N extends string>(placeholder: Placeholder<N>): FoldsEvery<{}, N> {
    return new FoldsEvery<{}, N>(placeholder.name);
  }
}

/** folds().every(x).in(xs).into(total).starting().at(0).by().adding(x).to(total) is `xs.reduce((total, x) => total + x, 0)`. */
export function folds(): Folds {
  return new Folds();
}

// ---------------------------------------------------------------- does(): nothing

export class DoesIn<S extends Scope> {
  constructor(private readonly binding: Binding) {}

  by(): ValueBody<S, ['nothing']> {
    return new ValueBody<S, ['nothing']>(sentence(this.binding, EACH));
  }

  all(): AllAtOnce<Omit<DoesIn<S>, 'all'>> {
    return new AllAtOnce(() => new DoesIn<S>({ ...this.binding, parallel: true }));
  }
}

export class DoesEvery<S extends Scope, N extends string> {
  constructor(private readonly name: N, private readonly index?: string) {}

  at<A>(index: Fresh<Bind<S, N, unknown>, A, 'at'>): Omit<DoesEvery<Bind<S, NameOf<A>, number>, N>, 'at'> {
    return new DoesEvery<Bind<S, NameOf<A>, number>, N>(this.name, (index as Placeholder).name);
  }

  in<T>(items: readonly T[]): DoesIn<Bind<S, N, T>> {
    return new DoesIn<Bind<S, N, T>>({ close: run, name: this.name, index: this.index, items });
  }
}

export class Does {
  every<N extends string>(placeholder: Placeholder<N>): DoesEvery<{}, N> {
    return new DoesEvery<{}, N>(placeholder.name);
  }
}

/** does().every(x).in(xs).by().waiting(x) is `for (const x of xs) await delay(x)`; it returns nothing. */
export function does(): Does {
  return new Does();
}
