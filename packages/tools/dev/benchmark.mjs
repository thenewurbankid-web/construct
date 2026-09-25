#!/usr/bin/env node
// #648 -- cold start time and peak memory of the commands people run, compared with packages/tools/dev/budgets.json.
// Deterministic apart from the machine's own timing: no model, no network (the Cockpit check talks to its own loopback port).
//
//   node packages/tools/dev/benchmark.mjs                     measure, compare, write the report, exit 1 on a regression
//   node packages/tools/dev/benchmark.mjs --runs 5            runs per command (default 3; the median is compared)
//   node packages/tools/dev/benchmark.mjs --only version,validate
//   node packages/tools/dev/benchmark.mjs --out report.json   where the JSON report goes (default: benchmark-report.json beside this file, git-ignored)
//   node packages/tools/dev/benchmark.mjs --update-docs       also refresh benchmark-snapshot.json and the generated tables of
//                                                             site/content/user/system-requirements.md from this run
//   node packages/tools/dev/benchmark.mjs --docs-only         no measuring: regenerate the page's tables from TIERS and the committed snapshot
//
// Peak memory: GNU `/usr/bin/time -f %M` where it exists (the largest resident set of the command and everything it started),
// else a `ps` sampling of the command; where neither works the memory of that check is "unmeasured" (reported, never a failure).
// The numbers the docs quote come from a `--update-docs` run of this script, never from an estimate.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderTierTable } from '../../core/machine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
/** The budgets file: data only, one entry per check with `maxMs` and `maxRssMb`. */
export const BUDGETS_FILE = path.join(HERE, 'budgets.json');
/** The committed numbers the docs quote (written by `--update-docs`). */
export const SNAPSHOT_FILE = path.join(HERE, 'benchmark-snapshot.json');
/** The page whose generated tables `--update-docs` refreshes. */
export const REQUIREMENTS_PAGE = path.join(REPO, 'site', 'content', 'user', 'system-requirements.md');
const FIXTURE = path.join(REPO, 'fixtures', 'architecture-valid-react-spa');
const CLI = path.join(REPO, 'packages', 'cli', 'construct.mjs');

/**
 * The checks, in report order: what is run and how it is described to a person.
 *
 * @type {readonly { id: string, label: string, args?: string[] }[]}
 */
export const CHECKS = Object.freeze([
  { id: 'version', label: 'construct --version', args: ['--version'] },
  { id: 'validate', label: 'construct validate (small project)', args: ['validate', '--dir', FIXTURE] },
  { id: 'summarize', label: 'construct summarize (small project)', args: ['summarize', '--dir', FIXTURE] },
  { id: 'decide', label: 'construct decide --requirement', args: ['decide', '--requirement', 'Show a list of products', '--dir', FIXTURE] },
  { id: 'cockpit-start', label: 'Cockpit server, start until it answers' },
]);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Min, median and max of a list of numbers (`null`s left out); `null` for an empty list.
 *
 * @param {(number|null)[]} xs Values.
 * @returns {{ min: number, median: number, max: number } | null} The spread.
 */
export function spread(xs) {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? { min: Math.min(...v), median: median(v), max: Math.max(...v) } : null;
}

/**
 * Compare measurements with the budgets. A check passes when its median time and median peak memory are within the budget;
 * a time or memory above its budget is a `regression`; a check that has a budget but no measurement and no stated reason for
 * skipping is `missing` (someone removed it); a check skipped with a reason is `skipped`; memory that could not be measured
 * is `unmeasured` for the memory only. `ok` is false when any check is a regression or missing.
 *
 * @param {Record<string, { skipped?: string, ms?: number | null, rssMb?: number | null }>} measurements By check id: the median time and peak memory, or a `skipped` reason.
 * @param {{ checks: Record<string, { maxMs?: number, maxRssMb?: number }> }} budgets The parsed budgets file.
 * @returns {{ ok: boolean, results: { id: string, status: 'pass'|'regression'|'skipped'|'missing', notes: string[] }[] }} One result per budget.
 *
 * @example
 * compareBudgets({ version: { ms: 300, rssMb: 60 } }, { checks: { version: { maxMs: 600, maxRssMb: 120 } } }).ok; // => true
 */
