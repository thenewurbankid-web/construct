# qwen2.5-coder:1.5b on untranslated parts: 13 of 13 not accepted

Written by `node bench/atoms/model-fill.js --model qwen2.5-coder:1.5b` (temperature 0).

| function | gaps | outcome | why |
|---|---|---|---|
| validate | mutation, mutation | declined | handed the code back unchanged |
| defineService | drop-in | declined | handed the code back unchanged |
| send | ambiguous | declined | said no atom fits |
| csvCell | mutation | declined | said no atom fits |
| toCsv | mutation | declined | handed the code back unchanged |
| daysIn | ambiguous | declined | handed the code back unchanged |
| applyView | mutation | rejected | fewer gaps: 1 left of 1 |
| send | mutation | declined | handed the code back unchanged |
| toXStateConfig | ambiguous | declined | said no atom fits |
| covers | ambiguous | declined | said no atom fits |
| onKeyDown | control flow, control flow, ambiguous | rejected | fewer gaps: 4 left of 3 |
| add | ambiguous | declined | said no atom fits |
| pageItems | control flow, ambiguous, mutation, mutation | rejected | fewer gaps: 6 left of 4 |

---

## validate (packages/core/typed-contracts/examples/service-schema.ts)

declined: handed the code back unchanged. Gaps: mutation, mutation.

### Prompt

````text
Rewrite this TypeScript function using the atom functions listed below.
Atoms are plain functions; they never change their arguments. Keep the same name and parameters
and keep exactly what the function does. Do not define helpers. Answer with only the function in
one ```ts block. If a part cannot be written with these atoms without changing what the
function does, leave that part as it is; if no part can, answer only: NO ATOM

```ts
validate(value) {
  const v = value as Partial<User> | null;
  const issues: StandardSchemaIssue[] = [];
  when(differs(typeOf(get(v, "id")), 'string'), () => issues.push({
    message: 'expected string',
    path: ['id']
  }));
  when(differs(typeOf(get(v, "name")), 'string'), () => issues.push({
    message: 'expected string',
    path: [{
      key: 'name'
    }]
  }));
  return when(lengthOf(issues), () => ({
    issues
  }), () => ({
    value: v as User
  }));
}
```

Parts still to rewrite:
- `issues.push({ message: 'expected string', path: ['id'] })` (CallExpression .push(): mutates)
- `issues.push({ message: 'expected string', path: [{ key: 'name' }] })` (CallExpression .push(): mutates)

Atoms you may use (name(params) - what it reads as - the JS it replaces):
- pushedList(list, items?) - list after push items, as a copy - list.push(...items)
- differs(a, b) - a differs from b - a !== b
- when(condition, then, otherwise?) - when c, a, otherwise b - c ? a : b | if (c) { a } else { b }
- typeOf(value) - the type of value - typeof value
- get(obj, key) - the key of obj - obj?.[key] | obj?.key
- lengthOf(value) - the length of textOrList - value.length
````

### Answer

```ts
validate(value) {
  const v = value as Partial<User> | null;
  const issues: StandardSchemaIssue[] = [];
  when(differs(typeOf(get(v, "id")), 'string'), () => issues.push({
    message: 'expected string',
    path: ['id']
  }));
  when(differs(typeOf(get(v, "name")), 'string'), () => issues.push({
    message: 'expected string',
    path: [{
      key: 'name'
    }]
  }));
  return when(lengthOf(issues), () => ({
    issues
  }), () => ({
    value: v as User
  }));
}
```

---

## defineService (packages/core/typed-contracts/factories.ts)

declined: handed the code back unchanged. Gaps: drop-in.

### Prompt

````text
Rewrite this TypeScript function using the atom functions listed below.
Atoms are plain functions; they never change their arguments. Keep the same name and parameters
and keep exactly what the function does. Do not define helpers. Answer with only the function in
one ```ts block. If a part cannot be written with these atoms without changing what the
function does, leave that part as it is; if no part can, answer only: NO ATOM

```ts
function defineService<Props extends Forbid<Props, DomainUnitAny>, Return, Schema extends ResponseSchema>(name: string, fn: (props: Props) => Return, options?: ServiceOptions<Schema>): ServiceUnit<(props: Props) => unknown> {
  return when(not(get(options, "schema")), () => tagUnit(name, fn, 'service'), () => {
    const {
      schema
    } = options;
    const checked = (props: Props) => checkServiceReturn(schema, fn(props));
    const unit = tagUnit<typeof checked, ServiceUnit<typeof checked>>(name, checked, 'service');
    return Object.assign(unit, {
      schema
    });
  });
}
```

