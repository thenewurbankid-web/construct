#!/usr/bin/env node
// Hand-written: the syntax section of the JavaScript reference (ECMAScript 2025, plus `using`, which Node 24 runs).
// One function per syntax.json entry, named syntax_<entry>, each returning a value so the run can be compared.
// Module-only forms (imports, exports, top-level await, the hashbang above) sit at the top level of this file.
// `with` needs sloppy mode and lives in sloppy.cjs.
import helperDefault, { helperName, shout as loud } from './syntax-helper.mjs';
import * as helperModule from './syntax-helper.mjs';
import data from './syntax-data.json' with { type: 'json' };

export * from './syntax-helper.mjs';
export * as helpers from './syntax-helper.mjs';

const loaded = await Promise.resolve('ready');
const localValue = 'local';
export { localValue as renamedValue };
export default 'default export of syntax.mjs';

// ---- literals ----

/** numeric literal (decimal) */
export function syntax_numeric_literal_decimal() {
  return 42.5;
}

/** numeric literal (hex 0x) */
export function syntax_numeric_literal_hex_0x() {
  return 0xff;
}

/** numeric literal (octal 0o) */
export function syntax_numeric_literal_octal_0o() {
  return 0o17;
}

/** numeric literal (binary 0b) */
export function syntax_numeric_literal_binary_0b() {
  return 0b1010;
}

/** numeric literal (exponent e) */
export function syntax_numeric_literal_exponent_e() {
  return 1.5e3;
}

/** numeric separator (1_000) */
export function syntax_numeric_separator_1_000() {
  return 1_000_000;
}

/** bigint literal (10n) */
export function syntax_bigint_literal_10n() {
  return 10n ** 20n;
}

/** string literal (double quotes) */
export function syntax_string_literal_double_quotes() {
  return "double";
}

/** string literal (single quotes) */
export function syntax_string_literal_single_quotes() {
  return 'single';
}

/** string escape (\u{...}) */
export function syntax_string_escape_u() {
  return 'snow \u{2603} tab\tnew\nline \x41 B';
}

/** boolean literal */
export function syntax_boolean_literal() {
  return [true, false];
}

/** null literal */
export function syntax_null_literal() {
  return null;
}

/** regular expression literal */
export function syntax_regular_expression_literal() {
  return /a+b/.test('aaab');
}

/** regex flags dgimsuy */
export function syntax_regex_flags_dgimsuy() {
  const pattern = /(?<letter>a)./dgimsuy;
  const match = pattern.exec('A\n');
  return [pattern.flags, match.indices[0]];
}

/** regex flag v (unicodeSets) */
export function syntax_regex_flag_v_unicodeSets() {
  return /[\p{L}--[a-z]]/v.test('Q');
}

/** regex named group (?<name>) */
export function syntax_regex_named_group_name() {
  return /(?<year>\d{4})-(?<month>\d{2})/.exec('2026-10').groups;
}

/** regex lookbehind (?<=) */
export function syntax_regex_lookbehind() {
  return '$42 and €7'.match(/(?<=\$)\d+/)[0];
}

/** regex modifiers (?i:) */
export function syntax_regex_modifiers_i() {
  return [/(?i:hello) World/.test('HELLO World'), /(?i:hello) World/.test('HELLO WORLD')];
}

/** regex duplicate named groups */
export function syntax_regex_duplicate_named_groups() {
  const date = /(?<year>\d{4})-\d{2}|\d{2}\/(?<year>\d{4})/;
  return [date.exec('2026-10').groups.year, date.exec('10/2026').groups.year];
}

/** template literal */
export function syntax_template_literal() {
  const count = 3;
  return `${count} items, ${count * 2} halves`;
}

/** tagged template */
export function syntax_tagged_template() {
  const tag = (strings, ...values) => strings.raw.join('|') + values.join(',');
  return tag`a${1}b${2}c`;
}

/** array literal */
export function syntax_array_literal() {
  return [1, 'two', [3]];
}

/** array hole (elision) */
export function syntax_array_hole_elision() {
  const sparse = [1, , 3];
  return [sparse.length, 1 in sparse];
}

/** object literal */
export function syntax_object_literal() {
  return { name: 'atom', size: 1 };
}

