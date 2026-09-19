// Ticket 7.5 — Configurable Service Generator (OpenAPI -> RTKQ, services/).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  parseOperations,
  renderClient,
  renderEndpoints,
  ensureClient,
  generateServiceFromSpec,
} from '../src/service-generator.mjs';
import { validateArchitecture } from '../src/architecture-enforcer.mjs';
import { createFeature } from '../src/generators.mjs';
import { ConstructError } from '../src/diagnostics.mjs';
import { parseToAst } from '../src/parser.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const petstoreSpec = path.join(repoRoot, 'fixtures', 'openapi-petstore', 'petstore.yaml');

function tmpProject() {
  return makeTempDir('construct-service-gen-');
}

// A tmp dir *inside* the repo (gitignored via .construct-test-tmp/) so a real
// `tsc --noEmit` run against generated output can resolve node_modules
// (@reduxjs/toolkit, axios, react, ...) by walking up directories the same
// way any real target project's own node_modules would resolve.
function tmpProjectInRepo() {
  const base = path.join(repoRoot, '.construct-test-tmp');
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, 'proj-'));
}

function writeArchitectureYml(dir, providerYaml) {
  // providerYaml (e.g. "dataLayer:\n    provider: axios\n") must nest under
  // `project:` — indent every one of its lines by 2 spaces so it does, no
  // matter how the caller wrote it.
  const indented = providerYaml
    .split('\n')
    .map((line) => (line ? `  ${line}` : line))
    .join('\n');
  fs.writeFileSync(
    path.join(dir, 'architecture.yml'),
    `version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\n  language: typescript\n${indented}\nfeatures:\n  root: features\nrules: {}\nexceptions: []\n`,
  );
}

// ---- parseOperations --------------------------------------------------

test('parseOperations reads the pet-store fixture into 3 ordered operations', () => {
  const ops = parseOperations(petstoreSpec);
  assert.deepEqual(
    ops.map((o) => `${o.method} ${o.path}`),
    ['GET /pets', 'POST /pets', 'GET /pets/{petId}'],
  );
  assert.deepEqual(ops.map((o) => o.operationId), ['listPets', 'createPet', 'getPetById']);
});

test('parseOperations throws a clear ConstructError for a missing file', () => {
  assert.throws(() => parseOperations('/no/such/spec.yaml'), (err) => {
    assert.ok(err instanceof ConstructError);
    assert.match(err.message, /OpenAPI spec not found/);
    return true;
  });
});

test('parseOperations throws for a spec with no paths', () => {
  const dir = tmpProject();
  const specPath = path.join(dir, 'empty.yaml');
  fs.writeFileSync(specPath, 'openapi: 3.0.3\ninfo:\n  title: Empty\n  version: 1.0.0\n');
  assert.throws(() => parseOperations(specPath), /no "paths"/);
});

test('parseOperations throws for an operation with no operationId (cannot cross-reference hey-api types)', () => {
  const dir = tmpProject();
  const specPath = path.join(dir, 'noop.yaml');
  fs.writeFileSync(
    specPath,
    'openapi: 3.0.3\ninfo:\n  title: NoOp\n  version: 1.0.0\npaths:\n  /widgets:\n    get:\n      responses:\n        \'200\':\n          description: ok\n',
  );
  assert.throws(() => parseOperations(specPath), /has no operationId/);
});

// ---- renderClient -------------------------------------------------------

