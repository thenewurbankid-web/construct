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
// free -- this is what equalTo()/greaterThan() in page.ts/form.ts used to
// each hand-roll separately (exactly the duplicate shape "Find similar
// shapes" flagged between TextCheck and FieldCheck).
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