/** shorthand property */
export function syntax_shorthand_property() {
  const name = 'atom';
  const size = 1;
  return { name, size };
}

/** computed property name */
export function syntax_computed_property_name() {
  const key = 'dynamic';
  return { [key]: 1, [`${key}Two`]: 2 };
}

/** method definition in object */
export function syntax_method_definition_in_object() {
  const counter = { count: 1, next() { return this.count + 1; } };
  return counter.next();
}

/** getter in object */
export function syntax_getter_in_object() {
  const box = { width: 2, height: 3, get area() { return this.width * this.height; } };
  return box.area;
}

/** setter in object */
export function syntax_setter_in_object() {
  const box = { stored: 0, set value(next) { this.stored = next * 10; } };
  box.value = 4;
  return box.stored;
}

/** __proto__ in object literal */
export function syntax_proto_in_object_literal() {
  const base = { greet() { return 'hi'; } };
  const child = { __proto__: base, name: 'child' };
  return [child.greet(), Object.getPrototypeOf(child) === base];
}

// ---- operators ----

/** spread in array */
export function syntax_spread_in_array() {
  const middle = [2, 3];
  return [1, ...middle, 4];
}

/** spread in call */
export function syntax_spread_in_call() {
  const values = [4, 9, 2];
  return Math.max(...values);
}

/** spread in object */
export function syntax_spread_in_object() {
  const defaults = { a: 1, b: 2 };
  return { ...defaults, b: 3 };
}

/** arithmetic + - * / % */
export function syntax_arithmetic() {
  return [7 + 2, 7 - 2, 7 * 2, 7 / 2, 7 % 2];
}

/** exponent ** */
export function syntax_exponent() {
  return 2 ** 10;
}

/** comparison < > <= >= */
export function syntax_comparison() {
  return [1 < 2, 1 > 2, 2 <= 2, 3 >= 4];
}

/** equality == != */
export function syntax_equality() {
  return [1 == '1', 0 != false, null == undefined];
}

/** strict equality === !== */
export function syntax_strict_equality() {
  return [1 === 1, 1 !== '1'];
}

/** bitwise & | ^ */
export function syntax_bitwise() {
  return [0b1100 & 0b1010, 0b1100 | 0b1010, 0b1100 ^ 0b1010];
}

/** shift << >> >>> */
export function syntax_shift() {
  return [1 << 4, -16 >> 2, -16 >>> 28];
}

/** in */
export function syntax_in() {
  return ['a' in { a: 1 }, 'b' in { a: 1 }];
}

