// #621 (part of epic #616, relates to #400) -- where a shaped screen reads its data from, as one closed question with three stable answers.
// A list, detail, form, dashboard or wizard screen calls a service; until now that service called `/api/<plural>`, an endpoint nothing in the project had
// made. The person now chooses, and the units are generated to match:
//
//   local     the screen reads a typed in-memory store (seed rows in a domain unit, held by the service): it works with no backend.
//   endpoint  the service fetches `/api/<plural>` (what a shaped step without a source has always done); the endpoint must exist.
//   openapi   the service requests the path of the matching operation in the project's OpenAPI file (openapi.yaml|yml|json at the root
//             or in api/), read by openapi-spec.mjs, the reader `create.service.openapi` shares: the path comes from the contract.
//
//   readSource(value)          the source of a request: an unspecified one is `endpoint` (old plans are unchanged), an unknown one is refused
//   storeNames(shape, Name)    the identifiers of the local store (the file, the seed unit, the operation unit)
//   sourceOffer(root, request) the closed question `q-source` (chooser-summary shape: options with stable ids, the rules' default, chosen)
//
// Nothing here calls a model or the network. The templates that use the source live beside the shapes (shapes.mjs, shape-detail.mjs,
// shape-form.mjs); the render proofs adapt in proof.mjs and proof-screens.mjs.
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { findEntityOperation, findOpenApiFile } from './openapi-spec.mjs';

const usage = (message) => new ConstructError(message, { exitCode: EXIT_CODES.USAGE_ERROR });

/**
 * The data sources a shaped screen can have. Stable ids: an answer recorded once stays valid. A test keeps this equal to the enum of
 * the `--source` argument in plan.mjs and to schemas/plan.v1.json.
 *
 * @type {readonly string[]}
 */
export const SOURCES = Object.freeze(['local', 'endpoint', 'openapi']);

/** The id of the closed question about the data source (`q-source`; `q-source-<name>` when a plan has several shaped screens). */
export const SOURCE_QUESTION_ID = 'q-source';

/** What an unspecified source means: `endpoint`, the behaviour of every shaped step written before the source existed. */
export const UNSPECIFIED_SOURCE = 'endpoint';

/**
 * The source of a shaped request. Nothing given is `endpoint` (so a plan or a call that predates the source is unchanged); a value that is
 * not one of `SOURCES` is a usage error naming the choices.
 *
 * @param {unknown} value The `source` of a request, or `undefined`.
 * @returns {'local'|'endpoint'|'openapi'} The source.
 * @throws {Error} A usage error for an unknown source.
 *
 * @example
 * readSource(undefined); // => 'endpoint'
 * readSource('local'); // => 'local'
 */
export function readSource(value) {
  if (value === undefined || value === null || value === '') return UNSPECIFIED_SOURCE;
  if (!SOURCES.includes(value)) throw usage(`Unknown data source "${value}". The sources are: ${SOURCES.join(', ')}.`);
  return value;
}

/**
 * The identifiers of the local store of a shaped screen: the domain file that holds it (`ProductsStore`), the unit that makes the seed
 * rows, and the unit that reads (list), finds (detail) or saves (form) against a set of rows.
 *
 * @param {'list'|'detail'|'form'|'dashboard'|'wizard'} shape The shape.
 * @param {string} Name The PascalCase unit name of the screen.
 * @returns {{ file: string, seed: string, op: string }} The store file's base name and the two unit names.
 *
 * @example
 * storeNames('detail', 'Product'); // => { file: 'ProductStore', seed: 'seedProduct', op: 'findProduct' }
 */
export function storeNames(shape, Name) {
  const verb = shape === 'form' || shape === 'wizard' ? 'save' : shape === 'detail' ? 'find' : 'read';
  return { file: `${Name}Store`, seed: `seed${Name}`, op: `${verb}${Name}` };
}

/**
 * How each shape asks the OpenAPI file for its operation (`findEntityOperation`'s `kind`) and what that operation does, in a verb for a
 * sentence: a wizard submits, so it looks for the same `POST` a form does; a dashboard reads one summary (`GET /<plural>/summary`, #627).
 */
const OPERATIONS = Object.freeze({
  list: Object.freeze({ kind: 'list', method: 'GET', what: 'lists', tail: '' }),
  detail: Object.freeze({ kind: 'detail', method: 'GET', what: 'reads one', tail: '/{id}' }),
  form: Object.freeze({ kind: 'form', method: 'POST', what: 'creates', tail: '' }),
  wizard: Object.freeze({ kind: 'form', method: 'POST', what: 'creates', tail: '' }),
  dashboard: Object.freeze({ kind: 'dashboard', method: 'GET', what: 'summarises', tail: '/summary' }),
});

