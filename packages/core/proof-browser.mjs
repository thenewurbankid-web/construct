// #659 (part of epic #616) -- the Playwright browser flows of the `detail`, `form`, `dashboard` and `wizard` shapes, as generated LOCKED specs (proof.mjs writes
// them, `construct test run <feature> --area generated` runs them). The list shape's flow lives in proof.mjs; these follow its conventions: the route of the
// screen is loaded with the API mocked in the browser (nothing touches a real server), what a person sees is read off the screen's <main>, and a failure
// names the state that is wrong in the words the Playwright runner classifies (`Expected: "empty"` and `Received: "blank"`, so `classifyFailure` calls it
// an app failure, not "the test could not finish"). Written only when the project already has a Playwright config; a local data source makes no request to mock.
//
//   detail      loading, then the item (heading, every label and value), not found (a 404), the error state
//   form        every field with its label and input type, the message beside each invalid field, a valid submit (POSTs the typed values, then the saved notice), a failed submit
//   dashboard   loading, then the heading, every tile and every panel line of the sample summary; the error state
//   wizard      step 1 to the last step with Next (progress, legend, review), Back keeps what was typed, Submit posts the typed values and shows the complete screen;
//               Next is blocked while a step is invalid; a failed submit stays on the last step with its message
//
// proof.mjs owns the file, the header and the helpers every proof shares; it passes them in as `kit`, so this file needs nothing from it. Pure: the same
// (shape, entity, fields, steps, unit name, feature, route) writes the same bytes.
import { dashboardExpectations } from './proof-dashboard.mjs';
import { sampleValue, shownValue, typedValue } from './proof-screens.mjs';
import { dealFields } from './shape-wizard.mjs';
import { inputFieldsOf } from './shape-form.mjs';
import { cap, kebab, labelOf } from './shape-kit.mjs';

/**
 * @typedef {{ header: (extra: string, command: string) => string[], command: string, run: string, lit: (value: string) => string, rowLiteral: (row: object) => string }} BrowserKit
 * What proof.mjs hands the browser flows: the generated-file header, the flow's own command line and run line, and how to write a literal.
 */

/** The lines every browser flow starts with: the imports and the address of the screen. `controls` adds the `Locator` type the control helpers use. */
const prelude = (route, lit, controls) => [
  "import { test, expect } from '@playwright/test';",
  `import type { ${controls ? 'Locator, ' : ''}Page } from '@playwright/test';`,
  '',
  `const START_URL: string | null = ${lit(route)};`,
];

/** The helpers every browser flow carries (the same text in every shape's flow). */
const HELPERS = [
  "/** The markup of the screen's <main>, as the browser holds it right now ('' while there is none). */",
  'async function mainOf(page: Page): Promise<string> {',
  "  return page.locator('main').first().innerHTML({ timeout: 1_000 }).catch(() => '');",
  '}',
  '',
  '/** Waits for `markup` to be on the screen; when it never is, fails naming it in the words the runner classifies (Expected and Received lines). */',
  'async function expectMarkup(page: Page, what: string, markup: string): Promise<void> {',
  "  const shown = markup.replace(/\"/g, \"'\");",
  "  await expect.poll(async () => ((await mainOf(page)).includes(markup) ? shown : 'not shown'), { message: what + ' does not show ' + shown + '.' }).toBe(shown);",
  '}',
];

/** The helpers of the flows that fill in and press controls (the form and the wizard). */
const CONTROL_HELPERS = [
  '/** Waits for a control to be on the screen (a labelled field, a button); when it never is, fails naming it. */',
  'async function expectVisible(page: Page, what: string, control: Locator, name: string): Promise<void> {',
  "  const seen = async () => ((await control.count()) > 0 && (await control.first().isVisible()) ? name : 'not shown');",
  "  await expect.poll(seen, { message: what + ' is not on the screen.' }).toBe(name);",
  '}',
  '',
  '/** Fails naming the state that is wrong, in the words the runner classifies. */',
  'function expectState(what: string, want: string, got: string): void {',
  "  const quote = (text: string) => text.replace(/\"/g, \"'\");",
  '  if (got === want) return;',
  "  throw new Error(what + ': the ' + quote(want) + ' state is wrong, the screen shows ' + quote(got) + '.\\nExpected: \"' + quote(want) + '\"\\nReceived: \"' + quote(got) + '\"');",
  '}',
  '',
  '/** A JSON body with its keys in order, so two bodies with the same values compare equal. */',
  "const plain = (json: string): string => JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(json) as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))));",
  '',
  '/** Types into each field the way a person does, finding it by its label (so a label that is not tied to its input fails here). */',
  'async function fillIn(page: Page, fields: Field[]): Promise<void> {',
  '  for (const field of fields) {',
  '    const input = page.getByLabel(field.label, { exact: true });',
  "    if (typeof field.value === 'boolean') await input.setChecked(field.value);",
  '    else await input.fill(field.value);',
  '  }',
  '}',
];

