# smith

A small framework for the **atomic pattern**: shared connector "atoms" (`Chain`, `Organism`) and single-source comparison logic (`Comparable`), meant to be the foundation a **new** project or module is built on from day one — not retrofitted onto existing code (see [Why "new projects only"](#why-new-projects-only) below).

```ts
import { Chain, Organism, Comparable } from 'smith';
```

## The idea

Two rules, applied consistently:

1. **No ternaries** — use if/else.
2. **No raw comparison operators** (`===`, `>`, `&&`, ...) in business logic — delegate to a named method. Implement it once, everything else calls it.

Once comparisons are reduced to a handful of tiny, single-purpose methods (`and()`, `is()`, `if()`, `will()`...), those methods can be shared across unrelated features via a common base class, instead of every feature reinventing the same connector words. You get a fluent, English-readable call chain as a side effect, not the goal itself.

## What's in the package

### `Comparable<T>`

Implement `compareTo()` once, get `equals` / `greaterThan` / `lessThan` / `greaterThanOrEqual` / `lessThanOrEqual` for free — the same idea as Java's `Comparable` interface, ported to TS since JS doesn't have it built in.

```ts
class Money extends Comparable<Money> {
  constructor(private readonly cents: number) { super(); }
  protected compareTo(other: Money): number {
    return this.cents - other.cents;
  }
}

new Money(500).greaterThan(new Money(300)); // true
```

### `Chain`

Connector words (`and`, `but`, `also`, `if`, `then`, `is`) that just `return this` — pure readability glue, borrowed from the same idea as Chai/Should.js's `.to.be.have` matchers. Extend it once; every fluent builder in your app shares the same words instead of each redefining `and()`.

### `Organism`

`will()` — the one connector that starts a chain at the entry point (a page, a form, whatever your top-level object is).

## Example

```ts
class PageText extends Comparable<PageText> {
  constructor(private readonly value: string) { super(); }
  protected compareTo(other: PageText): number {
    return this.value.localeCompare(other.value);
  }
}

type TextResult = 'static' | 'dynamic';

class TextCheck extends Chain {
  constructor(private readonly current: PageText) { super(); }
  equalTo(expected: PageText): TextResult {
    if (this.current.equals(expected)) {
      return 'static';
    } else {
      return 'dynamic';
    }
  }
}

class Page extends Organism {
  checkText(current: PageText): TextCheck {
    return new TextCheck(current);
  }
}

const page = new Page();
page.will().checkText(new PageText('hello')).and().if().is().equalTo(new PageText('hello'));
// -> 'static'
```

Add a second, completely unrelated feature (say, a form field check) and it inherits the exact same `and`/`if`/`is`/`will` for free — nothing about those words gets rewritten per feature.

**Live example page:** the full walkthrough — this same example, a second organism (`Form`) reusing the same atoms, a speed calculation, and a plain assertion, all rendered as readable English with the underlying code alongside — lives in the companion `atomic-codemod` project at [`../atomic-codemod/public/showcase.html`](../atomic-codemod/public/showcase.html). Run that project's server (`node server.js` in `atomic-codemod/`) and open `http://localhost:5175/showcase.html` to see it live and try your own function against the refactoring pipeline.

## Why "new projects only"

`Comparable`'s methods only work because the value type promises to implement `compareTo()`. Retrofitting this onto an *existing* codebase means some raw `a === b` you convert to `a.equals(b)` might be comparing a plain `number` or `string` that was never wrapped in a `Comparable` type — that throws at runtime (`a.equals is not a function`), it doesn't silently do the right thing. For a brand-new project or module, `Comparable` is the foundation from the start, so that mismatch never has a chance to happen. The one thing to watch even in a new module: calls into *existing* code/APIs return plain values, not `Comparable`-wrapped ones — that boundary still needs a human's judgment, not the framework's.

## Install

```sh
npm install smith
```

(Currently installable via local path only — not yet published to the public npm registry.)

## Build from source

```sh
npm install
npm run build
```
