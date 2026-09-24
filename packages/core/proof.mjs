// #623 (part of epic #616) -- the proof of a shaped screen: a generated, LOCKED test that shows the screen the shape wrote
// behaves, as a deterministic step of the Requirement chain. A person confirms a plan and gets a screen that works AND the
// evidence that it does, with no model involved.
//
//   construct create proof Products --feature products --entity Product --fields id:string,name:string,price:number
//   construct test proof products          (runs it and classifies the result; packages/engine/proofRunner.mjs)
//
//   proofFiles(root, request)     pure: the file a proof writes, `{ path, content, change }` (absolute path)
//   proofTouches(root, request)   the same as a plan step's `touches.files` (project-relative, no content), plus architecture.yml
//   generateProof(root, request)  write it (and declare the test regions in architecture.yml once), or say why it was skipped
//   detectPlaywright(root)        the Playwright config file of the project, or null
//   proofStatus(entries)          whether the chain is complete: every proof step green or explicitly skipped
//
// Two kinds. `render` needs nothing beyond what a `construct init` project has (react, react-dom, and the esbuild that comes
// with tsx or vite): a node test file that renders the page with react-dom/server, and drives the service with a stubbed fetch.
// `playwright` is written only when the project already has a Playwright config (never installed here): the route of the screen
// with a mocked API. Both are named per READ-004 (`Name.proof.test.ts`, `name--screen.spec.ts`), carry the generated-test marker
// (locked: frozen + nonLayer regions of architecture.yml) and are a pure function of (shape, entity, fields, unit name, feature).
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { matchFrozen } from './frozen.mjs';
import { isNonLayerPath, GENERATED_TESTS_GLOB, TESTS_GLOB } from './nonLayer.mjs';
import { shapeContext } from './shapes.mjs';
import { GENERATED_MARKER, assertSafeDir } from '../engine/testGenerator.mjs';
import { lit, comment } from '../engine/testSpecRender.mjs';

const usage = (message) => new ConstructError(message, { exitCode: EXIT_CODES.USAGE_ERROR });

/** The kinds of proof: `render` (offline, node test) and `playwright` (only when the project has Playwright configured). */
export const PROOF_KINDS = Object.freeze(['render', 'playwright']);

/** The Playwright config file names `detectPlaywright` looks for, at the project root. */
export const PLAYWRIGHT_CONFIGS = Object.freeze(['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs', 'playwright.config.mts', 'playwright.config.cts']);

/** What a project must have for the render proof to run: `esbuild` (it comes with `tsx` and with `vite`), plus react and react-dom. */
export const RENDER_PROOF_NEEDS = Object.freeze(['react', 'react-dom', 'esbuild']);

const FEATURE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Where a feature's generated tests live: `{ genRel, genDir, featureDir }`. Does not need the feature to exist yet (a plan derives touches before `create.feature` ran). */
function generatedDir(root, feature) {
  if (typeof feature !== 'string' || !FEATURE_RE.test(feature)) throw usage(`Invalid feature name ${JSON.stringify(feature ?? '')}: use letters, numbers, "_" and "-" only.`);
  const featuresRoot = loadConfig(root).features?.root || 'features';
  if (path.isAbsolute(featuresRoot) || featuresRoot.split(/[\\/]/).includes('..')) throw usage(`features.root "${featuresRoot}" must be a relative path inside the project.`);
  const genRel = `${featuresRoot}/${feature}/tests/generated`.split('/').filter(Boolean).join('/');
  return { genRel, genDir: path.join(root, genRel), featureDir: path.join(root, featuresRoot, feature) };
}

const rel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');
const slugOf = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

/**
 * The Playwright config file of a project (`playwright.config.ts` and its siblings at the root), or `null`. Read-only; nothing is installed.
 *
 * @param {string} root Project root.
 * @returns {string | null} The config file name, for example `playwright.config.ts`, or `null` when the project has none.
 *
 * @example
 * detectPlaywright(root); // => null in a fresh `construct init` project
 */
export function detectPlaywright(root) {
  return PLAYWRIGHT_CONFIGS.find((f) => fs.existsSync(path.join(root, f))) ?? null;
}

// ---------------------------------------------------------------------------------------------------------- the sample

