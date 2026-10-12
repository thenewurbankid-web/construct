// cl1 -- `construct line ...`: Line describes itself and reads its own session traces. Every verb reads; only
// `misses --draft` writes, and only markdown drafts into the project's Line state folder (through the writer's
// Line-state path). Nothing is filed and nothing leaves the machine.
//
//   construct line spec [--topic <rules|commands|plan|model|modules>] [--id <text>]   the versioned spec (JSON)
//   construct line misses [--dir <project>] [--threshold <n>] [--draft] [--eval] [--json]
//                                                      recurring refusals with no working fix, and the miss report (im1):
//                                                      absent vs picked per step; --eval adds Train Line and the drafter eval
//   construct line context [--dir <project>] [--json]                                 the context Line picks for the latest miss
//   construct line check [--dir <project>] <expr JSON> [--json]                       evaluate an expression on the project's facts
//   construct line facts [--dir <project>]                                            the facts snapshot (JSON) expressions read
//   construct line records [--dir <project>] [--json]                                 the plan records kept for training (logic only)
import path from 'node:path';
import { findProjectRoot } from './config.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';

export const LINE_USAGE = [
  'Usage:',
  '  construct line spec [--topic rules|commands|plan|model|modules] [--id <text>]',
  '  construct line misses [--dir <project>] [--threshold <n>] [--draft] [--eval] [--json]',
  '  construct line context [--dir <project>] [--json]',
  '  construct line check [--dir <project>] \'<expression JSON>\' [--json]',
  '  construct line facts [--dir <project>]',
  '  construct line records [--dir <project>] [--json]',
].join('\n');

const flag = (args, name) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined; };
const rootOf = (args) => { const d = flag(args, '--dir'); const dir = path.resolve(d ?? process.cwd()); return d ? dir : findProjectRoot(dir) ?? dir; };
const usage = (message) => new ConstructError(`${message}\n${LINE_USAGE}`, { exitCode: EXIT_CODES.USAGE_ERROR });

/**
 * `construct line <spec|context|misses>`: Line describes itself, hands over the picked context, or lists recurring misses.
 * @param {string[]} args The arguments after `line`.
 * @returns {Promise<void>}
 */