const GATE = [
  '  let release: () => void = () => {};',
  '  const gate = new Promise<void>((resolve) => { release = resolve; });',
];

/** The run line and what the flow does, as the comment block after the header. */
const intro = (kit, lines) => [kit.run, '//', ...lines, ''];

/** The `open` helper of the flows that read: the answer to the GET is `answer`, held back until `gate` opens. `glob` is the request to mock, as a JS expression. */
const openReads = (glob, goto) => [
  'async function open(page: Page, answer: { status: number; body: unknown }, gate?: Promise<void>): Promise<void> {',
  `  await page.route(${glob}, async (route) => {`,
  '    if (gate) await gate;',
  "    await route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) });",
  '  });',
  '  if (START_URL === null) return;',
  `  await page.goto(${goto});`,
  '}',
];

/** The `open` helper of the flows that write: the answer to the POST is `answer`, and `sent` is told what the browser sent. */
const OPEN_WRITES = [
  '/** Loads the screen; the answer to the POST is `answer`, and `sent` is told what the browser sent. */',
  'async function open(page: Page, answer: { status: number; body: unknown }, sent?: (body: string | null) => void): Promise<void> {',
  "  await page.route('**' + ENDPOINT, async (route) => {",
  '    if (sent) sent(route.request().postData());',
  "    await route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) });",
  '  });',
  '  if (START_URL === null) return;',
  '  await page.goto(START_URL);',
  '}',
];

// ------------------------------------------------------------------------------------------------------------------------------ detail

/**
 * The text of the Playwright flow of a detail screen: loads the route with `?id=` and the item endpoint mocked, and checks loading then the item
 * (heading, every label and value), the not-found state (a 404) and the error state with role alert.
 *
 * @param {object} ctx The proof context (shape context plus `rows`, `loadingText`, `notFoundText`, `errorText`).
 * @param {string} route The route of the screen, for example `/product`.
 * @param {BrowserKit} kit The shared header and helpers.
 * @returns {string} The file text, ending with a newline.
 *
 * @example
 * detailBrowserText(ctx, '/product', kit).includes('not-found');
 */
