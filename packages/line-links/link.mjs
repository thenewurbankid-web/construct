#!/usr/bin/env node
// cu1 -- the link step. `node packages/line-links/link.mjs` checks the source repo and says, per linked package, whether
// Construct can load it; `--load` also imports each one through the link; `--pin` prints the source's current commit
// for links.json; `--json` prints the status as JSON. Exit code 0 when every link is ready, 1 otherwise (Construct
// itself runs either way: a missing link only means the static path).
import { importLinked, linkStatus, LINKS_FILE } from './index.mjs';

const args = process.argv.slice(2);
const status = linkStatus(args.includes('--pin') ? { env: { ...process.env, LINE_LINKS_ALLOW_DRIFT: '1' } } : {});

if (args.includes('--pin')) {
  if (!status.head) {
    console.log(status.message);
    process.exitCode = 1;
  } else if (status.head === status.pinned) {
    console.log(`links.json already pins ${status.head}.`);
  } else {
    console.log(`The source is at ${status.head}; set "source.commit" to it in ${LINKS_FILE} (it pins ${status.pinned}), then run the link tests.`);
  }
} else {
  /** @type {any[]} */
  const rows = [];
  for (const p of status.packages) {
    if (args.includes('--load') && p.ok) {
      const r = await importLinked(p.name);
      rows.push({ ...p, loaded: r.ok, message: 'reason' in r ? r.reason : `${p.message.replace(/\.$/, '')} and loads.` });
    } else rows.push(p);
  }
  if (args.includes('--json')) console.log(JSON.stringify({ ...status, packages: rows }, null, 2));
  else {
    console.log(status.message);
    for (const r of rows) console.log(`  ${r.message}`);
  }
  if (!status.ok || rows.some((r) => r.loaded === false)) process.exitCode = 1;
}
