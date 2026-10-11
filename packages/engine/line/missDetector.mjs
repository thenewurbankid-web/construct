// cl1 -- a miss that recurs becomes a drafted framework issue. A miss is a refusal by Construct (not by the plan
// protocol) in the session traces. Refusals group by signature (tool, code, rule ids); a group is a framework issue
// when it recurs (at least `threshold` times) and no typed fix worked for it: none was offered, none was tried, or every
// fix (and retry) that was tried did not pass. For each, one minimal case is cut from a real trace (the refusal with the
// fewest files and the shortest request) and drafted as a markdown issue at `<state>/issues/<id>.md`, written through
// the writer's Line-state path. Drafted only: nothing is filed, nothing leaves the machine.
import crypto from 'node:crypto';
import { writeLineState } from '../transactionalWriter.mjs';
import { lineStateDir } from './workspace.mjs';
import { pickContext } from './contextPicker.mjs';
import { sliceSpec } from './spec.mjs';

/**
 * A refusal's signature: what recurs.
 * @param {any} e A refusal trace event.
 * @returns {string} tool|code|rules.
 */
export const signatureOf = (e) => `${e.tool}|${e.code}|${[...(e.rules ?? [])].sort().join(',')}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/**
 * "once", "twice", "3 times".
 * @param {number} n
 * @returns {string}
 */
export const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
/** What a plan tool does, in plain words (the tool name stays as the technical detail). */
export const TOOL_WORDS = Object.freeze({
  'line.baseOn': 'Basing a new item on the library', 'line.promote': 'Promoting an item to the library', 'line.setPageProp': 'Setting a page prop',
  'line.fix': 'Applying a typed fix', 'line.setFragment': 'Editing a code fragment', 'line.setBase': 'Setting a base link',
  'line.moveFile': 'Moving a file', 'line.createLayout': 'Creating the Line layout', 'line.leaveAsIs': 'Leaving a step as it is', 'line.project': 'Reading the project',
});
/**
 * "Editing a code fragment (line.setFragment)".
 * @param {string} tool A plan tool name.
 * @returns {string}
 */
export const toolWords = (tool) => (TOOL_WORDS[tool] ? `${TOOL_WORDS[tool]} (${tool})` : `Running ${tool}`);

/**
 * Group the Construct refusals of `events` and say which recur with no working typed fix.
 * @param {import('./contract.mjs').TraceEvent[]} events
 * @param {{threshold?: number}} [o]
 * @returns The misses and a summary.
 */
export function detectMisses(events, { threshold = 2 } = {}) {
  const key = (e) => `${e.trace}#${e.stepId}`;
  const outcomes = new Map(events.filter((e) => e.kind === 'outcome').map((e) => [key(e), e]));
  const groups = new Map();
  for (const e of events) {
    if (e.kind !== 'refusal' || e.source !== 'construct') continue;
    const sig = signatureOf(e);
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(e);
  }
  const misses = [];
  for (const [signature, refusals] of groups) {
    const refused = new Set(refusals.filter((r) => r.stepId).map(key));
    const answers = events.filter((e) => e.kind === 'step' && ((e.fixOf && refused.has(`${e.trace}#${e.fixOf}`)) || (e.retryOf && refused.has(`${e.trace}#${e.retryOf}`))));
    const tried = answers.map((a) => ({ step: a, outcome: outcomes.get(key(a)) ?? null, fixId: events.find((p) => p.kind === 'fix-picked' && p.trace === a.trace && p.stepId === a.stepId)?.fixId ?? null }));
    const passed = tried.filter((t) => t.outcome?.ok === true);
    const offered = refusals.reduce((n, r) => n + r.fixes.filter((f) => f.tool).length, 0);
    const working = passed.length > 0;
    const traces = new Set(refusals.map((r) => r.trace)).size;
    const recurs = refusals.length >= threshold;
    const reason = !offered ? `Construct refused this ${times(refusals.length)} and never offered a typed fix that can run as a step.`
      : !tried.length ? `Construct offered typed fixes ${times(refusals.length)}, but none was tried, so none is known to work.`
        : !working ? `Every typed fix or retry tried (${tried.length}) was refused again or failed its checks.`
          : `A typed fix worked (${passed.map((t) => t.fixId ?? t.step.tool).join(', ')}).`;
    const minimal = [...refusals].sort((a, b) => a.files.length - b.files.length || JSON.stringify(a.args ?? {}).length - JSON.stringify(b.args ?? {}).length || a.seq - b.seq)[0];
    misses.push({
      signature, tool: minimal.tool, code: minimal.code, rules: [...minimal.rules], count: refusals.length, traces,
      offered, tried: tried.map((t) => ({ stepId: t.step.stepId, tool: t.step.tool, fixId: t.fixId, ok: t.outcome?.ok ?? null })),
      working, recurs, frameworkIssue: recurs && !working, reason, minimal,
    });
  }
  return misses.sort((a, b) => Number(b.frameworkIssue) - Number(a.frameworkIssue) || b.count - a.count || a.signature.localeCompare(b.signature));
}

