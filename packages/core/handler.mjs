// #625 (part of epic #616) -- the Next.js route handler: `app/api/<x>/route.ts` as a deterministic block, so serving the endpoint a screen calls is an option, not a manual task. No model:
// fixed templates, the same request writes the same bytes, and running it twice changes nothing. (The other half of #625, adding a dependency, is `add.dependency`, #654.)
//
//   construct create handler Products --feature shop --method GET --path /api/products [--service Products] [--entity Product] [--fields id:string,name:string]
//
//   handlerArgIssue(args)             first reason a `create.handler` request is invalid (pure; plan.mjs uses it), or null
//   handlerContext(root, request)     the names, the files and the service of a request (throws a usage error for a bad one, and for a project that is not Next.js)
//   handlerFiles(root, request)       pure: the files the handler writes, `{ path, content, layer }` (absolute paths)
//   handlerTouches(root, request)     the same as a plan step's `touches.files`, plus `types.ts` and the barrel it updates and its proof (`null` for a request it cannot serve)
//   generateHandler(root, request)    write it; idempotent; refuses, with the reason, and writes nothing
//   handlerOffer(root, request)       the closed question `q-handler` (add-handler | skip) for the endpoint a shaped screen calls
//
// What it writes (Next.js App Router only: a react-spa project has no server, so the flow refuses and says a handler needs a Next.js project):
//   app/api/<x>/route.ts                 imports the service and the domain unit and NOTHING else: the exported method function hands the request to the service and answers
//                                        with the status its typed result maps to; every other method (of GET, POST, PUT, DELETE) answers 405 with an Allow header, as typed
//                                        JSON. No `if`, no environment variable, no secret: whatever needs one reads it in the SERVICE.
//   domain/<Name>Api.domain.ts           toHttp<Name>({ result }) -> { status, body, headers }, pure: ready 200, invalid 400, not-allowed 405, error 500
//   services/<Name>Api.service.ts        only when no --service is named: a typed in-memory service for the method (GET lists rows, POST adds one, PUT replaces one by id, DELETE
//                                        removes one by ?id=), starting empty; it is where a database or another server would be called. With --service <Name> the handler
//                                        delegates to that service's first `defineService` unit, called with `{ input }` (the parsed JSON body; for DELETE the `id` query) and answering an
//                                        `ApiResult<unknown>`: the type-check names the line when it does not.
//   types.ts                             `ApiResult<Body>` and `ApiReply` (and the entity for a generated service), appended once
//   tests/generated/<Name>Api.proof.test.ts  locked: the status of every typed result, 405 with the Allow header for every other method and, for a generated service, a good and a bad request
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { pascalCase, selfCheck } from './generators.mjs';
import { write } from './fs.mjs';
import { syncPublicApi } from './api-composer.mjs';
import { assertFeature, entityFieldsIn, featureDirOf, withDeclarations, writeOwned } from './block-kit.mjs';
import { HANDLER_METHODS, HANDLER_PATH_RE, handlerArgIssue } from './block-args.mjs';
import { EXPECT_LINES, blockProofTouches, proofHeader, writeBlockProof } from './block-proof.mjs';
import { generatedDir } from './proof.mjs';
import { FIELD_TYPES, importLine, kebab, lines, sampleRows, words } from './shape-kit.mjs';
import { DEFAULT_FIELDS, parseFields, singularOf } from './shapes.mjs';
import { lit } from '../engine/testSpecRender.mjs';

const usage = (message) => new ConstructError(message, { exitCode: EXIT_CODES.USAGE_ERROR });
const rel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');

export { HANDLER_METHODS, handlerArgIssue };

/** The id of the closed question about the handler of a screen's endpoint (chooser summary shape, like `q-route`); several screens get `q-handler-<kebab-name>`. */
export const HANDLER_QUESTION_ID = 'q-handler';