/** Two sample rows of the entity, from its fields: readable text for strings, 12.5 and 7 for numbers, true and false for booleans. */
function sampleRows(ctx) {
  const words = (text) => String(text).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return [1, 2].map((n) => Object.fromEntries(ctx.fields.map((f) => {
    if (f.type === 'number') return [f.name, f.name === 'id' ? n : n === 1 ? 12.5 : 7];
    if (f.type === 'boolean') return [f.name, n === 1];
    return [f.name, f.name === 'id' ? `${words(ctx.names.Entity).replace(/ /g, '-')}-${n}` : `${ctx.names.Entity} ${words(f.name)} ${n}`];
  })));
}

const literal = (value) => (typeof value === 'string' ? lit(value) : String(value));
const rowLiteral = (row) => `{ ${Object.entries(row).map(([k, v]) => `${k}: ${literal(v)}`).join(', ')} }`;

/** Everything a proof needs, from a shape request: the shape context plus the sample rows and the texts the screen shows. */
function proofContext(root, request) {
  const ctx = shapeContext(root, { shape: request.shape ?? 'list', name: request.name, feature: request.feature, entity: request.entity, fields: request.fields });
  if (!request.feature) throw usage('A proof needs the feature its screen belongs to (--feature).');
  return { ...ctx, rows: sampleRows(ctx), loadingText: `Loading ${ctx.plural}...`, emptyText: `No ${ctx.plural} yet.`, errorText: 'The server answered 500.' };
}

// -------------------------------------------------------------------------------------------------------- the render proof

const header = (ctx, request, command, extra) => [
  GENERATED_MARKER,
  `// Generated by \`${comment(command)}\`. Regenerated by the same command; edits are refused (it is a proof: the screen changes, the proof does not).`,
  `// feature: ${lit(request.feature)}`,
  `// proof: ${lit(ctx.names.Name)} (${extra})`,
];

