// im2, opt-in live run (CONSTRUCT_LIVE_QWEN=1): the real qwen2.5-coder:1.5b repairs 20 seeded refusals ONCE each.
// The refusals are seeded from Train Line's train-split cases: each case's gold step (verified by Construct) gets one
// argument broken in a fixed way (a feature typo, a wrong library folder, a lower-case item name, a name that is not
// PascalCase, a prop typo), Construct refuses it on a copy of the case's world, and the model gets only that refusal,
// its typed fixes and the broken step. The repaired step is checked by Construct on a copy again. Nothing is written to
// any project. Prints the success rate; the test fails only when no model answers at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repairOnce, optionSchema } from '../packages/core/line-decide.mjs';
import { checkOnCopy, toolArgsSchema } from '../packages/engine/line/repair.mjs';
import { materialize } from '../packages/engine/line/train/corpus.mjs';
import { factsOf } from '../packages/engine/line/train/facts.mjs';
import { bindSlots, fill } from '../packages/engine/line/train/slots.mjs';
import { wordsOf } from '../packages/engine/line/train/verify.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = process.env.CONSTRUCT_LIVE_QWEN === '1';
const N = 20;

/** Break one argument of a gold step, in a fixed way per tool (null when this step has nothing to break). */
function breakStep(step, i) {
  const a = { ...step.args };
  if (step.tool === 'line.baseOn') {
    const k = i % 3;
    if (k === 0) a.feature = `${a.feature}s`;
    else if (k === 1) a.libraryId = String(a.libraryId).replace(/^(\w+)s\//, '$1/');
    else a.name = String(a.name).toLowerCase();
  } else if (step.tool === 'line.promote') a.featureItemId = String(a.featureItemId).replace(/\/([A-Z])/, (_m, c) => `/${c.toLowerCase()}`);
  else if (step.tool === 'line.setPageProp') a.prop = `${a.prop}s`;
  else return null;
  return { tool: step.tool, args: a };
}

/** The seeded refusals: Train cases in order, broken, kept only when Construct really refuses them. */
function seeds() {
  const cases = fs.readFileSync(path.join(REPO, 'line/train/cases.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const out = [];
  let i = 0;
  for (const c of cases.filter((x) => x.split === 'train')) {
    if (out.length >= N) break;
    const gold = c.gold.routes.find((r) => r.id === c.gold.preferred);
    if (gold?.outcome !== 'change' || gold.steps.length !== 1) continue;
    const dir = materialize(c.world);
    try {
      const b = /** @type {any} */ (bindSlots(c.slots, factsOf(dir), wordsOf(c.world)));
      if (!b.ok) continue;
      const step = { tool: gold.steps[0].tool, args: fill(gold.steps[0].args, b.bound, { asArg: true }) };
      const broken = breakStep(step, i++);
      if (!broken) continue;
      const first = checkOnCopy(dir, broken);
      if (first.ok) continue;
      out.push({ id: c.id, world: c.world, dir, broken, refusal: first.refusal, gold: step });
    } catch { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  return out;
}

test('live: the 1.5B repairs seeded Train Line refusals once; prints the success rate', { skip: !LIVE && 'set CONSTRUCT_LIVE_QWEN=1 (needs Ollama with qwen2.5-coder:1.5b)', timeout: 15 * 60_000 }, async () => {
  const list = seeds();
  assert.equal(list.length, N, `${list.length} seeded refusals`);
  const rows = [];
  try {
    for (const s of list) {
      const a = await repairOnce(s.broken, s.refusal, { schema: optionSchema(s.broken, toolArgsSchema(s.broken.tool)), check: (o) => checkOnCopy(s.dir, o) });
      rows.push({ id: s.id, tool: s.broken.tool, outcome: a.outcome, ms: a.ms });
    }
  } finally { for (const s of list) fs.rmSync(s.dir, { recursive: true, force: true }); }
  const repaired = rows.filter((r) => r.outcome === 'repaired').length;
  const by = Object.entries(rows.reduce((m, r) => ({ ...m, [r.outcome]: (m[r.outcome] ?? 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(', ');
  const perTool = Object.entries(rows.reduce((m, r) => ({ ...m, [r.tool]: [...(m[r.tool] ?? []), r.outcome === 'repaired'] }), {})).map(([t, xs]) => `${t} ${xs.filter(Boolean).length}/${xs.length}`).join(', ');
  console.log(`Live repair success: ${repaired}/${rows.length} (${Math.round((repaired / rows.length) * 100)}%); ${by}; per tool: ${perTool}; mean ${Math.round(rows.reduce((t, r) => t + r.ms, 0) / rows.length)} ms.`);
  assert.ok(rows.every((r) => r.outcome !== 'no-model'), 'the model answered every attempt');
});