export function compareBudgets(measurements, budgets) {
  const results = [];
  for (const [id, budget] of Object.entries(budgets.checks ?? {})) {
    const m = measurements[id];
    if (!m) {
      results.push({ id, status: 'missing', notes: ['no measurement was taken for this check'] });
      continue;
    }
    if (m.skipped) {
      results.push({ id, status: 'skipped', notes: [`skipped: ${m.skipped}`] });
      continue;
    }
    const notes = [];
    let status = 'pass';
    if (budget.maxMs !== undefined) {
      if (!Number.isFinite(m.ms)) {
        status = 'missing';
        notes.push('the time was not measured');
      } else if (m.ms > budget.maxMs) {
        status = 'regression';
        notes.push(`took ${Math.round(m.ms)} ms, budget ${budget.maxMs} ms`);
      }
    }
    if (budget.maxRssMb !== undefined) {
      if (!Number.isFinite(m.rssMb)) notes.push('peak memory unmeasured on this machine (not a failure)');
      else if (m.rssMb > budget.maxRssMb) {
        status = 'regression';
        notes.push(`peaked at ${Math.round(m.rssMb)} MB, budget ${budget.maxRssMb} MB`);
      }
    }
    results.push({ id, status, notes });
  }
  return { ok: results.every((r) => r.status !== 'regression' && r.status !== 'missing'), results };
}

/**
 * Read `GNU time -f` output: the last line of the command's stderr is `<seconds> <peak KB>`; everything before it is the command's own.
 *
 * @param {string} stderr The command's stderr with the time line appended.
 * @returns {{ ms: number, rssMb: number, stderr: string } | null} The wall time, peak resident memory and the command's own stderr; `null` when the line is absent.
 */
export function parseTimeLine(stderr) {
  const m = /(?:^|\n)__TIME__ ([\d.]+) (\d+)\s*$/.exec(stderr);
  if (!m) return null;
  return { ms: Number(m[1]) * 1000, rssMb: Number(m[2]) / 1024, stderr: stderr.slice(0, m.index) };
}

let gnuTime;
/** Whether `/usr/bin/time -f` (GNU time) works here. */
function hasGnuTime() {
  if (gnuTime === undefined) {
    const r = spawnSync('/usr/bin/time', ['-f', '%M', process.execPath, '-e', '0'], { encoding: 'utf8' });
    gnuTime = r.status === 0 && /^\d+\s*$/.test(r.stderr ?? '');
  }
  return gnuTime;
}

/**
 * Run one command cold (a fresh process) and measure its wall time and peak memory. Uses GNU time when present; otherwise samples
 * `ps` every 10 ms (a lower bound: a short process may be missed), and where `ps` fails the memory is `null`.
 *
 * @param {string[]} args Arguments for the construct CLI script, run with the current Node.
 * @param {{ timeoutMs?: number, env?: Record<string, string|undefined> }} [options] Timeout (default 120 s) and environment.
 * @returns {Promise<{ ms: number, rssMb: number | null, exitCode: number | null, method: string }>} The measurement.
 */
export function measureCli(args, { timeoutMs = 120_000, env = process.env } = {}) {
  return new Promise((resolve) => {
    const gnu = hasGnuTime();
    const [cmd, cmdArgs] = gnu ? ['/usr/bin/time', ['-f', '__TIME__ %e %M', process.execPath, CLI, ...args]] : [process.execPath, [CLI, ...args]];
    const start = process.hrtime.bigint();
    const child = spawn(cmd, cmdArgs, { cwd: REPO, env, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    let peakKb = null;
    child.stderr.on('data', (d) => {
      err += d;
      if (err.length > 1 << 20) err = err.slice(-1 << 16);
    });
    const sampler = gnu ? null : setInterval(() => {
      const r = spawnSync('ps', ['-o', 'rss=', '-p', String(child.pid)], { encoding: 'utf8' });
      const kb = Number.parseInt(r.stdout, 10);
      if (Number.isFinite(kb)) peakKb = Math.max(peakKb ?? 0, kb);
    }, 10);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (sampler) clearInterval(sampler);
      const wall = Number(process.hrtime.bigint() - start) / 1e6;
      const t = gnu ? parseTimeLine(err) : null;
      resolve({ ms: t?.ms ?? wall, rssMb: t ? t.rssMb : peakKb === null ? null : peakKb / 1024, exitCode: code, method: gnu ? 'gnu-time' : 'ps-sampling' });
    });
  });
}

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