test('renderClient never imports the bare "react" specifier for any provider (SERVICE-002 safety)', () => {
  for (const provider of ['fetchBaseQuery', 'axios', 'mock']) {
    const content = renderClient(provider);
    assert.doesNotMatch(content, /from ['"]react['"]/);
    assert.doesNotMatch(content, /from ['"]react\//);
    assert.match(content, /export function buildRequest/);
    assert.match(content, /export const baseQuery/);
    assert.match(content, /export const api = createApi/);
  }
});

test('renderClient instantiates the axios adapter only when provider is axios', () => {
  assert.match(renderClient('axios'), /axios\.create/);
  assert.doesNotMatch(renderClient('fetchBaseQuery'), /axios\.create/);
  assert.doesNotMatch(renderClient('mock'), /axios\.create/);
});

test('renderClient instantiates fetchBaseQuery only when provider is fetchBaseQuery', () => {
  assert.match(renderClient('fetchBaseQuery'), /fetchBaseQuery\(/);
  assert.doesNotMatch(renderClient('axios'), /fetchBaseQuery\(/);
  assert.doesNotMatch(renderClient('mock'), /fetchBaseQuery\(/);
});

test('renderClient builds a network-free in-memory adapter for provider mock', () => {
  const content = renderClient('mock');
  assert.match(content, /mockData/);
  assert.doesNotMatch(content, /axios\.create|fetchBaseQuery\(/);
});

// ---- ensureClient ---------------------------------------------------------

test('ensureClient creates features/core/services/client.ts and re-exports it from core/index.ts', () => {
  const dir = tmpProject();
  writeArchitectureYml(dir, 'dataLayer:\n    provider: axios\n');
  const clientPath = ensureClient(dir);
  assert.ok(fs.existsSync(clientPath));
  assert.match(fs.readFileSync(clientPath, 'utf8'), /axios\.create/);
  const indexSrc = fs.readFileSync(path.join(dir, 'features', 'core', 'index.ts'), 'utf8');
  assert.match(indexSrc, /export \{ api, buildRequest \} from '\.\/services\/client';/);
});

test('ensureClient is idempotent: calling it twice does not duplicate the export line', () => {
  const dir = tmpProject();
  writeArchitectureYml(dir, 'dataLayer:\n    provider: mock\n');
  ensureClient(dir);
  ensureClient(dir);
  const indexSrc = fs.readFileSync(path.join(dir, 'features', 'core', 'index.ts'), 'utf8');
  const matches = indexSrc.match(/export \{ api, buildRequest \} from '\.\/services\/client';/g) || [];
  assert.equal(matches.length, 1);
});

test('ensureClient reuses an existing core feature instead of re-scaffolding over it', () => {
  const dir = tmpProject();
  writeArchitectureYml(dir, '');
  createFeature(dir, 'core');
  fs.writeFileSync(path.join(dir, 'features', 'core', 'types.ts'), 'export type CoreId = string;\nexport type Marker = true;\n');
  ensureClient(dir);
  // The human-added types.ts content survives — ensureClient never touches it.
  assert.match(fs.readFileSync(path.join(dir, 'features', 'core', 'types.ts'), 'utf8'), /Marker/);
});

// ---- renderEndpoints ------------------------------------------------------

test('renderEndpoints maps GET/HEAD to query and everything else to mutation', () => {
  const ops = parseOperations(petstoreSpec);
  const generatedTypes = {
    dataByKey: new Map([
      ['listpets', 'ListPetsData'],
      ['createpet', 'CreatePetData'],
      ['getpetbyid', 'GetPetByIdData'],
    ]),
    responseByKey: new Map([
      ['listpets', 'ListPetsResponse'],
      ['createpet', 'CreatePetResponse'],
      ['getpetbyid', 'GetPetByIdResponse'],
    ]),
  };
  const content = renderEndpoints('petStore', ops, generatedTypes, './petStore/types.gen');
  assert.match(content, /listPets: builder\.query<ListPetsResponse, ListPetsData>/);
  assert.match(content, /createPet: builder\.mutation<CreatePetResponse, CreatePetData>/);
  assert.match(content, /getPetById: builder\.query<GetPetByIdResponse, GetPetByIdData>/);
  assert.match(content, /buildRequest\('GET', '\/pets\/\{petId\}', data\)/);
  assert.match(content, /import \{ api, buildRequest \} from '\.\.\/\.\.\/core\/services\/client';/);
  assert.match(content, /export const \{ useListPetsQuery, useCreatePetMutation, useGetPetByIdQuery \} = petStoreApi;/);
});

test('renderEndpoints falls back to void/unknown when a type is not found in the generated-types map', () => {
  const ops = [{ method: 'GET', path: '/ping', operationId: 'ping' }];
  const content = renderEndpoints('health', ops, { dataByKey: new Map(), responseByKey: new Map() }, './health/types.gen');
  assert.match(content, /ping: builder\.query<unknown, void>/);
});

// ---- generateServiceFromSpec (end to end) ---------------------------------

test('generateServiceFromSpec compiles the pet-store fixture end to end without an LLM and passes construct validate', async () => {
  const dir = tmpProject();
  writeArchitectureYml(dir, 'dataLayer:\n    provider: axios\n');
  const files = await generateServiceFromSpec(dir, 'petStore', 'pet', petstoreSpec);
  assert.equal(files.length, 4);
  for (const f of files) assert.ok(fs.existsSync(f), `missing generated file: ${f}`);

  const clientSrc = fs.readFileSync(path.join(dir, 'features', 'core', 'services', 'client.ts'), 'utf8');
  assert.match(clientSrc, /axios\.create/); // matches architecture.yml's configured provider

  const apiSrc = fs.readFileSync(path.join(dir, 'features', 'pet', 'services', 'petStoreApi.ts'), 'utf8');
  assert.match(apiSrc, /export const petStoreApi = api\.injectEndpoints/);
  assert.match(apiSrc, /useListPetsQuery/);

  const typesSrc = fs.readFileSync(path.join(dir, 'features', 'pet', 'services', 'petStore', 'types.gen.ts'), 'utf8');
  assert.match(typesSrc, /export type Pet = NewPet & \{/); // hey-api actually resolved the allOf composition

  const { ok, violations } = validateArchitecture(dir, {});
  assert.equal(ok, true, JSON.stringify(violations));
});

test('generateServiceFromSpec instantiates the transport adapter matching project.dataLayer.provider', async () => {
  for (const provider of ['fetchBaseQuery', 'axios', 'mock']) {
    const dir = tmpProject();
    writeArchitectureYml(dir, `dataLayer:\n    provider: ${provider}\n`);
    await generateServiceFromSpec(dir, 'petStore', 'pet', petstoreSpec);
    const clientSrc = fs.readFileSync(path.join(dir, 'features', 'core', 'services', 'client.ts'), 'utf8');
    assert.match(clientSrc, new RegExp(`provider: '${provider}'`));
  }
});

test('generateServiceFromSpec defaults to fetchBaseQuery when architecture.yml has no dataLayer configured', async () => {
  const dir = tmpProject();
  writeArchitectureYml(dir, '');
  await generateServiceFromSpec(dir, 'petStore', 'pet', petstoreSpec);
  const clientSrc = fs.readFileSync(path.join(dir, 'features', 'core', 'services', 'client.ts'), 'utf8');
  assert.match(clientSrc, /fetchBaseQuery\(/);
});

test('generateServiceFromSpec creates the destination feature if it does not already exist', async () => {
  const dir = tmpProject();
  writeArchitectureYml(dir, '');
  assert.ok(!fs.existsSync(path.join(dir, 'features', 'pet')));
  await generateServiceFromSpec(dir, 'petStore', 'pet', petstoreSpec);
  assert.ok(fs.existsSync(path.join(dir, 'features', 'pet', 'index.ts')));
});

test('generateServiceFromSpec: a hyphenated / underscored service name yields a valid `<name>Api` identifier (#216)', async () => {
  // (An underscored name is already a valid identifier, so it is left as-is
  // -- `pet_storeApi` -- exactly like every other already-valid name.)
  for (const [name, ident] of [['pet-store', 'petStore'], ['pet_store', 'pet_store']]) {
    const dir = tmpProject();
    writeArchitectureYml(dir, '');
    const files = await generateServiceFromSpec(dir, name, 'pet', petstoreSpec);
    const endpoints = files.find((f) => f.endsWith(`${name}Api.ts`));
    const source = fs.readFileSync(endpoints, 'utf8');
    assert.ok(source.includes(`export const ${ident}Api = api.injectEndpoints(`));
    assert.doesNotMatch(source, /pet-storeApi/);
    assert.doesNotThrow(() => parseToAst(source, endpoints));
  }
});

test('generateServiceFromSpec: a service name that cannot form an identifier is rejected before anything is written (#216)', async () => {
  const dir = tmpProject();
  writeArchitectureYml(dir, '');
  await assert.rejects(() => generateServiceFromSpec(dir, '3d-store', 'pet', petstoreSpec), (err) => {
    assert.ok(err instanceof ConstructError);
    assert.match(err.message, /Service name "3d-store" can't be turned into a valid TypeScript identifier/);
    return true;
  });
  assert.ok(!fs.existsSync(path.join(dir, 'features')));
});

// ---- SERVICE-002 regression (#115 acceptance criterion) -------------------

test('SERVICE-002: this generator\'s own output never trips it, but the rule still fires on a genuinely bad services/ file', async () => {
  const dir = tmpProject();
  writeArchitectureYml(dir, 'dataLayer:\n    provider: mock\n');
  const files = await generateServiceFromSpec(dir, 'petStore', 'pet', petstoreSpec);

  const { violations: cleanViolations } = validateArchitecture(dir, { files });
  assert.equal(cleanViolations.filter((v) => v.rule === 'SERVICE-002').length, 0);

  // Now prove the rule itself is still live: a hand-written services/ file
  // that imports a React UI component must still be flagged.
  const badFile = path.join(dir, 'features', 'pet', 'services', 'badService.ts');
  fs.writeFileSync(
    badFile,
    "import { SomeComponent } from 'react';\n\nexport function badService() {\n  return SomeComponent;\n}\n",
  );
  const { violations, ok } = validateArchitecture(dir, { files: [badFile] });
  assert.equal(ok, false);
  assert.ok(violations.some((v) => v.rule === 'SERVICE-002'), JSON.stringify(violations));
});

// ---- construct create service <name> --feature <f> --openapi <spec> (CLI) -

test('CLI: construct create service <name> --feature <f> --openapi <spec> generates and reports the files', () => {
  const dir = tmpProject();
  writeArchitectureYml(dir, 'dataLayer:\n    provider: mock\n');
  const bin = path.join(repoRoot, 'bin', 'construct.mjs');
  const r = spawnSync('node', [bin, 'create', 'service', 'petStore', '--feature', 'pet', '--openapi', petstoreSpec], {
    encoding: 'utf8',
    cwd: dir,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Created features\/core\/services\/client\.ts/);
  assert.match(r.stdout, /Created features\/pet\/services\/petStoreApi\.ts/);
  assert.ok(fs.existsSync(path.join(dir, 'features', 'pet', 'services', 'petStoreApi.ts')));
});

// ---- real tsc --noEmit compile check (verification bar from #110/#115) ----

test('generated service files (every provider) compile clean under a real tsc --noEmit', { timeout: 60000 }, async () => {
  const tscBin = path.join(repoRoot, 'node_modules', '.bin', 'tsc');
  assert.ok(fs.existsSync(tscBin), 'expected node_modules/.bin/tsc to exist (npm install at repo root)');

  for (const provider of ['fetchBaseQuery', 'axios', 'mock']) {
    const dir = tmpProjectInRepo();
    try {
      writeArchitectureYml(dir, `dataLayer:\n    provider: ${provider}\n`);
      await generateServiceFromSpec(dir, 'petStore', 'pet', petstoreSpec);

      fs.writeFileSync(
        path.join(dir, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              module: 'ES2022',
              moduleResolution: 'bundler',
              lib: ['ES2022', 'DOM'],
              jsx: 'react-jsx',
              types: ['node'],
              strict: true,
              skipLibCheck: true,
              resolveJsonModule: true,
              esModuleInterop: true,
              noEmit: true,
            },
            include: ['features/**/*.ts', 'features/**/*.tsx'],
          },
          null,
          2,
        ),
      );

      const r = spawnSync(tscBin, ['--noEmit', '-p', 'tsconfig.json'], { encoding: 'utf8', cwd: dir });
      assert.equal(r.status, 0, `tsc failed for provider "${provider}":\n${r.stdout}\n${r.stderr}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});
