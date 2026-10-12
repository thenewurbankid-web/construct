#!/usr/bin/env node
// The control arm's only tool: plain file access to one project folder, no Line. The same project flags and call log
// as plan-cli.mjs, so metrics read both arms the same way.
//
//   plain-cli.mjs ls [dir]            the entries of one folder
//   plain-cli.mjs tree [dir]          every file under a folder (node_modules, .next and .git left out)
//   plain-cli.mjs read <path>         one file
//   plain-cli.mjs write <path>        replace or create one file with stdin (or the --content value)
//   plain-cli.mjs run <script>        npm run build | lint | tsc in the project (output tail and exit code)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SKIP = new Set(['node_modules', '.next', '.git']);
export const SCRIPTS = Object.freeze(['build', 'lint', 'tsc']);
const MAX = 64 * 1024;
const sentence = (s) => { const t = String(s ?? '').trim().replace(/\s+/g, ' '); return /[.?!]$/.test(t) ? t : `${t}.`; };

function inside(root, rel) {
  const p = String(rel ?? '.').replace(/^\.\/?/, '') || '.';
  if (path.isAbsolute(p) || p.split('/').some((s) => s === '..' || SKIP.has(s))) return null;
  const abs = path.resolve(root, p);
  return abs === root || abs.startsWith(root + path.sep) ? abs : null;
}

/**
 * One plain-cli session over a project folder.
 * @param {{project: string, log?: string, builder?: string}} o
 */
export function createPlainCli({ project, log, builder = 'unknown' }) {
  const root = fs.realpathSync(path.resolve(project));
  const logFile = log ?? path.join(here, '..', 'runs', path.basename(root), 'calls.jsonl');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const record = (e) => fs.appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), builder, ...e })}\n`);
  const commands = {
    ls(rel = '.') {
      const abs = inside(root, rel);
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return { ok: false, code: 'NOT_FOUND', sentence: `There is no folder ${rel}.` };
      const entries = fs.readdirSync(abs, { withFileTypes: true }).filter((e) => !SKIP.has(e.name)).map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort();
      return { ok: true, path: path.relative(root, abs) || '.', entries, sentence: `${entries.length} entries.` };
    },
    tree(rel = '.') {
      const abs = inside(root, rel);
      if (!abs || !fs.existsSync(abs)) return { ok: false, code: 'NOT_FOUND', sentence: `There is no folder ${rel}.` };
      const files = [];
      const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(path.relative(root, p)); } };
      walk(abs);
      return { ok: true, files: files.sort(), sentence: `${files.length} files.` };
    },
    read(rel) {
      const abs = inside(root, rel);
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return { ok: false, code: 'NOT_FOUND', sentence: `There is no file ${rel}.` };
      const content = fs.readFileSync(abs, 'utf8');
      if (content.length > MAX) return { ok: false, code: 'TOO_BIG', sentence: `${rel} is over 64 KB.` };
      return { ok: true, path: path.relative(root, abs), content, sentence: `Read ${path.relative(root, abs)}.` };
    },
    write(rel, content) {
      const abs = inside(root, rel);
      if (!abs || abs === root) return { ok: false, code: 'BAD_PATH', sentence: `${rel} is not a file path inside the project.` };
      if (typeof content !== 'string') return { ok: false, code: 'NO_CONTENT', sentence: 'Give the file content on stdin or with --content.' };
      if (Buffer.byteLength(content) > MAX) return { ok: false, code: 'TOO_BIG', sentence: 'The file is over 64 KB.' };
      const existed = fs.existsSync(abs);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
      return { ok: true, path: path.relative(root, abs), sentence: `${existed ? 'Replaced' : 'Created'} ${path.relative(root, abs)}.` };
    },
    run(script) {
      if (!SCRIPTS.includes(script)) return { ok: false, code: 'BAD_SCRIPT', sentence: `Only ${SCRIPTS.join(', ')} can run.` };
      const r = spawnSync('npm', ['run', '--silent', script], { cwd: root, encoding: 'utf8', timeout: 600_000, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      return { ok: r.status === 0, exitCode: r.status, output: out.slice(-6000), sentence: `npm run ${script} ended with exit code ${r.status}.` };
    },
  };
  async function run(cmd, rest = [], opts = {}) {
    const t0 = Date.now();
    let out;
    try {
      if (!Object.hasOwn(commands, cmd)) out = { ok: false, code: 'UNKNOWN_COMMAND', sentence: `There is no command ${cmd}; use one of ${Object.keys(commands).join(', ')}.` };
      else if (cmd === 'write') out = commands.write(rest[0], opts.content);
      else out = commands[cmd](...rest);
    } catch (e) {
      out = { ok: false, code: 'CRASH', sentence: `plain-cli failed: ${/** @type {Error} */ (e).message}` };
    }
    out.sentence = sentence(out.sentence);
    record({ kind: 'call', cmd, args: rest, bytes: typeof opts.content === 'string' ? Buffer.byteLength(opts.content) : null, ms: Date.now() - t0, result: { ok: out.ok, code: out.code ?? null, sentence: out.sentence } });
    return out;
  }
  return { run, root, logFile };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const o = { cmd: '', rest: /** @type {string[]} */ ([]), content: undefined, project: process.env.BENCH_PROJECT, log: process.env.BENCH_LOG, builder: process.env.BENCH_BUILDER };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--project') o.project = argv[++i];
    else if (a === '--log') o.log = argv[++i];
    else if (a === '--builder') o.builder = argv[++i];
    else if (a === '--content') o.content = argv[++i];
    else if (!o.cmd) o.cmd = a;
    else o.rest.push(a);
  }
  if (!o.project || !o.cmd) { console.log(JSON.stringify({ ok: false, sentence: 'Usage: plain-cli.mjs --project <dir> <ls|tree|read|write|run> [...] (or set BENCH_PROJECT).' })); process.exit(2); }
  if (o.cmd === 'write' && o.content === undefined && !process.stdin.isTTY) o.content = fs.readFileSync(0, 'utf8');
  const cli = createPlainCli(o);
  const out = await cli.run(o.cmd, o.rest, { content: o.content });
  console.log(JSON.stringify(out, null, 1));
  process.exit(out.ok ? 0 : 1);
}