/** The peak resident memory (MB) of a live process: `VmHWM` on Linux, else the current size from `ps`; `null` when neither works. */
function livePeakMb(pid) {
  try {
    const m = /VmHWM:\s+(\d+) kB/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'));
    if (m) return Number(m[1]) / 1024;
  } catch {
    // not Linux: fall through to ps
  }
  const kb = Number.parseInt(spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).stdout, 10);
  return Number.isFinite(kb) ? kb / 1024 : null;
}

/**
 * Start the Cockpit's API server on a free loopback port with a throwaway workspace and state folder, and time it from spawn until
 * `/api/health` answers; then stop it. Skipped, with the reason, when its dependencies are not installed.
 *
 * @param {{ timeoutMs?: number }} [options] How long to wait for the answer (default 60 s).
 * @returns {Promise<{ skipped: string } | { ms: number, rssMb: number | null, method: string }>} The measurement, or the reason it was skipped.
 */
export async function measureCockpitStart({ timeoutMs = 60_000 } = {}) {
  const server = path.join(REPO, 'ui', 'server');
  if (!fs.existsSync(path.join(server, 'node_modules', 'express'))) return { skipped: 'the Cockpit server dependencies are not installed (npm ci in ui/server)' };
  const port = await freePort();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `construct-bench-${process.pid}-`));
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', CONSTRUCT_WORKSPACE_ROOT: path.join(scratch, 'ws'), CONSTRUCT_STATE_DIR: path.join(scratch, 'state') };
  const child = spawn(process.execPath, [path.join(server, 'src', 'index.mjs')], { cwd: server, env, stdio: 'ignore' });
  const start = process.hrtime.bigint();
  const deadline = Date.now() + timeoutMs;
  let out = { skipped: `the Cockpit server did not answer /api/health within ${timeoutMs / 1000} s` };
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });
  try {
    while (Date.now() < deadline && !exited) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) {
          out = { ms: Number(process.hrtime.bigint() - start) / 1e6, rssMb: livePeakMb(child.pid), method: 'VmHWM-at-health' };
          break;
        }
      } catch {
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    if (exited && out.skipped) out = { skipped: 'the Cockpit server exited before it answered' };
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => {
      const t = setTimeout(() => {
        child.kill('SIGKILL');
        r();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(t);
        r();
      });
      if (exited) r();
    });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return out;
}

/**
 * Measure every check `runs` times and return the report: per check the runs, the spread and the medians that are compared.
 *
 * @param {{ runs?: number, only?: string[] | null, log?: (line: string) => void }} [options] Runs per check (default 3), the ids to run (default all) and where progress goes.
 * @returns {Promise<{ schema: string, date: string, machine: object, runs: number, checks: Record<string, object> }>} The report (without the comparison).
 */
