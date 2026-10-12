// Two modes: the Train Line screen's options provider (lib/lineModes.ts). One level: the panel (?section= review, teach
// or score), which Under the hood scrolls into view and marks as open. Pure.
import type { ChatAnswer, ChatOption, Place, ScreenChatProvider } from '@/lib/lineModes';

export const TRAIN_SECTIONS: readonly { id: string; name: string; text: string; anchor: string }[] = [
  { id: 'review', name: 'Review Claude\'s cases', text: 'Agree or disagree with the routes Claude proposed.', anchor: 'ltr-review-head' },
  { id: 'teach', name: 'Teach a new request', text: 'Type a request, correct the draft, try it and save it as a case.', anchor: 'ltr-teach-head' },
  { id: 'score', name: 'Scoreboard', text: 'Run the eval on the held-out projects and read the scores.', anchor: 'ltr-score-head' },
];

export type TrainModeData = { sections: typeof TRAIN_SECTIONS };
export const TRAIN_MODE_DATA: TrainModeData = { sections: TRAIN_SECTIONS };

const EXPLAIN: ChatOption = { id: 'train.explain', label: 'Explain', sentence: 'What training Line does and what it never touches.', effect: 'read' };

function options(place: Place): ChatOption[] {
  if (place.steps.length) return [EXPLAIN];
  return [{ id: 'train.open', label: 'What do you want to do?', sentence: 'Review cases, teach a request, or read the scoreboard.', effect: 'read' }, EXPLAIN];
}

function answer(optionId: string, place: Place, data: TrainModeData): ChatAnswer | null {
  if (optionId === 'train.open') return { text: 'Pick what to do.', pick: { label: 'Training', items: data.sections.map((s) => ({ id: s.id, name: s.name, text: s.text })) } };
  if (optionId === 'train.explain') {
    const open = data.sections.find((s) => s.id === place.steps[0]?.id);
    if (open) return { text: `${open.name}: ${open.text}` };
    return { text: 'Training teaches Line\'s drafter to turn a request into plan steps and checks. Every check runs in a scratch copy of an imaginary or sample project, never in yours.' };
  }
  return null;
}

function intro(place: Place): ChatAnswer {
  const open = place.steps[0];
  if (open) return { text: `${open.label} is open beside this chat.` };
  return { text: 'Train Line: review Claude\'s cases, teach a new request, or read the scoreboard.' };
}

export const TRAIN_MODES: ScreenChatProvider<TrainModeData> = {
  screen: 'train',
  label: 'Train Line',
  href: '/train',
  params: ['section'],
  defaultMode: 'hood',
  options,
  answer,
  intro,
  labelOf: (_param, id) => TRAIN_SECTIONS.find((s) => s.id === id)?.name ?? id,
  anchor: (place) => TRAIN_SECTIONS.find((s) => s.id === place.steps[0]?.id)?.anchor ?? null,
};