/** The shapes whose endpoint a generated handler can serve, and the method each calls: a list reads its collection, a form and a wizard post to it. */
export const HANDLER_SHAPE_METHODS = Object.freeze({ list: 'GET', form: 'POST', wizard: 'POST' });

const frameworkOf = (root) => loadConfig(root).project?.framework ?? 'nextjs';
const routeRoot = (root) => {
  const pattern = loadConfig(root).layers?.route?.pattern ?? 'app/**/page.tsx';
  return pattern.split('/**')[0];
};

/** The reason a project cannot have a route handler, or `null`: a handler is a Next.js App Router file, so a react-spa project (no server) is refused with a sentence that says so. */
function frameworkIssue(root) {
  const framework = frameworkOf(root);
  return framework === 'nextjs' ? null : `A route handler needs a Next.js project: this project is ${framework}, which has no server of its own to answer /api requests. Run the service behind your own API, or use a Next.js project.`;
}

/**
 * The service a handler delegates to, when `--service` names one: its file and the first `defineService` unit it exports. Refuses, with the reason, a service that is not there or has no unit.
 *
 * @param {string} root Project root.
 * @param {string} feature The feature the handler belongs to.
 * @param {string} service The service's unit name (`Products` is `services/Products.service.ts`).
 * @returns {{ file: string, ident: string }} The absolute file and the exported name.
 * @throws {Error} A usage error when the file is missing or exports no `defineService` unit.
 *
 * @example
 * serviceUnitOf(root, 'shop', 'Products').ident; // => 'fetchProducts'
 */
export function serviceUnitOf(root, feature, service) {
  const dir = path.join(featureDirOf(root, feature), 'services');
  const found = [`${service}.service.ts`, `${service}.ts`].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  if (!found) throw usage(`The service ${service} does not exist in feature "${feature}" (looked for ${rel(root, path.join(dir, `${service}.service.ts`))}). Create it first, or leave --service out and the handler gets a typed in-memory service.`);
  const ident = /export\s+const\s+([A-Za-z_]\w*)\s*=\s*defineService\b/.exec(fs.readFileSync(found, 'utf8'))?.[1];
  if (!ident) throw usage(`${rel(root, found)} exports no unit built with defineService(...), so the handler has nothing to delegate to.`);
  return { file: found, ident };
}

/**
 * Everything a handler's templates need, worked out from a request: the names, the route file, the entity and fields of a generated service, and the service it delegates to. Throws a
 * usage error for a bad request, a project that is not Next.js, or a service that cannot be used, before anything is written.
 *
 * @param {string} root Project root.
 * @param {{ name: string, feature: string, method: string, path: string, service?: string, entity?: string, fields?: string }} request The handler.
 * @returns {object} The resolved context.
 * @throws {Error} A usage error naming the problem.
 *
 * @example
 * handlerContext(root, { name: 'Products', feature: 'shop', method: 'GET', path: '/api/products' }).routeFile; // => 'app/api/products/route.ts'
 */
export function handlerContext(root, request) {
  const issue = handlerArgIssue(request);
  if (issue) throw usage(issue.message);
  const refusal = frameworkIssue(root);
  if (refusal) throw usage(refusal);
  const Name = pascalCase(request.name, 'Handler');
  const dir = featureDirOf(root, request.feature);
  const routeAbs = path.join(root, routeRoot(root), ...request.path.split('/').filter(Boolean), 'route.ts');
  const own = request.service === undefined;
  const entity = request.entity ?? singularOf(Name);
  const fields = parseFields(request.fields ?? DEFAULT_FIELDS);
  if (fields.find((f) => f.name === 'id').type === 'boolean') throw usage('The "id" field must be a string or a number.');
  const unit = own ? null : serviceUnitOf(root, request.feature, request.service);
  const names = { Name, http: `to${Name}Http`, domainBase: `${Name}Api`, serve: own ? `serve${Name}` : unit.ident };
  return {
    Name, names, method: request.method, path: request.path, own, entity, fields, unit, dir, routeAbs, routeFile: rel(root, routeAbs), label: words(Name).join(' ').toLowerCase(),
    servicePath: own ? path.join(dir, 'services', `${names.Name}Api.service`) : unit.file.replace(/\.tsx?$/, ''), domainPath: path.join(dir, 'domain', `${names.domainBase}.domain`),
  };
}

