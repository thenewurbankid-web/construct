#!/usr/bin/env node
// Rewrite LINE-MODULE deep imports (one package reaching into another by a relative path, or by a subpath
// the other package's "exports" does not list) into imports by the package's name plus a listed subpath,
// adding the subpath to that package's "exports" when it is missing.
//
//   node packages/tools/line-module/fix-imports.mjs [--dir .] [--dry-run]
//
// Deterministic: the findings come from `construct validate --profile line` itself (rule LINE-MODULE), so the
// script fixes exactly what the rule reports. For each finding:
//   1. resolve the imported file inside the other package;
//   2. find the "exports" key whose target is that file (reuse it); else add one: the path without its
//      extension, `index` dropped, camelCase turned to kebab-case ("./engine/transactionalWriter.mjs" ->
//      "./transactional-writer"); a key already used for another file stops the script (fix by hand);
//   3. replace the specifier (quoted string on the reported line) with "<package name><key without the dot>".
// Prints one line per rewrite and per added export; exits 1 when a finding could not be fixed.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { write } from '@line/construct-core/fs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dirArg = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : '.';
const root = resolve(dirArg);
const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '../../cli/construct.mjs');

let out;
try {
  out = execFileSync(process.execPath, [cli, 'validate', '--dir', root, '--profile', 'line', '--format', 'json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
} catch (err) {
  out = err.stdout; // validate exits non-zero when it finds errors
}
const findings = JSON.parse(out).violations.filter((v) => v.rule === 'LINE-MODULE' && !v.file.endsWith('/package.json'));

const pkgCache = new Map();
/** The package (folder holding package.json, below packages/) that owns a root-relative path. */
function ownerOf(rel) {
  let d = posix.dirname(rel);
  while (d && d !== '.') {
    if (existsSync(join(root, d, 'package.json'))) {
      if (!pkgCache.has(d)) pkgCache.set(d, { dir: d, json: JSON.parse(readFileSync(join(root, d, 'package.json'), 'utf8')), dirty: false });
      return pkgCache.get(d);
    }
    d = posix.dirname(d);
  }
  return null;
}

function resolveFile(rel) {
  for (const c of [rel, `${rel}.mjs`, `${rel}.js`, `${rel}/index.mjs`, `${rel}/index.js`]) {
    if (existsSync(join(root, c)) && !c.endsWith('/')) {
      try { readFileSync(join(root, c)); return c; } catch { /* a folder */ }
    }
  }
  return null;
}

const targetOf = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? (v.import ?? v.default ?? v.node ?? null) : null);
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** The "exports" key for a file of a package, adding one when none lists it. */
function exportKey(pkg, fileInPkg) {
  const exp = pkg.json.exports ?? (pkg.json.exports = {});
  for (const [k, v] of Object.entries(exp)) {
    const t = targetOf(v);
    if (t && posix.normalize(t) === posix.normalize(`./${fileInPkg}`)) return k;
  }
  let key = `./${fileInPkg.replace(/\.[cm]?[jt]s$/, '').replace(/(^|\/)index$/, '')}`.replace(/\/$/, '');
  key = key === '.' ? '.' : key.split('/').map(kebab).join('/');
  if (exp[key] !== undefined) throw new Error(`${pkg.dir}/package.json "exports" already has "${key}" for another file; cannot list ./${fileInPkg} under it`);
  exp[key] = `./${fileInPkg}`;
  pkg.dirty = true;
  console.log(`export  ${pkg.json.name} "${key}" -> ./${fileInPkg}`);
  return key;
}

const edits = new Map(); // file -> [{line, from, to}]
let failed = 0;
for (const f of findings) {
  const spec = f.message.match(/imports "([^"]+)"/)?.[1];
  try {
    if (!spec) throw new Error('no specifier in the message');
    let pkg; let fileInPkg;
    if (spec.startsWith('.')) {
      const target = resolveFile(posix.normalize(posix.join(posix.dirname(f.file), spec)));
      if (!target) throw new Error(`cannot resolve ${spec}`);
      pkg = ownerOf(target);
      fileInPkg = posix.relative(pkg.dir, target);
    } else {
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      pkg = execFileSync('git', ['-C', root, 'ls-files', 'packages/*/package.json', 'packages/@*/*/package.json'], { encoding: 'utf8' })
        .split('\n').filter(Boolean).map((pj) => ownerOf(pj)).find((p) => p && p.json.name === name);
      if (!pkg) throw new Error(`no package named ${name}`);
      const target = resolveFile(posix.join(pkg.dir, spec.slice(name.length + 1)));
      if (!target) throw new Error(`cannot resolve ${spec}`);
      fileInPkg = posix.relative(pkg.dir, target);
    }
    if (!pkg.json.name) throw new Error(`${pkg.dir}/package.json has no name`);
    const key = exportKey(pkg, fileInPkg);
    const to = key === '.' ? pkg.json.name : `${pkg.json.name}${key.slice(1)}`;
    if (!edits.has(f.file)) edits.set(f.file, []);
    edits.get(f.file).push({ line: f.line, from: spec, to });
  } catch (err) {
    failed++;
    console.error(`skip    ${f.file}:${f.line} ${spec}: ${err.message}`);
  }
}

for (const [file, list] of edits) {
  const lines = readFileSync(join(root, file), 'utf8').split('\n');
  for (const e of list) {
    // The reported line is where the import node starts; the specifier may sit a few lines below (multi-line imports).
    let done = false;
    for (let i = e.line - 1; i < Math.min(lines.length, e.line + 40) && !done; i++) {
      for (const q of ["'", '"', '`']) {
        const needle = `${q}${e.from}${q}`;
        if (lines[i].includes(needle)) { lines[i] = lines[i].replace(needle, `${q}${e.to}${q}`); done = true; break; }
      }
    }
    if (!done) { failed++; console.error(`skip    ${file}:${e.line} ${e.from}: specifier not found near the line`); continue; }
    console.log(`rewrite ${file}:${e.line} ${e.from} -> ${e.to}`);
  }
  if (!dryRun) write(join(root, file), lines.join('\n'));
}
for (const p of pkgCache.values()) {
  if (p.dirty && !dryRun) write(join(root, p.dir, 'package.json'), `${JSON.stringify(p.json, null, 2)}\n`);
}
console.log(`${findings.length} findings, ${findings.length - failed} fixed${dryRun ? ' (dry run)' : ''}, ${failed} left`);
process.exit(failed ? 1 : 0);
