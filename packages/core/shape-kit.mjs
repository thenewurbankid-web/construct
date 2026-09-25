// #620 (part of epic #616) -- the small pieces every screen shape's templates share (shapes.mjs, shape-detail.mjs):
// how a name is worded, how a field is typed and shown, and how a template is assembled from lines. Pure text helpers, no I/O.

/** The module every generated unit imports its factory from (the published subpath of `@line/construct-core`, #591). */
export const TYPED_CONTRACTS_SPECIFIER = '@line/construct-core/typed-contracts';

/** The field types a shape accepts, and the TypeScript each one is. */
export const FIELD_TYPES = Object.freeze({ string: 'string', number: 'number', boolean: 'boolean' });

/**
 * The words of a PascalCase, camelCase or separated name: `OrderItems` is `['Order', 'Items']`, `unit_price` is `['unit', 'price']`.
 *
 * @param {string} text A name.
 * @returns {string[]} Its words, in order.
 *
 * @example
 * words('unitPrice'); // => ['unit', 'Price']
 */
export const words = (text) => String(text).replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_-]+/).filter(Boolean);

/**
 * The text with its first letter lower-cased.
 *
 * @param {string} text Any text.
 * @returns {string} The text, first letter lower-cased.
 *
 * @example
 * lowerFirst('Products'); // => 'products'
 */
export const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * The text with its first letter upper-cased.
 *
 * @param {string} text Any text.
 * @returns {string} The text, first letter upper-cased.
 *
 * @example
 * cap('product'); // => 'Product'
 */
export const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The kebab-case of a name, for ids and routes: `AddProduct` is `add-product`.
 *
 * @param {string} text A name.
 * @returns {string} Lower-case words joined with `-`.
 *
 * @example
 * kebab('AddProduct'); // => 'add-product'
 */
export const kebab = (text) => words(text).join('-').toLowerCase();

/**
 * The label a person reads for a field or a name: the words lower-cased with the first letter capitalised, so `unitPrice` is `Unit price`.
 *
 * @param {string} text A camelCase field name or a PascalCase unit name.
 * @returns {string} The label.
 *
 * @example
 * labelOf('unitPrice'); // => 'Unit price'
 */
export const labelOf = (text) => cap(words(text).join(' ').toLowerCase());

/**
 * The lines of a template joined into a file body that ends with one newline (nested arrays are flattened).
 *
 * @param {...(string|string[])} parts Lines, or arrays of lines.
 * @returns {string} The file text.
 *
 * @example
 * lines('a', ['b', 'c']); // => 'a\nb\nc\n'
 */
export const lines = (...parts) => `${parts.flat().join('\n')}\n`;

/**
 * The import line of one typed factory.
 *
 * @param {string} factory The factory name, for example `defineDomain`.
 * @returns {string} `import { defineDomain } from '@line/construct-core/typed-contracts';`.
 *
 * @example
 * importLine('definePage'); // => "import { definePage } from '@line/construct-core/typed-contracts';"
 */
export const importLine = (factory) => `import { ${factory} } from '${TYPED_CONTRACTS_SPECIFIER}';`;

/**
 * The TypeScript type of a field.
 *
 * @param {{ name: string, type: 'string'|'number'|'boolean' }} f A field.
 * @returns {string} `string`, `number` or `boolean`.
 *
 * @example
 * ts({ name: 'price', type: 'number' }); // => 'number'
 */
export const ts = (f) => FIELD_TYPES[f.type];

/**
 * The expression that shows a field of `item` as text (`String(...)` for anything that is not a string).
 *
 * @param {{ name: string, type: 'string'|'number'|'boolean' }} f A field.
 * @param {string} [item] The name of the variable that holds the item (default `item`).
 * @returns {string} The expression text.
 *
 * @example
 * show({ name: 'price', type: 'number' }); // => 'String(item.price)'
 */
export const show = (f, item = 'item') => (f.type === 'string' ? `${item}.${f.name}` : `String(${item}.${f.name})`);
