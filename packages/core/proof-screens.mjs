// #620 (part of epic #616) -- the render proof of the `detail` shape, as generated node tests (proof.mjs writes and locks
// them, `construct test proof` runs them). Each proof shows the screen the shape wrote BEHAVES, with no browser and no server: every state
// from sample props (react-dom/server), the controller's first state, the pure domain unit, and the service with a stubbed fetch. A failure
// names the state that is wrong (`the not-found state is wrong, the screen shows loading`), so a person, an LLM or the runner can act on it.
//
// proof.mjs owns the file, the header and the helpers every proof shares; it passes them in as `kit`, so this file needs nothing from it.
import { labelOf } from './shape-kit.mjs';

/**
 * @typedef {{ header: (extra: string, command: string) => string[], expectLines: string[], fetchLines: string[], lit: (value: string) => string, rowLiteral: (row: object) => string, comment: (text: string) => string }} ProofKit
 * What proof.mjs hands the proofs of the other shapes: the generated-file header, the shared helper text, and how to write a literal.
 */

/** How a field of the sample row reads on the details screen: a string as it is, a number by `String`, a boolean as Yes or No. */
const shownValue = (f, value) => (f.type === 'boolean' ? (value ? 'Yes' : 'No') : String(value));

/**
 * The text of the render proof of a detail screen: loading, not found, ready (every field with its label and its value), error with
 * role alert, the controller's first state, the domain lines, and the service with a stubbed fetch (200, 404, 500, wrong shape, network
 * failure, the id in the address, the AbortSignal).
 *
 * @param {object} ctx The proof context (shape context plus `rows`, `loadingText`, `notFoundText`, `errorText`).
 * @param {{ feature: string }} request The proof request.
 * @param {string} relPath The project-relative path of the proof file, for its run line.
 * @param {ProofKit} kit The shared header and helpers.
 * @returns {string} The file text, ending with a newline.
 *
 * @example
 * detailProofText(ctx, { feature: 'products' }, 'features/products/tests/generated/ProductScreen.proof.test.ts', kit).startsWith('// @construct-generated');
 */
