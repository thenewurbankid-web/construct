// cl1 -- every plan session leaves a typed local trace (trace.mjs, written through the writer's Line-state path), Line
// picks the context for a miss statically (contextPicker.mjs), and a refusal that recurs with no working typed fix is
// drafted, never filed, as a framework issue with one minimal case (missDetector.mjs). Runs on copies of
// examples/line-sample with the real plan service and Line's built-in plan store.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { writeLineState } from '../packages/engine/transactionalWriter.mjs';
import { createLinePlanService, loadPlanApi } from '../packages/engine/line/planService.mjs';
import { createSessionTrace, createMemoryTrace, readTraces, traceArgs } from '../packages/engine/line/trace.mjs';
import { pickContext, staticSummarizer, importsOf } from '../packages/engine/line/contextPicker.mjs';
import { detectMisses, draftFrameworkIssues, issueMarkdown, signatureOf } from '../packages/engine/line/missDetector.mjs';
import { assertTraceEvent, assertContextPick } from '../packages/engine/line/contract.mjs';
import { listFragments } from '../packages/engine/line/fragments.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../examples/line-sample');
const copy = () => { const dir = makeTempDir('line-trace-'); fs.cpSync(SAMPLE, dir, { recursive: true }); return dir; };
const MISSING_LINK = { env: { ...process.env, LINE_SOURCE_DIR: path.join(makeTempDir('no-source-'), 'nope') } };
const staticLoad = (o) => loadPlanApi({ ...o, linkOptions: MISSING_LINK });
const PAGE = 'features/orders/pages/OrdersPage.tsx';

/** The real miss from cp1's test: a fragment that makes a feature use another feature, then its recommended fix. */
async function refuseAndFix(dir, svc) {
  const list = listFragments(dir, PAGE);
  const added = await svc.addStep({ tool: 'line.setFragment', args: { file: PAGE, fragmentId: list.fragments[0].id, code: "() => import('../../billing/pages/InvoicesPage')", contentHash: list.contentHash } }, 'ui');
  await svc.approve(added.stepId, 'ui');
  const step = (await svc.runNext('ui')).steps.find((s) => s.id === added.stepId);
  const fix = step.result.options.find((o) => o.id === 'fix' && o.recommended);
  const fixStep = await svc.addStep({ tool: fix.step.tool, args: { ...fix.step.args, fixOf: added.stepId } }, 'agent');
  await svc.approve(fixStep.stepId, 'ui');
  await svc.runNext('agent', fixStep.stepId);
  return { refusedId: added.stepId, fixId: fixStep.stepId };
}
/** A miss no typed fix can mend (experiment fixes: a fix that would land is chained and lands, so only this recurs): the
 * library already has an OrderButton, so neither orders' OrderButton nor billing's InvoicesPage can be promoted. */
async function refuseBlocked(dir, svc) {
  fs.copyFileSync(path.join(dir, 'library/components/Button.tsx'), path.join(dir, 'library/components/OrderButton.tsx'));
  const list = listFragments(dir, PAGE);
  const added = await svc.addStep({ tool: 'line.setFragment', args: { file: PAGE, fragmentId: list.fragments[0].id, code: "() => import('../../billing/pages/InvoicesPage')", contentHash: list.contentHash } }, 'ui');
  await svc.approve(added.stepId, 'ui');
  const step = (await svc.runNext('ui')).steps.find((s) => s.id === added.stepId);
  return { refusedId: added.stepId, step };
}
const tree = (dir) => {
  const out = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } };
  walk(dir);
  return out;
};
const outsideState = (t) => Object.fromEntries(Object.entries(t).filter(([k]) => !k.startsWith('line/')));

test('Line-state path: only inside the state folder, atomic, append-only for JSONL, no temp files left', () => {
  const dir = copy();
  assert.throws(() => writeLineState(dir, 'features/x.md', 'no'), /Line state is written only inside line\/, not features\/x\.md\./);
  assert.throws(() => writeLineState(dir, 'line/../x.md', 'no'), /only inside line\//);
  writeLineState(dir, 'line/traces/t.jsonl', '{"a":1}\n', { append: true });
  writeLineState(dir, 'line/traces/t.jsonl', '{"a":2}\n', { append: true });
  assert.equal(fs.readFileSync(path.join(dir, 'line/traces/t.jsonl'), 'utf8'), '{"a":1}\n{"a":2}\n');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'line/traces')), ['t.jsonl']);
});

