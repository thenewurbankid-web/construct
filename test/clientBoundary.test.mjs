// CLIENT-001 (#644): a 'use client' file (or a file reachable from one) cannot import server-only
// code. Off by default for existing projects, error in projects `construct init` creates.
// Detection: packages/ast/clientBoundary.mjs (facts) + packages/core/client-boundary.mjs (the walk).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { DEFAULT_RULES, loadConfig } from '../packages/core/config.mjs';
import { validateArchitecture } from '../packages/core/architecture-enforcer.mjs';
import { isServerOnlySpecifier } from '../packages/core/client-boundary.mjs';
import { EXIT_CODES } from '../packages/core/diagnostics.mjs';
import { parseToAst, readModuleDirective, collectModuleEdges, collectSecretEnvReads } from '../packages/ast/index.mjs';
import { ruleKind } from '../packages/engine/units/kinds/meta.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, '..', 'fixtures', 'client-boundary');
const BAD = path.join(FIXTURES, 'project-bad');
const GOOD = path.join(FIXTURES, 'project-good');
const bin = path.join(here, '..', 'packages', 'cli', 'construct.mjs');

const client001 = (root, opts) => validateArchitecture(root, opts).violations.filter((v) => v.rule === 'CLIENT-001');
const at = (vs, file) => vs.filter((v) => v.file === file);