Parts still to rewrite:
- `Object.assign(unit, { schema })` (CallExpression Object.assign())

Atoms you may use (name(params) - what it reads as - the JS it replaces):
- merged(a, b, c) - a merged with b - { ...a, ...b } | Object.assign({}, a, b)
- not(a) - not a - !a
- when(condition, then, otherwise?) - when c, a, otherwise b - c ? a : b | if (c) { a } else { b }
- get(obj, key) - the key of obj - obj?.[key] | obj?.key
````

### Answer

```ts
function defineService<Props extends Forbid<Props, DomainUnitAny>, Return, Schema extends ResponseSchema>(name: string, fn: (props: Props) => Return, options?: ServiceOptions<Schema>): ServiceUnit<(props: Props) => unknown> {
  return when(not(get(options, "schema")), () => tagUnit(name, fn, 'service'), () => {
    const {
      schema
    } = options;
    const checked = (props: Props) => checkServiceReturn(schema, fn(props));
    const unit = tagUnit<typeof checked, ServiceUnit<typeof checked>>(name, checked, 'service');
    return Object.assign(unit, { schema });
  });
}
```

---

## send (packages/line-atoms/atoms/async-status/index.ts)

declined: said no atom fits. Gaps: ambiguous.

### Prompt

````text
Rewrite this TypeScript function using the atom functions listed below.
Atoms are plain functions; they never change their arguments. Keep the same name and parameters
and keep exactly what the function does. Do not define helpers. Answer with only the function in
one ```ts block. If a part cannot be written with these atoms without changing what the
function does, leave that part as it is; if no part can, answer only: NO ATOM

```ts
send(state, event) {
  return match(event.type, {
    FETCH: () => when(equals(state.status, 'success'), () => ({
      ...state,
      fetching: true,
      request: state.request + 1
    }), () => ({
      ...state,
      status: 'pending',
      error: null,
      fetching: true,
      request: plus(state.request, 1)
    })),
    RESOLVE: () => when(not(isCurrent(state, event.request)), () => state, () => ({
      ...state,
      status: 'success',
      data: event.data,
      error: null,
      fetching: false,
      updatedAt: orElse(event.at, () => null)
    })),
    REJECT: () => when(not(isCurrent(state, event.request)), () => state, () => ({
      ...state,
      status: 'error',
      error: event.error,
      fetching: false
    })),
    RESET: () => machine.init()
  }, () => state);
}
```

Parts still to rewrite:
- `state.request + 1` (BinaryExpression +: ambiguous type)

Atoms you may use (name(params) - what it reads as - the JS it replaces):
- plus(a, b) - a plus b - a + b
- join(a, b) - a joined with b - a + b | a.concat(b)
- randomBetween(min, max, random?) - a random number from min up to max - min + Math.random() * (max - min)
- equals(a, b) - a equals b - a === b
- not(a) - not a - !a
- orElse(a, b) - a, or else b - a ?? b
- when(condition, then, otherwise?) - when c, a, otherwise b - c ? a : b | if (c) { a } else { b }
- match(value, cases, fallback?) - match value against cases, otherwise fallback - switch (value) { case k: … default: … }
````

### Answer

```ts
NO ATOM
```

---

## csvCell (packages/line-atoms/atoms/csv-export/index.ts)

declined: said no atom fits. Gaps: mutation.

### Prompt

````text
Rewrite this TypeScript function using the atom functions listed below.
Atoms are plain functions; they never change their arguments. Keep the same name and parameters
and keep exactly what the function does. Do not define helpers. Answer with only the function in
one ```ts block. If a part cannot be written with these atoms without changing what the
function does, leave that part as it is; if no part can, answer only: NO ATOM

