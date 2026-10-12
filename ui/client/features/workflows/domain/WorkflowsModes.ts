// Two modes: the Workflows screen's options provider (lib/lineModes.ts). Levels: feature › workflow file, kept in the
// URL as ?feature= and ?file= ("Workflows › orders › checkout.ts"). Pure.
import type { ChatAnswer, ChatOption, Place, ScreenChatProvider } from '@/lib/lineModes';

/** What the Workflows chat reads: the features with a workflows/ folder, and the open feature's workflow files. */
export type WorkflowsModeData = { features: string[]; feature: string; files: string[]; filesLoading: boolean };

const at = (place: Place, param: string) => place.steps.find((s) => s.param === param)?.id ?? null;
const EXPLAIN: ChatOption = { id: 'workflows.explain', label: 'Explain', sentence: 'What a workflow is and what this screen shows.', effect: 'read' };

function options(place: Place): ChatOption[] {
  if (place.steps.length === 0) return [{ id: 'workflows.open', label: 'Open a feature', sentence: 'Pick a feature to see its workflow files.', effect: 'read' }, EXPLAIN];
  if (place.steps.length === 1) return [{ id: 'workflows.open-file', label: 'Open a workflow', sentence: 'Pick one of this feature\'s workflow files to see its states as a diagram.', effect: 'read' }, EXPLAIN];
  return [EXPLAIN];
}

function answer(optionId: string, place: Place, data: WorkflowsModeData): ChatAnswer | null {
  const feature = at(place, 'feature');
  const file = at(place, 'file');
  if (optionId === 'workflows.open') {
    if (!data.features.length) return { text: 'No feature has a workflows folder yet.' };
    return { text: 'Which feature\'s workflows do you want to see?', pick: { label: 'Features', items: data.features.map((f) => ({ id: f, name: f, text: `The workflows of ${f}.` })) } };
  }
  if (optionId === 'workflows.open-file') {
    if (data.feature !== feature || data.filesLoading) return { text: `Still reading the workflows of ${feature}; ask again in a moment.` };
    if (!data.files.length) return { text: `${feature} has no workflow files yet.` };
    return { text: `Which workflow of ${feature} do you want to open?`, pick: { label: 'Workflows', items: data.files.map((f) => ({ id: f, name: f, text: `Its states and moves, as a diagram.` })) } };
  }
  if (optionId === 'workflows.explain') {
    if (file) return { text: `${file} is open: each state is a box and each move between states is an arrow. Pick a state to read what it does.` };
    if (feature) return { text: `A workflow is a state machine in ${feature}'s workflows folder; it says which page or step comes after which.` };
    return { text: 'A workflow is a state machine in a feature\'s workflows folder. Open a feature to see its workflows as diagrams.' };
  }
  return null;
}

function intro(place: Place): ChatAnswer {
  const last = place.steps.at(-1);
  if (last) return { text: `${last.label} is open beside this chat.` };
  return { text: 'Workflows shows each feature\'s state machines as diagrams. Open a feature to start.' };
}

export const WORKFLOWS_MODES: ScreenChatProvider<WorkflowsModeData> = {
  screen: 'workflows',
  label: 'Workflows',
  href: '/workflows',
  params: ['feature', 'file'],
  defaultMode: 'hood',
  options,
  answer,
  intro,
};