test('trace: a refusal records the typed fixes offered, which fix was picked and whether it passed; every line fits the contract', async () => {
  const dir = copy();
  const svc = createLinePlanService({ root: dir, commands: null, load: staticLoad });
  const { refusedId, fixId } = await refuseAndFix(dir, svc);
  assert.equal(svc.trace.problem, null);
  assert.match(svc.trace.file, /^line\/traces\/ses-cockpit-\d{8}T\d{6}Z-[0-9a-f]{6}\.jsonl$/);
  const { events, files, skipped } = readTraces(dir);
  assert.deepEqual([files, skipped], [[svc.trace.file], 0]);
  events.forEach((e, i) => assertTraceEvent(e, `event ${i}`));
  assert.deepEqual(events.map((e) => `${e.kind}:${e.stepId}`), [`step:${refusedId}`, `refusal:${refusedId}`, `outcome:${refusedId}`, `step:${fixId}`, `fix-picked:${fixId}`, `outcome:${fixId}`]);
  const refusal = events[1];
  assert.deepEqual([refusal.source, refusal.code, refusal.rules, refusal.files], ['construct', 'NEEDS_FIX', ['LINE-DIR'], ['features/orders/pages/OrdersPage.tsx']]);
  assert.deepEqual(refusal.fixes.find((f) => f.recommended), { fixId: 'LINE-DIR/promote', tool: 'line.amend', recommended: true }, 'the chain (promote OrderButton, then InvoicesPage) with the refused change, in one step');
  assert.deepEqual([events[4].fixOf, events[4].fixId], [refusedId, 'LINE-DIR/promote'], 'which offered fix the agent picked');
  assert.deepEqual([events[5].ok, events[5].passed, events[5].total, events[5].state], [true, 2, 2, 'done'], 'and that it passed');
  assert.equal(events.map((e) => e.seq).join(), '1,2,3,4,5,6');
});