export function detailBrowserText(ctx, route, kit) {
  const { lit } = kit;
  const Name = ctx.names.Name;
  const [item] = ctx.rows;
  const L = [
    ...kit.header('shape detail, kind playwright', kit.command),
    ...intro(kit, [
      `// Loads the route of the ${ctx.singular} details screen with the item (?id=) and ${ctx.endpoint}/<id> mocked in the browser, and checks what a person sees:`,
      '// loading, then the heading and every field with its label and value; not found (a 404); the error state with role="alert". Nothing here touches a real server.',
    ]),
    ...prelude(route, lit, false),
    `const ENDPOINT = ${lit(ctx.endpoint)};`,
    `const ITEM = ${kit.rowLiteral(item)};`,
    `const LOADING_TEXT = ${lit(ctx.loadingText)};`,
    `const NOT_FOUND_TEXT = ${lit(ctx.notFoundText)};`,
    `const ERROR_TEXT = ${lit(ctx.errorText)};`,
    '',
    '/** What a person sees: the state of the screen, read off its <main>. Named the way the unit proof names it. */',
    'async function stateOf(page: Page): Promise<string> {',
    '  const html = await mainOf(page);',
    "  if (html.includes('role=\"alert\"')) return 'error';",
    "  if (html.includes('role=\"status\"') && html.includes(LOADING_TEXT)) return 'loading';",
    "  if (html.includes('role=\"status\"') && html.includes(NOT_FOUND_TEXT)) return 'not-found';",
    "  if (html.includes('<dl')) return 'ready';",
    "  return 'nothing';",
    '}',
    '',
    ...HELPERS,
    '',
    ...openReads("'**' + ENDPOINT + '/*'", "START_URL + (START_URL.includes('?') ? '&' : '?') + 'id=' + encodeURIComponent(String(ITEM.id))"),
    '',
    `test(${lit(`${Name} screen: loading, then the item with every field`)}, async ({ page }) => {`,
    ...GATE,
    '  await open(page, { status: 200, body: ITEM }, gate);',
    "  await expect.poll(() => stateOf(page)).toBe('loading');",
    '  release();',
    "  await expect.poll(() => stateOf(page)).toBe('ready');",
    `  await expectMarkup(page, 'The heading', ${lit(`<h1>${cap(ctx.singular)} details</h1>`)});`,
    '  const shown: [string, string, string][] = [',
    ...ctx.fields.map((f) => `    [${lit(labelOf(f.name))}, ${lit(`<dt>${labelOf(f.name)}</dt>`)}, ${lit(`<dd>${shownValue(f, item[f.name])}</dd>`)}],`),
    '  ];',
    '  for (const [label, term, description] of shown) {',
    "    await expectMarkup(page, 'The label of the field \"' + label + '\"', term);",
    "    await expectMarkup(page, 'The value of the field \"' + label + '\"', description);",
    '  }',
    '});',
    '',
    `test(${lit(`${Name} screen: the not-found state`)}, async ({ page }) => {`,
    '  await open(page, { status: 404, body: {} });',
    "  await expect.poll(() => stateOf(page)).toBe('not-found');",
    "  await expectMarkup(page, 'The not-found notice', '<p role=\"status\">' + NOT_FOUND_TEXT + '</p>');",
    '});',
    '',
    `test(${lit(`${Name} screen: the error state, with role alert`)}, async ({ page }) => {`,
    '  await open(page, { status: 500, body: {} });',
    "  await expect.poll(() => stateOf(page)).toBe('error');",
    "  await expect(page.getByRole('alert')).toHaveText(ERROR_TEXT);",
    '});',
  ];
  return `${L.join('\n')}\n`;
}

// -------------------------------------------------------------------------------------------------------------------------- dashboard

/**
 * The text of the Playwright flow of a dashboard screen: loads the route with the summary endpoint mocked, and checks loading, then the heading, every
 * tile and every line of every panel of the sample summary, and the error state with role alert.
 *
 * @param {object} ctx The proof context (shape context plus `rows`, `loadingText`, `errorText`).
 * @param {string} route The route of the screen, for example `/orders`.
 * @param {BrowserKit} kit The shared header and helpers.
 * @returns {string} The file text, ending with a newline.
 *
 * @example
 * dashboardBrowserText(ctx, '/orders', kit).includes('every tile');
 */