export async function lineCommand(args) {
  const [verb, ...rest] = args;
  if (verb === 'spec') {
    const { buildLineSpec, sliceSpec } = await import('@line/construct-engine/line/spec');
    const { SPEC_TOPICS } = await import('@line/construct-engine/line/contract');
    const topic = flag(rest, '--topic');
    if (topic && !SPEC_TOPICS.includes(topic)) throw usage(`"${topic}" is not a spec topic; the topics are ${SPEC_TOPICS.join(', ')}.`);
    const spec = await buildLineSpec();
    console.log(JSON.stringify(topic ? sliceSpec(spec, topic, flag(rest, '--id')) : spec, null, 2));
    return;
  }
  if (verb === 'misses') {
    const root = rootOf(rest);
    const threshold = Number(flag(rest, '--threshold') ?? 2);
    if (!Number.isInteger(threshold) || threshold < 1) throw usage('--threshold must be a whole number from 1.');
    const { readTraces } = await import('@line/construct-engine/line/trace');
    const { detectMisses, draftFrameworkIssues, times, toolWords } = await import('@line/construct-engine/line/miss-detector');
    const { events, files, skipped } = readTraces(root);
    const misses = detectMisses(events, { threshold });
    let drafts = [];
    if (rest.includes('--draft')) {
      const { buildLineSpec } = await import('@line/construct-engine/line/spec');
      drafts = await draftFrameworkIssues(root, events, { threshold, spec: await buildLineSpec() });
    }
    // im1: the miss report -- every miss classified absent (the right answer was not among Line's options) or picked
    // (offered, another recommended), per step, from plan feedback; with --eval also from Train Line's gold and the
    // drafter eval (the repo's own corpora; about 30 seconds).
    const report = await missReportOf(root, rest.includes('--eval'));
    if (rest.includes('--json')) {
      console.log(JSON.stringify({ ok: true, traces: files, skipped, misses: misses.map(({ minimal, ...m }) => ({ ...m, case: { trace: minimal.trace, seq: minimal.seq } })), drafts: drafts.map((d) => d.file), report }, null, 2));
      return;
    }
    if (!files.length) { console.log('There are no session traces in this project yet; they appear once a plan step is added in Cockpit or through MCP.'); printMissReport(report); return; }
    const issues = misses.filter((m) => m.frameworkIssue);
    console.log(`Read ${files.length} session trace${files.length === 1 ? '' : 's'}: ${misses.length} kind${misses.length === 1 ? '' : 's'} of refusal, ${issues.length} that recur${issues.length === 1 ? 's' : ''} with no working typed fix.`);
    for (const m of misses) console.log(`- ${m.frameworkIssue ? 'Framework issue' : m.working ? 'Fixed by a typed fix' : 'Not a pattern yet'}: ${toolWords(m.tool)} was refused ${times(m.count)} (${m.rules.join(', ') || m.code}). ${m.reason}`);
    if (skipped) console.log(`${skipped} trace line${skipped === 1 ? ' was' : 's were'} unreadable and skipped.`);
    if (drafts.length) for (const d of drafts) console.log(`Drafted (not filed): ${d.file}`);
    else if (rest.includes('--draft')) console.log('Nothing to draft: no refusal recurs without a working typed fix.');
    else if (issues.length) console.log('Add --draft to write each one as a markdown issue in the project\'s line/issues folder (nothing is filed).');
    printMissReport(report);
    return;
  }
  if (verb === 'context') {
    const root = rootOf(rest);
    const { readTraces } = await import('@line/construct-engine/line/trace');
    const { pickContext } = await import('@line/construct-engine/line/context-picker');
    const { toolWords } = await import('@line/construct-engine/line/miss-detector');
    const { events } = readTraces(root);
    const miss = [...events].reverse().find((e) => e.kind === 'refusal' && e.source === 'construct');
    if (!miss) { console.log('There is no refusal by Construct in this project\'s session traces, so there is no context to pick.'); return; }
    const pick = await pickContext(root, { miss, events });
    if (rest.includes('--json')) { console.log(JSON.stringify({ ok: true, miss: { trace: miss.trace, seq: miss.seq, tool: miss.tool, sentence: miss.sentence }, ...pick }, null, 2)); return; }
    console.log(`The latest refusal, ${toolWords(miss.tool).charAt(0).toLowerCase()}${toolWords(miss.tool).slice(1)}: ${miss.sentence}`);
    console.log(`Line picked ${pick.files.length} file${pick.files.length === 1 ? '' : 's'} (${pick.via === 'jev' ? 'jev chose among tied candidates' : 'static order'}):`);
    for (const f of pick.files) console.log(`- ${f.file}: ${f.why} ${f.summary.sentence}`);
    if (pick.rules.length) console.log(`Rules: ${pick.rules.join(', ')}.`);
    return;
  }
  if (verb === 'check' || verb === 'facts') {
    const root = rootOf(rest);
    const { buildFacts, summarizeFacts, factsHash } = await import('@line/construct-engine/line/facts');
    const facts = buildFacts(root);
    if (verb === 'facts') { console.log(JSON.stringify({ hash: factsHash(facts), ...summarizeFacts(facts) }, null, 2)); return; }
    const dirAt = rest.indexOf('--dir');
    const text = rest.find((a, i) => !a.startsWith('--') && i !== dirAt + 1);
    if (!text) throw usage('Give the expression as JSON, for example \'{"exists": {"path": ["files", "features/orders/spec.md"]}}\'.');
    let expr;
    try { expr = JSON.parse(text); } catch { throw usage('The expression is not valid JSON.'); }
    const { evaluate } = await import('@line/construct-engine/line/expr');
    const r = evaluate(facts, expr);
    if (rest.includes('--json')) console.log(JSON.stringify(r, null, 2));
    else if (r.ok) console.log('Holds.');
    else for (const f of r.failed) console.log(f.sentence);
    if (!r.ok) process.exitCode = 1;
    return;
  }
  if (verb === 'records') {
    const root = rootOf(rest);
    const { readPlanRecords } = await import('@line/construct-engine/line/records');
    const { records, skipped, file } = readPlanRecords(root);
    if (rest.includes('--json')) { console.log(JSON.stringify({ ok: true, file, skipped, records }, null, 2)); return; }
    if (!records.length) { console.log(`There are no plan records in ${file} yet; one is kept each time a change step finishes.`); return; }
    const passed = records.filter((r) => r.passed === r.checks.length).length;
    console.log(`${records.length} plan record${records.length === 1 ? '' : 's'} in ${file}: ${passed} passed every check, ${records.filter((r) => r.repaired).length} repaired an earlier step. Names are typed slots; no project name is kept.`);
    for (const r of records.slice(-5)) console.log(`- ${r.steps[r.step - 1].tool}: ${r.intent} (${r.passed} of ${r.checks.length} checks passed${r.approved ? ', approved by a person' : ''})`);
    if (skipped) console.log(`${skipped} record line${skipped === 1 ? ' was' : 's were'} unreadable and skipped.`);
    return;
  }
  throw usage(verb ? `"${verb}" is not a line command.` : 'Name a line command.');
}

/**
 * im1: the miss report of a project (plan feedback), plus Train Line's and the drafter eval's misses with `withEval`.
 * @param {string} root
 * @param {boolean} withEval
 * @returns {Promise<any>}
 */
async function missReportOf(root, withEval) {
  const { readClassifiedPlanMisses, missReport } = await import('@line/rule-factory/misses');
  const plan = readClassifiedPlanMisses(root);
  if (!withEval) return { sources: ['plan'], numbers: null, ...missReport(plan) };
  const { runEvalMisses } = await import('@line/rule-factory/eval-misses');
  const ev = await runEvalMisses();
  return { sources: ['plan', 'train', 'drafter-eval'], numbers: ev.numbers, ...missReport([...plan, ...ev.train, ...ev.drafter]) };
}

/** @param {any} r */
function printMissReport(r) {
  console.log(`Miss report (${r.sources.join(', ')}): ${r.sentence}`);
  for (const s of r.steps) console.log(`- ${s.sentence}`);
  if (r.topAbsent.length) console.log('Most common misses where the right answer was not offered (a static tool should cover them):');
  for (const p of r.topAbsent) console.log(`- ${p.sentence}`);
  if (r.numbers?.train) console.log(`Train Line held-out eval: ${Math.round(r.numbers.train.recall * 100)}% of the valid routes found, ${Math.round(r.numbers.train.preferred * 100)}% picked the preferred one (${r.numbers.train.n} cases).`);
  if (r.numbers?.drafter) console.log(`Drafter eval: ${Math.round(r.numbers.drafter.recall * 100)}% route recall, ${Math.round(r.numbers.drafter.precision * 100)}% precision (${r.numbers.drafter.n} cases).`);
  if (!r.numbers) console.log('Add --eval to include Train Line\'s gold and the drafter eval (about 30 seconds).');
}
