#!/usr/bin/env node
// cs2 (scaffold) -- prints the share of decisions static code made, per step, for one Line project:
//
//   node packages/rule-factory/static-share.mjs --dir <project> [--findings <validate.json>] [--json]
//
// Plan feedback comes from <project>/line/plans/*.json. Findings come from --findings (a JSON list of LineFindings,
// or `construct validate --format json` output with a `violations` list), else from Construct's Line validate of the
// project (with typed fixes). No model is called.
import fs from 'node:fs';
import path from 'node:path';
import { missesFromFindings, readPlanMisses, staticShare } from './collect.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const root = path.resolve(opt('--dir') ?? '.');

async function findingsOf() {
  const file = opt('--findings');
  if (file) {
    const data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    const list = Array.isArray(data) ? data : data.violations ?? data.findings ?? [];
    return list.map((v) => ({ rule: v.rule, file: v.file, line: v.line ?? 1, key: v.key, fixes: v.fixes }));
  }
  try {
    const { lineFindings } = await import('@line/construct-engine/line/model');
    return lineFindings(root);
  } catch (e) {
    console.error(`Validate could not run on ${root} (${String(/** @type {any} */ (e)?.message ?? e).split('\n')[0]}), so only plan feedback is counted.`);
    return [];
  }
}

const records = [...readPlanMisses(root), ...missesFromFindings(await findingsOf())];
const shares = staticShare(records);
if (args.includes('--json')) console.log(JSON.stringify({ root, records: records.length, shares }, null, 2));
else {
  console.log(`Share decided by static code, per step, in ${root} (${records.length} decisions):`);
  for (const s of shares) console.log(`  ${s.step === 'all' ? 'All steps' : s.step}: ${s.sentence}`);
}