export function dashboardBrowserText(ctx, route, kit) {
  const { lit } = kit;
  const Name = ctx.names.Name;
  const { summary, tiles, panels, tileHtml, lineHtml } = dashboardExpectations(ctx);
  const literalOf = (value) => (value !== null && typeof value === 'object' ? `{ ${Object.entries(value).map(([k, v]) => `${k}: ${literalOf(v)}`).join(', ')} }` : typeof value === 'string' ? lit(value) : String(value));
  const L = [
    ...kit.header('shape dashboard, kind playwright', kit.command),
    ...intro(kit, [
      `// Loads the route of the ${ctx.plural} screen with ${ctx.endpoint} mocked in the browser, and checks what a person sees:`,
      '// loading, then the heading, every tile and every line of every panel; the error state with role="alert". Nothing here touches a real server.',
    ]),
    ...prelude(route, lit, false),
    `const ENDPOINT = ${lit(ctx.endpoint)};`,
    `const SUMMARY = ${literalOf(summary)};`,
    `const LOADING_TEXT = ${lit(ctx.loadingText)};`,
    `const ERROR_TEXT = ${lit(ctx.errorText)};`,
    '',
    '/** What a person sees: the state of the screen, read off its <main>. Named the way the unit proof names it. */',
    'async function stateOf(page: Page): Promise<string> {',
    '  const html = await mainOf(page);',
    "  if (html.includes('role=\"alert\"')) return 'error';",
    "  if (html.includes('role=\"status\"') && html.includes(LOADING_TEXT)) return 'loading';",
    "  if (html.includes('<ul aria-label=')) return 'ready';",
    "  return 'nothing';",
    '}',
    '',
    ...HELPERS,
    '',
    ...openReads("'**' + ENDPOINT", 'START_URL'),
    '',
    `test(${lit(`${Name} screen: loading, then every tile and every panel`)}, async ({ page }) => {`,
    ...GATE,
    '  await open(page, { status: 200, body: SUMMARY }, gate);',
    "  await expect.poll(() => stateOf(page)).toBe('loading');",
    '  release();',
    "  await expect.poll(() => stateOf(page)).toBe('ready');",
    `  await expectMarkup(page, 'The heading', ${lit(`<h1>${ctx.heading}</h1>`)});`,
    '  const tiles: [string, string][] = [',
    ...tiles.map((t) => `    [${lit(t.label)}, ${lit(tileHtml(t))}],`),
    '  ];',
    "  for (const [label, markup] of tiles) await expectMarkup(page, 'The tile \"' + label + '\"', markup);",
    '  const panels: [string, string, string[]][] = [',
    ...panels.map((p) => `    [${lit(p.title)}, ${lit(`<section aria-label="${p.title}"><h2>${p.title}</h2>`)}, [${p.lines.map((l) => lit(lineHtml(l))).join(', ')}]],`),
    '  ];',
    '  for (const [title, opening, lines] of panels) {',
    "    await expectMarkup(page, 'The panel \"' + title + '\"', opening);",
    "    for (const line of lines) await expectMarkup(page, 'A line of the panel \"' + title + '\"', line);",
    '  }',
    '});',
    '',
    `test(${lit(`${Name} screen: the error state, with role alert`)}, async ({ page }) => {`,
    '  await open(page, { status: 500, body: {} });',
    "  await expect.poll(() => stateOf(page)).toBe('error');",
    "  await expect(page.getByRole('alert')).toHaveText(ERROR_TEXT);",
    '});',
  ];
  return `${L.join('\n')}\n`;
}

// ------------------------------------------------------------------------------------------------------------------------------ form

const inputType = (f) => (f.type === 'number' ? 'number' : f.type === 'boolean' ? 'checkbox' : 'text');
const objectOf = (fields, pick, lit) => `{ ${fields.map((f) => `${f.name}: ${typeof pick(f) === 'string' ? lit(pick(f)) : pick(f)}`).join(', ')} }`;
const fieldRow = (f, prefix, lit) => `{ id: ${lit(`${prefix}-${kebab(f.name)}`)}, label: ${lit(labelOf(f.name))}, type: ${lit(inputType(f))}, value: ${typeof sampleValue(f) === 'string' ? lit(sampleValue(f)) : sampleValue(f)} }`;

/**
 * The text of the Playwright flow of a form screen: loads the route with the POST endpoint mocked, and checks every field by its label and input type,
 * the message beside each invalid field after an empty submit, a valid submit (the typed values are POSTed, then the saved notice) and a failed submit.
 *
 * @param {object} ctx The proof context (shape context plus `errorText`, `submittedText`).
 * @param {string} route The route of the screen, for example `/add-product`.
 * @param {BrowserKit} kit The shared header and helpers.
 * @returns {string} The file text, ending with a newline.
 *
 * @example
 * formBrowserText(ctx, '/add-product', kit).includes('a valid submit');
 */
