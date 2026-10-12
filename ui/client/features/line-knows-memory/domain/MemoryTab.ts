// Pure (DOMAIN-001): "What Line knows", the Memory tab's words. What Line remembered per AI step, as a person reads it:
// "You picked 'via the library' 3 times for 'use item'." The tables mirror the engine's (memory/contract.mjs
// MEMORY_STEPS, memory/words.mjs TEMPLATE_PHRASE, drafter/contract.mjs intentPhrase); MemoryTab.spec.mjs keeps them equal.
import type { MemoryExport, MemoryLogEntry, MemoryRecord, MemoryRecordsView, MemoryRow, MemoryTabView } from '@/lib/lineKnowsContract';

/** The AI steps Line keeps memory for (engine: MEMORY_STEPS). */
export const STEP_LABELS: Record<string, string> = {
  'drafter.route': 'Which drafted route you pick',
  'plan.step': 'What happens to a proposed plan step',
  'plan.fix': 'Which fix you pick for a refused step',
  'import.step': 'How you change the Import plan',
  'train.route': 'Which route you agree with in Train Line',
};

/** How a route template reads (engine: TEMPLATE_PHRASE). */
export const ROUTE_WORDS: Record<string, string> = {
  'via-library': 'via the library',
  'base-on': 'a new item based on the library',
  promote: 'moving it into the library',
  'set-base': 'setting its base',
  'set-prop': 'setting the page value',
  'set-fragment': 'editing that piece of code',
  fix: 'that fix',
  'fix-all': 'fixing them all',
  combo: 'that combined route',
  'new-feature': 'starting a new feature',
  'create-layout': 'creating the layout',
};

const VERB_WORDS: Record<string, string> = { add: 'Add', update: 'Change', remove: 'Remove', rename: 'Rename', move: 'Move', promote: 'Move into the library', 'base-on': 'Base on the library', wire: 'Wire up', split: 'Split', merge: 'Merge', fix: 'Fix' };
const OBJECT_WORDS: Record<string, string> = {
  variable: 'a variable', prop: 'a value on a page', handler: 'what a page does on an action', page: 'a page', component: 'a component',
  'feature-flow': "a feature's flow", workflow: 'a flow', 'workflow-step': 'a step of a flow', service: 'a service', 'data-shape': 'a data shape',
  route: 'a route', fixture: 'sample data', test: 'a test', feature: 'a feature', 'library-item': 'a library item', layout: 'the layout', problem: 'a reported problem',
};

const WHO: Record<MemoryRecord['by'], string> = { person: 'You', agent: 'An agent', line: 'Line' };

/** A step's label, else its id. */
export function stepLabel(step: string): string {
  return STEP_LABELS[step] ?? step;
}

/** An intent id in words ("add.component" -> "Add a component"); an id outside the catalog reads as its words. */
export function intentWords(id: string): string {
  const [verb, object] = id.split('.');
  const v = VERB_WORDS[verb];
  const o = OBJECT_WORDS[object];
  if (!v || !o) return id.replace(/[.-]/g, ' ');
  if (verb === 'promote') return `Move ${o} into the library`;
  if (verb === 'base-on') return `Base ${o} on the library`;
  return `${v} ${o}`;
}

/** A closed option key in words: a route key, a Line tool, a fix id ("LINE-DIR:remove"), else the key itself. */
export function optionWords(key: string): string {
  const route = ROUTE_WORDS[key.replace(/^retrieval:/, '').split(':')[0]];
  if (route) return route;
  const tool = /^line\.([A-Za-z]+)$/.exec(key);
  if (tool) return tool[1].replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  const fix = /^([A-Z][A-Z0-9-]+):(.+)$/.exec(key);
  if (fix) return `${fix[2]} (${fix[1]})`;
  return key;
}

/** What happened to the proposal, who did it, in words ("You picked 'via the library'"). */
export function outcomeWords(r: MemoryRecord): string {
  const kept = `'${optionWords(r.chosen ?? r.proposed ?? '')}'`;
  const offered = `'${optionWords(r.proposed ?? r.chosen ?? '')}'`;
  const did: Record<MemoryRecord['kind'], string> = {
    picked: `picked ${kept}`,
    approved: `approved ${kept}`,
    refused: `refused ${offered}`,
    edited: `changed it to ${kept}`,
    skipped: `skipped ${offered}`,
    reordered: `moved ${offered}`,
    'fix-picked': `picked the fix ${kept}`,
    agreed: `agreed with ${kept}`,
    disagreed: `disagreed with ${offered}`,
  };
  return `${WHO[r.by]} ${did[r.kind]}`;
}

