import { Chain, Comparable, Organism } from './atoms';

export class PageText extends Comparable<PageText> {
  constructor(private readonly value: string) {
    super();
  }

  protected compareTo(other: PageText): number {
    return this.value.localeCompare(other.value);
  }
}

export type TextResult = 'static' | 'dynamic';

export class TextCheck extends Chain {
  constructor(private readonly current: PageText) {
    super();
  }

  text(): this {
    return this;
  }

  equalTo(expected: PageText): TextResult {
    return this.resultFor(this.current.equals(expected));
  }

  private resultFor(isEqual: boolean): TextResult {
    if (isEqual) {
      return 'static';
    } else {
      return 'dynamic';
    }
  }
}

export class Page extends Organism {
  checkText(current: PageText): TextCheck {
    return new TextCheck(current);
  }

  interactions(): void {}
}
