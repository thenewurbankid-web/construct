// Ticket 7.5 — Configurable Service Generator (OpenAPI -> RTKQ, services/).
//
// Two genuinely new, real dependencies power this (see #110's reconciliation
// notes for why that's the right call here, unlike elsewhere in this epic):
//  - @hey-api/openapi-ts does the actual OpenAPI *parsing* (ref resolution,
//    allOf/oneOf composition, etc.) and emits real, correctly-typed
//    TypeScript for every operation's request/response shape — reimplementing
//    that ourselves would be its own multi-week project, and getting it
//    subtly wrong would silently miscompile real projects.
//  - @reduxjs/toolkit (RTK Query) is the actual runtime the generated
//    services target: `createApi`/`injectEndpoints`.
//
// What stays deterministic and LLM-free, by design: turning hey-api's parsed
// output into an RTKQ `injectEndpoints` file is our own template code, not
// hey-api's job (it has no RTKQ plugin) and not an LLM's job either — this
// module walks the OpenAPI document's `paths` itself (plain object walk, no
// AST needed — it's already structured JSON/YAML) and cross-references the
// exact type names hey-api actually generated (by reading them back off
// disk, not by guessing hey-api's internal naming transform) to produce a
// working, compiling endpoints file every time.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { createClient } from '@hey-api/openapi-ts';
import { ensureDir, write, rel } from './fs.mjs';
import { loadConfig } from './config.mjs';
import { createFeature } from './generators.mjs';
import { validateArchitecture } from './architecture-enforcer.mjs';
import { parseIndexExports } from './soc-enforcer.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const QUERY_METHODS = new Set(['GET', 'HEAD']);

function usageError(message) {
  return new ConstructError(message, { exitCode: EXIT_CODES.USAGE_ERROR });
}

// Re-validate generated files against Construct's own enforcer — same
// contract as generators.mjs's selfCheck: a failure here means Construct's
// own generator produced non-conforming code (an internal bug), not a user
// mistake, so it throws rather than returning a normal violation report.
function selfCheck(root, absFiles) {
  const files = absFiles.map((f) => rel(root, f));
  const { violations } = validateArchitecture(root, { files });
  const errors = violations.filter((v) => v.severity === 'error');
  if (errors.length) {
    throw new ConstructError(
      `Construct's service generator produced code that fails its own architecture rules (generator bug): ${errors
        .map((v) => `${v.rule} in ${v.file} — ${v.message}`)
        .join('; ')}`,
      { violations: errors, exitCode: EXIT_CODES.INTERNAL_ERROR },
    );
  }
}

// ---- features/core/services/client.ts — the configurable transport -------

const PROVIDER_ADAPTERS = {
  fetchBaseQuery: () => `const providerBaseQuery = fetchBaseQuery({ baseUrl: process.env.API_BASE_URL || '/' });`,
  axios: () => `const axiosInstance = axios.create({ baseURL: process.env.API_BASE_URL || '/' });

const providerBaseQuery: BaseQueryFn<RequestArgs, unknown, unknown> = async ({ url, method, params, body }) => {
  try {
    const result = await axiosInstance.request({ url, method, params, data: body });
    return { data: result.data };
  } catch (err) {
    const error = err as AxiosError;
    return { error: { status: error.response?.status, data: error.response?.data ?? error.message } };
  }
};`,
  mock: () => `// No network calls -- resolves every request against this in-memory map,
// keyed by "<METHOD> <url>". Swap \`project.dataLayer.provider\` to 'fetchBaseQuery'
// or 'axios' once a real backend exists; no generated services/*.ts file needs
// to change when you do.
const mockData: Record<string, unknown> = {};

const providerBaseQuery: BaseQueryFn<RequestArgs, unknown, unknown> = async ({ url, method }) => ({
  data: mockData[\`\${method} \${url}\`] ?? null,
});`,
};

