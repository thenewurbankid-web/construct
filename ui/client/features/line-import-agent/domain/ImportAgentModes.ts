// Two modes: the Import agent screen's options provider (lib/lineModes.ts). One level: a step of the agent's plan
// (?step=), which Under the hood scrolls to (the plan). Pure.
import type { ChatAnswer, ChatOption, Place, ScreenChatProvider } from '@/lib/lineModes';

/** What the Import agent chat reads: whether it started, where it is, and the plan's steps. */
export type ImportAgentModeData = { started: boolean; sentence: string | null; stages: { label: string; status: string }[]; rows: { id: string; n: number; sentence: string; outcome: string | null }[] };

const EXPLAIN: ChatOption = { id: 'import-agent.explain', label: 'Explain', sentence: 'What the Import agent does, and what waits for you.', effect: 'read' };

function options(place: Place, data: ImportAgentModeData): ChatOption[] {
  if (place.steps.length) return [EXPLAIN];
  const steps: ChatOption = { id: 'import-agent.steps', label: 'Open a step', sentence: 'Pick one step of the agent\'s plan to read it.', effect: 'read' };
  return [
    { id: 'import-agent.status', label: 'Where is it?', sentence: 'Say which stage the import is at and what waits for you.', effect: 'read' },
    data.rows.length ? steps : { ...steps, disabled: 'The agent has no plan yet; start the import beside this chat first.' },
    { id: 'import-agent.by-hand', label: 'Import by hand', sentence: 'Pick and answer each part yourself on the Import screen.', effect: 'navigate' },
    EXPLAIN,
  ];
}

function answer(optionId: string, place: Place, data: ImportAgentModeData): ChatAnswer | null {
  if (optionId === 'import-agent.status') {
    if (!data.started) return { text: 'The import has not started. Pick a folder and start it beside this chat.' };
    const now = data.stages.find((s) => s.status !== 'done');
    return { text: data.sentence ?? (now ? `The agent is at ${now.label}.` : 'The import is done.') };
  }
  if (optionId === 'import-agent.steps') {
    if (!data.rows.length) return { text: 'The agent has no plan yet.' };
    return { text: 'Which step do you want to read?', pick: { label: 'Steps', items: data.rows.map((r) => ({ id: r.id, name: `Step ${r.n}`, text: r.sentence })) } };
  }
  if (optionId === 'import-agent.by-hand') return { text: 'On the Import screen you pick the folder and answer each question yourself.', link: { href: '/import', label: 'Open Import' } };
  if (optionId === 'import-agent.explain') {
    const row = data.rows.find((r) => r.id === place.steps[0]?.id);
    if (row) return { text: `Step ${row.n}: ${row.sentence.replace(/\.?$/, '.')}${row.outcome ? ` ${row.outcome.replace(/\.?$/, '.')}` : ''}` };
    return { text: 'The Import agent reads a folder, sorts what it finds, writes a plan you review, then makes each change as a plan step you approve.' };
  }
  return null;
}

function intro(place: Place): ChatAnswer {
  const step = place.steps[0];
  if (step) return { text: `${step.label} is open beside this chat.` };
  return { text: 'The Import agent brings one folder into Line through a plan you review and approve.' };
}

export const IMPORT_AGENT_MODES: ScreenChatProvider<ImportAgentModeData> = {
  screen: 'import-agent',
  label: 'Import agent',
  href: '/import/agent',
  params: ['step'],
  defaultMode: 'chat',
  options,
  answer,
  intro,
  labelOf: (_param, id, data) => {
    const row = data.rows.find((r) => r.id === id);
    return row ? `Step ${row.n}` : id;
  },
  anchor: (place) => (place.steps.length ? 'la-plan-h' : null),
};