// -------------------------------------------------------------------------------------------------------------- templates

const RESULT_TYPE = {
  declares: 'ApiResult',
  marker: "'not-allowed'",
  text: lines('/** What a service answers to an API handler: the body of a good answer, a request it refused, a method the route does not answer or a failure. The handler maps it to 200, 400, 405 or 500. */', 'export type ApiResult<Body> =', "  | { status: 'ready'; body: Body }", "  | { status: 'invalid'; message: string }", "  | { status: 'not-allowed'; allow: string[] }", "  | { status: 'error'; message: string };"),
};
const REPLY_TYPE = {
  declares: 'ApiReply',
  marker: 'headers: Record<string, string>',
  text: lines('/** The HTTP reply of a typed result: a status code, a JSON body and the headers to send. */', 'export interface ApiReply {', '  status: number;', '  body: unknown;', '  headers: Record<string, string>;', '}'),
};

function typeBlocks(ctx) {
  const E = ctx.entity;
  const entity = { declares: E, text: lines(`/** One ${words(E).join(' ').toLowerCase()}, as the ${ctx.label} handler's service holds it. */`, `export interface ${E} {`, ctx.fields.map((f) => `  ${f.name}: ${FIELD_TYPES[f.type]};`), '}') };
  return ctx.own ? [RESULT_TYPE, REPLY_TYPE, entity] : [RESULT_TYPE, REPLY_TYPE];
}

function domainText(ctx) {
  const { names, label } = ctx;
  return lines(
    importLine('defineDomain'), "import type { ApiReply, ApiResult } from '../types';", '',
    `/** Maps what the ${label} service answered to the HTTP reply: ready is 200, invalid is 400, not-allowed is 405 with an Allow header, an error is 500. Pure: the status is decided here, from the typed result, never in the route. */`,
    `export const ${names.http} = defineDomain<{ result: ApiResult<unknown> }, ApiReply>('${names.http}', ({ result }): ApiReply => {`,
    '  switch (result.status) {',
    "    case 'ready':", "      return { status: 200, body: result.body, headers: {} };",
    "    case 'invalid':", "      return { status: 400, body: { error: result.message }, headers: {} };",
    "    case 'not-allowed':", "      return { status: 405, body: { error: 'Use ' + result.allow.join(', ') + '.' }, headers: { Allow: result.allow.join(', ') } };",
    "    case 'error':", "      return { status: 500, body: { error: result.message }, headers: {} };",
    '  }', '});',
  );
}

/** The body of the generated in-memory service for a method, as TypeScript lines. */
function serviceBody(ctx) {
  const { entity: E, fields, method } = ctx;
  const idNumber = fields.find((f) => f.name === 'id').type === 'number';
  const inputFields = fields.filter((f) => f.name !== 'id');
  const check = (list) => list.map((f) => `typeof row.${f.name} === '${f.type}'`).join(' && ') || 'true';
  const noun = words(E).join(' ').toLowerCase();
  const a = /^[aeiou]/.test(noun) ? 'an' : 'a';
  const nextId = idNumber ? 'rows.length + 1' : `\`${kebab(E)}-\${rows.length + 1}\``;
  const helper = {
    POST: [`function isNew${E}(value: unknown): value is Omit<${E}, 'id'> {`, "  if (typeof value !== 'object' || value === null) return false;", '  const row = value as Record<string, unknown>;', `  return ${check(inputFields)};`, '}', ''],
    PUT: [`function is${E}(value: unknown): value is ${E} {`, "  if (typeof value !== 'object' || value === null) return false;", '  const row = value as Record<string, unknown>;', `  return ${check(fields)};`, '}', ''],
  }[method] ?? [];
  const run = {
    GET: ["  return { status: 'ready', body: [...rows] };"],
    POST: [`  if (!isNew${E}(input)) return { status: 'invalid', message: 'The body must be ${a} ${noun} without its id, as JSON.' };`, `  const row: ${E} = { id: ${nextId}, ...input };`, '  rows.push(row);', "  return { status: 'ready', body: row };"],
    PUT: [`  if (!is${E}(input)) return { status: 'invalid', message: 'The body must be ${a} ${noun} with its id, as JSON.' };`, '  const at = rows.findIndex((row) => row.id === input.id);', `  if (at < 0) return { status: 'invalid', message: 'There is no ${noun} with that id.' };`, '  rows[at] = input;', "  return { status: 'ready', body: input };"],
    DELETE: [`  if (typeof input !== 'string') return { status: 'invalid', message: 'Say which ${noun} to delete: ?id=<id>.' };`, '  const at = rows.findIndex((row) => String(row.id) === input);', `  if (at < 0) return { status: 'invalid', message: 'There is no ${noun} with that id.' };`, '  rows.splice(at, 1);', "  return { status: 'ready', body: { deleted: input } };"],
  }[method];
  return { helper, run };
}

