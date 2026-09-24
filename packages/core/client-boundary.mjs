// CLIENT-001 (#644): a file marked 'use client', and every file that only it (or another client
// file) pulls in, is shipped to the browser, so none of them may import server-only code.
//
// Deterministic, no model: the AST facts come from packages/ast/clientBoundary.mjs (directive, value
// edges, non-public process.env reads); this module owns the project-wide walk and the verdicts.
//
// Model. Client entries are the files whose directive prologue is 'use client'. The client set is
// everything reachable from an entry through value edges (import, re-export, dynamic import; type-only
// edges are erased and never count). A file imported by both a server and a client entry is therefore
// judged from the client edge. The walk stops at:
//   * a 'use server' file: a server-action boundary. The browser gets an RPC stub, so importing one
//     is the sanctioned fix, and nothing behind it is followed;
//   * a server-only module: it is already reported, and what it imports is a consequence.
// A module is server-only when it is in the project's `service` layer, imports the `server-only`
// package, imports a database/SDK/Node adapter (default list below, extended by the rule's
// `serverOnly` option in architecture.yml), or reads a non-public process.env variable. A project
// whose service layer holds browser-side API clients sets `serviceLayer: false` on the rule. A finding sits
// on the file that draws the offending edge (or reads the variable) and names the client entry and
// the chain that puts that file in the browser, so `exceptions:` by path work as for every rule.
import fs from 'node:fs';
import path from 'node:path';
import { parseToAst } from '../../packages/ast/parse.mjs';
import { readModuleDirective, collectModuleEdges, collectSecretEnvReads } from '../../packages/ast/clientBoundary.mjs';
import { classifyFile } from './architecture-graph.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { walk, rel } from './fs.mjs';
import { matchFrozen } from './frozen.mjs';
import { isNonLayerPath } from './nonLayer.mjs';
import { readPathAliases, resolveImportSpecifier } from './route-resolver.mjs';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

/** The package that, imported, marks a module as one that must never reach the browser. */
export const SERVER_ONLY_PACKAGE = 'server-only';

/**
 * Databases, external SDKs and Node built-ins a browser bundle can neither run nor be trusted with.
 * An entry matches the package itself and any subpath (`pg` also matches `pg/lib/x`); a trailing
 * `/*` (`@aws-sdk/*`) matches every package under that scope. A `node:` prefix is ignored.
 * A project adds its own through the rule's `serverOnly` list in architecture.yml.
 *
 * @type {readonly string[]}
 */
export const DEFAULT_SERVER_ONLY_MODULES = Object.freeze([
  '@prisma/client', 'prisma', 'pg', 'pg-promise', 'mysql', 'mysql2', 'mongodb', 'mongoose', 'redis', 'ioredis',
  'better-sqlite3', 'sqlite3', 'knex', 'typeorm', 'sequelize', 'drizzle-orm',
  'stripe', 'aws-sdk', '@aws-sdk/*', 'nodemailer', '@sendgrid/mail', 'twilio', 'firebase-admin',
  'bcrypt', 'bcryptjs', 'jsonwebtoken',
  'fs', 'fs/promises', 'child_process', 'net', 'tls', 'dgram', 'cluster', 'worker_threads',
]);

function matchesModuleList(specifier, list) {
  const spec = specifier.replace(/^node:/, '');
  return list.some((entry) => {
    const e = entry.replace(/^node:/, '');
    if (e.endsWith('/*')) return spec.startsWith(e.slice(0, -1));
    return spec === e || spec.startsWith(`${e}/`);
  });
}

/**
 * Whether a bare module specifier is a server-only package: `server-only` itself, or one on the
 * default adapter list or the caller's extra list.
 *
 * @param {string} specifier The import specifier, for example `stripe` or `@aws-sdk/client-s3`.
 * @param {string[]} [extra] Extra package names or `scope/*` patterns (the rule's `serverOnly` option).
 * @returns {{kind:'server-only'|'adapter'}|null} Why it is server-only, or `null` when it is not.
 *
 * @example
 * isServerOnlySpecifier('@aws-sdk/client-s3'); // => { kind: 'adapter' }
 */
