// cl1 -- `construct line ...`: Line describes itself and reads its own session traces. Every verb reads; only
// `misses --draft` writes, and only markdown drafts into the project's Line state folder (through the writer's
// Line-state path). Nothing is filed and nothing leaves the machine.
//
//   construct line spec [--topic <rules|commands|plan|model|modules>] [--id <text>]   the versioned spec (JSON)
//   construct line misses [--dir <project>] [--threshold <n>] [--draft] [--json]     recurring refusals with no working fix
//   construct line context [--dir <project>] [--json]                                 the context Line picks for the latest miss
//   construct line check [--dir <project>] <expr JSON> [--json]                       evaluate an expression on the project's facts
//   construct line facts [--dir <project>]                                            the facts snapshot (JSON) expressions read
//   construct line records [--dir <project>] [--json]                                 the plan records kept for training (logic only)
//   construct line rules propose|gate|apply [--dir <project>] ...                     the static rule factory (cs2, packages/rule-factory)
import path from 'node:path';
import { findProjectRoot } from './config.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';

export const LINE_USAGE = [
  'Usage:',
  '  construct line spec [--topic rules|commands|plan|model|modules] [--id <text>]',
  '  construct line misses [--dir <project>] [--threshold <n>] [--draft] [--json]',
  '  construct line context [--dir <project>] [--json]',
  '  construct line check [--dir <project>] \'<expression JSON>\' [--json]',
  '  construct line facts [--dir <project>]',
  '  construct line records [--dir <project>] [--json]',
  '  construct line rules propose [--dir <project>] [--ledger <dir>] [--labels <jsonl>] [--limit <n>] [--no-jev] [--no-drafter] [--json]',
  '  construct line rules gate [--dir <project>] [--json]',
  '  construct line rules apply [--dir <project>] [--id <proposal id>]... [--json]',
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
    if (rest.includes('--json')) {
      console.log(JSON.stringify({ ok: true, traces: files, skipped, misses: misses.map(({ minimal, ...m }) => ({ ...m, case: { trace: minimal.trace, seq: minimal.seq } })), drafts: drafts.map((d) => d.file) }, null, 2));
      return;
    }
    if (!files.length) { console.log('There are no session traces in this project yet; they appear once a plan step is added in Cockpit or through MCP.'); return; }
    const issues = misses.filter((m) => m.frameworkIssue);
    console.log(`Read ${files.length} session trace${files.length === 1 ? '' : 's'}: ${misses.length} kind${misses.length === 1 ? '' : 's'} of refusal, ${issues.length} that recur${issues.length === 1 ? 's' : ''} with no working typed fix.`);
    for (const m of misses) console.log(`- ${m.frameworkIssue ? 'Framework issue' : m.working ? 'Fixed by a typed fix' : 'Not a pattern yet'}: ${toolWords(m.tool)} was refused ${times(m.count)} (${m.rules.join(', ') || m.code}). ${m.reason}`);
    if (skipped) console.log(`${skipped} trace line${skipped === 1 ? ' was' : 's were'} unreadable and skipped.`);
    if (drafts.length) for (const d of drafts) console.log(`Drafted (not filed): ${d.file}`);
    else if (rest.includes('--draft')) console.log('Nothing to draft: no refusal recurs without a working typed fix.');
    else if (issues.length) console.log('Add --draft to write each one as a markdown issue in the project\'s line/issues folder (nothing is filed).');
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
  if (verb === 'rules') { await rulesCommand(rest); return; }
  throw usage(verb ? `"${verb}" is not a line command.` : 'Name a line command.');
}

const pct = (x) => (x === null || x === undefined ? '-' : `${Math.round(x * 100)}%`);
const many = (n, one, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;

/**
 * `construct line rules propose|gate|apply`: the static rule factory (cs2). Offline: propose collects and labels
 * misses and writes proposals into the project's Line state folder; gate measures them on the held-out evals; apply
 * (run by a person) writes the passed ones to the Construct checkout's rule files through the writer.
 * @param {string[]} args The arguments after `rules`.
 * @returns {Promise<void>}
 */
async function rulesCommand(args) {
  const [sub, ...rest] = args;
  const root = rootOf(rest);
  const json = rest.includes('--json');
  const factory = await import('@line/rule-factory/factory');
  if (sub === 'propose') {
    const limit = flag(rest, '--limit');
    if (limit !== undefined && !(Number.isInteger(Number(limit)) && Number(limit) > 0)) throw usage('--limit must be a whole number from 1.');
    const ledger = flag(rest, '--ledger'); const labels = flag(rest, '--labels');
    const r = await factory.propose({
      root, limit: limit ? Number(limit) : undefined, jev: !rest.includes('--no-jev'), drafter: !rest.includes('--no-drafter'),
      ...(ledger ? { ledger: path.resolve(ledger) } : {}), ...(labels ? { labels: path.resolve(labels) } : {}),
    });
    if (json) { console.log(JSON.stringify({ ok: true, ...r }, null, 2)); return; }
    console.log(`Collected ${many(r.records, 'decision')}, ${many(r.misses, 'miss', 'misses')} by static code:`);
    for (const [s, n] of Object.entries(r.bySource)) console.log(`- ${s}: ${n.misses} of ${n.total} missed.`);
    const all = r.shares.find((x) => x.step === 'all');
    if (all) console.log(`All steps: ${all.sentence}`);
    console.log(r.labelling.sentence);
    console.log(r.proposals.length ? `${many(r.proposals.length, 'rule proposal')} (none applied):` : 'No rule proposal this time.');
    for (const p of r.proposals) console.log(`- ${p.id} (${p.kind}): ${p.sentence}`);
    for (const s of r.skipped) console.log(`Not proposed: ${s.count} x ${s.sentence}`);
    for (const n of r.notes) console.log(n);
    console.log(`Written: ${r.files.join(', ')}. Fill in the labelling file and propose again to add your own labels; then run \`construct line rules gate\`.`);
    return;
  }
  if (sub === 'gate') {
    const r = await factory.gate({ root, onProgress: json ? undefined : (s) => console.log(s) });
    if (json) { console.log(JSON.stringify({ ok: Boolean(r.report), ...r }, null, 2)); return; }
    if (!r.report) { console.log(r.sentence); return; }
    const b = r.report.baseline;
    console.log(`Baseline: Train held-out recall ${pct(b.train.recall)}, precision ${pct(b.train.precision)}, preferred ${pct(b.train.preferred)} (${b.train.n} cases); drafter held-out recall ${pct(b.drafter.recall)}, precision ${pct(b.drafter.precision)}, preferred ${pct(b.drafter.preferred)} (${b.drafter.n} cases).`);
    for (const x of r.report.results) console.log(`- ${x.proposalId}: ${x.sentence} ${x.ownTest.sentence}`);
    console.log(r.report.sentence);
    console.log(`Written: ${r.file}.${r.report.passed.length ? ' A person applies them with `construct line rules apply`.' : ''}`);
    return;
  }
  if (sub === 'apply') {
    const ids = rest.flatMap((a, i) => (a === '--id' && rest[i + 1] ? [rest[i + 1]] : []));
    const r = factory.apply({ root, ids });
    if (json) console.log(JSON.stringify(r, null, 2));
    else console.log(r.sentence);
    if (!r.ok) process.exitCode = 1;
    return;
  }
  throw usage(sub ? `"${sub}" is not a rules command; use propose, gate or apply.` : 'Name a rules command: propose, gate or apply.');
}