```ts
function csvCell(value: unknown, options: CsvOptions = {}): string {
  const separator = orElse(options.separator, () => ',');
  let text = '';
  choose([[isA(value, Date), () => text = dateAsIsoText(value)], [() => and(differs(value, null), () => differs(value, undefined)), () => text = textFrom(value)]]);
  when(and(orElse(options.safe, () => true), () => FORMULA_START.test(text)), () => text = `'${text}`);
  return when(or(or(or(hasText(text, separator), () => hasText(text, '"')), () => hasText(text, '\n')), () => hasText(text, '\r')), () => `"${replaceText(text, /"/g, '""')}"`, () => text);
}
```

Parts still to rewrite:
- `FORMULA_START.test(text)` (CallExpression .test(): mutates)

Atoms you may use (name(params) - what it reads as - the JS it replaces):
- doesPatternMatch(pattern, string) - whether pattern matches string - pattern.test(string)
- differs(a, b) - a differs from b - a !== b
- and(a, b) - a and b - a && b
- or(a, b) - a or b - a || b
- orElse(a, b) - a, or else b - a ?? b
- when(condition, then, otherwise?) - when c, a, otherwise b - c ? a : b | if (c) { a } else { b }
- choose(cases, fallback?) - choose a when c1, b when c2, otherwise fallback - if (c1) { a } else if (c2) { b } else { fallback } | c1 ? a : c2 ? b : fallback
- isA(value, type) - whether value is a Type - value instanceof type
- hasText(text, part, position?) - whether text has part in it - text.includes(part, position)
- replaceText(text, searchValue, replaceValue) - the replace searchValue, replaceValue of text - text.replace(searchValue, replaceValue)
- textFrom(value?) - value as a String - String(value)
- dateAsIsoText(date) - the to isostring of date - date.toISOString()
````

### Answer

```ts
NO ATOM
```

---

## toCsv (packages/line-atoms/atoms/csv-export/index.ts)

declined: handed the code back unchanged. Gaps: mutation.

### Prompt

````text
Rewrite this TypeScript function using the atom functions listed below.
Atoms are plain functions; they never change their arguments. Keep the same name and parameters
and keep exactly what the function does. Do not define helpers. Answer with only the function in
one ```ts block. If a part cannot be written with these atoms without changing what the
function does, leave that part as it is; if no part can, answer only: NO ATOM

```ts
function toCsv<T>(rows: T[], columns: Column<T>[], options: CsvOptions = {}): string {
  const separator = orElse(options.separator, () => ',');
  const eol = orElse(options.eol, () => '\r\n');
  const lines = [joinWith(mapEach(columns, c => csvCell(c.header, options)), separator)];
  each(rows, row => {
    lines.push(joinWith(mapEach(columns, c => csvCell(cellOf(row, c), options)), separator));
  });
  return join(joinWith(lines, eol), eol);
}
```

Parts still to rewrite:
- `lines.push(columns.map((c) => csvCell(cellOf(row, c), options)).join(separator))` (CallExpression .push(): mutates)

Atoms you may use (name(params) - what it reads as - the JS it replaces):
- pushedList(list, items?) - list after push items, as a copy - list.push(...items)
- join(a, b) - a joined with b - a + b | a.concat(b)
- orElse(a, b) - a, or else b - a ?? b
- each(list, fn) - for each item of list, effect - list.forEach(fn) | for (const item of list) { fn(item) }
- joinWith(list, separator?) - list joined with separator - list.join(separator)
- mapEach(list, fn) - each item of list mapped to result - list.map(fn)
````

### Answer

```ts
function toCsv<T>(rows: T[], columns: Column<T>[], options: CsvOptions = {}): string {
  const separator = orElse(options.separator, () => ',');
  const eol = orElse(options.eol, () => '\r\n');
  const lines = [joinWith(mapEach(columns, c => csvCell(c.header, options)), separator)];
  each(rows, row => {
    lines.push(joinWith(mapEach(columns, c => csvCell(cellOf(row, c), options)), separator));
  });
  return join(joinWith(lines, eol), eol);
}
```

---

## daysIn (packages/line-atoms/atoms/date-range/index.ts)

declined: handed the code back unchanged. Gaps: ambiguous.

### Prompt