export function formBrowserText(ctx, route, kit) {
  const { lit } = kit;
  const Name = ctx.names.Name;
  const inputs = inputFieldsOf(ctx.fields);
  const checked = inputs.filter((f) => f.type !== 'boolean');
  const prefix = kebab(Name);
  const messageOf = (f) => `${labelOf(f.name)} is required.`; // an empty submit leaves every checked field blank, a blank number included
  const pressSubmit = [
    "  await expectVisible(page, 'The submit button', page.getByRole('button', { name: SUBMIT, exact: true }), SUBMIT);",
    "  await page.getByRole('button', { name: SUBMIT, exact: true }).click();",
  ];
  const L = [
    ...kit.header('shape form, kind playwright', kit.command),
    ...intro(kit, [
      `// Loads the route of the ${ctx.singular} form screen with POST ${ctx.endpoint} mocked in the browser, and checks what a person sees and does: every field`,
      '// found by its label with its input type; the message beside each invalid field after an empty submit; a valid submit POSTs the typed values and shows the',
      '// saved notice; a failed submit shows the error with role="alert". Nothing here touches a real server.',
    ]),
    ...prelude(route, lit, true),
    `const ENDPOINT = ${lit(ctx.endpoint)};`,
    `const SUBMIT = ${lit(labelOf(Name))};`,
    `const SUBMITTED_TEXT = ${lit(ctx.submittedText)};`,
    `const SAVING_TEXT = ${lit(ctx.savingText)};`,
    `const ERROR_TEXT = ${lit(ctx.errorText)};`,
    `const TYPED = ${objectOf(inputs, typedValue, lit)};`,
    '',
    'type Field = { id: string; label: string; type: string; value: string | boolean };',
    'const FIELDS: Field[] = [',
    ...inputs.map((f) => `  ${fieldRow(f, prefix, lit)},`),
    '];',
    '',
    '/** What a person sees: the state of the screen, read off its <main>. Named the way the unit proof names it. */',
    'async function stateOf(page: Page): Promise<string> {',
    '  const html = await mainOf(page);',
    "  if (html.includes('role=\"alert\"')) return 'error';",
    "  if (html.includes('role=\"status\"') && html.includes(SAVING_TEXT)) return 'submitting';",
    "  if (html.includes('role=\"status\"') && html.includes(SUBMITTED_TEXT)) return 'submitted';",
    "  if (html.includes('aria-invalid=\"true\"')) return 'invalid';",
    "  if (html.includes('<form')) return 'editing';",
    "  return 'nothing';",
    '}',
    '',
    ...HELPERS,
    '',
    ...CONTROL_HELPERS,
    '',
    ...OPEN_WRITES,
    '',
    `test(${lit(`${Name} screen: every field with its label and a typed input`)}, async ({ page }) => {`,
    '  await open(page, { status: 201, body: {} });',
    "  await expect.poll(() => stateOf(page)).toBe('editing');",
    '  for (const field of FIELDS) {',
    '    const input = page.getByLabel(field.label, { exact: true });',
    "    await expectVisible(page, 'The field ' + field.id, input, field.label);",
    "    await expect.poll(async () => (await input.first().getAttribute('type')) ?? 'none', { message: 'The input of ' + field.id + ' is not a ' + field.type + ' input.' }).toBe(field.type);",
    '  }',
    '});',
    '',
    ...(checked.length ? [
      `test(${lit(`${Name} screen: a message beside each invalid field`)}, async ({ page }) => {`,
      '  await open(page, { status: 201, body: {} });',
      "  await expect.poll(() => stateOf(page)).toBe('editing');",
      ...pressSubmit,
      "  await expect.poll(() => stateOf(page)).toBe('invalid');",
      ...checked.map((f) => `  await expectMarkup(page, 'The message of ${f.name}', ${lit(`>${messageOf(f)}</span>`)});`),
      '});',
      '',
    ] : []),
    `test(${lit(`${Name} screen: a valid submit posts the typed values and shows the saved notice`)}, async ({ page }) => {`,
    '  let sent: string | null = null;',
    '  await open(page, { status: 201, body: {} }, (body) => { sent = body; });',
    "  await expect.poll(() => stateOf(page)).toBe('editing');",
    '  await fillIn(page, FIELDS);',
    ...pressSubmit,
    "  await expect.poll(() => stateOf(page)).toBe('submitted');",
    "  await expectMarkup(page, 'The saved screen', 'Add another');",
    "  expectState('The request the form sent', plain(JSON.stringify(TYPED)), sent === null ? 'nothing was sent' : plain(sent));",
    '});',
    '',
    `test(${lit(`${Name} screen: a failed submit shows the error, with role alert`)}, async ({ page }) => {`,
    '  await open(page, { status: 500, body: {} });',
    "  await expect.poll(() => stateOf(page)).toBe('editing');",
    '  await fillIn(page, FIELDS);',
    ...pressSubmit,
    "  await expect.poll(() => stateOf(page)).toBe('error');",
    "  await expect(page.getByRole('alert')).toHaveText(ERROR_TEXT);",
    '});',
  ];
  return `${L.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------------- wizard

/**
 * The text of the Playwright flow of a wizard screen: loads the route with the POST endpoint mocked, and walks it like a person: step 1 to the last step with
 * Next (each step shows its progress, its legend, its fields and, on a step with no field of its own, the review of what was typed), Back keeps what was typed,
 * Submit POSTs the typed values and shows the complete screen; Next stays off while a step is invalid; a failed submit stays on the last step with its message.
 *
 * @param {object} ctx The proof context (shape context plus `errorText`; `steps` are the parsed steps).
 * @param {string} route The route of the screen, for example `/signup`.
 * @param {BrowserKit} kit The shared header and helpers.
 * @returns {string} The file text, ending with a newline.
 *
 * @example
 * wizardBrowserText(ctx, '/signup', kit).includes('Next through every step');
 */
export function wizardBrowserText(ctx, route, kit) {
  const { lit } = kit;
  const { names, steps } = ctx;
  const Name = names.Name;
  const inputs = inputFieldsOf(ctx.fields);
  const dealt = dealFields(ctx.fields, steps);
  const prefix = kebab(Name);
  const blockAt = dealt.findIndex((d) => d.fields.some((f) => f.type !== 'boolean'));
  const stepRows = steps.map((s, i) => {
    const review = dealt[i].fields.length ? [] : inputs.map((f) => `<div><dt>${labelOf(f.name)}</dt><dd>${f.type === 'boolean' ? 'Yes' : String(sampleValue(f))}</dd></div>`);
    return `  { name: ${lit(s.name)}, progress: ${lit(`<p aria-live="polite">Step ${i + 1} of ${steps.length}: ${s.label}</p>`)}, legend: ${lit(`<legend>${s.label}</legend>`)}, fields: [${dealt[i].fields.map((f) => fieldRow(f, prefix, lit)).join(', ')}], review: [${review.map((r) => lit(r)).join(', ')}] },`;
  });
  const L = [
    ...kit.header('shape wizard, kind playwright', kit.command),
    ...intro(kit, [
      `// Loads the route of the ${ctx.singular} wizard with POST ${ctx.endpoint} mocked in the browser, and walks it the way a person does: Next from step 1 to the last`,
      '// step (each step shows its progress, its legend and its fields, and a step with none of its own reviews what was typed), Back keeps what was typed, Submit',
      '// POSTs the typed values and shows the complete screen; Next stays off while a step is invalid; a failed submit stays on the last step with role="alert".',
      '// Nothing here touches a real server.',
    ]),
    ...prelude(route, lit, true),
    `const ENDPOINT = ${lit(ctx.endpoint)};`,
    `const COMPLETE_TEXT = ${lit(`${labelOf(Name)} complete.`)};`,
    `const ERROR_TEXT = ${lit(ctx.errorText)};`,
    `const TYPED = ${objectOf(inputs, typedValue, lit)};`,
    '',
    'type Field = { id: string; label: string; type: string; value: string | boolean };',
    'type Step = { name: string; progress: string; legend: string; fields: Field[]; review: string[] };',
    'const STEPS: Step[] = [',
    ...stepRows,
    '];',
    '',
    '/** What a person sees: the step the wizard is on, or sending, complete or an error. Named the way the unit proof names its states. */',
    'async function stateOf(page: Page): Promise<string> {',
    '  const html = await mainOf(page);',
    "  if (html.includes('role=\"status\"') && html.includes(COMPLETE_TEXT)) return 'submitted';",
    "  if (html.includes('role=\"status\"') && html.includes('Sending...')) return 'submitting';",
    "  if (html.includes('role=\"alert\"')) return 'error';",
    "  return STEPS.find((step) => html.includes(step.progress))?.name ?? 'nothing';",
    '}',
    '',
    ...HELPERS,
    '',
    ...CONTROL_HELPERS,
    '',
    ...OPEN_WRITES,
    '',
    '/** Presses a button by its name, once it is on the screen. */',
    'async function press(page: Page, name: string): Promise<void> {',
    "  const button = page.getByRole('button', { name, exact: true });",
    "  await expectVisible(page, 'The ' + name + ' button', button, name);",
    '  await button.click();',
    '}',
    '',
    '/** On step `i`: the screen shows that step (its progress, its legend and, when it has no field, the review of what was typed), then fills its fields. */',
    'async function visit(page: Page, i: number): Promise<void> {',
    '  const step = STEPS[i];',
    '  await expect.poll(() => stateOf(page)).toBe(step.name);',
    "  await expectMarkup(page, 'The step \"' + step.name + '\"', step.progress);",
    "  await expectMarkup(page, 'The step \"' + step.name + '\"', step.legend);",
    "  for (const line of step.review) await expectMarkup(page, 'The review on the step \"' + step.name + '\"', line);",
    '  await fillIn(page, step.fields);',
    '}',
    '',
    '/** Goes from the first step to the last with Next, filling every step. */',
    'async function walk(page: Page): Promise<void> {',
    '  for (let i = 0; i < STEPS.length; i += 1) {',
    '    await visit(page, i);',
    "    if (i < STEPS.length - 1) await press(page, 'Next');",
    '  }',
    '  await expect.poll(() => stateOf(page)).toBe(STEPS[STEPS.length - 1].name);',
    '}',
    '',
    `test(${lit(`${Name} wizard: Next through every step, Back keeps what was typed, then Submit posts the typed values`)}, async ({ page }) => {`,
    '  let sent: string | null = null;',
    '  await open(page, { status: 201, body: {} }, (body) => { sent = body; });',
    '  await walk(page);',
    "  await press(page, 'Back');",
    '  const before = STEPS[STEPS.length - 2];',
    '  await expect.poll(() => stateOf(page)).toBe(before.name);',
    '  for (const field of before.fields) {',
    '    const input = page.getByLabel(field.label, { exact: true });',
    "    const kept = async () => (typeof field.value === 'boolean' ? String(await input.isChecked()) : await input.inputValue());",
    "    await expect.poll(kept, { message: 'The field ' + field.id + ' after Back does not keep what was typed.' }).toBe(String(field.value));",
    '  }',
    "  await press(page, 'Next');",
    '  await expect.poll(() => stateOf(page)).toBe(STEPS[STEPS.length - 1].name);',
    "  await press(page, 'Submit');",
    "  await expect.poll(() => stateOf(page)).toBe('submitted');",
    "  await expectMarkup(page, 'The complete screen', 'Start again');",
    "  expectState('The request the wizard sent', plain(JSON.stringify(TYPED)), sent === null ? 'nothing was sent' : plain(sent));",
    '});',
    '',
    ...(blockAt >= 0 ? [
      `test(${lit(`${Name} wizard: Next stays off while a step is invalid, and goes on once it is filled`)}, async ({ page }) => {`,
      '  await open(page, { status: 201, body: {} });',
      `  const at = ${blockAt};`,
      '  for (let i = 0; i < at; i += 1) {',
      '    await visit(page, i);',
      "    await press(page, 'Next');",
      '  }',
      '  await expect.poll(() => stateOf(page)).toBe(STEPS[at].name);',
      "  const next = page.getByRole('button', { name: 'Next', exact: true });",
      "  const nextState = async () => ((await next.isDisabled()) ? 'disabled' : 'enabled');",
      "  await expectVisible(page, 'The Next button', next, 'Next');",
      "  expectState('Next on the step \"' + STEPS[at].name + '\" with nothing typed', 'disabled', await nextState());",
      '  await fillIn(page, STEPS[at].fields);',
      "  await expect.poll(nextState, { message: 'Next on the step \"' + STEPS[at].name + '\" with its fields filled is still off.' }).toBe('enabled');",
      '});',
      '',
    ] : []),
    `test(${lit(`${Name} wizard: a failed submit stays on the last step, with the error and role alert`)}, async ({ page }) => {`,
    '  await open(page, { status: 500, body: {} });',
    '  await walk(page);',
    "  await press(page, 'Submit');",
    "  await expect.poll(() => stateOf(page)).toBe('error');",
    "  await expect(page.getByRole('alert')).toHaveText(ERROR_TEXT);",
    "  await expectMarkup(page, 'The last step after a failed submit', STEPS[STEPS.length - 1].progress);",
    '});',
  ];
  return `${L.join('\n')}\n`;
}