/**
 * The draft's file id: readable, stable for the same signature.
 * @param {string} signature A refusal signature (signatureOf).
 * @returns {string}
 */
export function draftId(signature) {
  const [tool, code, rules] = signature.split('|');
  const words = `${tool.replace(/^line\./, '')}-${rules || code}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  return `${words}-${crypto.createHash('sha256').update(signature).digest('hex').slice(0, 6)}`;
}

/** The node:test the case turns into: the invariant "a refused request offers a typed fix that works". */
function testFor(miss) {
  const args = JSON.stringify(Object.fromEntries(Object.entries(miss.minimal.args ?? {}).filter(([k]) => k !== 'fixOf')));
  return [
    "test('" + `${miss.tool} refused with ${miss.rules.join(', ') || miss.code} offers a typed fix that works` + "', async () => {",
    '  const dir = copy(); // a copy of examples/line-sample (or of the fixture this case needs)',
    "  const svc = createLinePlanService({ root: dir, commands: null, load: staticLoad, trace: null });",
    `  const added = await svc.addStep({ tool: '${miss.tool}', args: ${args} }, 'ui');`,
    "  await svc.approve(added.stepId, 'ui');",
    "  const step = (await svc.runNext('ui')).steps.find((s) => s.id === added.stepId);",
    "  if (step.state === 'done') return; // the request itself now works",
    "  // Invariant: every refusal offers at least one typed fix whose step passes its checks.",
    "  const fixes = step.result.options.filter((o) => o.id === 'fix' && o.step);",
    "  assert.ok(fixes.length, step.sentence);",
    '  let worked = false;',
    '  for (const fix of fixes) {',
    "    const d = copy(); const s2 = createLinePlanService({ root: d, commands: null, load: staticLoad, trace: null });",
    "    const a = await s2.addStep({ tool: '" + miss.tool + "', args: " + args + " }, 'ui'); await s2.approve(a.stepId, 'ui'); await s2.runNext('ui');",
    "    const f = await s2.addStep({ tool: fix.step.tool, args: { ...fix.step.args, fixOf: a.stepId } }, 'ui');",
    "    await s2.approve(f.stepId, 'ui');",
    "    worked ||= (await s2.runNext('ui', f.stepId)).steps.find((s) => s.id === f.stepId).state === 'done';",
    '  }',
    "  assert.ok(worked, 'no typed fix for this refusal works');",
    '});',
  ].join('\n');
}

/**
 * The markdown of one drafted framework issue: the story, what recurred, the minimal case, the spec slice, the context
 * Line picked and the test the case becomes.
 * @param {ReturnType<typeof detectMisses>[number]} miss
 * @param {{context?: import('./contract.mjs').ContextPick, spec?: import('./contract.mjs').LineSpec}} [o]
 * @returns {string} The issue as markdown.
 */
export function issueMarkdown(miss, { context, spec } = {}) {
  const m = miss.minimal;
  const what = miss.rules.length ? miss.rules.join(', ') : miss.code;
  const lines = [
    `# [Framework] ${toolWords(miss.tool)} is refused with ${what} and no typed fix works`,
    '',
    '> Draft only: Line wrote this from the session traces and did not file it. A maintainer reviews it and files it by hand.',
    '',
    '## Story',
    `As a Line user or agent running ${miss.tool}, I want every refusal by Construct to carry a typed fix that works, so that the step corrects itself without anyone writing code by hand.`,
    '',
    '- The minimal case below either succeeds, or is refused with at least one typed fix whose step passes its checks.',
    '- The case is a node test (the invariant below) that ran and passed.',
    '- `construct validate --dir examples/line-sample --profile line` shows no new findings.',
    '',
    '## What recurred',
    `- ${plural(miss.count, 'refusal')} in ${plural(miss.traces, 'trace')}, signature \`${miss.signature}\`.`,
    `- ${miss.reason}`,
    ...(miss.tried.length ? [`- Tried: ${miss.tried.map((t) => `${t.fixId ?? t.tool} (${t.ok === true ? 'passed' : t.ok === false ? 'did not pass' : 'not run'})`).join('; ')}.`] : []),
    '',
    `## Minimal case (trace ${m.trace}, event ${m.seq})`,
    `${m.sentence}`,
    '',
    '```json',
    JSON.stringify({ tool: m.tool, args: Object.fromEntries(Object.entries(m.args ?? {}).filter(([k]) => k !== 'fixOf')), by: m.by }, null, 2),
    '```',
    '',
    `- Rules: ${m.rules.length ? m.rules.join(', ') : 'none (refused before validate)'}.`,
    `- Files: ${m.files.length ? m.files.join(', ') : 'none named'}.`,
    `- Typed fixes offered: ${m.fixes.length ? m.fixes.map((f) => `${f.fixId ?? 'advice only'}${f.tool ? ` (${f.tool})` : ''}${f.recommended ? ', recommended' : ''}`).join('; ') : 'none'}.`,
  ];
  if (spec && miss.rules.length) {
    lines.push('', '## Spec slice (rules)');
    for (const id of miss.rules) for (const r of /** @type {any} */ (sliceSpec(spec, 'rules', id).topics).rules.filter((x) => x.id === id)) lines.push(`- **${r.id}** (${r.defaultSeverity}): ${r.why}`);
    lines.push(`- Spec version ${spec.version}.`);
  }
  if (context) {
    lines.push('', `## Context Line picked (${context.via}${context.ambiguous ? ', more candidates tied at the cut' : ''})`);
    for (const f of context.files) lines.push(`- \`${f.file}\`: ${f.why} ${f.summary.sentence}`);
    for (const i of context.items.filter((x) => x.kind === 'plan-step')) lines.push(`- Plan step ${i.id}: ${i.why}`);
  }
  lines.push('', '## The test this case becomes', '', '```js', testFor(miss), '```', '');
  return lines.join('\n');
}

/**
 * Draft one framework issue per recurring miss with no working fix, as markdown under `<state>/issues/`. Never files.
 * @param {string} root
 * @param {import('./contract.mjs').TraceEvent[]} events
 * @param {{threshold?: number, spec?: import('./contract.mjs').LineSpec, pickOptions?: object}} [o]
 * @returns {Promise<{file: string, id: string, miss: ReturnType<typeof detectMisses>[number]}[]>}
 */
export async function draftFrameworkIssues(root, events, { threshold = 2, spec, pickOptions } = {}) {
  const stateDir = lineStateDir(root);
  const out = [];
  for (const miss of detectMisses(events, { threshold }).filter((x) => x.frameworkIssue)) {
    const context = await pickContext(root, { miss: miss.minimal, events }, pickOptions);
    const id = draftId(miss.signature);
    const file = writeLineState(root, `${stateDir}/issues/${id}.md`, issueMarkdown(miss, { context, spec }), { stateDir });
    out.push({ file, id, miss });
  }
  return out;
}