/** #x in obj (private brand check) */
export function syntax_x_in_obj_private_brand_check() {
  class Token {
    #secret = 1;
    static isToken(value) { return #secret in value; }
  }
  return [Token.isToken(new Token()), Token.isToken({})];
}

/** instanceof */
export function syntax_instanceof() {
  return [[] instanceof Array, {} instanceof Array];
}

/** logical && || */
export function syntax_logical() {
  return [true && 'yes', false || 'fallback', 0 && 'never'];
}

/** nullish ?? */
export function syntax_nullish() {
  return [null ?? 'default', 0 ?? 'default', undefined ?? 'default'];
}

/** unary + - ! ~ */
export function syntax_unary() {
  return [+'3', -5, !0, ~5];
}

/** typeof */
export function syntax_typeof() {
  return [typeof 1, typeof 'a', typeof undefined, typeof null, typeof (() => {}), typeof 1n, typeof Symbol()];
}

/** void */
export function syntax_void() {
  return void 'ignored';
}

/** delete */
export function syntax_delete() {
  const record = { keep: 1, drop: 2 };
  delete record.drop;
  return record;
}

/** prefix ++ -- */
export function syntax_prefix() {
  let up = 1;
  let down = 1;
  return [++up, --down];
}

/** postfix ++ -- */
export function syntax_postfix() {
  let up = 1;
  let down = 1;
  const before = [up++, down--];
  return [before, up, down];
}

/** assignment = */
export function syntax_assignment() {
  let value;
  value = 5;
  return value;
}

/** compound assignment += -= *= /= %= **= */
export function syntax_compound_assignment() {
  let n = 10;
  const steps = [];
  n += 5; steps.push(n);
  n -= 3; steps.push(n);
  n *= 2; steps.push(n);
  n /= 4; steps.push(n);
  n %= 4; steps.push(n);
  n **= 3; steps.push(n);
  return steps;
}

/** bitwise assignment &= |= ^= <<= >>= >>>= */
export function syntax_bitwise_assignment() {
  let n = 0b1111;
  const steps = [];
  n &= 0b1010; steps.push(n);
  n |= 0b0101; steps.push(n);
  n ^= 0b0011; steps.push(n);
  n <<= 2; steps.push(n);
  n >>= 1; steps.push(n);
  n >>>= 1; steps.push(n);
  return steps;
}

/** logical assignment &&= ||= ??= */
export function syntax_logical_assignment() {
  const options = { retries: 0, name: '', limit: null };
  options.retries &&= 5;
  options.name ||= 'unnamed';
  options.limit ??= 10;
  return options;
}

/** conditional ? : */
export function syntax_conditional() {
  const age = 20;
  return age >= 18 ? 'adult' : 'minor';
}

/** comma operator */
export function syntax_comma_operator() {
  let a = 0;
  const last = (a += 1, a += 1, a * 10);
  return last;
}

/** grouping ( ) */
export function syntax_grouping() {
  return [(2 + 3) * 4, 2 + 3 * 4];
}

/** member access a.b */
export function syntax_member_access_a_b() {
  const user = { name: 'Ada' };
  return user.name;
}

/** computed access a[b] */
export function syntax_computed_access_a_b() {
  const user = { name: 'Ada' };
  const field = 'name';
  return user[field];
}

/** optional member a?.b */
export function syntax_optional_member_a_b() {
  const user = { address: null };
  return [user.address?.city, user?.address];
}

/** optional call a?.() */
export function syntax_optional_call_a() {
  const handlers = { onSave: () => 'saved' };
  return [handlers.onSave?.(), handlers.onClose?.()];
}

/** new */
export function syntax_new() {
  return new Date(Date.UTC(2026, 0, 1)).getUTCFullYear();
}

/** new.target */
export function syntax_new_target() {
  function Shape() {
    return new.target === Shape;
  }
  return [Reflect.construct(Shape, []) instanceof Shape, Shape()];
}

/** import.meta */
export function syntax_import_meta() {
  return import.meta.url.endsWith('/syntax.mjs');
}

/** dynamic import() */
export async function syntax_dynamic_import() {
  const helper = await import('./syntax-helper.mjs');
  return helper.shout('loaded');
}

/** this */
export function syntax_this() {
  const counter = { count: 2, double() { return this.count * 2; } };
  return counter.double();
}

/** super call */
export function syntax_super_call() {
  class Animal { constructor(name) { this.name = name; } }
  class Dog extends Animal { constructor(name) { super(name); this.kind = 'dog'; } }
  return { ...new Dog('Rex') };
}

/** super property */
export function syntax_super_property() {
  class Animal { speak() { return 'sound'; } }
  class Dog extends Animal { speak() { return `${super.speak()} → woof`; } }
  return new Dog().speak();
}

/** await */
export async function syntax_await() {
  const value = await Promise.resolve(21);
  return value * 2;
}

/** yield */
export function syntax_yield() {
  function* letters() {
    yield 'a';
    yield 'b';
  }
  return [...letters()];
}

/** yield* */
export function syntax_yield_star() {
  function* inner() { yield 1; yield 2; }
  function* outer() { yield 0; yield* inner(); yield 3; }
  return [...outer()];
}

// ---- declarations ----

/** var */
export function syntax_var() {
  var hoisted = typeof later;
  var later = 1;
  return [hoisted, later];
}

/** let */
export function syntax_let() {
  let count = 1;
  count = 2;
  return count;
}

/** const */
export function syntax_const() {
  const fixed = 'fixed';
  return fixed;
}

/** using */
export function syntax_using() {
  const log = [];
  {
    using resource = { [Symbol.dispose]() { log.push('disposed'); } };
    log.push('used');
  }
  return log;
}

/** array destructuring */
export function syntax_array_destructuring() {
  const [first, , third] = [1, 2, 3];
  return [first, third];
}

/** object destructuring */
export function syntax_object_destructuring() {
  const { name, size: weight } = { name: 'atom', size: 1 };
  return [name, weight];
}

/** default value in pattern */
export function syntax_default_value_in_pattern() {
  const { color = 'blue' } = {};
  return color;
}

/** rest element */
export function syntax_rest_element() {
  const [head, ...tail] = [1, 2, 3];
  const { a, ...others } = { a: 1, b: 2, c: 3 };
  return [head, tail, a, others];
}

/** destructuring assignment */
export function syntax_destructuring_assignment() {
  let left = 1;
  let right = 2;
  [left, right] = [right, left];
  let x;
  ({ x } = { x: 9 });
  return [left, right, x];
}

// ---- functions ----

/** function declaration */
export function syntax_function_declaration() {
  function add(a, b) {
    return a + b;
  }
  return add(2, 3);
}

/** function expression */
export function syntax_function_expression() {
  const multiply = function (a, b) {
    return a * b;
  };
  return multiply(4, 5);
}

/** named function expression */
export function syntax_named_function_expression() {
  const factorial = function fact(n) {
    return n <= 1 ? 1 : n * fact(n - 1);
  };
  return factorial(5);
}

/** arrow function (block body) */
export function syntax_arrow_function_block_body() {
  const square = (n) => {
    const result = n * n;
    return result;
  };
  return square(7);
}

/** arrow function (expression body) */
export function syntax_arrow_function_expression_body() {
  const half = (n) => n / 2;
  return half(9);
}

/** async function */
export async function syntax_async_function() {
  async function fetchValue() {
    return 'value';
  }
  return fetchValue();
}

/** async arrow */
export async function syntax_async_arrow() {
  const later = async (n) => n + 1;
  return later(1);
}

/** generator function */
export function syntax_generator_function() {
  function* range(end) {
    for (let i = 0; i < end; i++) yield i;
  }
  return [...range(4)];
}

/** async generator function */
export async function syntax_async_generator_function() {
  async function* ticks() {
    yield 'tick';
    yield 'tock';
  }
  const seen = [];
  for await (const t of ticks()) seen.push(t);
  return seen;
}

/** default parameter */
export function syntax_default_parameter() {
  function greet(name = 'world') {
    return `hello ${name}`;
  }
  return [greet(), greet('Ada')];
}

/** rest parameter */
export function syntax_rest_parameter() {
  function total(...numbers) {
    return numbers.reduce((sum, n) => sum + n, 0);
  }
  return total(1, 2, 3, 4);
}

/** arguments object */
export function syntax_arguments_object() {
  function count() {
    return arguments.length;
  }
  return count('a', 'b', 'c');
}

/** trailing comma in parameters */
export function syntax_trailing_comma_in_parameters() {
  function pair(
    first,
    second,
  ) {
    return [first, second];
  }
  return pair(1, 2,);
}

/** closure over outer variable */
export function syntax_closure_over_outer_variable() {
  function makeCounter() {
    let count = 0;
    return () => ++count;
  }
  const next = makeCounter();
  next();
  return next();
}

/** IIFE */
export function syntax_IIFE() {
  return (function () {
    return 'ran once';
  })();
}

// ---- classes ----

/** class declaration */
export function syntax_class_declaration() {
  class Point {}
  return typeof Point;
}

/** class expression */
export function syntax_class_expression() {
  const Named = class Inner {};
  return Named.name;
}

/** extends */
export function syntax_extends() {
  class Base {}
  class Derived extends Base {}
  return new Derived() instanceof Base;
}

/** constructor */
export function syntax_constructor() {
  class Point {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
  }
  return { ...new Point(1, 2) };
}

/** instance method */
export function syntax_instance_method() {
  class Circle {
    constructor(r) { this.r = r; }
    diameter() { return this.r * 2; }
  }
  return new Circle(3).diameter();
}

/** static method */
export function syntax_static_method() {
  class Temperature {
    static fromFahrenheit(f) { return Math.round((f - 32) * 5 / 9); }
  }
  return Temperature.fromFahrenheit(212);
}

/** getter */
export function syntax_getter() {
  class Square {
    constructor(side) { this.side = side; }
    get area() { return this.side ** 2; }
  }
  return new Square(4).area;
}

/** setter */
export function syntax_setter() {
  class Thermostat {
    celsius = 0;
    set fahrenheit(f) { this.celsius = (f - 32) * 5 / 9; }
  }
  const t = new Thermostat();
  t.fahrenheit = 212;
  return t.celsius;
}

/** public field */
export function syntax_public_field() {
  class Settings {
    theme = 'dark';
  }
  return new Settings().theme;
}

/** static field */
export function syntax_static_field() {
  class Config {
    static version = '1.0';
  }
  return Config.version;
}

/** private field #x */
export function syntax_private_field_x() {
  class Wallet {
    #balance = 10;
    spend(n) { this.#balance -= n; return this.#balance; }
  }
  return new Wallet().spend(3);
}

/** private method #m() */
export function syntax_private_method_m() {
  class Greeter {
    #format(name) { return `Hi, ${name}`; }
    greet(name) { return this.#format(name); }
  }
  return new Greeter().greet('Ada');
}

/** private getter/setter */
export function syntax_private_getter_setter() {
  class Counter {
    #count = 0;
    get #doubled() { return this.#count * 2; }
    set #value(n) { this.#count = n; }
    run() { this.#value = 5; return this.#doubled; }
  }
  return new Counter().run();
}

/** static private member */
export function syntax_static_private_member() {
  class Registry {
    static #items = [];
    static #check(item) { return typeof item === 'string'; }
    static add(item) { if (Registry.#check(item)) Registry.#items.push(item); return Registry.#items.length; }
  }
  Registry.add('a');
  return Registry.add(1);
}

/** static initialization block */
export function syntax_static_initialization_block() {
  class Table {
    static rows;
    static {
      Table.rows = ['header'];
    }
  }
  return Table.rows;
}

/** computed class member */
export function syntax_computed_class_member() {
  const methodName = 'describe';
  class Thing {
    [methodName]() { return 'computed'; }
  }
  return new Thing().describe();
}

/** async class method */
export async function syntax_async_class_method() {
  class Loader {
    async load() { return 'loaded'; }
  }
  return new Loader().load();
}

/** generator class method */
export function syntax_generator_class_method() {
  class Countdown {
    *steps() { yield 3; yield 2; yield 1; }
  }
  return [...new Countdown().steps()];
}

/** accessor via Symbol.iterator */
export function syntax_accessor_via_Symbol_iterator() {
  class Pair {
    constructor(a, b) { this.a = a; this.b = b; }
    *[Symbol.iterator]() { yield this.a; yield this.b; }
  }
  return [...new Pair('x', 'y')];
}

// ---- statements ----

/** block */
export function syntax_block() {
  let outer = 'outer';
  {
    let outer2 = 'inner';
    outer = `${outer}+${outer2}`;
  }
  return outer;
}

/** empty statement */
export function syntax_empty_statement() {
  let i = 0;
  for (; i < 3; i++);
  return i;
}

/** expression statement */
export function syntax_expression_statement() {
  const log = [];
  log.push('expression');
  return log;
}

/** if */
export function syntax_if() {
  const stock = 0;
  if (stock === 0) {
    return 'sold out';
  }
  return 'available';
}

/** if / else */
export function syntax_if_else() {
  const score = 72;
  if (score >= 90) {
    return 'A';
  } else if (score >= 70) {
    return 'C';
  } else {
    return 'F';
  }
}

/** switch */
export function syntax_switch() {
  const day = 'sat';
  switch (day) {
    case 'sat':
    case 'sun':
      return 'weekend';
    default:
      return 'weekday';
  }
}

/** switch fall-through */
export function syntax_switch_fall_through() {
  const level = 2;
  const unlocked = [];
  switch (level) {
    case 3:
      unlocked.push('gold');
    case 2:
      unlocked.push('silver');
    case 1:
      unlocked.push('bronze');
      break;
    default:
      unlocked.push('none');
  }
  return unlocked;
}

/** for */
export function syntax_for() {
  let sum = 0;
  for (let i = 1; i <= 4; i++) {
    sum += i;
  }
  return sum;
}

/** for...in */
export function syntax_for_in() {
  const keys = [];
  for (const key in { a: 1, b: 2 }) {
    keys.push(key);
  }
  return keys;
}

/** for...of */
export function syntax_for_of() {
  const doubled = [];
  for (const n of [1, 2, 3]) {
    doubled.push(n * 2);
  }
  return doubled;
}

/** for await...of */
export async function syntax_for_await_of() {
  const results = [];
  for await (const value of [Promise.resolve('a'), 'b']) {
    results.push(value);
  }
  return results;
}

/** while */
export function syntax_while() {
  let n = 1;
  while (n < 100) {
    n *= 3;
  }
  return n;
}

/** do...while */
export function syntax_do_while() {
  let runs = 0;
  do {
    runs++;
  } while (runs < 0);
  return runs;
}

/** break */
export function syntax_break() {
  let found = -1;
  for (const [i, n] of [5, 8, 13].entries()) {
    if (n > 6) {
      found = i;
      break;
    }
  }
  return found;
}

/** continue */
export function syntax_continue() {
  const odd = [];
  for (let i = 0; i < 6; i++) {
    if (i % 2 === 0) continue;
    odd.push(i);
  }
  return odd;
}

/** labeled statement */
export function syntax_labeled_statement() {
  const steps = [];
  check: {
    steps.push('start');
    if (steps.length > 0) break check;
    steps.push('never');
  }
  return steps;
}

/** break label */
export function syntax_break_label() {
  let pair = null;
  outer: for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (i * j === 2) {
        pair = [i, j];
        break outer;
      }
    }
  }
  return pair;
}

/** continue label */
export function syntax_continue_label() {
  const kept = [];
  rows: for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (j === 1) continue rows;
      kept.push(`${i}${j}`);
    }
  }
  return kept;
}

/** return */
export function syntax_return() {
  return 'returned';
}

/** throw */
export function syntax_throw() {
  try {
    throw new RangeError('out of range');
  } catch (error) {
    return error.message;
  }
}

/** try / catch */
export function syntax_try_catch() {
  try {
    JSON.parse('{');
    return 'parsed';
  } catch (error) {
    return error.name;
  }
}

/** try / finally */
export function syntax_try_finally() {
  const log = [];
  try {
    log.push('try');
  } finally {
    log.push('finally');
  }
  return log;
}

/** optional catch binding */
export function syntax_optional_catch_binding() {
  try {
    null.property;
  } catch {
    return 'caught without a name';
  }
  return 'no error';
}

/** debugger */
export function syntax_debugger() {
  debugger;
  return 'continued';
}

/** directive 'use strict' */
export function syntax_directive_use_strict() {
  function strictThis() {
    'use strict';
    return this;
  }
  return strictThis();
}

// ---- modules (the declarations are at the top of this file) ----

/** named export */
export function syntax_named_export() {
  return 'every function in this file is a named export';
}

/** export list { a as b } */
export function syntax_export_list_a_as_b() {
  return localValue;
}

/** default export */
export function syntax_default_export() {
  return 'see the export default at the top';
}

/** export * from */
export function syntax_export_star_from() {
  return helperName;
}

/** export * as ns from */
export function syntax_export_star_as_ns_from() {
  return Object.keys(helperModule).sort();
}

/** named import */
export function syntax_named_import() {
  return loud(helperName);
}

/** default import */
export function syntax_default_import() {
  return helperDefault;
}

/** namespace import */
export function syntax_namespace_import() {
  return helperModule.shout('namespace');
}

/** import attributes (with { type: 'json' }) */
export function syntax_import_attributes_with_type_json() {
  return data;
}

/** top-level await */
export function syntax_top_level_await() {
  return loaded;
}

// ---- lexical grammar ----

/** line comment */
export function syntax_line_comment() {
  // A line comment ends at the line break.
  return 'line';
}

/** block comment */
export function syntax_block_comment() {
  /* A block comment
     can span lines. */
  return 'block';
}

/** hashbang */
export function syntax_hashbang() {
  return 'see the #! on the first line of this file';
}

/** automatic semicolon insertion */
export function syntax_automatic_semicolon_insertion() {
  const a = 1
  const b = 2
  return a + b
}

/** unicode identifier */
export function syntax_unicode_identifier() {
  const café = 'coffee';
  const π = 3.14159;
  return [café, π];
}