/** An ISO time as "2026-10-12 09:12" (UTC, so every screen and test reads the same). */
export function whenWords(at: string): string {
  return at.slice(0, 16).replace('T', ' ');
}

const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const sameKey = (r: MemoryRecord) => [r.step, r.intent, r.kind, r.chosen ?? '', r.proposed ?? '', r.by].join('\u0000');

/** One log entry as a sentence. */
export function logLine(e: MemoryLogEntry): string {
  const when = whenWords(e.at);
  const what: Record<MemoryLogEntry['action'], string> = {
    edit: `You changed one decision (${e.target})`,
    forget: `You forgot one decision (${e.target})`,
    forgetStep: `You forgot everything for '${stepLabel(e.target)}'`,
    forgetAll: 'You forgot everything Line remembered',
    import: `You imported a memory file (${e.target})`,
    embeddings: `You turned embeddings ${e.target}`,
  };
  return `${what[e.action]}, ${when}.`;
}

export type MemorySummary = { step: string; text: string; count: number };

const EMPTY: MemoryTabView = { sentence: 'Reading what Line remembered.', rows: [], steps: [], embeddingsOn: false, embeddingsRuns: false, log: [], summaries: [] };

/**
 * The Memory tab: one row per record (newest first) with how often the same decision was made, a summary sentence per
 * decision, the steps with their sizes, the embeddings switch and the log (newest first). Null while loading.
 */
export function memoryTabView(view: MemoryRecordsView | null): MemoryTabView {
  if (!view) return EMPTY;
  const counts = new Map<string, number>();
  for (const r of view.records) counts.set(sameKey(r), (counts.get(sameKey(r)) ?? 0) + 1);
  const rows: MemoryRow[] = [...view.records]
    .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
    .map((r) => ({
      id: r.id,
      step: r.step,
      stepLabel: stepLabel(r.step),
      intent: intentWords(r.intent),
      outcome: outcomeWords(r),
      count: counts.get(sameKey(r)) ?? 1,
      when: whenWords(r.at),
      options: [...r.options],
      chosen: r.chosen,
    }));
  const seen = new Set<string>();
  const summaries: MemorySummary[] = [];
  for (const r of view.records) {
    const k = sameKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    const n = counts.get(k) ?? 1;
    summaries.push({ step: r.step, count: n, text: `${outcomeWords(r)} ${times(n)} for '${intentWords(r.intent)}'.` });
  }
  summaries.sort((a, b) => a.step.localeCompare(b.step) || b.count - a.count);
  const sizes = new Map<string, number>();
  for (const r of view.records) sizes.set(r.step, (sizes.get(r.step) ?? 0) + 1);
  const steps = [...sizes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([step, size]) => ({ step, label: stepLabel(step), size }));
  return { sentence: view.sentence, rows, steps, embeddingsOn: view.embeddings.on, embeddingsRuns: view.embeddings.runs === true, log: [...view.log].reverse().map(logLine), summaries };
}

/** A file the person picked: a Line memory export, else one sentence. */
export function parseMemoryFile(text: string): { ok: true; file: MemoryExport } | { ok: false; sentence: string } {
  const no = { ok: false as const, sentence: 'That is not a Line memory file; export one from this tab first.' };
  let x: unknown;
  try {
    x = JSON.parse(text);
  } catch {
    return no;
  }
  const f = x as Partial<MemoryExport> | null;
  if (!f || f.v !== 1 || f.kind !== 'line-memory' || !f.steps || typeof f.steps !== 'object' || Array.isArray(f.steps)) return no;
  return { ok: true, file: f as MemoryExport };
}

/** The exported file's name, dated. */
export function exportFileName(now: Date): string {
  return `line-memory-${now.toISOString().slice(0, 10)}.json`;
}

/** What the switch actually does now: on alone is not enough, comparisons run only once the step measured a win (API `runs`). */
export function embeddingsHelp(on: boolean, runs: boolean): string {
  if (on && runs) return 'On: Line also compares the words of your past decisions with a local model; it never reads your code.';
  if (on) return 'On, but no comparisons run yet: the local model is used only once it measures a win over plain recall. It never reads your code.';
  return 'Off by default. When on, and once it measures a win over plain recall, Line also compares the words of your past decisions with a local model; it never reads your code.';
}
