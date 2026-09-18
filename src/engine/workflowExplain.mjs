// Epic #185 -- one call that explains every machine in a workflow file:
// plain-English narrative + scenarios + health findings, plus the text
// renderers shared by the CLI and the UI server. Deterministic, read-only,
// re-derived from source on every call (nothing stored).
import { extractMachines } from './workflowExtractor.mjs';
import { narrateMachine, humanize } from './workflowNarrator.mjs';
import { enumerateScenarios, findHealthIssues } from './workflowScenarios.mjs';

/** Explain one already-extracted machine. Never throws. */
export function explainMachine(machine, opts = {}) {
  const narration = narrateMachine(machine);
  const { scenarios, loops, truncated, total } = enumerateScenarios(machine, opts);
  const findings = findHealthIssues(machine);
  return {
    ...narration,
    exportName: machine.exportName ?? null,
    line: machine.line ?? null,
    error: machine.error ?? null,
    scenarios,
    loops,
    truncated,
    findings,
  };
}

/** Explain every machine found in `source`. Always `{ machines, error }`, never throws. */
export function explainSource(source, opts = {}) {
  const { machines, error } = extractMachines(source);
  return { machines: machines.map((m) => explainMachine(m, opts)), error };
}

export function renderScenarios(e, { markdown = false } = {}) {
  if (e.error) return `${e.summary}\n`;
  if (!e.scenarios.length) return 'No complete route from the start to an end state was found.\n';
  const lines = [];
  for (const sc of e.scenarios) {
    lines.push(markdown ? `#### ${sc.title}` : sc.title);
    lines.push(markdown ? `_${sc.route}_` : `  Route: ${sc.route}`);
    for (const l of sc.text) lines.push(markdown ? `- ${l}` : `  ${l}`);
    lines.push('');
  }
  if (e.truncated) lines.push(`(Showing the first ${e.scenarios.length} scenarios; this flow has more.)`);
  return `${lines.join('\n').trimEnd()}\n`;
}

export function renderFindings(e, { markdown = false } = {}) {
  if (e.error) return '';
  if (!e.findings.length) return 'No problems found: every step is reachable and every non-final step has a way out.\n';
  return `${e.findings.map((f) => (markdown ? `- **${f.kind}**: ${f.message}` : `  - [${f.kind}] ${f.message}`)).join('\n')}\n`;
}

/** Full report for one explained machine. format: 'prose' | 'md' | 'scenarios'. */
export function renderExplained(e, format = 'prose') {
  if (format === 'scenarios') return renderScenarios(e);
  if (format === 'md') {
    const md = e.text.split('\n');
    const head = `## ${md[0]}\n\n${e.summary}\n`;
    const body = e.states.map((s) => `### ${s.path.split('.').map(humanize).join(' › ')} _(${s.kind})_\n\n${s.sentences.map((x) => `- ${x}`).join('\n')}\n`).join('\n');
    if (e.error) return `${head}\n`;
    return `${head}\n${body}\n### Scenarios\n\n${renderScenarios(e, { markdown: true })}\n### Health\n\n${renderFindings(e, { markdown: true })}`;
  }
  if (e.error) return e.text;
  return `${e.text}\nScenarios\n${renderScenarios(e).replace(/^/gm, '  ').replace(/^ {2}$/gm, '')}\nHealth\n${renderFindings(e)}`;
}