function renderProofText(ctx, request, relPath) {
  const { names, fields, title, rows } = ctx;
  const Name = names.Name;
  const command = `construct create proof ${Name} --feature ${request.feature} --entity ${names.Entity} --fields ${ctx.request.fields}`;
  const others = fields.filter((f) => f.name !== 'id' && f !== title);
  const shown = (row) => [`<strong>${row[title.name]}</strong>`, ...others.map((f) => `<span>${f.name}: ${row[f.name]}</span>`)];
  const L = [
    ...header(ctx, request, command, `shape ${request.shape ?? 'list'}, kind render`),
    `// run: construct test proof ${comment(request.feature)}   (on its own: npx tsx --test ${comment(relPath)})`,
    '//',
    `// Proves the ${ctx.plural} screen with no browser and no server: its four states from sample props (loading, empty, items with`,
    '// every field value, error with role="alert"), that the controller renders the loading state first, and that the service',
    '// answers a 500, a wrong shape and a network failure with an error result (fetch is stubbed). A failure names the state.',
    '',
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { createElement } from 'react';",
    "import { renderToString } from 'react-dom/server';",
    `import { ${names.controller} } from '../../controllers/${names.controller}.controller';`,
    `import { ${names.page} } from '../../pages/${names.page}.page';`,
    `import { ${names.fetch} } from '../../services/${Name}.service';`,
    `import type { ${names.Entity}, ${names.result}, ${names.state} } from '../../types';`,
    '',
    `const ROWS: ${names.Entity}[] = [`,
    ...rows.map((r) => `  ${rowLiteral(r)},`),
    '];',
    `const LOADING_TEXT = ${lit(ctx.loadingText)};`,
    `const EMPTY_TEXT = ${lit(ctx.emptyText)};`,
    `const ERROR_TEXT = ${lit(ctx.errorText)};`,
    '',
    '/** What a person would see: the state of the screen, read off its markup. */',
    'function stateOf(html: string): string {',
    "  if (html.includes('role=\"alert\"')) return 'error';",
    "  if (html.includes('role=\"status\"') && html.includes(LOADING_TEXT)) return 'loading';",
    "  if (html.includes('role=\"status\"') && html.includes(EMPTY_TEXT)) return 'empty';",
    "  if (html.includes('<li')) return 'items';",
    "  return html.includes('<ul') ? 'blank' : 'nothing';",
    '}',
    '',
    '/** What the service answered, in the same words. */',
    `function resultState(result: ${names.result}): string {`,
    "  if (result.status === 'error') return 'error';",
    "  return result.items.length > 0 ? 'items' : 'empty';",
    '}',
    '',
    '/** Fails with the state that is wrong, in the words the test runner classifies: the Expected and Received lines name states. */',
    'function expectState(what: string, want: string, got: string): void {',
    '  if (got === want) return;',
    "  const message = what + ': the ' + want + ' state is wrong, the screen shows ' + got + '.\\nExpected: \"' + want + '\"\\nReceived: \"' + got + '\"';",
    "  throw new assert.AssertionError({ message, actual: got, expected: want, operator: 'strictEqual' });",
    '}',
    '',
    'function expectShown(what: string, html: string, text: string): void {',
    '  if (html.includes(text)) return;',
    "  const message = what + ' does not show ' + text + '.\\nExpected: \"' + text + '\"\\nReceived: \"not shown\"';",
    "  throw new assert.AssertionError({ message, actual: 'not shown', expected: text, operator: 'includes' });",
    '}',
    '',
    `const render = (state: ${names.state}): string => renderToString(createElement(${names.page}, { state }));`,
    '',
    '/** Runs `check` with fetch answering `answer`, and puts the real fetch back. */',
    'async function withFetch(answer: () => Promise<unknown>, check: () => Promise<void>): Promise<void> {',
    '  const original = globalThis.fetch;',
    '  globalThis.fetch = (async () => answer()) as unknown as typeof fetch;',
    '  try {',
    '    await check();',
    '  } finally {',
    '    globalThis.fetch = original;',
    '  }',
    '}',
    'const respond = (status: number, body: unknown) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });',
    `const ask = () => ${names.fetch}({ signal: new AbortController().signal });`,
    '',
    `test(${lit(`${Name} screen: the loading state`)}, () => {`,
    "  expectState('The page given status loading', 'loading', stateOf(render({ status: 'loading' })));",
    '});',
    '',
    `test(${lit(`${Name} screen: the empty state`)}, () => {`,
    "  expectState('The page given no rows', 'empty', stateOf(render({ status: 'ready', items: [] })));",
    '});',
    '',
    `test(${lit(`${Name} screen: the items, with every field value`)}, () => {`,
    "  const html = render({ status: 'ready', items: ROWS });",
    "  expectState('The page given rows', 'items', stateOf(html));",
    '  const shown: string[][] = [',
    ...rows.map((r) => `    [${shown(r).map((s) => lit(s)).join(', ')}],`),
    '  ];',
    "  shown.forEach((parts, i) => parts.forEach((part) => expectShown('Row ' + (i + 1), html, part)));",
    '});',
    '',
    `test(${lit(`${Name} screen: the error state, with role alert`)}, () => {`,
    "  const html = render({ status: 'error', message: ERROR_TEXT });",
    "  expectState('The page given an error', 'error', stateOf(html));",
    "  expectShown('The error', html, ERROR_TEXT);",
    '});',
    '',
    `test(${lit(`${Name} controller: renders the loading state first`)}, () => {`,
    `  const html = renderToString(createElement(${names.controller}, {}));`,
    "  expectState('The controller on its first render', 'loading', stateOf(html));",
    "  assert.equal(html, render({ status: 'loading' }), 'the controller hands the hook state to the page and adds nothing');",
    '});',
    '',
    `test(${lit(`${Name} service: a good answer is the rows`)}, async () => {`,
    '  await withFetch(respond(200, ROWS), async () => {',
    "    expectState('The service given a list', 'items', resultState(await ask()));",
    '  });',
    '});',
    '',
    `test(${lit(`${Name} service: a 500 is an error result`)}, async () => {`,
    '  await withFetch(respond(500, []), async () => {',
    "    expectState('The service given a 500', 'error', resultState(await ask()));",
    '  });',
    '});',
    '',
    `test(${lit(`${Name} service: a wrong shape is an error result`)}, async () => {`,
    "  await withFetch(respond(200, { not: 'a list' }), async () => {",
    "    expectState('The service given something that is not a list', 'error', resultState(await ask()));",
    '  });',
    `  const wrong = { ...ROWS[0], ${title.name}: ${title.type === 'string' ? '12345' : "'wrong'"} };`,
    '  await withFetch(respond(200, [wrong]), async () => {',
    "    expectState('The service given a row of the wrong shape', 'error', resultState(await ask()));",
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
    '  globalThis.fetch = (async (_url: unknown, init?: { signal?: unknown }) => { seen = init?.signal; return respond(200, [])(); }) as unknown as typeof fetch;',
    '  try {',
    `    await ${names.fetch}({ signal: controller.signal });`,
    '  } finally {',
    '    globalThis.fetch = original;',
    '  }',
    "  assert.equal(seen, controller.signal, 'the service forwards the AbortSignal, so leaving the screen cancels the request');",
    '});',
  ];
  return `${L.join('\n')}\n`;
}

