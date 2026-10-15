// Turns a library run's results.jsonl into the Library Run page's db documents, in an outbox:
//   run-current.json  (run/current: totals, stages, sections, the newest partial log block as `tail`)
//   events-eNNNN.json (events/eNNNN: one full block of 40 log rows; written once)
// State (which blocks were pushed) lives next to the outbox. Usage:
//   node sync.mjs <runDir> <outbox> <status> <scope text> [sections,comma] [limit]
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { summarize } from '../run.mjs';
const [runDir, outbox, status, scope, sectionsArg, limitArg] = process.argv.slice(2);
const BLOCK = 40;
const reference = JSON.parse(readFileSync(new URL('../../../../line-codemod/bench/atoms/js-reference/reference.json', import.meta.url), 'utf8')).entries;
const want = sectionsArg ? new Set(sectionsArg.split(',')) : null;
let entries = reference.filter((e) => !want || want.has(e.section));
if (limitArg) entries = entries.slice(0, Number(limitArg));
const file = `${runDir}/results.jsonl`;
const all = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const { summary, library } = summarize(all, entries);

const firstFail = (g) => Object.entries(g?.checks ?? {}).find(([, v]) => v === 'fail')?.[0] ?? null;
const rows = all.map((r) => ({
  t: r.at ?? null, key: r.key, section: r.section, stage: r.stage, model: r.model,
  result: r.error ? 'error' : r.gate?.pass ? 'pass' : 'refused',
  decision: r.answer?.decision ?? null, check: firstFail(r.gate),
  refusal: r.error ?? r.gate?.refusal ?? null, sentence: r.gate?.pass ? r.answer?.sentence ?? null : null,
  reason: r.gate?.pass ? r.answer?.reason ?? null : null, tries: r.tries ?? 0, costUsd: Number((r.costUsd ?? 0).toFixed(4)),
  ...(r.dialogue?.length ? { dialogue: r.dialogue } : {}),
}));

// Finished per entry: passed inside, or has an outside result; gaps are those refused by both.
const latest = new Map();
for (const r of all) latest.set(`${r.key}|${r.stage}`, r);
const sections = {};
let done = 0, errors = 0;
for (const e of entries) {
  const s = (sections[e.section] ??= { entries: 0, done: 0, inside: 0, outside: 0, user: 0, gaps: 0, errors: 0 });
  s.entries++;
  const i = latest.get(`${e.key}|inside`), o = latest.get(`${e.key}|outside`), u = latest.get(`${e.key}|user`);
  const last = u ?? o; // the stage that runs after inside: the user stage, or the old outside stage
  if (i?.gate?.pass) { s.inside++; s.done++; done++; }
  else if (o?.gate?.pass) { s.outside++; s.done++; done++; }
  else if (u?.gate?.pass) { s.user++; s.done++; done++; }
  else if (last && !last.error) { s.gaps++; s.done++; done++; }
  else if ((last ?? i)?.error) { s.errors++; errors++; }
}
const startedAt = all.length ? all.map((r) => r.at).filter(Boolean).sort()[0] ?? null : null;
const strip = ({ decisions, ...t }) => t;
const run = {
  status, scope, models: summary.models ?? { inside: 'haiku', outside: 'opus' },
  startedAt, updatedAt: new Date().toISOString(),
  entries: entries.length, done, inLibrary: summary.inLibrary, knownGaps: Object.values(sections).reduce((a, s) => a + s.gaps, 0), errors,
  inside: strip(summary.inside), outside: strip(summary.outside), user: strip(summary.user), sections,
  tail: rows.slice(Math.floor(rows.length / BLOCK) * BLOCK),
};
mkdirSync(outbox, { recursive: true });
for (const f of readdirSync(outbox)) rmSync(`${outbox}/${f}`);
const stateFile = `${outbox}.state.json`; // per outbox
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { pushedBlocks: 0 };
const full = Math.floor(rows.length / BLOCK);
const fresh = [];
for (let b = state.pushedBlocks; b < full; b++) {
  const id = `e${String(b).padStart(4, '0')}`;
  writeFileSync(`${outbox}/events-${id}.json`, JSON.stringify({ rows: rows.slice(b * BLOCK, (b + 1) * BLOCK) }));
  fresh.push(id);
}
writeFileSync(`${outbox}/run-current.json`, JSON.stringify(run));
writeFileSync(`${outbox}.pending.json`, JSON.stringify({ blocks: fresh, full }));
console.log(JSON.stringify({ rows: rows.length, newBlocks: fresh, done, entries: entries.length, inLibrary: run.inLibrary }));