const PROVIDER_IMPORTS = {
  fetchBaseQuery: `import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';`,
  axios: `import { createApi } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn } from '@reduxjs/toolkit/query/react';
import axios, { type AxiosError } from 'axios';`,
  mock: `import { createApi } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn } from '@reduxjs/toolkit/query/react';`,
};

/** Renders `features/core/services/client.ts`'s full content for the given
 * `project.dataLayer.provider`. Every generated `services/*.ts` endpoint
 * file calls the shared `buildRequest` helper exported here instead of
 * hand-building its request, so switching providers never requires touching
 * a single generated endpoint file — only this one. */
export function renderClient(provider) {
  const imports = PROVIDER_IMPORTS[provider] || PROVIDER_IMPORTS.fetchBaseQuery;
  const adapter = (PROVIDER_ADAPTERS[provider] || PROVIDER_ADAPTERS.fetchBaseQuery)();
  return `// Generated by Construct's service generator (Ticket 7.5) from
// project.dataLayer.provider: '${provider}' in architecture.yml. Regenerated
// on every \`construct create service ... --openapi ...\` run -- hand edits
// here will be overwritten; change the provider in architecture.yml instead.
${imports}

export type RequestArgs = {
  url: string;
  method: string;
  params?: Record<string, unknown>;
  body?: unknown;
};

// Provider-agnostic request shaping: substitutes "{param}" path segments from
// a hey-api-shaped { path, query, body } payload and carries the rest through
// untouched. Every generated services/*.ts endpoint calls this so it never
// needs to know which transport adapter is actually active.
export function buildRequest(
  method: string,
  template: string,
  data?: { path?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown },
): RequestArgs {
  let url = template;
  if (data?.path) {
    for (const [key, value] of Object.entries(data.path)) {
      url = url.replace(\`{\${key}}\`, encodeURIComponent(String(value)));
    }
  }
  return {
    url,
    method,
    ...(data?.query ? { params: data.query } : {}),
    ...(data && 'body' in data && data.body !== undefined ? { body: data.body } : {}),
  };
}

${adapter}

export const baseQuery = providerBaseQuery;

export const api = createApi({
  reducerPath: 'api',
  baseQuery,
  endpoints: () => ({}),
});
`;
}

/** Idempotently ensures `features/core` exists, `features/core/services/
 * client.ts` reflects the current `project.dataLayer.provider`, and
 * `features/core/index.ts` publicly re-exports `api`/`buildRequest` (so a
 * cross-feature `services/*.ts` import of them satisfies SLICE-002 instead
 * of tripping it -- see this module's header and #115's design notes). */