function serviceText(ctx) {
  const { names, entity: E, method, label } = ctx;
  const { helper, run } = serviceBody(ctx);
  return lines(
    importLine('defineService'), `import type { ApiResult, ${E} } from '../types';`, '', helper,
    `const rows: ${E}[] = [];`, '',
    `/** The ${label} service behind ${method} ${ctx.path}: the rows are kept in memory and start empty, and it answers a typed result, never a throw. It is where a database or another server would be called: environment variables and secrets are read here, never in the route. */`,
    `export const ${names.serve} = defineService('${names.serve}', async ({ input }: { input: unknown }): Promise<ApiResult<unknown>> => {`, run, '});',
  );
}

/** The import specifier from a file to a feature file (no extension), relative. */
const specFrom = (fromFile, target) => {
  const spec = path.relative(path.dirname(fromFile), target).split(path.sep).join('/');
  return spec.startsWith('.') ? spec : `./${spec}`;
};

function routeText(ctx) {
  const { names, method, label } = ctx;
  const dir = ctx.dir;
  const typesSpec = specFrom(ctx.routeAbs, path.join(dir, 'types'));
  const ask = { GET: '', POST: 'request', PUT: 'request', DELETE: 'request' }[method];
  const input = {
    GET: '  return respond(await ' + names.serve + '({ input: undefined }));',
    POST: ['  const input: unknown = await request.json().catch(() => undefined);', `  return respond(await ${names.serve}({ input }));`],
    PUT: ['  const input: unknown = await request.json().catch(() => undefined);', `  return respond(await ${names.serve}({ input }));`],
    DELETE: ["  const input: unknown = new URL(request.url).searchParams.get('id') ?? undefined;", `  return respond(await ${names.serve}({ input }));`],
  }[method];
  const others = HANDLER_METHODS.filter((m) => m !== method);
  return lines(
    `import { ${names.http} } from '${specFrom(ctx.routeAbs, ctx.domainPath)}';`, `import { ${names.serve} } from '${specFrom(ctx.routeAbs, ctx.servicePath)}';`, `import type { ApiResult } from '${typesSpec}';`, '',
    "/** The response for what the service answered: the status is decided by the domain unit from the typed result, never here. */",
    'function respond(result: ApiResult<unknown>): Response {', `  const reply = ${names.http}({ result });`,
    "  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json', ...reply.headers } });", '}', '',
    `/** ${method} ${ctx.path}: hands the request to the ${label} service and answers with the status of its typed result. */`,
    `export async function ${method}(${ask ? 'request: Request' : ''}): Promise<Response> {`, input, '}',
    others.flatMap((m) => ['', `/** ${m} is not answered here: 405, with the method that is, as typed JSON. */`, `export function ${m}(): Response {`, `  return respond({ status: 'not-allowed', allow: ['${method}'] });`, '}']),
  );
}