/** A throwaway project: architecture.yml with the given rules, plus the given files. */
function project(files, rules = { 'CLIENT-001': 'error' }, framework = 'nextjs') {
  const dir = makeTempDir('construct-client001-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), yaml.dump({ version: 1, preset: 'strict-nextjs', project: { framework }, features: { root: 'features' }, rules }));
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./*'] } } }));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}
const SERVICE = ['features/shop/services/payments.ts', 'export async function charge(n: number) { return fetch("/charge", { body: String(n) }); }\nexport type Payment = { id: string };\n'];

// ---- registration and defaults ------------------------------------------------------------------

test('CLIENT-001 is registered, off by default, and named for what it forbids', () => {
  assert.equal(DEFAULT_RULES['CLIENT-001'].severity, 'off');
  assert.equal(DEFAULT_RULES['CLIENT-001'].name, "A 'use client' file cannot import server-only code");
});

test('CLIENT-001 is off for an existing project: the same tree with no rule configured reports nothing', () => {
  const dir = project(Object.fromEntries([SERVICE, ['widgets/A.tsx', "'use client';\nimport { charge } from '../features/shop/services/payments';\nexport const A = () => charge(1);\n"]]), {});
  assert.equal(loadConfig(dir).rules['CLIENT-001'].severity, 'off');
  assert.deepEqual(client001(dir), []);
  const on = project(Object.fromEntries([SERVICE, ['widgets/A.tsx', "'use client';\nimport { charge } from '../features/shop/services/payments';\nexport const A = () => charge(1);\n"]]));
  assert.equal(client001(on).length, 1);
});

test('CLIENT-001 shows in the rule listing (the rule unit kind reads DEFAULT_RULES)', () => {
  assert.ok(ruleKind.list().some((r) => r.id === 'CLIENT-001' && r.name === "A 'use client' file cannot import server-only code"));
  assert.equal(ruleKind.resolve({}, 'CLIENT-001')[0].id, 'CLIENT-001');
});

test('`construct init` scaffolds CLIENT-001: error (the rule is on in new projects) and the fresh project validates', () => {
  const dir = makeTempDir('construct-client001-init-');
  const init = spawnSync('node', [bin, 'init', '--no-scaffold'], { encoding: 'utf8', cwd: dir });
  assert.equal(init.status, EXIT_CODES.OK, init.stderr);
  const cfg = yaml.load(fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8'));
  assert.equal(cfg.rules['CLIENT-001'], 'error');
  assert.equal(loadConfig(dir).rules['CLIENT-001'].severity, 'error');
  assert.equal(cfg.rules['DOMAIN-002'], 'off', 'other off-by-default rules stay off');
  assert.deepEqual(client001(dir), []);
});

// ---- the fixture pair ---------------------------------------------------------------------------

test('project-good: server actions, type-only imports, NEXT_PUBLIC_ and server files raise nothing', () => {
  assert.deepEqual(client001(GOOD), []);
  assert.equal(validateArchitecture(GOOD).ok, true);
});

test('project-bad: eight findings, each on the file that draws the edge or reads the variable', () => {
  const v = client001(BAD);
  assert.deepEqual(v.map((x) => `${x.file}:${x.line}`), [
    'features/shop/controllers/CheckoutController.tsx:3',
    'features/shop/hooks/useCheckout.ts:4',
    'lib/billing/index.ts:2',
    'widgets/Mailer.tsx:3',
    'widgets/Mailer.tsx:4',
    'widgets/Mailer.tsx:7',
    'widgets/Secrets.tsx:5',
    'widgets/format.ts:1',
  ]);
  assert.ok(v.every((x) => x.severity === 'error' && x.module === 'architecture'));
  assert.equal(validateArchitecture(BAD).ok, false);
});

test('a client file importing a service (a layer-legal hook) is reported with the service layer as the reason', () => {
  const [f] = at(client001(BAD), 'features/shop/hooks/useCheckout.ts');
  assert.match(f.message, /^"use client" file "features\/shop\/hooks\/useCheckout\.ts" imports "\.\.\/services\/payments" \(features\/shop\/services\/payments\.ts\), which is server-only: it is in the service layer\.$/);
});

test('a client file importing a module that reads process.env.STRIPE_SECRET names the variable and its line', () => {
  const [f] = at(client001(BAD), 'features/shop/controllers/CheckoutController.tsx');
  assert.match(f.message, /imports "@\/lib\/stripeServer" \(lib\/stripeServer\.ts\), which is server-only: it reads process\.env\.STRIPE_SECRET, a non-public environment variable \(line 1\)/);
});

test('a server-only import through a re-export chain is found, on the barrel, with the chain from the client entry', () => {
  const [f] = at(client001(BAD), 'lib/billing/index.ts');
  assert.match(f.message, /^"lib\/billing\/index\.ts" \(reachable from "use client" file "widgets\/Receipt\.tsx"\) re-exports "\.\.\/\.\.\/features\/shop\/services\/payments"/);
  assert.match(f.message, /It is bundled into the browser: widgets\/Receipt\.tsx -> lib\/billing\/index\.ts\.$/);
  assert.deepEqual(at(client001(BAD), 'widgets/Receipt.tsx'), [], 'the client entry itself imports only a clean-looking barrel');
});

test('a file reachable only from a client file counts as client (no directive of its own)', () => {
  const [f] = at(client001(BAD), 'widgets/format.ts');
  assert.match(f.message, /reachable from "use client" file "widgets\/Total\.tsx"/);
  assert.match(f.message, /widgets\/Total\.tsx -> widgets\/format\.ts\.$/);
});

test('a client file reading a non-public variable is reported; NEXT_PUBLIC_ on the line above is not', () => {
  const v = at(client001(BAD), 'widgets/Secrets.tsx');
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 5);
  assert.match(v[0].message, /reads process\.env\.STRIPE_SECRET, a non-public environment variable\.$/);
  assert.match(v[0].suggestedFix, /NEXT_PUBLIC_/);
});

test('the server-only package, an adapter, and a dynamic import() of a configured module are each reported', () => {
  const v = at(client001(BAD), 'widgets/Mailer.tsx');
  assert.match(v[0].message, /imports "nodemailer", a database, SDK or Node module that is server-only/);
  assert.match(v[1].message, /imports "server-only", the "server-only" package/);
  assert.match(v[2].message, /dynamically imports "acme-billing"/, 'acme-billing comes from the rule\'s serverOnly list in architecture.yml');
});

test('the finding text names the file, the offender and the fix', () => {
  const [f] = at(client001(BAD), 'features/shop/hooks/useCheckout.ts');
  assert.equal(f.rule, 'CLIENT-001');
  assert.match(f.why, /shipped to the browser/);
  assert.match(f.suggestedFix, /^move the call behind a server action \(a 'use server' file the client imports instead\) or a service that a server component calls/);
  assert.match(f.suggestedFix, /remove this import from features\/shop\/hooks\/useCheckout\.ts$/);
  assert.deepEqual(f.expected, ["a server action ('use server') or a service called from a server component"]);
});

// ---- negatives and judgement --------------------------------------------------------------------

test('a server file importing a service and reading a secret is allowed', () => {
  const dir = project(Object.fromEntries([SERVICE, ['widgets/Page.tsx', "import { charge } from '../features/shop/services/payments';\nexport const Page = () => charge(Number(process.env.STRIPE_SECRET));\n"]]));
  assert.deepEqual(client001(dir), []);
});

test('a file imported by both a server entry and a client entry is judged from the client edge', () => {
  const dir = project(Object.fromEntries([SERVICE,
    ['widgets/shared.ts', "import { charge } from '../features/shop/services/payments';\nexport const pay = charge;\n"],
    ['widgets/Server.tsx', "import { pay } from './shared';\nexport const S = () => pay(1);\n"],
    ['widgets/Client.tsx', "'use client';\nimport { pay } from './shared';\nexport const C = () => pay(2);\n"]]));
  const v = client001(dir);
  assert.deepEqual(v.map((x) => x.file), ['widgets/shared.ts']);
  assert.match(v[0].message, /reachable from "use client" file "widgets\/Client\.tsx"/);
});

test('type-only imports are erased and never count, in every spelling', () => {
  const dir = project(Object.fromEntries([SERVICE, ['widgets/T.tsx', [
    "'use client';",
    "import type { Payment } from '../features/shop/services/payments';",
    "import { type Payment as P2 } from '../features/shop/services/payments';",
    "export type { Payment } from '../features/shop/services/payments';",
    "import type Stripe from 'stripe';",
    'export const T = (p: Payment | P2, s?: Stripe) => String(p.id) + String(s);', ''].join('\n')]]));
  assert.deepEqual(client001(dir), []);
});

test("a 'use server' file is the sanctioned boundary: a client imports it, and nothing behind it is followed", () => {
  const dir = project(Object.fromEntries([SERVICE,
    ['actions/pay.ts', "'use server';\nimport { charge } from '../features/shop/services/payments';\nimport Stripe from 'stripe';\nexport async function pay(n: number) { void Stripe; return charge(n); }\n"],
    ['widgets/Buy.tsx', "'use client';\nimport { pay } from '../actions/pay';\nexport const Buy = () => pay(1);\n"]]));
  assert.deepEqual(client001(dir), []);
});

test('a service that carries its own \'use server\' directive is a server action, not a leak', () => {
  const dir = project({
    'features/shop/services/payments.ts': "'use server';\nexport async function charge(n: number) { return n; }\n",
    'widgets/Buy.tsx': "'use client';\nimport { charge } from '../features/shop/services/payments';\nexport const Buy = () => charge(1);\n",
  });
  assert.deepEqual(client001(dir), []);
});

test('NEXT_PUBLIC_ and NODE_ENV reads are allowed in a client file; a destructured secret and a computed key are not', () => {
  const dir = project({
    'widgets/Env.tsx': [
      "'use client';",
      'export const a = process.env.NEXT_PUBLIC_API;',
      'export const b = process.env.NODE_ENV;',
      "export const c = process.env['NEXT_PUBLIC_X'];",
      'export const { DB_URL, NEXT_PUBLIC_OK } = process.env;',
      "export const d = process.env['API_KEY'];",
      'export const e = process.env;', ''].join('\n'),
  });
  assert.deepEqual(client001(dir).map((v) => [v.line, v.message.match(/process\.env\.(\w+)/)[1]]), [[5, 'DB_URL'], [6, 'API_KEY']]);
});

test("the directive must be in the prologue: a comment, a later string, or ('use client') does not make a client file", () => {
  const dir = project(Object.fromEntries([SERVICE,
    ['widgets/A.tsx', "// 'use client'\nimport { charge } from '../features/shop/services/payments';\nexport const A = () => charge(1);\n"],
    ['widgets/B.tsx', "import { charge } from '../features/shop/services/payments';\n'use client';\nexport const B = () => charge(1);\n"],
    ['widgets/C.tsx', "('use client');\nimport { charge } from '../features/shop/services/payments';\nexport const C = () => charge(1);\n"],
    ['widgets/D.tsx', "/* header */\n'use strict';\n'use client';\nimport { charge } from '../features/shop/services/payments';\nexport const D = () => charge(1);\n"]]));
  assert.deepEqual(client001(dir).map((v) => v.file), ['widgets/D.tsx'], 'only D has a real directive prologue');
});

