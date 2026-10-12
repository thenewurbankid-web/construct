// Runs every scripted CLI UAT walk (ui/e2e/uat/cli/*.walk.mjs) one after another, each in its own process, and exits
// non-zero when any fails. `node ui/e2e/uat/cli/run-all.mjs [name...]` runs only the named walks (e.g. `atoms lv`).
// Through heavy.sh on a shared machine: `packages/tools/dev/heavy.sh node ui/e2e/uat/cli/run-all.mjs`.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const walks = fs.readdirSync(HERE).filter((f) => f.endsWith('.walk.mjs')).sort()
  .filter((f) => !only.length || only.includes(f.replace('.walk.mjs', '')));
if (!walks.length) { console.error(`No walk matches ${only.join(', ')}.`); process.exit(2); }

const results = [];
for (const f of walks) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(HERE, f)], { stdio: 'inherit' });
  results.push({ walk: f.replace('.walk.mjs', ''), ok: r.status === 0, s: Math.round((Date.now() - started) / 1000) });
  console.log('');
}
console.log('CLI UAT walks:');
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.walk} (${r.s}s)`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} of ${results.length} walks failed.` : `All ${results.length} walks passed.`);
process.exit(failed ? 1 : 0);