````text
Rewrite this TypeScript function using the atom functions listed below.
Atoms are plain functions; they never change their arguments. Keep the same name and parameters
and keep exactly what the function does. Do not define helpers. Answer with only the function in
one ```ts block. If a part cannot be written with these atoms without changing what the
function does, leave that part as it is; if no part can, answer only: NO ATOM

```ts
function daysIn(r: RangeState): number {
  return when(differs(r.status, 'complete'), () => 0, () => round(dividedBy(minus(timeOfDate(r.end as Date) + 1, timeOfDate(r.start as Date)), DAY)));
}
```

Parts still to rewrite:
- `(r.end as Date).getTime() + 1` (BinaryExpression +: ambiguous type)

Atoms you may use (name(params) - what it reads as - the JS it replaces):
- plus(a, b) - a plus b - a + b
- join(a, b) - a joined with b - a + b | a.concat(b)
- randomBetween(min, max, random?) - a random number from min up to max - min + Math.random() * (max - min)
- differs(a, b) - a differs from b - a !== b
- minus(a, b) - a minus b - a - b
- dividedBy(a, b) - a divided by b - a / b
- when(condition, then, otherwise?) - when c, a, otherwise b - c ? a : b | if (c) { a } else { b }
- round(x) - the round of x - Math.round(x)
- timeOfDate(date) - the time of date - date.getTime()
````

### Answer

```ts
function daysIn(r: RangeState): number {
  return when(
    differs(r.status, 'complete'),
    () => 0,
    () => round(dividedBy(minus(timeOfDate(r.end as Date) + 1, timeOfDate(r.start as Date)), DAY))
  );
}
```

---

## applyView (packages/line-atoms/atoms/filter-sort/index.ts)

rejected: fewer gaps: 1 left of 1. Gaps: mutation.

### Prompt

````text
Rewrite this TypeScript function using the atom functions listed below.
Atoms are plain functions; they never change their arguments. Keep the same name and parameters
and keep exactly what the function does. Do not define helpers. Answer with only the function in
one ```ts block. If a part cannot be written with these atoms without changing what the
function does, leave that part as it is; if no part can, answer only: NO ATOM

```ts
function applyView<T extends Record<string, unknown>>(rows: T[], v: View, searchFields: (keyof T)[] = []): T[] {
  const active = keepWhere(entriesOf(v.filters), ([, value]) => not(isNoFilter(value)));
  const kept = keepWhere(rows, row => and(isEveryWhere(active, ([id, value]) => equals(row[id], value)), () => matchesSearch(row, v.search, searchFields)));
  return when(equals(v.sort, null), () => kept, () => {
    const {
      id,
      desc
    } = v.sort;
    const indexed = mapEach(kept, (row, i) => ({
      row,
      i
    }));
    indexed.sort((x, y) => {
      const c = compareValues(x.row[id], y.row[id]);
      return when(equals(c, 0), () => minus(x.i, y.i), () => when(and(and(desc, () => not(isEmptyValue(x.row[id]))), () => not(isEmptyValue(y.row[id]))), () => negate(c), () => c));
    });
    return mapEach(indexed, x => x.row);
  });
}
```

Parts still to rewrite:
- `indexed.sort((x, y) => { const c = compareValues(x.row[id], y.row[id]); if (c === 0) { return x.i - ` (CallExpression .sort(): mutates)

Atoms you may use (name(params) - what it reads as - the JS it replaces):
- sortedBy(list, order?) - list sorted by order - list.toSorted(order) | [...list].sort(order)
- equals(a, b) - a equals b - a === b
- minus(a, b) - a minus b - a - b
- negate(a) - negative a - -a
- not(a) - not a - !a
- and(a, b) - a and b - a && b
- when(condition, then, otherwise?) - when c, a, otherwise b - c ? a : b | if (c) { a } else { b }
- mapEach(list, fn) - each item of list mapped to result - list.map(fn)
- keepWhere(list, test) - the items of list where test holds - list.filter(test)
- isEveryWhere(list, test) - whether every item of list passes test - list.every(test)
- entriesOf(obj) - the key/value pairs of obj - Object.entries(obj)
````

### Answer

```ts
function applyView<T extends Record<string, unknown>>(rows: T[], v: View, searchFields: (keyof T)[] = []): T[] {
  const active = keepWhere(entriesOf(v.filters), ([, value]) => not(isNoFilter(value)));
  const kept = keepWhere(rows, row => and(isEveryWhere(active, ([id, value]) => equals(row[id], value)), () => matchesSearch(row, v.search, searchFields)));
  return when(equals(v.sort, null), () => kept, () => {
    const {
      id,
      desc
    } = v.sort;
    const indexed = mapEach(kept, (row, i) => ({
      row,
      i
    }));
    indexed.sort((x, y) => {
      const c = compareValues(x.row[id], y.row[id]);
      return when(equals(c, 0), () => x.i - y.i, () => when(and(and(desc, () => not(isEmptyValue(x.row[id]))), () => not(isEmptyValue(y.row[id]))), () => negate(c), () => c));
    });
    return mapEach(indexed, x => x.row);
  });
}
```

