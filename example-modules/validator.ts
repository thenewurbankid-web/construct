import { Chain, Organism } from './atoms';

class RangeCheck extends Chain {
  constructor(private readonly value: number) {
    super();
  }

  within(min: number, max: number): 'valid' | 'invalid' {
    if (this.isWithin(min, max)) {
      return 'valid';
    } else {
      return 'invalid';
    }
  }

  // The one place this comparison is allowed to happen, same role as
  // PageText.equals() in page.ts.
  private isWithin(min: number, max: number): boolean {
    return this.value >= min && this.value <= max;
  }
}

export class Validator extends Organism {
  checkRange(value: number): RangeCheck {
    return new RangeCheck(value);
  }
}