export function isServerOnlySpecifier(specifier, extra = []) {
  if (specifier === SERVER_ONLY_PACKAGE) return { kind: 'server-only' };
  if (matchesModuleList(specifier, DEFAULT_SERVER_ONLY_MODULES) || matchesModuleList(specifier, extra)) return { kind: 'adapter' };
  return null;
}

function readExtraModules(options) {
  const list = options?.serverOnly;
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.some((s) => typeof s !== 'string' || !s)) {
    throw new ConstructError(
      "Invalid configuration for rule 'CLIENT-001' in architecture.yml — 'serverOnly' must be a list of package names (for example ['my-sdk', '@acme/*']).",
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  return list;
}

const WHY = "A module marked 'use client' (and every module only it pulls in) is bundled and shipped to the browser. Server-only code there leaks secrets and credentials, or breaks the build, because a browser cannot run a database driver or Node's fs.";

/**
 * Find every CLIENT-001 finding in a project: a 'use client' file, or a file reachable from one, that
 * imports server-only code or reads a non-public environment variable. Read-only; the caller decides
 * severity, exceptions and scope.
 *
 * @param {string} root Project root.
 * @param {object} ctx What the walk needs from the caller.
 * @param {Record<string, {pattern?: string, canImport: string[]}>} ctx.graph The layer graph (`loadLayerGraph`), to find the `service` layer.
 * @param {string[]} [ctx.frozenGlobs] Frozen globs; frozen files are externally authored and skipped.
 * @param {string[]} [ctx.nonLayerGlobs] Non-layer globs (tests); skipped.
 * @param {object} [ctx.options] The CLIENT-001 rule entry; `serverOnly` extends the default adapter list, and `serviceLayer: false` stops treating the service layer as server-only (for a project whose services are browser-side API clients).
 * @returns {{rule:'CLIENT-001', file:string, line:number, message:string, why:string, expected:string[], suggestedFix:string}[]} Finding descriptors (project-relative `file`), sorted by file then line.
 * @throws {Error} A usage error when the `serverOnly` option is not a list of strings.
 *
 * @example
 * checkClientBoundary(root, { graph: loadLayerGraph(root) }).map((f) => f.message);
 */
export function checkClientBoundary(root, { graph, frozenGlobs = [], nonLayerGlobs = [], options = {} } = {}) {
  const extra = readExtraModules(options);
  const serviceLayerIsServerOnly = options?.serviceLayer !== false;
  const aliases = readPathAliases(root).aliases;
  const skip = (abs) => (frozenGlobs.length && matchFrozen(root, abs, frozenGlobs)) || (nonLayerGlobs.length && isNonLayerPath(root, abs, nonLayerGlobs));
  const inRoot = (abs) => { const r = path.relative(root, abs); return r && !r.startsWith('..') && !path.isAbsolute(r); };

  const memo = new Map();
  const factsOf = (abs) => {
    if (memo.has(abs)) return memo.get(abs);
    let facts = null;
    try {
      const source = fs.readFileSync(abs, 'utf8');
      const ast = parseToAst(source);
      const directive = readModuleDirective(ast);
      const edges = collectModuleEdges(ast, source).map((e) => ({ ...e, target: e.specifier.startsWith('.') || aliases.some((a) => e.specifier.startsWith(a.prefix)) ? resolveImportSpecifier(abs, e.specifier, aliases) : null }));
      const envReads = collectSecretEnvReads(ast, source);
      facts = { directive, edges, envReads };
    } catch { facts = null; } // unreadable or unparseable: nothing to say about it here
    memo.set(abs, facts);
    return facts;
  };

  // Why a (non-client, non-server-action) project file is server-only on its own, or null.
  const taintMemo = new Map();
  const taintOf = (abs) => {
    if (taintMemo.has(abs)) return taintMemo.get(abs);
    const f = factsOf(abs);
    let taint = null;
    if (f && !f.directive) {
      if (serviceLayerIsServerOnly && classifyFile(rel(root, abs), graph) === 'service') taint = { text: 'it is in the service layer' };
      for (const e of f.edges) {
        if (taint) break;
        const so = e.target ? null : isServerOnlySpecifier(e.specifier, extra);
        if (so?.kind === 'server-only') taint = { text: `it imports the "${SERVER_ONLY_PACKAGE}" package (line ${e.line})` };
        else if (so) taint = { text: `it imports "${e.specifier}", a server-side adapter (line ${e.line})` };
      }
      if (!taint && f.envReads.length) taint = { text: `it reads process.env.${f.envReads[0].name}, a non-public environment variable (line ${f.envReads[0].line})` };
    }
    taintMemo.set(abs, taint);
    return taint;
  };

  const candidates = walk(root).filter((p) => SOURCE_EXTENSIONS.has(path.extname(p)) && inRoot(p) && !skip(p)).sort();
  const seeds = candidates.filter((abs) => {
    try { if (!fs.readFileSync(abs, 'utf8').includes('use client')) return false; } catch { return false; } // cheap pre-filter; the AST decides
    return factsOf(abs)?.directive === 'client';
  });

  const findings = [];
  const seen = new Set();
  const chainOf = new Map(seeds.map((s) => [s, [s]]));
  const queue = [...seeds];
  const report = (abs, line, key, sentence, fix) => {
    const id = `${abs}:${key}`;
    if (seen.has(id)) return;
    seen.add(id);
    const chain = chainOf.get(abs);
    const isEntry = chain.length === 1;
    const via = isEntry ? '' : ` It is bundled into the browser: ${chain.map((c) => rel(root, c)).join(' -> ')}.`;
    findings.push({
      rule: 'CLIENT-001', file: rel(root, abs), line,
      message: `${isEntry ? `"use client" file "${rel(root, abs)}"` : `"${rel(root, abs)}" (reachable from "use client" file "${rel(root, chain[0])}")`} ${sentence}.${via}`,
      why: WHY,
      expected: ["a server action ('use server') or a service called from a server component"],
      suggestedFix: fix,
    });
  };
  const fixImport = (abs) => `move the call behind a server action (a 'use server' file the client imports instead) or a service that a server component calls, then pass the result to the client as props; remove this import from ${rel(root, abs)}`;

  while (queue.length) {
    const abs = queue.shift();
    const f = factsOf(abs);
    if (!f) continue;
    const isEntry = chainOf.get(abs).length === 1;
    for (const e of f.edges) {
      const verb = e.kind === 'dynamic' ? 'dynamically imports' : e.kind === 'reexport' ? 're-exports' : 'imports';
      if (!e.target) {
        const so = isServerOnlySpecifier(e.specifier, extra);
        if (!so) continue;
        report(abs, e.line, `edge:${e.specifier}:${e.line}`, `${verb} "${e.specifier}", ${so.kind === 'server-only' ? `the "${SERVER_ONLY_PACKAGE}" package, which marks code that must never reach the browser` : 'a database, SDK or Node module that is server-only'}`, fixImport(abs));
        continue;
      }
      if (!inRoot(e.target) || skip(e.target)) continue;
      const tf = factsOf(e.target);
      if (!tf || tf.directive === 'server' || tf.directive === 'client') continue; // action boundary / an entry judged on its own
      const taint = taintOf(e.target);
      if (taint) {
        report(abs, e.line, `edge:${e.specifier}:${e.line}`, `${verb} "${e.specifier}" (${rel(root, e.target)}), which is server-only: ${taint.text}`, fixImport(abs));
        continue;
      }
      if (!chainOf.has(e.target)) { chainOf.set(e.target, [...chainOf.get(abs), e.target]); queue.push(e.target); }
    }
    if (isEntry) {
      for (const r of f.envReads) {
        report(abs, r.line, `env:${r.name}:${r.line}`, `reads process.env.${r.name}, a non-public environment variable`,
          `read it on the server (a server action, route handler or server component) and pass only the result to the client; only a value that is safe to publish belongs in a NEXT_PUBLIC_ variable`);
      }
    }
  }
  return findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
}
