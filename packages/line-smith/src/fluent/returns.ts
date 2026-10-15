// R10 (ENGLISH-RULES.md): every sentence ends by naming what it returns, `.andThe().lowercased()`. The last word of
// the sentence computes the value (exactly one atom, R7); `andThe()` offers only the name the rules give that
// sentence, so a wrong name is a `tsc` error, and `.<name>()` hands back the plain value.

/** The named value after `andThe()`: one method, the return name. */
export type Named<T, N extends string> = { readonly [K in N]: () => T };

/** A finished sentence, waiting for `andThe().<name>()`. */
export class Returns<T, N extends string> {
  constructor(
    private readonly value: T,
    private readonly name: N,
  ) {}

  andThe(): Named<T, N> {
    const value = this.value;
    return { [this.name]: () => value } as Named<T, N>;
  }
}

/** Ends a sentence: `value` is what it returns, `name` what R10 calls it. */
export function returns<T, N extends string>(value: T, name: N): Returns<T, N> {
  return new Returns(value, name);
}