test('a server-only module reached only through another server-only module is reported once, at the client edge', () => {
  const dir = project({
    'lib/db.ts': "import { Pool } from 'pg';\nexport const db = new Pool();\n",
    'lib/users.ts': "import { db } from './db';\nimport { readFileSync } from 'node:fs';\nexport const users = () => [db, readFileSync];\n",
    'widgets/U.tsx': "'use client';\nimport { users } from '../lib/users';\nexport const U = () => users();\n",
  });
  const v = client001(dir);
  assert.equal(v.length, 1);
  assert.equal(v[0].file, 'widgets/U.tsx');
  assert.match(v[0].message, /it imports "node:fs", a server-side adapter \(line 2\)/);
});

// ---- configuration ------------------------------------------------------------------------------

test('serverOnly in architecture.yml extends the default list (exact name, subpath and scope wildcard)', () => {
  assert.equal(isServerOnlySpecifier('acme-billing'), null);
  assert.deepEqual(isServerOnlySpecifier('acme-billing/lite', ['acme-billing']), { kind: 'adapter' });
  assert.deepEqual(isServerOnlySpecifier('@acme/ledger', ['@acme/*']), { kind: 'adapter' });
  assert.deepEqual(isServerOnlySpecifier('node:child_process'), { kind: 'adapter' });
  assert.deepEqual(isServerOnlySpecifier('@aws-sdk/client-s3'), { kind: 'adapter' });
  assert.deepEqual(isServerOnlySpecifier('server-only'), { kind: 'server-only' });
  assert.equal(isServerOnlySpecifier('pg-boss'), null, 'a prefix of a name is not a match');
  assert.equal(isServerOnlySpecifier('react'), null);
});

