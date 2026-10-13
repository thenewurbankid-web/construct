// K6 (#942): Claude-written Smith plans (bench/isolation/chain/plans/<task>.smith.txt) checked against the isolation
// tasks' reference solutions and the r3 H+fix fills (bench/isolation/results/r3-raw/H+fix), with hardened Smith in
// canonical mode. logic: per function, the sentences equal the plan lines exactly. page: every plan line appears in
// the function's English (extras allowed). No model.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, norm } from './lib/smith.mjs';

const ISO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PLANS = path.join(ISO, 'chain', 'plans');

/** @returns {{mode: 'page'|'logic', fns: Record<string, string[]>}} */
export function parsePlan(text) {
  let mode = 'page', fn = null;
  const fns = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(mode|fn):\s*(.+)$/.exec(line);
    if (m && m[1] === 'mode') { mode = /** @type {any} */ (m[2]); continue; }
    if (m && m[1] === 'fn') { fn = m[2]; fns[fn] = []; continue; }
    if (!fn) throw new Error(`plan line before any fn: ${line}`);
    fns[fn].push(line);
  }
  return { mode: /** @type {'page'|'logic'} */ (mode), fns };
}

/** Check one source against a plan. @returns {Promise<{pass: boolean, matched: number, total: number, missing: string[], unhandled: number}>} */
export async function checkSource(source, plan) {
  const d = await describe(source, { canonical: true });
  const all = Object.values(d);
  const unhandled = all.reduce((a, f) => a + f.unhandled.length, 0);
  let matched = 0, total = 0;
  const missing = [];
  for (const [fn, lines] of Object.entries(plan.fns)) {
    const got = d[fn]?.sentences ?? all.flatMap((f) => f.sentences);
    if (plan.mode === 'logic') {
      const want = lines.map(norm);
      const have = got.map(norm);
      total += Math.max(want.length, have.length);
      for (const w of want) if (have.includes(w)) matched++; else missing.push(`${fn}: ${w}`);
      if (have.length > want.length) missing.push(`${fn}: ${have.length - want.length} extra step(s)`);
    } else {
      const text = norm(got.join(' '));
      total += lines.length;
      for (const l of lines) if (text.includes(norm(l))) matched++; else missing.push(`${fn}: ${l}`);
    }
  }
  return { pass: matched === total && total > 0, matched, total, missing, unhandled };
}

const lastAttempt = (dir) => {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => /^attempt-.*\.(tsx?|jsx?)$/.test(f)).sort();
  return files.length ? path.join(dir, files[files.length - 1]) : null;
};

export async function runK6() {
  const r3 = JSON.parse(fs.readFileSync(path.join(ISO, 'results', 'r3.json'), 'utf8'));
  const rows = [];
  for (const f of fs.readdirSync(PLANS).filter((x) => x.endsWith('.smith.txt')).sort()) {
    const id = f.replace(/\.smith\.txt$/, '');
    const task = JSON.parse(fs.readFileSync(path.join(ISO, 'tasks', id, 'task.json'), 'utf8'));
    const plan = parsePlan(fs.readFileSync(path.join(PLANS, f), 'utf8'));
    const ref = await checkSource(fs.readFileSync(path.join(ISO, 'tasks', id, 'reference', task.target), 'utf8'), plan);
    const fillFile = lastAttempt(path.join(ISO, 'results', 'r3-raw', 'H+fix', id));
    const fill = fillFile ? await checkSource(fs.readFileSync(fillFile, 'utf8'), plan) : null;
    const r3row = r3.rows.find((x) => x.arm === 'H+fix' && x.task === id);
    rows.push({ task: id, mode: plan.mode, reference: ref, fillFile: fillFile && path.relative(ISO, fillFile), fill, r3Pass: r3row?.pass ?? null });
  }
  const refPass = rows.filter((r) => r.reference.pass).length;
  const fillPass = rows.filter((r) => r.fill?.pass).length;
  const agree = rows.filter((r) => r.fill && r.fill.pass === r.r3Pass).length;
  return {
    summary: {
      smith: 'hardened, canonical', tasks: rows.length, referencesPass: `${refPass}/${rows.length}`, fillsPass: `${fillPass}/${rows.filter((r) => r.fill).length}`,
      fillsAgreeWithR3Check: `${agree}/${rows.filter((r) => r.fill).length}`,
      planElementsMatchedInReferences: `${rows.reduce((a, r) => a + r.reference.matched, 0)}/${rows.reduce((a, r) => a + r.reference.total, 0)}`,
    },
    rows,
  };
}