export function ensureClient(root) {
  const config = loadConfig(root);
  const featuresRoot = config.features?.root || 'features';
  const coreDir = path.join(root, featuresRoot, 'core');
  if (!fs.existsSync(coreDir)) createFeature(root, 'core');

  const clientPath = path.join(coreDir, 'services', 'client.ts');
  write(clientPath, renderClient(config.project?.dataLayer?.provider || 'fetchBaseQuery'));

  const indexPath = path.join(coreDir, 'index.ts');
  const indexSrc = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : `// Public API for feature: core\n`;
  const alreadyExported = parseIndexExports(indexSrc).some((e) => e.specifier.replace(/^\.\//, '') === 'services/client');
  if (!alreadyExported) {
    const needsNewline = indexSrc.length > 0 && !indexSrc.endsWith('\n');
    write(indexPath, indexSrc + (needsNewline ? '\n' : '') + `export { api, buildRequest } from './services/client';\n`);
  }

  return clientPath;
}

// ---- OpenAPI spec walking (plain object walk -- no AST needed) -----------

/** Read + parse an OpenAPI document (YAML or JSON -- js-yaml parses both)
 * and return its operations as { method, path, operationId } in document
 * order. Throws a clear, actionable error rather than guessing when an
 * operation has no operationId: without one, there is no reliable way to
 * cross-reference hey-api's generated type names (see extractGeneratedTypes
 * below), so this is a deliberate scope cut, not a silent best-effort. */
export function parseOperations(specPath) {
  if (!fs.existsSync(specPath)) {
    throw usageError(`OpenAPI spec not found: ${specPath}`);
  }
  let doc;
  try {
    doc = yaml.load(fs.readFileSync(specPath, 'utf8'));
  } catch (e) {
    throw usageError(`Failed to parse OpenAPI spec at ${specPath}: ${e.message}`);
  }
  if (!doc || typeof doc !== 'object' || !doc.paths || typeof doc.paths !== 'object') {
    throw usageError(`OpenAPI spec at ${specPath} has no "paths" — nothing to generate.`);
  }

  const ops = [];
  for (const [urlPath, pathItem] of Object.entries(doc.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!op || typeof op !== 'object') continue;
      if (!op.operationId) {
        throw usageError(
          `Operation "${method.toUpperCase()} ${urlPath}" in ${specPath} has no operationId — every operation needs one so the generated RTKQ endpoint name and its hey-api-generated types line up.`,
        );
      }
      ops.push({ method: method.toUpperCase(), path: urlPath, operationId: op.operationId });
    }
  }
  if (!ops.length) {
    throw usageError(`OpenAPI spec at ${specPath} defines no operations under "paths" — nothing to generate.`);
  }
  return ops;
}

/** Read back the type names @hey-api/openapi-ts actually generated for
 * "<Op>Data"/"<Op>Response" (keyed by the lowercased operation-id-derived
 * prefix), instead of re-deriving hey-api's own PascalCase transform
 * ourselves -- this is what keeps the endpoint file correct regardless of
 * exactly how hey-api names things internally. */
function extractGeneratedTypes(typesGenPath) {
  const src = fs.readFileSync(typesGenPath, 'utf8');
  const dataByKey = new Map();
  const responseByKey = new Map();
  for (const m of src.matchAll(/export type ([A-Za-z_$][\w$]*) =/g)) {
    const full = m[1];
    if (full.endsWith('Data')) dataByKey.set(full.slice(0, -'Data'.length).toLowerCase(), full);
    else if (full.endsWith('Response')) responseByKey.set(full.slice(0, -'Response'.length).toLowerCase(), full);
  }
  return { dataByKey, responseByKey };
}

// A valid JS identifier derived from an operationId — sanitizes anything an
// OpenAPI author could legally put in operationId (dots, dashes, etc.) into
// something usable as both an RTKQ endpoint key and a hook name suffix.
function sanitizeIdentifier(name) {
  const cleaned = name.replace(/[^A-Za-z0-9_$]/g, '_').replace(/^([0-9])/, '_$1');
  return cleaned || '_op';
}

function pascalCase(identifier) {
  return identifier[0].toUpperCase() + identifier.slice(1);
}

/** Renders the RTKQ `injectEndpoints` file's content for a parsed operation
 * list, given the generated-types lookup and the relative specifier to
 * import them from. */
export function renderEndpoints(serviceName, ops, generatedTypes, typesImportSpecifier) {
  const { dataByKey, responseByKey } = generatedTypes;
  const entries = ops.map((op) => {
    const key = sanitizeIdentifier(op.operationId);
    const normKey = op.operationId.toLowerCase();
    const dataType = dataByKey.get(normKey) || 'void';
    const responseType = responseByKey.get(normKey) || 'unknown';
    const kind = QUERY_METHODS.has(op.method) ? 'query' : 'mutation';
    return { key, dataType, responseType, kind, method: op.method, path: op.path };
  });

  const usedTypes = new Set();
  for (const e of entries) {
    if (e.dataType !== 'void') usedTypes.add(e.dataType);
    if (e.responseType !== 'unknown') usedTypes.add(e.responseType);
  }
  const typeImportLine = usedTypes.size
    ? `import type { ${[...usedTypes].sort().join(', ')} } from '${typesImportSpecifier}';\n`
    : '';

  const endpointLines = entries
    .map(
      (e) =>
        `    ${e.key}: builder.${e.kind}<${e.responseType}, ${e.dataType}>({\n      query: (data) => buildRequest('${e.method}', '${e.path}', data),\n    }),`,
    )
    .join('\n');

  const apiConst = `${serviceName}Api`;
  const hookNames = entries.map((e) => `use${pascalCase(e.key)}${e.kind === 'query' ? 'Query' : 'Mutation'}`);

  return `// Generated by Construct's service generator (Ticket 7.5) from an OpenAPI
// spec -- deterministic, no LLM involved. Re-run \`construct create service
// ${serviceName} --feature <feature> --openapi <spec>\` to regenerate after
// the spec changes; hand edits here will be overwritten.
${typeImportLine}import { api, buildRequest } from '../../core/services/client';

export const ${apiConst} = api.injectEndpoints({
  endpoints: (builder) => ({
${endpointLines}
  }),
  overrideExisting: false,
});

export const { ${hookNames.join(', ')} } = ${apiConst};
`;
}

/**
 * generateServiceFromSpec(root, name, feature, specPath) -> string[] (absolute file paths written)
 *
 * WHEN an OpenAPI spec is provided (via `construct create service <name>
 * --feature <feature> --openapi <specPath>`), compiles RTKQ endpoint
 * definitions without invoking an LLM:
 *  1. Ensures features/core/services/client.ts (+ its public export) exists
 *     and matches the current project.dataLayer.provider.
 *  2. Runs @hey-api/openapi-ts's `@hey-api/typescript` plugin to parse the
 *     spec into features/<feature>/services/<name>/{index.ts,types.gen.ts}.
 *  3. Walks the same spec's `paths` itself and emits
 *     features/<feature>/services/<name>Api.ts — a real RTKQ
 *     `injectEndpoints` file referencing the types hey-api just generated.
 * Every written file is re-validated against Construct's own architecture
 * rules before returning (selfCheck) — see this file's header for why
 * SERVICE-002 can never fire on this generator's own output.
 */
export async function generateServiceFromSpec(root, name, feature, specPath) {
  if (!name || !feature || !specPath) {
    throw usageError('generateServiceFromSpec requires a name, a feature, and an OpenAPI spec path.');
  }
  const absSpecPath = path.isAbsolute(specPath) ? specPath : path.resolve(root, specPath);
  const ops = parseOperations(absSpecPath); // fail fast on a bad/empty spec before touching disk

  const clientPath = ensureClient(root);

  const config = loadConfig(root);
  const featuresRoot = config.features?.root || 'features';
  const featureDir = path.join(root, featuresRoot, feature);
  if (!fs.existsSync(featureDir)) createFeature(root, feature);

  const servicesDir = path.join(featureDir, 'services');
  ensureDir(servicesDir);
  const generatedDir = path.join(servicesDir, name);

  await createClient({
    input: absSpecPath,
    output: generatedDir,
    plugins: ['@hey-api/typescript'],
    logs: { level: 'silent' },
  });

  const typesGenPath = path.join(generatedDir, 'types.gen.ts');
  if (!fs.existsSync(typesGenPath)) {
    throw new ConstructError(
      `@hey-api/openapi-ts did not produce the expected types.gen.ts for spec ${absSpecPath}.`,
      { exitCode: EXIT_CODES.INTERNAL_ERROR },
    );
  }
  const generatedTypes = extractGeneratedTypes(typesGenPath);

  const endpointsPath = path.join(servicesDir, `${name}Api.ts`);
  write(endpointsPath, renderEndpoints(name, ops, generatedTypes, `./${name}/types.gen`));

  const written = [clientPath, path.join(generatedDir, 'index.ts'), typesGenPath, endpointsPath];
  selfCheck(root, written);
  return written;
}
