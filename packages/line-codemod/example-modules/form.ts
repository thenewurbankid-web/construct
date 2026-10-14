import { Chain, Comparable, Organism } from './atoms';

export class FieldValue extends Comparable<FieldValue> {
  constructor(private readonly value: number) {
    super();
  }

  protected compareTo(other: FieldValue): number {
    return this.value - other.value;
  }
}

export type FieldResult = 'valid' | 'invalid';

export class FieldCheck extends Chain {
  constructor(private readonly current: FieldValue) {
    super();
  }

  value(): this {
    return this;
  }

  greaterThan(threshold: FieldValue): FieldResult {
    return this.resultFor(this.current.greaterThan(threshold));
  }

  private resultFor(passes: boolean): FieldResult {
    if (passes) {
      return 'valid';
    } else {
      return 'invalid';
    }
  }
}

export class Form extends Organism {
  checkField(current: FieldValue): FieldCheck {
    return new FieldCheck(current);
  }
}