---

## send (packages/line-atoms/atoms/filter-sort/index.ts)

declined: handed the code back unchanged. Gaps: mutation.

### Prompt

````text
Rewrite this TypeScript function using the atom functions listed below.
Atoms are plain functions; they never change their arguments. Keep the same name and parameters
and keep exactly what the function does. Do not define helpers. Answer with only the function in
one ```ts block. If a part cannot be written with these atoms without changing what the
function does, leave that part as it is; if no part can, answer only: NO ATOM

```ts
send(state, event) {
  return match(event.type, {
    SET_FILTER: () => when(equals(state.filters[event.id], event.value), () => state, () => view(withKey(state.filters, event.id, event.value), state.search, state.sort)),
    CLEAR_FILTER: () => when(not(hasProperty(state.filters, event.id)), () => state, () => {
      const filters = {
        ...state.filters
      };
      delete filters[event.id];
      return view(filters, state.search, state.sort);
    }),
    SET_SEARCH: () => when(equals(event.text, state.search), () => state, () => view(state.filters, event.text, state.sort)),
    SORT_BY: () => view(state.filters, state.search, {
      id: event.id,
      desc: orElse(event.desc, () => false)
    }),
    TOGGLE_SORT: () => when(or(equals(state.sort, null), () => differs(state.sort.id, event.id)), () => view(state.filters, state.search, {
      id: event.id,
      desc: false
    }), () => when(not(state.sort.desc), () => view(state.filters, state.search, {
      id: event.id,
      desc: true
    }), () => view(state.filters, state.search, null))),
    RESET: () => machine.init()
  }, () => state);
}
```

Parts still to rewrite:
- `delete filters[event.id]` (UnaryExpression delete: mutates)

Atoms you may use (name(params) - what it reads as - the JS it replaces):
- keysOf(obj) - the keys of obj - Object.keys(obj)
- valuesOf(obj) - the values of obj - Object.values(obj)
- entriesOf(obj) - the key/value pairs of obj - Object.entries(obj)
- fromEntries(pairs) - an object from pairs - Object.fromEntries(pairs)
- merged(a, b, c) - a merged with b - { ...a, ...b } | Object.assign({}, a, b)
- withKey(obj, key, value) - obj with key set to value - ({ ...obj, [key]: value })
- withoutKey(obj, key) - obj without key - (({ [key]: _omit, ...rest }) => rest)(obj)
- pick(obj, keys) - only keys of obj - Object.fromEntries(keys.filter((k) => Object.hasOwn(obj, k)).map((k) => [k, obj[k]]))
- omit(obj, keys) - obj without keys - Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)))
- equals(a, b) - a equals b - a === b
- differs(a, b) - a differs from b - a !== b
- not(a) - not a - !a
- or(a, b) - a or b - a || b
- orElse(a, b) - a, or else b - a ?? b
- when(condition, then, otherwise?) - when c, a, otherwise b - c ? a : b | if (c) { a } else { b }
- match(value, cases, fallback?) - match value against cases, otherwise fallback - switch (value) { case k: … default: … }
- hasProperty(obj, key) - whether obj has the property key - key in obj
````

### Answer

```ts
send(state, event) {
  return match(event.type, {
    SET_FILTER: () => when(equals(state.filters[event.id], event.value), () => state, () => view(withKey(state.filters, event.id, event.value), state.search, state.sort)),
    CLEAR_FILTER: () => when(not(hasProperty(state.filters, event.id)), () => state, () => {
      const filters = {
        ...state.filters
      };
      delete filters[event.id];
      return view(filters, state.search, state.sort);
    }),
    SET_SEARCH: () => when(equals(event.text, state.search), () => state, () => view(state.filters, event.text, state.sort)),
    SORT_BY: () => view(state.filters, state.search, {
      id: event.id,
      desc: orElse(event.desc, () => false)
    }),
    TOGGLE_SORT: () => when(or(equals(state.sort, null), () => differs(state.sort.id, event.id)), () => view(state.filters, state.search, {
      id: event.id,
      desc: false
    }), () => when(not(state.sort.desc), () => view(state.filters, state.search, {
      id: event.id,
      desc: true
    }), () => view(state.filters, state.search, null))),
    RESET: () => machine.init()
  }, () => state);
}
```

---

## toXStateConfig (packages/line-atoms/atoms/multi-step-flow/index.ts)

declined: said no atom fits. Gaps: ambiguous.

### Prompt

````text
Rewrite this TypeScript function using the atom functions listed below.
Atoms are plain functions; they never change their arguments. Keep the same name and parameters
and keep exactly what the function does. Do not define helpers. Answer with only the function in
one ```ts block. If a part cannot be written with these atoms without changing what the
function does, leave that part as it is; if no part can, answer only: NO ATOM

