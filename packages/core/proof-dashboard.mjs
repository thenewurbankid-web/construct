// #627 (part of epic #616) -- the render proof of the `dashboard` shape, as a generated node test (proof.mjs writes and locks it, `construct test proof`
// runs it). It shows the overview the shape wrote BEHAVES, with no browser and no server: loading, error with role alert, and the ready screen
// with EVERY tile and EVERY panel (and each of its lines) shown from sample props, the controller's first state, the pure domain unit, and the
// service (with a stubbed fetch, or answering its local store). A failure names the piece that is wrong: a missing tile is reported as
// `The tile "Sum of total" does not show ...`, a wrong screen as `the ready state is wrong, the screen shows loading`.
//
// proof.mjs owns the file, the header and the helpers every proof shares; it passes them in as `kit`, so this file needs nothing from it.
import { sourceFlag } from './proof-screens.mjs';
import { layoutOf, measuresOf } from './shape-dashboard.mjs';
import { proofViews, statesFlag } from './shape-states.mjs';

const show = (value) => String(Math.round(value * 100) / 100);

/**
 * The summary a dashboard makes of some rows, as the JSON-like object the service answers: `count`, `{ sum, average, max }` for each number field
 * and the number of true values for each yes or no field. The proof's sample summary (the two sample rows) and its expected tiles come from it.
 *
 * @param {Record<string, string|number|boolean>[]} rows The sample rows.
 * @param {{ name: string, type: string }[]} fields The parsed `--fields`.
 * @returns {Record<string, unknown>} The summary.
 *
 * @example
 * summaryOfRows([{ id: 'a', total: 12.5 }, { id: 'b', total: 7 }], [{ name: 'id', type: 'string' }, { name: 'total', type: 'number' }]); // => { count: 2, total: { sum: 19.5, average: 9.75, max: 12.5 } }
 */
export function summaryOfRows(rows, fields) {
  const { numbers, flags } = measuresOf(fields);
  const out = { count: rows.length };
  for (const f of numbers) {
    const values = rows.map((r) => Number(r[f.name]));
    const sum = values.reduce((a, b) => a + b, 0);
    out[f.name] = { sum, average: rows.length === 0 ? 0 : sum / rows.length, max: rows.length === 0 ? 0 : Math.max(...values) };
  }
  for (const f of flags) out[f.name] = rows.filter((r) => r[f.name] === true).length;
  return out;
}

const literalOf = (value, lit) => (value !== null && typeof value === 'object' ? `{ ${Object.entries(value).map(([k, v]) => `${k}: ${literalOf(v, lit)}`).join(', ')} }` : typeof value === 'string' ? lit(value) : String(value));

/**
 * What a dashboard screen shows for the sample summary of the two sample rows: the summary the service answers, each tile (`key`, `label`,
 * `from`, `value`) and each panel (`key`, `title`, `field`, `lines` as `[label, value]`), and the markup of one tile and of one panel line, so
 * the render proof and the browser flow expect the very same text. Pure.
 *
 * @param {object} ctx The proof context (shape context plus `rows`).
 * @returns {{ summary: Record<string, unknown>, tiles: { key: string, label: string, value: string }[], panels: { key: string, title: string, lines: [string, string][] }[], tileHtml: (tile: object) => string, lineHtml: (line: [string, string]) => string }} The expectations.
 *
 * @example
 * dashboardExpectations(ctx).tiles.map((t) => t.label); // => ['Orders', 'Sum of total']
 */