test('trace: a landed step is step then outcome ok; a plan-protocol refusal is source plan; long code is cut', async () => {
  const dir = copy();
  const svc = createLinePlanService({ root: dir, commands: null, load: staticLoad });
  const r = await svc.addStep({ tool: 'line.baseOn', args: { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge' } }, 'ui');
  await svc.approve(r.stepId, 'ui');
  await svc.runNext('ui');
  await svc.addStep({ tool: 'line.nope', args: {} }, 'agent');
  const { events } = readTraces(dir);
  assert.deepEqual(events.map((e) => [e.kind, e.ok ?? null, e.source ?? null]), [['step', null, null], ['outcome', true, null], ['refusal', null, 'plan']]);
  assert.equal(events[2].code, 'UNKNOWN_TOOL');
  assert.equal(traceArgs({ code: 'x'.repeat(500), expect: [1] }).code.length, 200);
  assert.equal('expect' in traceArgs({ expect: [1] }), false);
});

test('fallback: a trace that cannot be written never stops the plan, and says why in one sentence', async () => {
  const dir = copy();
  fs.mkdirSync(path.join(dir, 'line'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'line/traces'), 'a file where the folder should be');
  const svc = createLinePlanService({ root: dir, commands: null, load: staticLoad });
  const r = await svc.addStep({ tool: 'line.project', args: {} }, 'agent');
  assert.equal(r.ok, true, 'the step joined the plan');
  assert.match(svc.trace.problem, /^The session trace could not be written, so this step is not in it: /);
  const off = createLinePlanService({ root: copy(), commands: null, load: staticLoad, trace: null });
  assert.equal((await off.addStep({ tool: 'line.project', args: {} }, 'agent')).ok, true);
});

test('readTraces: a broken line is skipped and counted, never fatal', () => {
  const dir = copy();
  const t = createSessionTrace(dir, { id: 'manual' });
  t.record({ kind: 'step', by: 'ui', tool: 'line.project', stepId: 's1' });
  fs.appendFileSync(path.join(dir, t.file), 'not json\n{"v":1}\n');
  const r = readTraces(dir);
  assert.deepEqual([r.events.length, r.skipped], [1, 2]);
});

test('context: Line picks the refused file, what the refused code imports, what the file imports, its base and the plan steps, each with a static summary', async () => {
  const dir = copy();
  const svc = createLinePlanService({ root: dir, commands: null, load: staticLoad });
  await refuseBlocked(dir, svc);
  const { events } = readTraces(dir);
  const miss = events.find((e) => e.kind === 'refusal');
  const pick = await pickContext(dir, { miss, events });
  assertContextPick(pick);
  assert.deepEqual(pick.files.map((f) => [f.file, f.score]), [
    ['features/orders/pages/OrdersPage.tsx', 5],
    ['features/billing/pages/InvoicesPage.tsx', 4],
    ['library/pages/ListPage.tsx', 3],
  ]);
  assert.equal(pick.files[0].summary.sentence, 'OrdersPage.tsx is a page of feature orders, based on library pages/ListPage, 7 lines, exporting OrdersPage.');
  assert.deepEqual(pick.items.filter((i) => i.kind !== 'feature-item' && i.kind !== 'library-item').map((i) => `${i.kind}:${i.id}`), ['rule:LINE-DIR', `plan-step:${miss.stepId}`]);
  assert.deepEqual([pick.via, pick.ambiguous], ['static', false]);
  assert.deepEqual(importsOf(dir, 'features/billing/pages/InvoicesPage.tsx'), ['library/pages/ListPage.tsx', 'features/orders/components/OrderButton.tsx']);
});

test('context: when candidates tie at the cut, jev chooses among exactly those; jev down keeps the static order; the summarizer swaps', async () => {
  const dir = copy();
  const miss = { v: 1, trace: 't', seq: 1, at: 'x', kind: 'refusal', by: 'ui', tool: 'line.promote', stepId: 's1', source: 'construct', code: 'NEEDS_FIX', sentence: 'No.', rules: ['LINE-DIR'], files: ['features/billing/pages/InvoicesPage.tsx'], fixes: [] };
  let offered = null;
  const jev = await pickContext(dir, { miss }, { limit: 2, pick: (tied, slots) => { offered = { tied: tied.map((t) => t.file), slots }; return ['library/pages/ListPage.tsx']; } });
  assert.deepEqual(offered, { tied: ['features/orders/components/OrderButton.tsx', 'library/pages/ListPage.tsx'], slots: 1 });
  assert.deepEqual([jev.via, jev.ambiguous, jev.files.map((f) => f.file)], ['jev', true, ['features/billing/pages/InvoicesPage.tsx', 'library/pages/ListPage.tsx']]);
  const down = await pickContext(dir, { miss }, { limit: 2, pick: () => { throw new Error('jev is down'); } });
  assert.deepEqual([down.via, down.files.map((f) => f.file)], ['static', ['features/billing/pages/InvoicesPage.tsx', 'features/orders/components/OrderButton.tsx']]);
  const other = await pickContext(dir, { miss }, { limit: 1, summarizer: { name: 'cs1', summarize: (_r, f) => ({ sentence: `Summary of ${path.basename(f)}.`, via: 'cs1' }) } });
  assert.deepEqual(other.files[0].summary, { sentence: 'Summary of InvoicesPage.tsx.', via: 'cs1' });
  assert.equal(staticSummarizer.summarize(dir, 'gone.tsx').sentence, 'gone.tsx is not in the project any more.');
});

// ------------------------------------------------------------------------------------------------- miss detector
const ev = (trace, seq, e) => ({ v: 1, trace, seq, at: '2026-10-11T00:00:00.000Z', by: 'ui', stepId: null, ...e });
const refusalEv = (trace, seq, stepId, over = {}) => ev(trace, seq, { kind: 'refusal', tool: 'line.promote', stepId, source: 'construct', code: 'NEEDS_FIX', sentence: 'Refused.', rules: ['LINE-DIR'], files: ['a.tsx'], fixes: [{ fixId: 'LINE-DIR/promote', tool: 'line.promote', recommended: true }], args: { featureItemId: 'x' }, ...over });

test('misses: once is not a pattern; twice with no working fix is a framework issue; a fix that passed is not', () => {
  const once = [refusalEv('t1', 1, 's1')];
  assert.equal(detectMisses(once)[0].frameworkIssue, false);
  const twice = [...once, refusalEv('t2', 1, 's1')];
  const m = detectMisses(twice)[0];
  assert.deepEqual([m.count, m.traces, m.recurs, m.working, m.frameworkIssue], [2, 2, true, false, true]);
  assert.equal(m.reason, 'Construct offered typed fixes twice, but none was tried, so none is known to work.');
  const fixed = [...twice, ev('t2', 2, { kind: 'step', tool: 'line.promote', stepId: 's2', fixOf: 's1' }), ev('t2', 3, { kind: 'fix-picked', tool: 'line.promote', stepId: 's2', fixOf: 's1', fixId: 'LINE-DIR/promote' }), ev('t2', 4, { kind: 'outcome', tool: 'line.promote', stepId: 's2', ok: true, passed: 2, total: 2 })];
  const w = detectMisses(fixed)[0];
  assert.deepEqual([w.working, w.frameworkIssue, w.reason], [true, false, 'A typed fix worked (LINE-DIR/promote).']);
  const none = detectMisses([refusalEv('t1', 1, 's1', { fixes: [] }), refusalEv('t1', 2, 's2', { fixes: [] })])[0];
  assert.equal(none.reason, 'Construct refused this twice and never offered a typed fix that can run as a step.');
  assert.equal(detectMisses([refusalEv('t1', 1, null, { source: 'plan', code: 'BAD_ARGS' }), refusalEv('t1', 2, null, { source: 'plan', code: 'BAD_ARGS' })]).length, 0, 'plan-protocol refusals are not framework misses');
});

test('property: over random traces, a group is a framework issue exactly when it recurs and no fix or retry for it passed', () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let run = 0; run < 200; run += 1) {
    const events = []; const truth = new Map();
    for (let t = 0; t < 1 + rnd(3); t += 1) {
      let seq = 0; let step = 0;
      for (let k = 0; k < rnd(5); k += 1) {
        const tool = ['line.promote', 'line.baseOn'][rnd(2)]; const rules = [['LINE-DIR'], ['LINE-BASE'], []][rnd(3)];
        const sid = `s${(step += 1)}`;
        const r = refusalEv(`t${t}`, (seq += 1), sid, { tool, rules, files: ['f'.repeat(1 + rnd(3))] });
        events.push(r);
        const sig = signatureOf(r); const g = truth.get(sig) ?? { n: 0, ok: false }; g.n += 1;
        if (rnd(2)) {
          const fid = `s${(step += 1)}`; const ok = rnd(2) === 1; const how = rnd(2) ? { fixOf: sid } : { retryOf: sid };
          events.push(ev(`t${t}`, (seq += 1), { kind: 'step', tool, stepId: fid, ...how }), ev(`t${t}`, (seq += 1), { kind: 'outcome', tool, stepId: fid, ok, passed: ok ? 2 : 0, total: 2 }));
          g.ok ||= ok;
        }
        truth.set(sig, g);
      }
    }
    const threshold = 1 + rnd(3);
    for (const m of detectMisses(events, { threshold })) {
      const g = truth.get(m.signature);
      assert.equal(m.count, g.n);
      assert.equal(m.frameworkIssue, g.n >= threshold && !g.ok, `run ${run} ${m.signature}`);
      assert.ok(m.minimal.files.length <= Math.min(...events.filter((e) => e.kind === 'refusal' && signatureOf(e) === m.signature).map((e) => e.files.length)), 'the case is the smallest one');
    }
  }
});

test('draft: two real sessions with the same miss draft one markdown issue per signature under line/issues; nothing else changes and nothing is filed', async () => {
  const dir = copy();
  for (let i = 0; i < 2; i += 1) {
    const d = copy();
    const svc = createLinePlanService({ root: d, commands: null, load: staticLoad });
    assert.equal((await refuseBlocked(d, svc)).step.state, 'needs-you');
    // Each session's trace lands in the project under test (as two Cockpit runs on one project would).
    fs.mkdirSync(path.join(dir, 'line/traces'), { recursive: true });
    fs.copyFileSync(path.join(d, svc.trace.file), path.join(dir, svc.trace.file));
  }
  const before = outsideState(tree(dir));
  const { events } = readTraces(dir);
  const drafts = await draftFrameworkIssues(dir, events);
  assert.deepEqual(drafts.map((d) => d.miss.signature).sort(), ['line.setFragment|NEEDS_FIX|LINE-DIR']);
  assert.ok(drafts.every((d) => /^line\/issues\/[a-z0-9-]+-[0-9a-f]{6}\.md$/.test(d.file)));
  assert.deepEqual(outsideState(tree(dir)), before, 'only the Line state folder changed');
  const md = fs.readFileSync(path.join(dir, drafts.find((d) => d.miss.tool === 'line.setFragment').file), 'utf8');
  for (const h of ['# [Framework] Editing a code fragment (line.setFragment) is refused with LINE-DIR and no typed fix works', '> Draft only: Line wrote this from the session traces and did not file it.', '## Story', '## What recurred', '## Minimal case', '## Context Line picked (static)', '## The test this case becomes']) assert.ok(md.includes(h), h);
  assert.match(md, /- 2 refusals in 2 traces, signature `line\.setFragment\|NEEDS_FIX\|LINE-DIR`\./);
  assert.ok(md.includes('Construct refused this twice and never offered a typed fix that can run as a step.'), 'no fix of it would land');
  assert.ok(!md.includes('"fixOf"'), 'the case is the request alone');
  assert.ok(issueMarkdown(drafts[0].miss).includes("test('"), 'the case becomes a node test');
});

test('mock: the in-memory trace keeps the same typed events', () => {
  const t = createMemoryTrace({ id: 'm' });
  t.record({ kind: 'outcome', by: 'agent', tool: 'line.project', stepId: 's1', ok: true, passed: 1, total: 1 });
  t.record({ kind: 'outcome', by: 'agent', tool: 'line.project', stepId: 's1' });
  assert.equal(t.events.length, 1);
  assert.match(t.problem, /an outcome has ok, passed and total/);
});