```ts
function toXStateConfig<D>(id: string, steps: Step<D>[], data: D, assign: (fn: (args: {
  context: {
    data: D;
  };
  event: any;
}) => {
  data: D;
}) => unknown): Record<string, unknown> {
  const merged = ({
    context,
    event
  }: {
    context: {
      data: D;
    };
    event: any;
  }) => ({
    data: mergedAtom(context.data, orElse(event.data, () => ({})))
  });
  const states: Record<string, unknown> = {};
  steps.forEach((step, i) => {
    let target = 'done';
    when(lessThan(i, minus(lengthOf(steps), 1)), () => target = steps[plus(i, 1)].id);
    const on: Record<string, unknown> = {
      NEXT: [{
        target,
        guard: (args: {
          context: {
            data: D;
          };
          event: any;
        }) => canLeave(step, merged(args).data),
        actions: assign(merged)
      }, {
        actions: assign(merged)
      }]
    };
    when(greaterThan(i, 0), () => on.BACK = {
      target: steps[minus(i, 1)].id
    });
    states[step.id] = {
      on
    };
  });
  states.done = {
    type: 'final'
  };
  return {
    id,
    initial: firstOf(steps).id,
    context: {
      data
    },
    states
  };
}
```

Parts still to rewrite:
- `steps.forEach((step, i) => { let target = 'done'; if (i < steps.length - 1) { target = steps[i + 1].` (CallExpression .forEach(): ambiguous type)

Atoms you may use (name(params) - what it reads as - the JS it replaces):
- each(list, fn) - for each item of list, effect - list.forEach(fn) | for (const item of list) { fn(item) }
- eachMap(map, callbackfn, thisArg?) - the for each callbackfn, thisArg of map - map.forEach(callbackfn, thisArg)
- eachSet(set, callbackfn, thisArg?) - the for each callbackfn, thisArg of set - set.forEach(callbackfn, thisArg)
- lessThan(a, b) - a is less than b - a < b
- greaterThan(a, b) - a is greater than b - a > b
- plus(a, b) - a plus b - a + b
- minus(a, b) - a minus b - a - b
- orElse(a, b) - a, or else b - a ?? b
- when(condition, then, otherwise?) - when c, a, otherwise b - c ? a : b | if (c) { a } else { b }
- lengthOf(value) - the length of textOrList - value.length
- firstOf(list) - the first item of list - list[0] | list.at(0)
- merged(a, b, c) - a merged with b - { ...a, ...b } | Object.assign({}, a, b)
````

### Answer

```ts
NO ATOM
```

---

## covers (packages/line-atoms/atoms/permission-check/index.ts)

declined: said no atom fits. Gaps: ambiguous.

### Prompt

````text
Rewrite this TypeScript function using the atom functions listed below.
Atoms are plain functions; they never change their arguments. Keep the same name and parameters
and keep exactly what the function does. Do not define helpers. Answer with only the function in
one ```ts block. If a part cannot be written with these atoms without changing what the
function does, leave that part as it is; if no part can, answer only: NO ATOM

```ts
function covers(held: string, required: string): boolean {
  return when(or(equals(held, '*'), () => equals(held, required)), () => true, () => when(doesEndWith(held, ':*'), () => doesStartWith(required, held.slice(0, -1)), () => false));
}
```

Parts still to rewrite:
- `held.slice(0, -1)` (CallExpression .slice(): ambiguous type)

Atoms you may use (name(params) - what it reads as - the JS it replaces):
- sliceText(text, from?, to?) - the part of text from from to to - text.slice(from, to)
- part(list, from?, to?) - the part of list from from to to - list.slice(from, to)
- equals(a, b) - a equals b - a === b
- or(a, b) - a or b - a || b
- when(condition, then, otherwise?) - when c, a, otherwise b - c ? a : b | if (c) { a } else { b }
- doesStartWith(text, part, position?) - whether text starts with part - text.startsWith(part, position)
- doesEndWith(text, part, endPosition?) - whether text ends with part - text.endsWith(part, endPosition)
````

### Answer

```ts
NO ATOM
```

---

## onKeyDown (packages/line-primitives/library/components/Combobox.tsx)

rejected: fewer gaps: 4 left of 3. Gaps: control flow, control flow, ambiguous.

### Prompt

````text
Rewrite this TypeScript function using the atom functions listed below.
Atoms are plain functions; they never change their arguments. Keep the same name and parameters
and keep exactly what the function does. Do not define helpers. Answer with only the function in
one ```ts block. If a part cannot be written with these atoms without changing what the
function does, leave that part as it is; if no part can, answer only: NO ATOM

