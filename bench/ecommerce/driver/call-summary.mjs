#!/usr/bin/env node
// One line per distinct call in a run's calls.jsonl (repeats of the same call and answer folded, with a count), for
// reading a run and writing its gap list: node bench/ecommerce/driver/call-summary.mjs <run-dir>/logs/calls.jsonl
import fs from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: call-summary.mjs <calls.jsonl>'); process.exit(2); }
const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
let prev = ''; let n = 0; let first = '';
const flush = () => { if (prev) console.log(`${first} x${n} ${prev}`); };
for (const c of rows) {
  if (c.kind !== 'call') continue;
  const a = c.cmd === 'add' ? `${c.args?.tool} ${JSON.stringify(c.args?.args ?? {}).slice(0, 140)}` : JSON.stringify(c.args ?? []).slice(0, 80);
  const r = c.result ?? {};
  const key = `${c.cmd} ${a} => ${r.ok ? 'ok' : `REFUSED ${r.code ?? ''}`}${r.landed === true ? ' LANDED' : r.landed === false ? ` NOT LANDED [${(r.rules ?? []).join(',')}]` : ''} ${String(r.sentence ?? '').slice(0, 220)}`;
  if (key === prev) { n += 1; continue; }
  flush(); prev = key; n = 1; first = String(c.at ?? '').slice(11, 19);
}
flush();