export async function measureAll({ runs = 3, only = null, log = () => {} } = {}) {
  const checks = {};
  for (const c of CHECKS) {
    if (only && !only.includes(c.id)) continue;
    const samples = [];
    let skipped = null;
    let method = null;
    for (let i = 0; i < runs && !skipped; i++) {
      if (c.id === 'cockpit-start') {
        const r = await measureCockpitStart();
        if (r.skipped) skipped = r.skipped;
        else {
          samples.push({ ms: r.ms, rssMb: r.rssMb });
          method = r.method;
        }
      } else {
        const r = await measureCli(c.args);
        method = r.method;
        if (r.exitCode !== 0) skipped = `the command exited ${r.exitCode}`;
        else samples.push({ ms: r.ms, rssMb: r.rssMb });
      }
    }
    checks[c.id] = skipped ? { label: c.label, skipped } : { label: c.label, method, samples, ms: spread(samples.map((s) => s.ms)), rssMb: spread(samples.map((s) => s.rssMb)) };
    log(skipped ? `${c.id}: skipped, ${skipped}` : `${c.id}: median ${Math.round(checks[c.id].ms.median)} ms, ${checks[c.id].rssMb ? `${Math.round(checks[c.id].rssMb.median)} MB` : 'memory unmeasured'}`);
  }
  return {
    schema: 'construct-benchmark.v1',
    date: new Date().toISOString(),
    machine: { platform: process.platform, node: process.versions.node, cores: os.cpus().length, totalRamMb: Math.round(os.totalmem() / 1048576) },
    runs,
    checks,
  };
}

/**
 * The medians `compareBudgets` takes, from a report.
 *
 * @param {{ checks: Record<string, { skipped?: string, ms?: { median: number } | null, rssMb?: { median: number } | null }> }} report From `measureAll`.
 * @returns {Record<string, { skipped?: string, ms?: number | null, rssMb?: number | null }>} By check id.
 */
export function mediansOf(report) {
  return Object.fromEntries(Object.entries(report.checks).map(([id, c]) => [id, c.skipped ? { skipped: c.skipped } : { ms: c.ms?.median ?? null, rssMb: c.rssMb?.median ?? null }]));
}

/**
 * The committed numbers the docs quote, from a report: medians rounded (time to 10 ms, the resolution of the clock the time comes from; memory to 5 MB), no machine identity
 * beyond memory and cores.
 *
 * @param {ReturnType<typeof mediansOf>} medians From `mediansOf`.
 * @param {{ date: string, machine: { node: string, cores: number, totalRamMb: number }, runs: number }} report The report the medians came from.
 * @returns {{ measuredOn: string, node: string, cores: number, memoryGb: number, runs: number, checks: Record<string, { label: string, ms: number | null, peakMb: number | null } | { label: string, skipped: string }> }} The snapshot.
 */
export function snapshotOf(medians, report) {
  const labels = Object.fromEntries(CHECKS.map((c) => [c.id, c.label]));
  return {
    measuredOn: report.date.slice(0, 10),
    node: report.machine.node,
    cores: report.machine.cores,
    memoryGb: Math.round(report.machine.totalRamMb / 1024),
    runs: report.runs,
    checks: Object.fromEntries(Object.entries(medians).map(([id, m]) => [id, m.skipped ? { label: labels[id], skipped: m.skipped } : { label: labels[id], ms: Number.isFinite(m.ms) ? Math.round(m.ms / 10) * 10 : null, peakMb: Number.isFinite(m.rssMb) ? Math.round(m.rssMb / 5) * 5 : null }])),
  };
}

/**
 * The measured table of the "System requirements" page, from a snapshot and the budgets. A test fails when the page's copy is not exactly this.
 *
 * @param {ReturnType<typeof snapshotOf>} snapshot From `snapshotOf` (the committed `benchmark-snapshot.json`).
 * @param {{ checks: Record<string, { maxMs?: number, maxRssMb?: number }> }} budgets The budgets.
 * @returns {string} A markdown table, no trailing newline.
 */
export function renderMeasuredTable(snapshot, budgets) {
  const rows = Object.entries(snapshot.checks).map(([id, c]) => {
    const b = budgets.checks?.[id] ?? {};
    const limit = `${b.maxMs !== undefined ? `${b.maxMs / 1000} s` : 'none'} and ${b.maxRssMb !== undefined ? `${b.maxRssMb} MB` : 'none'}`;
    if (c.skipped) return `| ${c.label} | not measured: ${c.skipped} | | ${limit} |`;
    const time = c.ms === null ? 'n/a' : c.ms < 1000 ? `${c.ms} ms` : `${Math.round(c.ms / 100) / 10} s`;
    return `| ${c.label} | ${time} | ${c.peakMb === null ? 'n/a' : `${c.peakMb} MB`} | ${limit} |`;
  });
  return ['| Command | Cold start | Peak memory | Budget (time and memory) |', '|---|---|---|---|', ...rows].join('\n');
}