```ts
function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
  if (equals(e.key, 'ArrowDown')) {
    e.preventDefault();
    if (not(open)) {
      setOpen(true);
      setActive(0);
      return;
    }
    setActive(i => smallestOf([i + 1, minus(lengthOf(matches), 1)]));
  } else chooseAtom([[equals(e.key, 'ArrowUp'), () => {
    e.preventDefault();
    setActive(i => largestOf([minus(i, 1), 0]));
  }], [() => and(and(equals(e.key, 'Enter'), () => open), () => matches[active]), () => {
    e.preventDefault();
    choose(matches[active]);
  }], [() => and(equals(e.key, 'Escape'), () => open), () => {
    e.preventDefault();
    setOpen(false);
  }]]);
}
```

Parts still to rewrite:
- `if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) { setOpen(true); setActive(0); return; }` (IfStatement: a branch returns on some paths only)
- `if (!open) { setOpen(true); setActive(0); return; }` (IfStatement: return inside an if that is not directly in a function body)
- `i + 1` (BinaryExpression +: ambiguous type)

Atoms you may use (name(params) - what it reads as - the JS it replaces):
- plus(a, b) - a plus b - a + b
- join(a, b) - a joined with b - a + b | a.concat(b)
- randomBetween(min, max, random?) - a random number from min up to max - min + Math.random() * (max - min)
- when(condition, then, otherwise?) - when c, a, otherwise b - c ? a : b | if (c) { a } else { b }
- choose(cases, fallback?) - choose a when c1, b when c2, otherwise fallback - if (c1) { a } else if (c2) { b } else { fallback } | c1 ? a : c2 ? b : fallback
- match(value, cases, fallback?) - match value against cases, otherwise fallback - switch (value) { case k: … default: … }
- equals(a, b) - a equals b - a === b
- minus(a, b) - a minus b - a - b
- not(a) - not a - !a
- and(a, b) - a and b - a && b
- lengthOf(value) - the length of textOrList - value.length
- largestOf(numbers) - the largest of numbers - Math.max(...numbers)
- smallestOf(numbers) - the smallest of numbers - Math.min(...numbers)
````

### Answer

```ts
function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
  if (equals(e.key, 'ArrowDown')) {
    e.preventDefault();
    if (!open) {
      setOpen(true);
      setActive(0);
      return;
    }
    setActive(i => smallestOf([i + 1, minus(lengthOf(matches), 1)]));
  } else if (!open) {
    setOpen(true);
    setActive(0);
    return;
  } else if (equals(e.key, 'Enter')) {
    e.preventDefault();
    choose(matches[active]);
  } else if (equals(e.key, 'Escape')) {
    e.preventDefault();
    setOpen(false);
  }
}
```

---

## add (packages/line-primitives/library/components/FileUpload.tsx)

declined: said no atom fits. Gaps: ambiguous.

### Prompt