// ------------------------------------------------------------------------------------------------------ the Playwright proof

function playwrightProofText(ctx, request, route) {
  const { names, rows } = ctx;
  const Name = names.Name;
  const command = `construct create proof ${Name} --feature ${request.feature} --kind playwright --entity ${names.Entity} --fields ${ctx.request.fields}`;
  const L = [
    ...header(ctx, request, command, `shape ${request.shape ?? 'list'}, kind playwright`),
    `// run: construct test run ${comment(request.feature)} --area generated --name ${slugOf(Name)}--screen.spec.ts   (the app must be running)`,
    '//',
    `// Loads the route of the ${ctx.plural} screen with ${ctx.endpoint} mocked in the browser, and checks what a person sees:`,
    '// loading, then the list; the empty state; the error state with role="alert". Nothing here touches a real server.',
    '',
    "import { test, expect } from '@playwright/test';",
    "import type { Page } from '@playwright/test';",
    '',
    `const START_URL: string | null = ${lit(route)};`,
    'const ROWS = [',
    ...rows.map((r) => `  ${rowLiteral(r)},`),
    '];',
    `const LOADING_TEXT = ${lit(ctx.loadingText)};`,
    `const EMPTY_TEXT = ${lit(ctx.emptyText)};`,
    `const ERROR_TEXT = ${lit(ctx.errorText)};`,
    '',
    '/** What a person sees: the state of the screen, read off its <main>. Named the way the unit proof names it. */',
    'async function stateOf(page: Page): Promise<string> {',
    "  const html = await page.locator('main').first().innerHTML({ timeout: 1_000 }).catch(() => '');",
    "  if (html.includes('role=\"alert\"')) return 'error';",
    "  if (html.includes('role=\"status\"') && html.includes(LOADING_TEXT)) return 'loading';",
    "  if (html.includes('role=\"status\"') && html.includes(EMPTY_TEXT)) return 'empty';",
    "  if (html.includes('<li')) return 'items';",
    "  return html.includes('<ul') ? 'blank' : 'nothing';",
    '}',
    '',
    'async function open(page: Page, answer: { status: number; body: unknown }, gate?: Promise<void>): Promise<void> {',
    `  await page.route(${lit(`**${ctx.endpoint}`)}, async (route) => {`,
    '    if (gate) await gate;',
    "    await route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) });",
    '  });',
    '  if (START_URL === null) return;',
    '  await page.goto(START_URL);',
    '}',
    '',
    `test(${lit(`${Name} screen: loading, then the list`)}, async ({ page }) => {`,
    '  let release: () => void = () => {};',
    '  const gate = new Promise<void>((resolve) => { release = resolve; });',
    '  await open(page, { status: 200, body: ROWS }, gate);',
    "  await expect.poll(() => stateOf(page)).toBe('loading');",
    '  release();',
    "  await expect.poll(() => stateOf(page)).toBe('items');",
    ...rows.map((r) => `  await expect(page.getByText(${lit(String(r[ctx.title.name]))})).toBeVisible();`),
    '});',
    '',
    `test(${lit(`${Name} screen: the empty state`)}, async ({ page }) => {`,
    '  await open(page, { status: 200, body: [] });',
    "  await expect.poll(() => stateOf(page)).toBe('empty');",
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

// ------------------------------------------------------------------------------------------------------------------ files

/**
 * The file a proof writes, without touching the disk: `{ path (absolute), content, change: 'create', kind }`. The render proof is
 * `features/<feature>/tests/generated/<Name>Screen.proof.test.ts`; the Playwright proof is `<name>--screen.spec.ts` in the same
 * directory, and only exists when the project has a Playwright config (otherwise the list is empty).
 *
 * @param {string} root Project root.
 * @param {{ name: string, feature: string, kind?: 'render'|'playwright', shape?: string, entity?: string, fields?: string, route?: string }} request The unit name (`Products`), the feature, the kind (default `render`) and the shape's entity and fields.
 * @returns {{ path: string, content: string, change: 'create', kind: string }[]} The files, in write order.
 * @throws {Error} A usage error for an unknown kind, a bad name, entity or field list, or a feature that does not exist.
 *
 * @example
 * proofFiles(root, { name: 'Products', feature: 'shop' }).map((f) => path.basename(f.path)); // => ['ProductsScreen.proof.test.ts']
 */
export function proofFiles(root, request) {
  const kind = request?.kind ?? 'render';
  if (!PROOF_KINDS.includes(kind)) throw usage(`Unknown proof kind "${kind}". The kinds are: ${PROOF_KINDS.join(', ')}.`);
  const ctx = proofContext(root, request);
  const { genDir } = generatedDir(root, request.feature);
  if (kind === 'render') {
    const file = path.join(genDir, `${ctx.names.Name}Screen.proof.test.ts`);
    return [{ path: file, content: renderProofText(ctx, request, rel(root, file)), change: 'create', kind }];
  }
  if (!detectPlaywright(root)) return [];
  const file = path.join(genDir, `${slugOf(ctx.names.Name)}--screen.spec.ts`);
  return [{ path: file, content: playwrightProofText(ctx, request, request.route ?? '/'), change: 'create', kind }];
}

/**
 * The files a proof step will write, as its `touches.files`: project-relative POSIX paths with the change kind. The step also
 * declares `architecture.yml` (`modify`), because it adds the test regions (`frozen:` and `nonLayer:`) the first time. Read-only
 * and never throws: a request that does not name a valid proof yet answers `null`.
 *
 * @param {string} root Project root.
 * @param {{ name: string, feature: string, kind?: 'render'|'playwright', shape?: string, entity?: string, fields?: string }} request The step's arguments.
 * @returns {{ path: string, change: 'create'|'modify' }[] | null} The files, or `null`.
 *
 * @example
 * proofTouches(root, { name: 'Products', feature: 'shop' }).map((f) => `${f.change} ${f.path}`);
 * // => ['create features/shop/tests/generated/ProductsScreen.proof.test.ts', 'modify architecture.yml']
 */
export function proofTouches(root, request) {
  try {
    const files = proofFiles(root, request).map((f) => ({ path: rel(root, f.path), change: f.change }));
    return files.length ? [...files, { path: 'architecture.yml', change: 'modify' }] : [];
  } catch {
    return null;
  }
}

const REGION_BLOCKS = Object.freeze({ frozen: GENERATED_TESTS_GLOB, nonLayer: TESTS_GLOB });

/** Declare the generated-test regions in architecture.yml when it has neither key: returns the keys it added. A half-declared project is refused (nothing is rewritten). */
function ensureTestRegions(root, genDir) {
  const config = loadConfig(root);
  const probe = path.join(genDir, 'probe--x.spec.ts');
  const missing = [];
  if (!matchFrozen(root, probe, config.frozen || [])) missing.push('frozen');
  if (!isNonLayerPath(root, probe, config.nonLayer || [])) missing.push('nonLayer');
  if (!missing.length) return [];
  const file = path.join(root, 'architecture.yml');
  if (!fs.existsSync(file)) throw usage('There is no architecture.yml here: this is not a Construct project (run `construct init`).');
  const text = fs.readFileSync(file, 'utf8');
  const present = missing.filter((key) => new RegExp(`^${key}:`, 'm').test(text));
  if (present.length) throw usage(`architecture.yml already has ${present.join(' and ')} but not the test region. Add ${present.map((k) => `"${REGION_BLOCKS[k]}" to ${k}:`).join(' and ')} by hand, then run this again. Nothing was written.`);
  fs.writeFileSync(file, `${text.replace(/\n*$/, '\n')}\n${missing.map((key) => `${key}:\n  - ${REGION_BLOCKS[key]}`).join('\n')}\n`);
  return missing;
}

/**
 * Write a proof into the project. Refuses to overwrite a file that is not a marker-bearing generated file, declares the
 * generated-test regions in architecture.yml once (`frozen:` locks the proof, `nonLayer:` keeps it out of the layer graph), and
 * for the Playwright kind writes nothing when the project has no Playwright config, saying so (`skipped`) instead of installing it.
 * Deterministic: the same request writes the same bytes.
 *
 * @param {string} root Project root.
 * @param {{ name: string, feature: string, kind?: 'render'|'playwright', shape?: string, entity?: string, fields?: string, route?: string }} request What to generate.
 * @returns {{ kind: string, files: string[], regions: string[], skipped: string | null, needs: string[] }} The absolute paths written, the architecture.yml keys added, why nothing was written (or `null`), and what the project needs to run it.
 * @throws {Error} A usage error for a bad request, a missing feature, a file that is not a generated proof, or half-declared test regions.
 *
 * @example
 * generateProof(root, { name: 'Products', feature: 'shop', entity: 'Product', fields: 'id:string,name:string' });
 */
export function generateProof(root, request) {
  const kind = request?.kind ?? 'render';
  const files = proofFiles(root, request);
  if (!files.length) {
    return { kind, files: [], regions: [], skipped: 'Playwright is not configured in this project (no playwright.config.* at the root), so no Playwright flow was written and nothing was installed. The render proof still proves the screen; add Playwright and run this again for the browser flow.', needs: [] };
  }
  const { genRel, genDir, featureDir } = generatedDir(root, request.feature);
  if (!fs.existsSync(featureDir) || !fs.statSync(featureDir).isDirectory()) throw usage(`Feature "${request.feature}" not found (looked in ${path.relative(root, featureDir)}). Create it first: construct create feature ${request.feature}`);
  assertSafeDir(root, genRel);
  for (const f of files) {
    let st = null;
    try { st = fs.lstatSync(f.path); } catch { /* new file */ }
    if (!st) continue;
    if (st.isSymbolicLink() || !st.isFile()) throw usage(`Refusing to overwrite ${rel(root, f.path)}: it is not a regular file.`);
    if (!fs.readFileSync(f.path, 'utf8').startsWith(`${GENERATED_MARKER}\n`)) throw usage(`Refusing to overwrite ${rel(root, f.path)}: it is not a generated proof (no ${JSON.stringify(GENERATED_MARKER)} marker).`);
  }
  const regions = ensureTestRegions(root, genDir);
  fs.mkdirSync(genDir, { recursive: true });
  assertSafeDir(root, genRel);
  for (const f of files) fs.writeFileSync(f.path, f.content);
  return { kind, files: files.map((f) => f.path), regions, skipped: null, needs: kind === 'render' ? [...RENDER_PROOF_NEEDS] : ['@playwright/test'] };
}

// --------------------------------------------------------------------------------------------------------------- the chain

/**
 * Whether the chain of a screen is complete: every proof step is green or was explicitly skipped. Pure. An entry is
 * `{ id, result }` where `result` is what the verification step answered (`runProofs` for the render proof, `runFeatureTests`
 * for the Playwright flow: `{ ok, counts: { failed } }`), `{ skipped: 'why' }` for a step a person skipped on purpose, or
 * `undefined` for a step that has not run yet.
 *
 * @param {{ id: string, result?: { ok?: boolean, skipped?: string, counts?: { total?: number, failed?: number }, error?: { code?: string, message?: string } } }[]} entries The proof steps of the chain and what each answered.
 * @returns {{ complete: boolean, state: 'pending'|'failed'|'green'|'skipped', steps: { id: string, state: 'pending'|'failed'|'green'|'skipped', summary: string }[] }} The chain state: `complete` is true only for `green` and `skipped`.
 *
 * @example
 * proofStatus([{ id: 's9', result: { ok: true, counts: { total: 10, failed: 0 } } }]).complete; // => true
 */
export function proofStatus(entries) {
  const steps = (Array.isArray(entries) ? entries : []).map(({ id, result }) => {
    if (result === undefined || result === null) return { id, state: 'pending', summary: 'Not run yet.' };
    if (typeof result.skipped === 'string') return { id, state: 'skipped', summary: `Skipped on purpose: ${result.skipped}` };
    if (result.ok === false) return { id, state: 'failed', summary: result.error?.message ?? 'The proof could not run.' };
    const failed = result.counts?.failed ?? 0;
    const total = result.counts?.total ?? 0;
    if (failed > 0) return { id, state: 'failed', summary: `${failed} of ${total} failed.` };
    if (total === 0) return { id, state: 'failed', summary: 'The run found no test, so it proves nothing.' };
    return { id, state: 'green', summary: `${total} passed.` };
  });
  const has = (state) => steps.some((s) => s.state === state);
  const state = !steps.length || has('pending') ? 'pending' : has('failed') ? 'failed' : steps.every((s) => s.state === 'skipped') ? 'skipped' : 'green';
  return { complete: state === 'green' || state === 'skipped', state, steps };
}

/** The most failures and the longest text a proof summary carries: it is a fixed size, whoever reads it. */
export const PROOF_SUMMARY_LIMITS = Object.freeze({ failures: 5, text: 160 });

const OPTIONS = Object.freeze({
  run: { id: 'run-proof', label: 'Run the proof', why: 'Nothing has shown the screen behaves yet.' },
  edit: { id: 'edit-code', label: 'View/edit code', why: 'Open the unit whose state is wrong and change it by hand.' },
  ai: { id: 'fill-with-ai', label: 'Fill with AI', why: 'A model proposes the fix as a reviewable diff; the proof stays as it is.' },
  regenerate: { id: 'regenerate-screen', label: 'Regenerate the screen', why: 'The files the proof binds to are gone: write them again from the shape.' },
  skip: { id: 'skip-proof', label: 'Skip the proof', why: 'Complete the chain without it, on purpose; the skip is recorded.' },
});

/**
 * The fixed-size summary of a proof run (BLOCK-CONTRACT.md, "AI-ready by design"): the state of the chain, the counts, at most
 * five failures with their kind and the state that is wrong, and a closed list of stable option ids (2 to 5, never free text) for
 * a person, an LLM or a decision model to choose from. No paths, no secrets. Pure.
 *
 * @param {{ chain?: { state?: string }, counts?: { total?: number, passed?: number, failed?: number }, tests?: { title: string, status: string, failure?: { kind?: string, expected?: string, reached?: string, summary?: string, message?: string } }[] } | null} [run] A `runProofs` result, or nothing when the proof has not run.
 * @returns {{ version: string, state: string, complete: boolean, counts: { total: number, passed: number, failed: number }, failures: { test: string, kind: string, expected: string | null, reached: string | null, summary: string }[], options: { id: string, label: string, why: string }[] }} The summary.
 *
 * @example
 * proofSummary(null).options.map((o) => o.id); // => ['run-proof', 'skip-proof']
 */
export function proofSummary(run) {
  const cap = (text) => String(text ?? '').split('\n')[0].slice(0, PROOF_SUMMARY_LIMITS.text);
  const failed = (run?.tests ?? []).filter((t) => t.status === 'failed');
  const failures = failed.slice(0, PROOF_SUMMARY_LIMITS.failures).map((t) => ({ test: cap(t.title), kind: t.failure?.kind ?? 'other', expected: t.failure?.expected ?? null, reached: t.failure?.reached ?? null, summary: cap(t.failure?.summary ?? t.failure?.message ?? '') }));
  const state = run?.chain?.state ?? 'pending';
  const kinds = new Set(failed.map((t) => t.failure?.kind ?? 'other'));
  const options = state === 'green' || state === 'skipped' ? []
    : state === 'pending' ? [OPTIONS.run, OPTIONS.skip]
      : kinds.has('app') ? [OPTIONS.edit, OPTIONS.ai, OPTIONS.skip]
        : kinds.has('convention') ? [OPTIONS.regenerate, OPTIONS.edit, OPTIONS.skip]
          : [OPTIONS.edit, OPTIONS.skip];
  return { version: 'proof-summary.v1', state, complete: state === 'green' || state === 'skipped', counts: { total: run?.counts?.total ?? 0, passed: run?.counts?.passed ?? 0, failed: run?.counts?.failed ?? 0 }, failures, options: options.map((o) => ({ ...o })) };
}