// ------------------------------------------------------------------------------------------------------------------ files

/**
 * The files a handler writes, without touching the disk: `{ path (absolute), content, layer }`: the route, the domain unit and, when no `--service` is named, the in-memory service.
 * Throws a usage error for an invalid request, a project that is not Next.js, or a service that cannot be used.
 *
 * @param {string} root Project root.
 * @param {{ name: string, feature: string, method: string, path: string, service?: string, entity?: string, fields?: string }} request The handler.
 * @returns {{ path: string, content: string, layer: string }[]} The files, in write order.
 * @throws {Error} A usage error naming the problem.
 *
 * @example
 * handlerFiles(root, { name: 'Products', feature: 'shop', method: 'GET', path: '/api/products' }).map((f) => path.basename(f.path)); // => ['ProductsApi.domain.ts', 'ProductsApi.service.ts', 'route.ts']
 */
export function handlerFiles(root, request) {
  const ctx = handlerContext(root, request);
  return [
    { path: `${ctx.domainPath}.ts`, content: domainText(ctx), layer: 'domain' },
    ...(ctx.own ? [{ path: `${ctx.servicePath}.ts`, content: serviceText(ctx), layer: 'service' }] : []),
    { path: ctx.routeAbs, content: routeText(ctx), layer: 'route' },
  ];
}

/**
 * The file name of the proof of a handler: `<Name>Api.proof.test.ts`, which `construct test proof <feature>` and a plan's `test.proof` step run.
 *
 * @param {string} name The handler name, PascalCase.
 * @returns {string} The proof's file name.
 *
 * @example
 * handlerProofName('Products'); // => 'ProductsApi.proof.test.ts'
 */
export function handlerProofName(name) {
  return `${name}Api.proof.test.ts`;
}

/**
 * The files a `create.handler` step declares as its `touches.files`: the route, the domain unit and the service (`create`), the feature's `types.ts` and barrel (`modify`), the proof (`create`)
 * and `architecture.yml` (`modify`, the test regions). Read-only and never throws: an invalid request, a project that is not Next.js or a service that cannot be used answers `null`.
 *
 * @param {string} root Project root.
 * @param {{ name: string, feature: string, method: string, path: string, service?: string, entity?: string, fields?: string }} request The step's arguments.
 * @returns {{ path: string, change: 'create'|'modify', layer?: string }[] | null} The files, or `null`.
 *
 * @example
 * handlerTouches(root, { name: 'Products', feature: 'shop', method: 'GET', path: '/api/products' }).map((f) => f.path)[0]; // => 'features/shop/domain/ProductsApi.domain.ts'
 */
