// cl1 -- `construct line ...`: Line describes itself and reads its own session traces. Every verb reads; only
// `misses --draft` writes, and only markdown drafts into the project's Line state folder (through the writer's
// Line-state path). Nothing is filed and nothing leaves the machine.
//
//   construct line spec [--topic <rules|commands|plan|model|modules>] [--id <text>]   the versioned spec (JSON)
//   construct line misses [--dir <project>] [--threshold <n>] [--draft] [--json]     recurring refusals with no working fix
//   construct line context [--dir <project>] [--json]                                 the context Line picks for the latest miss
import path from 'node:path';
import { findProjectRoot } from './config.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';

export const LINE_USAGE = [
  'Usage:',
  '  construct line spec [--topic rules|commands|plan|model|modules] [--id <text>]',
  '  construct line misses [--dir <project>] [--threshold <n>] [--draft] [--json]',
  '  construct line context [--dir <project>] [--json]',
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
  throw usage(verb ? `"${verb}" is not a line command.` : 'Name a line command.');
}