````text
Rewrite this TypeScript function using the atom functions listed below.
Atoms are plain functions; they never change their arguments. Keep the same name and parameters
and keep exactly what the function does. Do not define helpers. Answer with only the function in
one ```ts block. If a part cannot be written with these atoms without changing what the
function does, leave that part as it is; if no part can, answer only: NO ATOM

```ts
function add(picked: File[]) {
  when(and(and(not(disabled), () => not(readOnly)), () => lengthOf(picked)), () => update(when(multiple, () => concatenated(list, picked), () => picked.slice(0, 1))));
}
```

Parts still to rewrite:
- `picked.slice(0, 1)` (CallExpression .slice(): ambiguous type)

Atoms you may use (name(params) - what it reads as - the JS it replaces):
- sliceText(text, from?, to?) - the part of text from from to to - text.slice(from, to)
- part(list, from?, to?) - the part of list from from to to - list.slice(from, to)
- not(a) - not a - !a
- and(a, b) - a and b - a && b
- when(condition, then, otherwise?) - when c, a, otherwise b - c ? a : b | if (c) { a } else { b }
- lengthOf(value) - the length of textOrList - value.length
- concatenated(lists?) - a followed by b - [...a, ...b]
````

### Answer

```ts
NO ATOM
```

---

## pageItems (packages/line-primitives/library/components/Pagination.tsx)

rejected: fewer gaps: 6 left of 4. Gaps: control flow, ambiguous, mutation, mutation.

### Prompt

````text
Rewrite this TypeScript function using the atom functions listed below.
Atoms are plain functions; they never change their arguments. Keep the same name and parameters
and keep exactly what the function does. Do not define helpers. Answer with only the function in
one ```ts block. If a part cannot be written with these atoms without changing what the
function does, leave that part as it is; if no part can, answer only: NO ATOM

```ts
function pageItems(page: number, pageCount: number, siblings = 1): (number | 'gap')[] {
  const wanted = setOf([1, pageCount]);
  for (let p = minus(page, siblings); atMost(p, plus(page, siblings)); p = plus(p, 1)) when(and(atLeast(p, 1), () => atMost(p, pageCount)), () => addToWeakSet(wanted, p));
  const sorted = sortedBy([...wanted], (a, b) => minus(a, b));
  const out: (number | 'gap')[] = [];
  sorted.forEach((p, i) => {
    when(and(greaterThan(i, 0), () => greaterThan(minus(p, sorted[minus(i, 1)]), 1)), () => out.push('gap'));
    out.push(p);
  });
  return out;
}
```

Parts still to rewrite:
- `for (let p = page - siblings; p <= page + siblings; p += 1) if (p >= 1 && p <= pageCount) wanted.add` (ForStatement: no exact loop atom (repeatWhile needs a limit))
- `sorted.forEach((p, i) => { if (i > 0 && p - sorted[i - 1] > 1) out.push('gap'); out.push(p); })` (CallExpression .forEach(): ambiguous type)
- `out.push('gap')` (CallExpression .push(): mutates)
- `out.push(p)` (CallExpression .push(): mutates)

Atoms you may use (name(params) - what it reads as - the JS it replaces):
- each(list, fn) - for each item of list, effect - list.forEach(fn) | for (const item of list) { fn(item) }
- pushedList(list, items?) - list after push items, as a copy - list.push(...items)
- eachMap(map, callbackfn, thisArg?) - the for each callbackfn, thisArg of map - map.forEach(callbackfn, thisArg)
- eachSet(set, callbackfn, thisArg?) - the for each callbackfn, thisArg of set - set.forEach(callbackfn, thisArg)
- repeatWhile(condition, step, limit) - repeat step while condition, at most limit times - while (condition) { step }
- iterateWhile(start, condition, next, limit) - starting from start, step to next while condition, at most limit times - let s = start; while (condition(s)) { s = next(s) }
- atMost(a, b) - a is at most b - a <= b
- greaterThan(a, b) - a is greater than b - a > b
- atLeast(a, b) - a is at least b - a >= b
- plus(a, b) - a plus b - a + b
- minus(a, b) - a minus b - a - b
- and(a, b) - a and b - a && b
- when(condition, then, otherwise?) - when c, a, otherwise b - c ? a : b | if (c) { a } else { b }
- sortedBy(list, order?) - list sorted by order - list.toSorted(order) | [...list].sort(order)
- setOf(items?) - the set of items - new Set(items)
- addToWeakSet(weakSet, value) - the add value of weakSet - weakSet.add(value)
````

### Answer

```ts
function pageItems(page: number, pageCount: number, siblings = 1): (number | 'gap')[] {
  const wanted = setOf([1, pageCount]);
  for (let p = page - siblings; p <= page + siblings; p += 1) when(and(atLeast(p, 1), () => atMost(p, pageCount)), () => addToWeakSet(wanted, p));
  const sorted = sortedBy([...wanted], (a, b) => minus(a, b));
  const out: (number | 'gap')[] = [];
  sorted.forEach((p, i) => {
    when(and(greaterThan(i, 0), () => greaterThan(minus(p, sorted[minus(i, 1)]), 1)), () => out.push('gap'));
    out.push(p);
  });
  return out;
}
```