test('serviceLayer: false stops the service layer counting as server-only, and nothing else changes', () => {
  const files = Object.fromEntries([SERVICE,
    ['widgets/A.tsx', "'use client';\nimport { charge } from '../features/shop/services/payments';\nimport Stripe from 'stripe';\nexport const A = () => [charge(1), Stripe];\n"]]);
  assert.equal(client001(project(files)).length, 2);
  const off = client001(project(files, { 'CLIENT-001': { severity: 'error', serviceLayer: false } }));
  assert.deepEqual(off.map((v) => v.line), [3], 'only the stripe adapter is left');
});

test('a malformed serverOnly option is a usage error naming the rule', () => {
  const dir = project({ 'widgets/A.tsx': "'use client';\nexport const A = 1;\n" }, { 'CLIENT-001': { severity: 'error', serverOnly: 'stripe' } });
  assert.throws(() => validateArchitecture(dir), (e) => e.exitCode === EXIT_CODES.USAGE_ERROR && /CLIENT-001/.test(e.message));
});

test('an exception by path silences a finding like any other rule; a warning severity is honoured', () => {
  const files = Object.fromEntries([SERVICE, ['widgets/A.tsx', "'use client';\nimport { charge } from '../features/shop/services/payments';\nexport const A = () => charge(1);\n"]]);
  const warn = project(files, { 'CLIENT-001': 'warning' });
  assert.deepEqual(client001(warn).map((v) => v.severity), ['warning']);
  const dir = project(files);
  const cfg = yaml.load(fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8'));
  cfg.exceptions = [{ rule: 'CLIENT-001', path: 'widgets/A.tsx', reason: 'browser-safe service', expires: '2999-01-01' }];
  fs.writeFileSync(path.join(dir, 'architecture.yml'), yaml.dump(cfg));
  assert.deepEqual(client001(dir), []);
});

test('scoping validate to files reports only findings in those files (the walk still sees the whole tree)', () => {
  const v = client001(BAD, { files: ['widgets/format.ts'] });
  assert.deepEqual(v.map((x) => x.file), ['widgets/format.ts']);
  assert.deepEqual(client001(GOOD, { files: ['widgets/BuyButton.tsx'] }), []);
});

// ---- the AST facts ------------------------------------------------------------------------------

test('readModuleDirective reads only the leading prologue', () => {
  const d = (s) => readModuleDirective(parseToAst(s));
  assert.equal(d("'use client';\nimport a from 'a';"), 'client');
  assert.equal(d('"use client"\nexport {};'), 'client');
  assert.equal(d("'use server';\nexport async function f() {}"), 'server');
  assert.equal(d("// 'use client'\nexport {};"), null);
  assert.equal(d("export {};\n'use client';"), null);
  assert.equal(d("('use client');"), null);
  assert.equal(d(''), null);
});

test('collectModuleEdges lists value edges only: imports, re-exports and literal dynamic imports', () => {
  const src = [
    "import a from './a';", "import type { B } from './b';", "import { type C } from './c';", "import { d, type E } from './d';",
    "import './side';", "export * from './all';", "export type * from './types';", "export { x } from './named';", "export type { Y } from './y';",
    "const l = import('./lazy'); const t = import(`./tpl`); const dyn = import(name); const sub = import(`./sub/${name}`);", ''].join('\n');
  const edges = collectModuleEdges(parseToAst(src), src);
  assert.deepEqual(edges.map((e) => [e.specifier, e.kind]), [
    ['./a', 'import'], ['./d', 'import'], ['./side', 'import'], ['./all', 'reexport'], ['./named', 'reexport'], ['./lazy', 'dynamic'], ['./tpl', 'dynamic']]);
  assert.equal(edges[0].line, 1);
});

test('collectSecretEnvReads: member, optional member, computed literal and destructuring; public names filtered', () => {
  const src = "const a = process.env.SECRET_A;\nconst b = process.env?.SECRET_B;\nconst c = process.env['SECRET_C'];\nconst { SECRET_D, NEXT_PUBLIC_E, F: renamed, ...rest } = process.env;\nconst g = process.env.NEXT_PUBLIC_G + process.env.NODE_ENV;\nconst h = other.process.env.NOPE;\nconst i = process.env[key];\n";
  const reads = collectSecretEnvReads(parseToAst(src), src);
  assert.deepEqual(reads.map((r) => [r.name, r.line]), [['SECRET_A', 1], ['SECRET_B', 2], ['SECRET_C', 3], ['SECRET_D', 4], ['F', 4]]);
});