export function detailProofText(ctx, request, relPath, kit) {
  const { names, fields, rows } = ctx;
  const { lit } = kit;
  const Name = names.Name;
  const command = `construct create proof ${Name} --feature ${request.feature} --shape detail --entity ${names.Entity} --fields ${ctx.request.fields}`;
  const [item] = rows;
  const lineOf = (f) => `[${lit(`<dt>${labelOf(f.name)}</dt>`)}, ${lit(`<dd>${shownValue(f, item[f.name])}</dd>`)}]`;
  const L = [
    ...kit.header(`shape detail, kind render`, command),
    `// run: construct test proof ${kit.comment(request.feature)}   (on its own: npx tsx --test ${kit.comment(relPath)})`,
    '//',
    `// Proves the ${ctx.singular} details screen with no browser and no server: its four states from sample props (loading, not found, ready`,
    '// with every field label and value, error with role="alert"), that the controller renders the loading state first, the domain lines,',
    '// and that the service answers a 404, a 500, a wrong shape and a network failure with a typed result (fetch is stubbed).',
    '// A failure names the state.',
    '',
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { createElement } from 'react';",
    "import { renderToString } from 'react-dom/server';",
    `import { ${names.controller} } from '../../controllers/${names.controller}.controller';`,
    `import { ${names.describe} } from '../../domain/${Name}.domain';`,
    `import { ${names.page} } from '../../pages/${names.page}.page';`,
    `import { ${names.fetch} } from '../../services/${Name}.service';`,
    `import type { ${names.Entity}, ${names.result}, ${names.state} } from '../../types';`,
    '',
    `const ITEM: ${names.Entity} = ${kit.rowLiteral(item)};`,
    `const LOADING_TEXT = ${lit(ctx.loadingText)};`,
    `const NOT_FOUND_TEXT = ${lit(ctx.notFoundText)};`,
    `const ERROR_TEXT = ${lit(ctx.errorText)};`,
    '',
    '/** What a person would see: the state of the screen, read off its markup. */',
    'function stateOf(html: string): string {',
    "  if (html.startsWith('<crashed')) return 'crashed';",
    "  if (html.includes('role=\"alert\"')) return 'error';",
    "  if (html.includes('role=\"status\"') && html.includes(LOADING_TEXT)) return 'loading';",
    "  if (html.includes('role=\"status\"') && html.includes(NOT_FOUND_TEXT)) return 'not-found';",
    "  if (html.includes('<dl')) return 'ready';",
    "  return 'nothing';",
    '}',
    '',
    '/** What the service answered, in the same words. */',
    `function resultState(result: ${names.result}): string {`,
    '  return result.status;',
    '}',
    '',
    ...kit.expectLines,
    '',
    `const render = (state: ${names.state}): string => {`,
    '  try {',
    `    return renderToString(createElement(${names.page}, { state }));`,
    '  } catch (error) {',
    "    return '<crashed: ' + (error instanceof Error ? error.message : String(error)) + '>';",
    '  }',
    '};',
    '',
    ...kit.fetchLines,
    `const ask = (id: string = String(ITEM.id)) => ${names.fetch}({ id, signal: new AbortController().signal });`,
    '',
    `test(${lit(`${Name} screen: the loading state`)}, () => {`,
    "  expectState('The page given status loading', 'loading', stateOf(render({ status: 'loading' })));",
    '});',
    '',
    `test(${lit(`${Name} screen: the not-found state`)}, () => {`,
    "  expectState('The page given status not-found', 'not-found', stateOf(render({ status: 'not-found' })));",
    '});',
    '',
    `test(${lit(`${Name} screen: the ready state, with every field label and value`)}, () => {`,
    `  const html = render({ status: 'ready', item: ITEM, rows: ${names.describe}({ item: ITEM }) });`,
    "  expectState('The page given the item', 'ready', stateOf(html));",
    '  const shown: string[][] = [',
    ...fields.map((f) => `    ${lineOf(f)},`),
    '  ];',
    "  shown.forEach((parts) => parts.forEach((part) => expectShown('The item', html, part)));",
    '});',
    '',
    `test(${lit(`${Name} screen: the error state, with role alert`)}, () => {`,
    "  const html = render({ status: 'error', message: ERROR_TEXT });",
    "  expectState('The page given an error', 'error', stateOf(html));",
    "  expectShown('The error', html, ERROR_TEXT);",
    '});',
    '',
    `test(${lit(`${Name} controller: renders the loading state first`)}, () => {`,
    `  const html = renderToString(createElement(${names.controller}, { id: String(ITEM.id) }));`,
    "  expectState('The controller on its first render', 'loading', stateOf(html));",
    "  assert.equal(html, render({ status: 'loading' }), 'the controller hands the hook state to the page and adds nothing');",
    `  assert.equal(renderToString(createElement(${names.controller}, {})), html, 'with no id prop it reads the address after the first render, so the first render is the same');`,
    '});',
    '',
    `test(${lit(`${Name} domain: one line per field, in order`)}, () => {`,
    `  const lines = ${names.describe}({ item: ITEM });`,
    `  assert.deepEqual(lines.map((line) => line.field), [${fields.map((f) => lit(f.name)).join(', ')}]);`,
    `  assert.deepEqual(lines.map((line) => line.label), [${fields.map((f) => lit(labelOf(f.name))).join(', ')}]);`,
    `  assert.deepEqual(lines.map((line) => line.value), [${fields.map((f) => lit(shownValue(f, item[f.name]))).join(', ')}]);`,
    '});',
    '',
    `test(${lit(`${Name} service: a good answer is the item`)}, async () => {`,
    '  await withFetch(respond(200, ITEM), async () => {',
    "    expectState('The service given an item', 'ready', resultState(await ask()));",
    '  });',
    '});',
    '',
    `test(${lit(`${Name} service: a 404 is not found`)}, async () => {`,
    '  await withFetch(respond(404, {}), async () => {',
    "    expectState('The service given a 404', 'not-found', resultState(await ask()));",
    '  });',
    '});',
    '',
    `test(${lit(`${Name} service: a 500 is an error result`)}, async () => {`,
    '  await withFetch(respond(500, {}), async () => {',
    "    expectState('The service given a 500', 'error', resultState(await ask()));",
    '  });',
    '});',
    '',
    `test(${lit(`${Name} service: a wrong shape is an error result`)}, async () => {`,
    "  await withFetch(respond(200, [ITEM]), async () => {",
    "    expectState('The service given a list instead of an item', 'error', resultState(await ask()));",
    '  });',
    `  const wrong = { ...ITEM, ${ctx.title.name}: ${ctx.title.type === 'string' ? '12345' : "'wrong'"} };`,
    '  await withFetch(respond(200, wrong), async () => {',
    "    expectState('The service given an item of the wrong shape', 'error', resultState(await ask()));",
    '  });',
    '});',
    '',
    `test(${lit(`${Name} service: a network failure is an error result`)}, async () => {`,
    "  await withFetch(async () => { throw new Error('offline'); }, async () => {",
    "    expectState('The service given a network failure', 'error', resultState(await ask()));",
    '  });',
    '});',
    '',
    `test(${lit(`${Name} service: asks for the item by its id, and the caller's AbortSignal reaches fetch`)}, async () => {`,
    '  const controller = new AbortController();',
    '  let seen: { url?: unknown; signal?: unknown } = {};',
    '  const original = globalThis.fetch;',
    '  globalThis.fetch = (async (url: unknown, init?: { signal?: unknown }) => { seen = { url, signal: init?.signal }; return respond(200, ITEM)(); }) as unknown as typeof fetch;',
    '  try {',
    `    await ${names.fetch}({ id: 'a b/c', signal: controller.signal });`,
    '  } finally {',
    '    globalThis.fetch = original;',
    '  }',
    `  assert.equal(seen.url, ${lit(`${ctx.endpoint}/a%20b%2Fc`)}, 'the id is part of the address, encoded');`,
    "  assert.equal(seen.signal, controller.signal, 'the service forwards the AbortSignal, so leaving the screen cancels the request');",
    '});',
  ];
  return `${L.join('\n')}\n`;
}