/**
 * The operation a shape's data source needs from an OpenAPI file: the `kind` `findEntityOperation` looks for, the HTTP `method`, what the
 * operation does (`lists`, `reads one`, `creates`, `summarises`) and the tail its path ends in after the plural (`/{id}`, `/summary`).
 *
 * @param {'list'|'detail'|'form'|'dashboard'|'wizard'} shape The shape.
 * @returns {{ kind: string, method: 'GET'|'POST', what: string, tail: string }} The operation it needs.
 *
 * @example
 * operationOf('dashboard'); // => { kind: 'dashboard', method: 'GET', what: 'summarises', tail: '/summary' }
 */
export const operationOf = (shape) => OPERATIONS[shape];

/** The most text of a question, a label and a reason (the sizes of a placement offer, so a summary stays fixed). */
const LIMITS = Object.freeze({ question: 160, label: 60, why: 120, reason: 200 });
const cap = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);
const answerOf = (answer) => (typeof answer === 'string' ? { option: answer } : answer && typeof answer === 'object' ? answer : null);

/**
 * The closed question about a screen's data source (chooser-summary shape: `{ id, question, options: [{ id, label, enabled, why }], default,
 * chosen }`, plus the unit it is about and the rules' suggestion). Two options, three when the project has an OpenAPI file with the
 * operation of the entity: `openapi` (first, and the default, when it is offered), `local`, `endpoint`. The rules-only default is
 * therefore `openapi` when a matching operation exists, else `local`. `openapi` is only offered when it can be generated: a missing
 * file, an unreadable one or a spec without the operation leaves it out (and `unavailable` says why, so a plan can note it). An
 * unanswered question uses its default; an answer naming an option that was not offered is `refused`, never silently replaced.
 * Reads the project, writes nothing, never throws.
 *
 * @param {string} root Project root (its OpenAPI file is looked for).
 * @param {{ shape: 'list'|'detail'|'form'|'dashboard'|'wizard', unit: string, plural: string, endpoint: string, answer?: string | { option: string } }} request The shape, the screen's unit name, the PascalCase plural of its entity (to find the operation), the `/api/...` path the endpoint option would call, and an answer to `q-source`.
 * @returns {{ question: object, source: 'local'|'endpoint'|'openapi', operation: object | null, unavailable: string | null, refused: string | null }}
 *   The question, the source the plan uses (the answer, else the default), the OpenAPI operation when there is one, why `openapi` was not offered when a file exists without it (else `null`), and why an answer was refused (else `null`).
 *
 * @example
 * sourceOffer(root, { shape: 'list', unit: 'Products', plural: 'Products', endpoint: '/api/products' }).question.default; // => 'local'
 */
export function sourceOffer(root, request) {
  const wanted = OPERATIONS[request.shape];
  const operation = findEntityOperation(root, { kind: wanted.kind, plural: request.plural });
  const file = findOpenApiFile(root);
  const verb = wanted.method;
  const item = `/${request.plural.toLowerCase()}${wanted.tail}`;
  const { what } = wanted;
  const all = {
    openapi: operation && { id: 'openapi', label: cap(`Use the contract in ${operation.file}`, LIMITS.label), enabled: true, why: cap(`Requests ${operation.method} ${operation.url}${operation.operationId ? ` (${operation.operationId})` : ''}, the path the OpenAPI file gives.`, LIMITS.why) },
    local: { id: 'local', label: 'Local data, no backend', enabled: true, why: cap('A typed in-memory store with seed rows: the screen works with no backend, and you swap it for an API later.', LIMITS.why) },
    endpoint: { id: 'endpoint', label: cap(`Call ${verb} ${request.endpoint}`, LIMITS.label), enabled: true, why: cap(`The service fetches ${request.endpoint}; that endpoint must exist in your app, nothing here creates it.`, LIMITS.why) },
  };
  const options = [all.openapi, all.local, all.endpoint].filter(Boolean);
  const fallback = options[0].id;
  const given = answerOf(request.answer)?.option;
  const known = options.some((o) => o.id === given);
  const used = known ? given : fallback;
  const reason = operation
    ? `The project has ${operation.file}, and it has an operation that ${what} ${request.plural.toLowerCase()} (${operation.method} ${operation.path}), so the contract is the source of the path.`
    : 'No OpenAPI operation for this screen was found, so a local store lets it work with no backend.';
  const question = {
    id: SOURCE_QUESTION_ID,
    question: cap(`Where should the "${request.unit}" screen read its data from?`, LIMITS.question),
    options, default: fallback, chosen: known ? given : null, unit: request.unit, shape: request.shape,
    suggestion: { option: fallback, reason: cap(reason, LIMITS.reason), provider: 'rules' },
  };
  return {
    question, source: used, operation: used === 'openapi' ? operation : null,
    unavailable: !operation && file ? `${file} has no operation that ${what} ${request.plural.toLowerCase()} (${verb} on a path ending in ${item}), so the openapi source is not offered.` : null,
    refused: given !== undefined && !known ? `"${SOURCE_QUESTION_ID}" has no option ${JSON.stringify(given)} here. Options: ${options.map((o) => o.id).join(', ')}.` : null,
  };
}