export function handlerTouches(root, request) {
  try {
    const files = handlerFiles(root, request);
    const feature = featureDirOf(root, request.feature);
    return [
      ...files.map((f) => ({ path: rel(root, f.path), change: 'create', layer: f.layer })),
      { path: rel(root, path.join(feature, 'types.ts')), change: 'modify', layer: 'domain' },
      { path: rel(root, path.join(feature, 'index.ts')), change: 'modify' },
      ...blockProofTouches(root, request.feature, handlerProofName(request.name)),
    ];
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------- proof

function proofText(root, request) {
  const ctx = handlerContext(root, request);
  const { names, method, own, fields, entity: E } = ctx;
  const { genDir } = generatedDir(root, request.feature);
  const routeSpec = specFrom(path.join(genDir, 'x.ts'), ctx.routeAbs.replace(/\.ts$/, ''));
  const others = HANDLER_METHODS.filter((m) => m !== method);
  const [rowA] = sampleRows(E, fields);
  const good = JSON.stringify(Object.fromEntries(Object.entries(rowA).filter(([k]) => (method === 'PUT' ? true : k !== 'id'))));
  const unknownId = fields.find((f) => f.name === 'id').type === 'number' ? 999 : 'unknown-id';
  const unknownRow = JSON.stringify({ ...rowA, id: unknownId });
  const call = (m, init) => (m === method && method !== 'GET' ? `route.${m}(new Request(ENDPOINT, ${init}))` : `route.${m}()`);
  const command = `construct create handler ${names.Name} --feature ${request.feature} --method ${method} --path ${request.path}${request.service ? ` --service ${request.service}` : ` --entity ${E} --fields ${fields.map((f) => `${f.name}:${f.type}`).join(',')}`}`;
  const relPath = `features/${request.feature}/tests/generated/${handlerProofName(names.Name)}`;
  const serviceTests = !own ? [] : {
    GET: [
      `test(${lit(`${names.Name} handler: GET answers 200 with the rows as JSON`)}, async () => {`, `  const res = await ${call('GET')};`, "  expectState('GET with no rows', '200', String(res.status));", "  expectState('The body of GET', 'a list', Array.isArray(await res.json()) ? 'a list' : 'something else');", '});', '',
    ],
    POST: [
      `test(${lit(`${names.Name} handler: POST with a good body answers 200 and the row, with its id`)}, async () => {`, `  const res = await ${call('POST', `{ method: 'POST', body: ${lit(good)} }`)};`, "  expectState('POST with a good body', '200', String(res.status));",
      "  const body: unknown = await res.json();", "  expectState('The row POST answers', 'a row with an id', typeof body === 'object' && body !== null && 'id' in body ? 'a row with an id' : 'no id');", '});', '',
      `test(${lit(`${names.Name} handler: POST with a body that is not a row answers 400`)}, async () => {`, `  const res = await ${call('POST', "{ method: 'POST', body: 'not json' }")};`, "  expectState('POST with a bad body', '400', String(res.status));", '});', '',
    ],
    PUT: [
      `test(${lit(`${names.Name} handler: PUT with a bad body or an unknown id answers 400`)}, async () => {`, `  const bad = await ${call('PUT', "{ method: 'PUT', body: 'not json' }")};`, "  expectState('PUT with a bad body', '400', String(bad.status));",
      `  const unknown = await ${call('PUT', `{ method: 'PUT', body: ${lit(unknownRow)} }`)};`, "  expectState('PUT with an id that is not there', '400', String(unknown.status));", '});', '',
    ],
    DELETE: [
      `test(${lit(`${names.Name} handler: DELETE with no id or an unknown id answers 400`)}, async () => {`, `  const none = await ${call('DELETE', "{ method: 'DELETE' }")};`, "  expectState('DELETE with no id', '400', String(none.status));",
      `  const unknown = await route.DELETE(new Request(ENDPOINT + '?id=' + ${lit(String(unknownId))}, { method: 'DELETE' }));`, "  expectState('DELETE with an id that is not there', '400', String(unknown.status));", '});', '',
    ],
  }[method];
  return `${[
    ...proofHeader({ command, feature: request.feature, subject: `${names.Name} handler (${method} ${request.path})` }),
    `// run: construct test proof ${request.feature}   (on its own: npx tsx --test ${relPath})`,
    '//',
    `// Proves the route handler of ${request.path} with no server: the status of every typed result (200, 400, 405, 500), that every method the route does not answer is 405 with an Allow header,`,
    own ? `// and ${method} with a good and a bad request against its in-memory service. A failure names the method and the status it reached.` : '// A service you named may do I/O, so the proof does not call it: it proves the mapping and the methods that are not answered.',
    '',
    "import { test } from 'node:test';", "import assert from 'node:assert/strict';",
    `import { ${names.http} } from '../../domain/${names.domainBase}.domain';`, `import * as route from '${routeSpec}';`, "import type { ApiResult } from '../../types';", '',
    `const ENDPOINT = ${lit(`http://localhost${request.path}`)};`, '',
    ...EXPECT_LINES, '',
    `test(${lit(`${names.Name} handler: the status of every typed result`)}, () => {`,
    "  const cases: [string, ApiResult<unknown>, number][] = [['ready', { status: 'ready', body: [] }, 200], ['invalid', { status: 'invalid', message: 'no' }, 400], ['not-allowed', { status: 'not-allowed', allow: ['" + method + "'] }, 405], ['error', { status: 'error', message: 'failed' }, 500]];",
    `  for (const [name, result, want] of cases) expectState('The ' + name + ' result', String(want), String(${names.http}({ result }).status));`, '});', '',
    `test(${lit(`${names.Name} handler: 405 names the methods that are answered`)}, () => {`,
    `  const reply = ${names.http}({ result: { status: 'not-allowed', allow: ['${method}'] } });`, `  expectState('The Allow header of a 405', ${lit(method)}, reply.headers.Allow ?? 'none');`,
    "  assert.equal(typeof (reply.body as { error?: unknown }).error, 'string', 'the body is typed JSON with an error text');", '});', '',
    `test(${lit(`${names.Name} handler: every other method is 405, as typed JSON, with the Allow header`)}, async () => {`,
    ...others.flatMap((m) => [`  const ${m.toLowerCase()}Reply = await route.${m}();`, `  expectState('${m}', '405', String(${m.toLowerCase()}Reply.status));`, `  expectState('The Allow header of ${m}', ${lit(method)}, ${m.toLowerCase()}Reply.headers.get('allow') ?? 'none');`,
      `  expectState('The body of ${m}', 'typed JSON', typeof (await ${m.toLowerCase()}Reply.json() as { error?: unknown }).error === 'string' ? 'typed JSON' : 'something else');`]),
    '});', '',
    ...serviceTests,
  ].join('\n').replace(/\n+$/, '')}\n`;
}

// ------------------------------------------------------------------------------------------------------------------ write

/**
 * Write a route handler into a Next.js project: the route, the domain unit, the in-memory service (when no `--service` is named), the feature's types and the locked proof. Everything that can refuse is
 * checked before the first byte is written (a react-spa project, an existing file with other content, a service that is not there, a type declared for something else), so a refusal changes nothing.
 * Idempotent: a second run reports `changed: false`.
 *
 * @param {string} root Project root.
 * @param {{ name: string, feature: string, method: string, path: string, service?: string, entity?: string, fields?: string }} request The handler.
 * @returns {{ changed: boolean, files: string[], route: string, method: string, path: string, service: string }} The project-relative files changed, the route file and where the service is.
 * @throws {Error} A usage error naming why nothing was written.
 *
 * @example
 * generateHandler(root, { name: 'Products', feature: 'shop', method: 'GET', path: '/api/products' }).route; // => 'app/api/products/route.ts'
 */
export function generateHandler(root, request) {
  const ctx = handlerContext(root, request);
  assertFeature(root, request.feature);
  const files = handlerFiles(root, request);
  const declared = withDeclarations(root, request.feature, typeBlocks(ctx));
  if (declared.conflicts.length) throw usage(`types.ts of "${request.feature}" already declares ${declared.conflicts.join(' and ')} for something else, so the handler cannot build on it. Rename that type. Nothing was written.`);
  if (ctx.own) {
    const have = entityFieldsIn(declared.current, ctx.entity);
    const wanted = ctx.fields.map((f) => `${f.name}:${f.type}`).join(',');
    if (have !== null && have !== wanted) throw usage(`types.ts of "${request.feature}" already declares ${ctx.entity} with the fields ${have}, not ${wanted}. Use --entity with another name, or the same --fields. Nothing was written.`);
  }
  const route = files.find((f) => f.layer === 'route');
  if (fs.existsSync(route.path) && fs.readFileSync(route.path, 'utf8') !== route.content) throw usage(`${ctx.routeFile} already exists with other content, so nothing was written. A route file answers one path: add another method to it by hand, or choose another path.`);
  const proof = proofText(root, request);
  const written = writeOwned(root, files);
  const changed = [...written.written];
  if (declared.changed) {
    const types = path.join(featureDirOf(root, request.feature), 'types.ts');
    write(types, declared.text);
    changed.push(rel(root, types));
  }
  const api = syncPublicApi(root, request.feature);
  if (api.changed) changed.push(api.path);
  const wrote = writeBlockProof(root, request.feature, handlerProofName(ctx.Name), proof);
  if (wrote.changed) changed.push(wrote.file);
  if (wrote.regions.length) changed.push('architecture.yml');
  selfCheck(root, files.filter((f) => f.layer !== 'route').map((f) => f.path));
  return { changed: changed.length > 0, files: changed, route: ctx.routeFile, method: ctx.method, path: ctx.path, service: ctx.own ? 'in-memory' : request.service };
}

// ---------------------------------------------------------------------------------------------------------------- the question

const answerOf = (answer) => (typeof answer === 'string' ? { option: answer } : answer && typeof answer === 'object' ? answer : null);

/**
 * The closed question about the handler of the endpoint a shaped screen calls (chooser summary shape, id `q-handler`, or `q-handler-<name>` for several screens): `add-handler` (the handler that
 * serves the endpoint) or `skip`, the rules default FIRST (add, so the built-in provider suggests it). Raised only when the project is Next.js, the screen's data source is `endpoint`, the shape
 * is one a generated handler can serve (`HANDLER_SHAPE_METHODS`), the path is a plain `/api/...` path, and no route file answers it yet. An unanswered question uses its default, so it never
 * holds a plan back; an answer that is not an option is refused, never replaced. Reads the project, writes nothing, never throws.
 *
 * @param {string} root Project root.
 * @param {{ id: string, name: string, shape: string, source: string, path: string, answer?: string | { option: string } }} request The question id, the screen, its shape, its data source, the endpoint it calls and an answer.
 * @returns {{ question: object | null, add: boolean, method: string | null, refused: string | null, note: string | null }} The question (`null` when nothing is asked), whether the plan adds the handler, its method, why an answer was refused, and a note when a handler was not offered for a reason a person should know.
 *
 * @example
 * handlerOffer(root, { id: 'q-handler', name: 'Products', shape: 'list', source: 'endpoint', path: '/api/products' }).method; // => 'GET'
 */
export function handlerOffer(root, request) {
  const none = { question: null, add: false, method: null, refused: null, note: null };
  try {
    if (frameworkOf(root) !== 'nextjs' || request.source !== 'endpoint') return none;
    const method = HANDLER_SHAPE_METHODS[request.shape];
    if (!method) return { ...none, note: `${request.name} calls ${request.path}, but a handler for a ${request.shape} screen is not generated yet: add the route handler by hand.` };
    if (!HANDLER_PATH_RE.test(request.path)) return { ...none, note: `${request.name} calls ${request.path}, which is not a plain /api path a handler can serve.` };
    const routeAbs = path.join(root, routeRoot(root), ...request.path.split('/').filter(Boolean), 'route.ts');
    if (fs.existsSync(routeAbs)) return { ...none, note: `${request.path} is already answered by ${rel(root, routeAbs)}, so no handler is offered for ${request.name}.` };
    const options = [
      { id: 'add-handler', label: `Add ${method} ${request.path}`, enabled: true, why: `A route handler that serves the endpoint ${request.name} calls, backed by a typed in-memory service.` },
      { id: 'skip', label: 'No handler', enabled: true, why: `${request.path} must exist in your app before the screen can read from it.` },
    ];
    const chosen = answerOf(request.answer)?.option;
    const known = options.find((o) => o.id === chosen);
    const refused = chosen && !known ? `"${chosen}" is not an option of ${request.id}: add-handler, skip.` : null;
    const used = known ? known.id : 'add-handler';
    return { question: { id: request.id, question: `Should the route handler for ${request.path}, which ${request.name} calls, be added?`, options, default: 'add-handler', chosen: known ? known.id : null }, add: used === 'add-handler', method, refused, note: null };
  } catch {
    return none;
  }
}
