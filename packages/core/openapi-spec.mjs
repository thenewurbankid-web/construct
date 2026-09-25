// #621 (part of epic #616, relates to #400) -- reading an OpenAPI file, for the two blocks that need one: the service generator
// (`construct create service --openapi`, service-generator.mjs) and the data source of a shaped screen (shape-source.mjs). One
// reader, so both see the same document and fail with the same words. Pure over the file: no network, no model, no write.
//
//   findOpenApiFile(root)                    the conventional file of a project (openapi.yaml|yml|json at the root or in api/), or null
//   loadOpenApiDocument(absPath)             read and parse a spec (YAML or JSON), or a usage error saying what is wrong
//   findEntityOperation(root, request)       the operation of a spec that lists, reads, creates or summarises one entity, or null
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';

const usage = (message) => new ConstructError(message, { exitCode: EXIT_CODES.USAGE_ERROR });

/** The places a project keeps its OpenAPI file, in the order they are looked for (project-relative). */
export const OPENAPI_FILES = Object.freeze(['openapi.yaml', 'openapi.yml', 'openapi.json', 'api/openapi.yaml', 'api/openapi.yml', 'api/openapi.json']);

/**
 * The OpenAPI file of a project at a conventional place: `openapi.yaml`, `openapi.yml` or `openapi.json` at the root, else the same in `api/`.
 * Read-only; a directory of that name does not count.
 *
 * @param {string} root Project root.
 * @returns {string | null} The project-relative POSIX path of the first one found, or `null`.
 *
 * @example
 * findOpenApiFile(root); // => 'openapi.yaml'
 */
export function findOpenApiFile(root) {
  return OPENAPI_FILES.find((f) => {
    try {
      return fs.statSync(path.join(root, f)).isFile();
    } catch {
      return false;
    }
  }) ?? null;
}

/**
 * Read and parse an OpenAPI document (YAML or JSON: js-yaml reads both). Throws a usage error that names the file, so the person knows
 * what to fix, rather than guessing.
 *
 * @param {string} specPath Absolute path of the spec.
 * @returns {{ paths: Record<string, object>, servers?: { url?: string }[] } & Record<string, unknown>} The document, with a `paths` object.
 * @throws {Error} A usage error when the file is missing, is not valid YAML or JSON, or has no `paths`.
 *
 * @example
 * loadOpenApiDocument('/project/openapi.yaml').paths['/products'].get.operationId; // => 'listProducts'
 */
export function loadOpenApiDocument(specPath) {
  if (!fs.existsSync(specPath)) throw usage(`OpenAPI spec not found: ${specPath}`);
  let doc;
  try {
    doc = yaml.load(fs.readFileSync(specPath, 'utf8'));
  } catch (e) {
    throw usage(`Failed to parse OpenAPI spec at ${specPath}: ${e.message}`);
  }
  if (!doc || typeof doc !== 'object' || !doc.paths || typeof doc.paths !== 'object') throw usage(`OpenAPI spec at ${specPath} has no "paths" — nothing to generate.`);
  return doc;
}

/** The letters and digits of a name, lower-cased: `order-items`, `order_items` and `OrderItems` all read `orderitems`. */
const squash = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, '');

/** The path prefix of a spec's first server: `/api/v1` for `/api/v1` and for `https://example.com/api/v1`; nothing for a server with variables or no path. */
function serverPrefix(doc) {
  const url = doc.servers?.[0]?.url;
  if (typeof url !== 'string' || url.includes('{')) return '';
  const pathname = /^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/.*)?$/i.exec(url)?.[1] ?? (url.startsWith('/') ? url : '');
  return pathname.replace(/\/+$/, '');
}

/** What each kind of screen needs from a spec: the HTTP method, whether the path ends in one `{parameter}` (a single item) or in the collection name, and (#627) a fixed last segment after the collection (`summary`). */
const KINDS = Object.freeze({ list: { method: 'get', item: false }, detail: { method: 'get', item: true }, form: { method: 'post', item: false }, dashboard: { method: 'get', item: false, suffix: 'summary' } });

/**
 * The operation of a project's OpenAPI file that lists (`list`: `GET /products`), reads one (`detail`: `GET /products/{id}`) or creates
 * (`form`: `POST /products`) or summarises (`dashboard`: `GET /products/summary`, #627) an entity, matched by fixed rules on the path: its last collection segment must read as the plural of the
 * entity (`products`, `order-items` and `order_items` all match `OrderItems`), it has no other path parameter, and the item form ends in
 * exactly one. The first match in document order wins. Read-only and never throws: no file, an unreadable file or no match answers `null`.
 *
 * @param {string} root Project root.
 * @param {{ kind: 'list'|'detail'|'form'|'dashboard', plural: string }} request The kind of screen and the PascalCase plural of the entity (`Products`).
 * @returns {{ file: string, method: 'GET'|'POST', path: string, url: string, operationId: string | null } | null} The spec file (project-relative), the method, the path as the spec writes it, the collection URL the screen requests (the spec's first server path plus the path up to the item parameter), and the operation id when it has one; or `null`.
 *
 * @example
 * findEntityOperation(root, { kind: 'detail', plural: 'Products' }); // => { file: 'openapi.yaml', method: 'GET', path: '/products/{id}', url: '/products', operationId: 'getProduct' }
 */
export function findEntityOperation(root, request) {
  const kind = KINDS[request?.kind];
  const file = findOpenApiFile(root);
  if (!kind || !file || typeof request.plural !== 'string') return null;
  try {
    const doc = loadOpenApiDocument(path.join(root, file));
    const wanted = squash(request.plural);
    for (const [specPath, item] of Object.entries(doc.paths)) {
      const operation = item?.[kind.method];
      if (!operation || typeof operation !== 'object') continue;
      const whole = specPath.split('/').filter(Boolean);
      if (kind.suffix && whole.at(-1) !== kind.suffix) continue;
      const segments = kind.suffix ? whole.slice(0, -1) : whole;
      const last = segments.at(-1) ?? '';
      const parameter = /^\{[^{}/]+\}$/.test(last);
      if (kind.item !== parameter) continue;
      const collection = kind.item ? segments.slice(0, -1) : segments;
      if (collection.length === 0 || collection.some((s) => s.includes('{') || s.includes('}'))) continue;
      if (squash(collection.at(-1)) !== wanted) continue;
      return { file, method: kind.method.toUpperCase(), path: specPath, url: `${serverPrefix(doc)}/${collection.join('/')}${kind.suffix ? `/${kind.suffix}` : ''}`, operationId: typeof operation.operationId === 'string' ? operation.operationId : null };
    }
  } catch {
    return null;
  }
  return null;
}