export function dashboardExpectations(ctx) {
  const summary = summaryOfRows(ctx.rows, ctx.fields);
  const layout = layoutOf(ctx);
  const valueOf = (from) => {
    const [head, tail] = from.split('.');
    return tail ? summary[head][tail] : summary[head];
  };
  const isCounted = (t) => t.key === 'count' || measuresOf(ctx.fields).flags.some((f) => f.name === t.key);
  const tileValue = (t) => (isCounted(t) ? String(valueOf(t.from)) : show(valueOf(t.from)));
  const tiles = layout.tiles.map((t) => ({ ...t, value: tileValue(t) }));
  const panels = layout.panels.map((p) => ({ ...p, lines: [['Sum', show(summary[p.field].sum)], ['Average', show(summary[p.field].average)], ['Highest', show(summary[p.field].max)]] }));
  const tileHtml = (t) => `<li><span>${t.label}</span><strong>${t.value}</strong></li>`;
  const lineHtml = ([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  return { summary, tiles, panels, tileHtml, lineHtml };
}

/**
 * The text of the render proof of a dashboard screen: loading, error with role alert, the ready screen with every tile and every panel line
 * shown, the controller's first state, the domain tiles and panels, and the service (a stubbed fetch: 200, 500, wrong shape, network failure,
 * the AbortSignal; or, for the local source, the summary of the seed rows with no network and a cancelled request).
 *
 * @param {object} ctx The proof context (shape context plus `rows`, `loadingText`, `errorText`).
 * @param {{ feature: string }} request The proof request.
 * @param {string} relPath The project-relative path of the proof file, for its run line.
 * @param {import('./proof-screens.mjs').ProofKit & { openapiServiceTests: string[] }} kit The shared header and helpers.
 * @returns {string} The file text, ending with a newline.
 *
 * @example
 * dashboardProofText(ctx, { feature: 'orders-dashboard' }, 'features/orders-dashboard/tests/generated/OrdersDashboardScreen.proof.test.ts', kit).includes('every tile');
 */
export function dashboardProofText(ctx, request, relPath, kit) {
  const { names } = ctx;
  const { lit } = kit;
  const Name = names.Name;
  const local = ctx.source === 'local';
  const command = `construct create proof ${Name} --feature ${request.feature} --shape dashboard --entity ${names.Entity} --fields ${ctx.request.fields}${sourceFlag(ctx)}${statesFlag(ctx)}`;
  const pv = proofViews(ctx);
  // #622: a state with no view (`skip-all`) is proven to show nothing, so a skip is a checked choice, never an unproven gap.
  const wants = (kind, shown) => (pv[kind] === 'shown' ? shown : 'nothing');
  const { summary, tiles, panels, tileHtml, lineHtml } = dashboardExpectations(ctx);
  const numbers = measuresOf(ctx.fields).numbers;
  const flags = measuresOf(ctx.fields).flags;
  const wrong = numbers.length ? `{ ...SUMMARY, ${numbers[0].name}: 'wrong' }` : flags.length ? `{ ...SUMMARY, ${flags[0].name}: 'wrong' }` : `{ ...SUMMARY, count: 'wrong' }`;
  const localServiceTests = [
    `test(${lit(`${Name} service: the local store answers the summary of the seed rows, with no network`)}, async () => {`,
    "  await withFetch(async () => { throw new Error('the local store must not use the network'); }, async () => {",
    '    const result = await ask();',
    "    expectState('The service reading the local store', 'ready', resultState(result));",
    `    assert.deepEqual(result.status === 'ready' ? result.summary : null, SUMMARY, 'the summary is the one of the seed rows');`,
    `    assert.equal(${ctx.store.seed}({}).length, SUMMARY.count, 'the count is how many seed rows there are');`,
    '  });',
    '});',
    '',
    `test(${lit(`${Name} service: a cancelled request is an error result`)}, async () => {`,
    '  const controller = new AbortController();',
    '  controller.abort();',
    `  expectState('The service given a cancelled request', 'error', resultState(await ${names.fetch}({ signal: controller.signal })));`,
    '});',
  ];
  const L = [
    ...kit.header(`shape dashboard, kind render`, command),
    `// run: construct test proof ${kit.comment(request.feature)}   (on its own: npx tsx --test ${kit.comment(relPath)})`,
    '//',
    `// Proves the ${ctx.plural} screen with no browser and no server: its states from sample props (loading, error with role="alert", ready with`,
    '// every tile and every line of every panel), that the controller renders the loading state first, the pure domain unit that makes the tiles',
    ...(local
      ? ['// and panels, and that the service answers the summary of its local store with no network. A failure names the tile or panel that is wrong.']
      : ['// and panels, and that the service answers a summary, a 500, a wrong shape and a network failure with a typed result (fetch is stubbed). A failure names the tile or panel that is wrong.']),
    '',
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { createElement } from 'react';",
    "import { renderToString } from 'react-dom/server';",
    `import { ${names.controller} } from '../../controllers/${names.controller}.controller';`,
    ...(local ? [`import { ${ctx.store.seed} } from '../../domain/${ctx.store.file}.domain';`] : []),
    `import { ${names.describe} } from '../../domain/${Name}.domain';`,
    `import { ${names.page} } from '../../pages/${names.page}.page';`,
    `import { ${names.fetch} } from '../../services/${Name}.service';`,
    `import type { ${names.result}, ${names.state}, ${names.summary} } from '../../types';`,
    '',
    `const SUMMARY: ${names.summary} = ${literalOf(summary, lit)};`,
    `const LOADING_TEXT = ${lit(ctx.loadingText)};`,
    `const ERROR_TEXT = ${lit(ctx.errorText)};`,
    '',
    '/** What a person would see: the state of the screen, read off its markup. */',
    'function stateOf(html: string): string {',
    "  if (html.startsWith('<crashed')) return 'crashed';",
    "  if (html.includes('role=\"alert\"')) return 'error';",
    "  if (html.includes('role=\"status\"') && html.includes(LOADING_TEXT)) return 'loading';",
    "  if (html.includes('<ul aria-label=')) return 'ready';",
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
    '/** Like expectShown, for markup: the quotes of attributes are written as apostrophes in the message, so the runner can read its Expected and Received lines. */',
    'function expectMarkup(what: string, html: string, markup: string): void {',
    '  if (html.includes(markup)) return;',
    "  const shown = markup.replace(/\"/g, \"'\");",
    "  const message = what + ' does not show ' + shown + '.\\nExpected: \"' + shown + '\"\\nReceived: \"not shown\"';",
    "  throw new assert.AssertionError({ message, actual: 'not shown', expected: markup, operator: 'includes' });",
    '}',
    '',
    `const render = (state: ${names.state}): string => {`,
    '  try {',
    `    return renderToString(createElement(${names.page}, { state }));`,
    '  } catch (error) {',
    "    return '<crashed: ' + (error instanceof Error ? error.message : String(error)) + '>';",
    '  }',
    '};',
    `const ready = (): ${names.state} => ({ status: 'ready', summary: SUMMARY, ...${names.describe}({ summary: SUMMARY }) });`,
    '',
    ...kit.fetchLines,
    `const ask = () => ${names.fetch}({ signal: new AbortController().signal });`,
    '',
    `test(${lit(`${Name} screen: the loading state${pv.loading === 'shown' ? '' : ' shows nothing (skipped)'}`)}, () => {`,
    `  expectState('The page given status loading', '${wants('loading', 'loading')}', stateOf(render({ status: 'loading' })));`,
    '});',
    '',
    `test(${lit(`${Name} screen: the error state${pv.error === 'shown' ? ', with role alert' : ' shows nothing (skipped)'}`)}, () => {`,
    "  const html = render({ status: 'error', message: ERROR_TEXT });",
    `  expectState('The page given an error', '${wants('error', 'error')}', stateOf(html));`,
    pv.error === 'shown' ? "  expectMarkup('The error', html, ERROR_TEXT);" : "  assert.equal(html.includes(ERROR_TEXT), false, 'a skipped error state does not show the message');",
    '});',
    '',
    `test(${lit(`${Name} screen: the ready state, with every tile and every panel`)}, () => {`,
    '  const html = render(ready());',
    "  expectState('The page given the summary', 'ready', stateOf(html));",
    `  expectMarkup('The heading', html, ${lit(`<h1>${ctx.heading}</h1>`)});`,
    '  const tiles: [string, string][] = [',
    ...tiles.map((t) => `    [${lit(t.label)}, ${lit(tileHtml(t))}],`),
    '  ];',
    "  tiles.forEach(([label, markup]) => expectMarkup('The tile \"' + label + '\"', html, markup));",
    '  const panels: [string, string, string[]][] = [',
    ...panels.map((p) => `    [${lit(p.title)}, ${lit(`<section aria-label="${p.title}"><h2>${p.title}</h2>`)}, [${p.lines.map((l) => lit(lineHtml(l))).join(', ')}]],`),
    '  ];',
    "  panels.forEach(([title, opening, lines]) => {",
    "    expectMarkup('The panel \"' + title + '\"', html, opening);",
    "    lines.forEach((line) => expectMarkup('A line of the panel \"' + title + '\"', html, line));",
    '  });',
    '});',
    '',
    `test(${lit(`${Name} domain: the tiles and panels of a summary, in order`)}, () => {`,
    `  const view = ${names.describe}({ summary: SUMMARY });`,
    `  assert.deepEqual(view.tiles.map((tile) => [tile.key, tile.label, tile.value]), [${tiles.map((t) => `[${lit(t.key)}, ${lit(t.label)}, ${lit(t.value)}]`).join(', ')}]);`,
    `  assert.deepEqual(view.panels.map((panel) => [panel.key, panel.title, panel.lines.map((line) => line.label + '=' + line.value)]), [${panels.map((p) => `[${lit(p.key)}, ${lit(p.title)}, [${p.lines.map(([a, b]) => lit(`${a}=${b}`)).join(', ')}]]`).join(', ')}]);`,
    '});',
    '',
    `test(${lit(`${Name} controller: renders the loading state first`)}, () => {`,
    `  const html = renderToString(createElement(${names.controller}, {}));`,
    `  expectState('The controller on its first render', '${wants('loading', 'loading')}', stateOf(html));`,
    "  assert.equal(html, render({ status: 'loading' }), 'the controller hands the hook state to the page and adds nothing');",
    '});',
    '',
    ...(local ? localServiceTests : [
      ...kit.openapiServiceTests,
      `test(${lit(`${Name} service: a good answer is the summary`)}, async () => {`,
      '  await withFetch(respond(200, SUMMARY), async () => {',
      '    const result = await ask();',
      "    expectState('The service given a summary', 'ready', resultState(result));",
      `    assert.deepEqual(result.status === 'ready' ? result.summary : null, SUMMARY);`,
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
      "  await withFetch(respond(200, { not: 'a summary' }), async () => {",
      "    expectState('The service given something that is not a summary', 'error', resultState(await ask()));",
      '  });',
      `  await withFetch(respond(200, ${wrong}), async () => {`,
      "    expectState('The service given a summary of the wrong shape', 'error', resultState(await ask()));",
      '  });',
      '});',
      '',
      `test(${lit(`${Name} service: a network failure is an error result`)}, async () => {`,
      "  await withFetch(async () => { throw new Error('offline'); }, async () => {",
      "    expectState('The service given a network failure', 'error', resultState(await ask()));",
      '  });',
      '});',
      '',
      `test(${lit(`${Name} service: the caller's AbortSignal reaches fetch`)}, async () => {`,
      '  const controller = new AbortController();',
      '  let seen: unknown;',
      '  const original = globalThis.fetch;',
      '  globalThis.fetch = (async (_url: unknown, init?: { signal?: unknown }) => { seen = init?.signal; return respond(200, SUMMARY)(); }) as unknown as typeof fetch;',
      '  try {',
      `    await ${names.fetch}({ signal: controller.signal });`,
      '  } finally {',
      '    globalThis.fetch = original;',
      '  }',
      "  assert.equal(seen, controller.signal, 'the service forwards the AbortSignal, so leaving the screen cancels the request');",
      '});',
    ]),
  ];
  return `${L.join('\n')}\n`;
}
