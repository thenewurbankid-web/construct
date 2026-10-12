// Two modes: the "Open a project" screen's options provider (lib/lineModes.ts). One level: the way in the person picks
// (?section=projects | new | clone), shown beside the chat. Reopen and the sample open a project at once (the screen's
// own handler, the same one its buttons use). Pure.
import type { ChatAnswer, ChatOption, Place, ScreenChatProvider } from '@/lib/lineModes';

/** What the Open-a-project chat reads (the same facts the screen shows). */
export type OpenModeData = { workspaceRoot: string | null; lastProject: string | null; samplePath: string | null };

export const OPEN_SECTIONS: readonly { id: string; name: string; text: string }[] = [
  { id: 'projects', name: 'Your projects', text: 'Pick a folder in your workspace to open it.' },
  { id: 'new', name: 'New project', text: 'Start a new Line project from a template.' },
  { id: 'clone', name: 'Clone a repository', text: 'Copy a repository into your workspace and open it.' },
];

const nameOf = (dir: string) => dir.split(/[\\/]+/).filter(Boolean).pop() ?? dir;
const EXPLAIN: ChatOption = { id: 'open.explain', label: 'Explain', sentence: 'What opening a project means here.', effect: 'read' };

function options(place: Place, data: OpenModeData): ChatOption[] {
  if (place.steps.length) return [EXPLAIN];
  const reopen: ChatOption = { id: 'open.reopen', label: data.lastProject ? `Reopen ${nameOf(data.lastProject)}` : 'Reopen', sentence: 'Open the project you had open last time.', effect: 'navigate' };
  const sample: ChatOption = { id: 'open.sample', label: 'Try the sample shop', sentence: 'Open the small demo app in your workspace.', effect: 'navigate' };
  return [
    data.lastProject ? reopen : { ...reopen, disabled: 'There is no project you had open before.' },
    data.samplePath ? sample : { ...sample, disabled: 'Your workspace has no sample shop folder.' },
    { id: 'open.start', label: 'Start or find a project', sentence: 'Pick one of your projects, start a new one, or clone a repository.', effect: 'read' },
    EXPLAIN,
  ];
}

function answer(optionId: string, place: Place, data: OpenModeData): ChatAnswer | null {
  if (optionId === 'open.start') return { text: 'How do you want to start?', pick: { label: 'Ways in', items: OPEN_SECTIONS.map((s) => ({ ...s })) } };
  if (optionId === 'open.explain') {
    const where = data.workspaceRoot ? ` Cockpit only opens folders inside ${data.workspaceRoot}.` : '';
    return { text: `A project is one folder with an architecture.yml; every screen then works on it.${where}` };
  }
  return null;
}

function intro(place: Place): ChatAnswer {
  const open = place.steps[0];
  if (open) return { text: `${open.label} is open beside this chat.` };
  return { text: 'No project is open yet. Reopen your last one, try the sample, or start or find a project.' };
}

export const OPEN_MODES: ScreenChatProvider<OpenModeData> = {
  screen: 'open',
  label: 'Open a project',
  href: '/',
  params: ['section'],
  defaultMode: 'chat',
  options,
  answer,
  intro,
  labelOf: (_param, id) => OPEN_SECTIONS.find((s) => s.id === id)?.name ?? id,
};