/**
 * Replace the text between `<!-- <name>:start -->` and `<!-- <name>:end -->` in a page; throws when the markers are missing.
 *
 * @param {string} md The page.
 * @param {string} name The block name.
 * @param {string} content What goes between the markers.
 * @returns {string} The page with the block replaced.
 */
export function spliceBlock(md, name, content) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const a = md.indexOf(start);
  const b = md.indexOf(end);
  if (a < 0 || b < a) throw new Error(`the page has no ${start} ... ${end} block`);
  return `${md.slice(0, a + start.length)}\n${content}\n${md.slice(b)}`;
}

/**
 * The text between a block's markers, without the surrounding newlines; `null` when the block is absent.
 *
 * @param {string} md The page.
 * @param {string} name The block name.
 * @returns {string | null} The block content.
 */
export function readBlock(md, name) {
  const m = new RegExp(`<!-- ${name}:start -->\\n([\\s\\S]*?)\\n<!-- ${name}:end -->`).exec(md);
  return m ? m[1] : null;
}

/**
 * Rewrite the generated blocks of the "System requirements" page: the tier table (from `TIERS`) and the measured table (from the snapshot).
 *
 * @param {ReturnType<typeof snapshotOf>} snapshot The committed snapshot.
 * @param {{ checks: Record<string, object> }} budgets The budgets.
 * @param {string} [page] The page to write (default: the site page).
 * @returns {void}
 */
export function writeDocs(snapshot, budgets, page = REQUIREMENTS_PAGE) {
  const md = spliceBlock(spliceBlock(fs.readFileSync(page, 'utf8'), 'tiers', renderTierTable()), 'measured', renderMeasuredTable(snapshot, budgets));
  fs.writeFileSync(page, md);
}

/**
 * Command line entry: measure, compare, write the report, print one line per check.
 *
 * @param {string[]} argv Arguments after the script name.
 * @returns {Promise<number>} The exit code: 0, or 1 when a check regressed or is missing.
 */
export async function main(argv) {
  const flag = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const runs = Math.max(1, Number.parseInt(flag('--runs') ?? '3', 10) || 3);
  const only = flag('--only') ? flag('--only').split(',') : null;
  const budgets = JSON.parse(fs.readFileSync(flag('--budgets') ?? BUDGETS_FILE, 'utf8'));
  if (argv.includes('--docs-only')) {
    writeDocs(JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')), budgets);
    console.log(`docs: regenerated the tier and measured tables of ${path.relative(REPO, REQUIREMENTS_PAGE)} from the committed snapshot`);
    return 0;
  }
  const out = flag('--out') ?? path.join(HERE, 'benchmark-report.json');
  const report = await measureAll({ runs, only, log: (l) => console.error(l) });
  const scope = only ? { checks: Object.fromEntries(Object.entries(budgets.checks).filter(([id]) => only.includes(id))) } : budgets;
  const medians = mediansOf(report);
  const comparison = compareBudgets(medians, scope);
  fs.writeFileSync(out, `${JSON.stringify({ ...report, comparison }, null, 2)}\n`);
  for (const r of comparison.results) console.log(`${r.status.padEnd(10)} ${r.id}${r.notes.length ? `: ${r.notes.join('; ')}` : ''}`);
  console.log(comparison.ok ? 'budgets: ok' : 'budgets: REGRESSION');
  if (argv.includes('--update-docs')) {
    if (only) throw new Error('--update-docs needs every check: run it without --only');
    const snap = snapshotOf(medians, report);
    fs.writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(snap, null, 2)}\n`);
    writeDocs(snap, budgets);
    console.log(`docs: wrote ${path.relative(REPO, SNAPSHOT_FILE)} and the tier and measured tables of ${path.relative(REPO, REQUIREMENTS_PAGE)}`);
  }
  return comparison.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
