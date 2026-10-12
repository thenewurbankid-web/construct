// Two modes: the Settings screen's options provider (lib/lineModes.ts). One level: the section (?section=), which Under
// the hood scrolls into view and marks as open. Pure.
import type { ChatAnswer, ChatOption, Place, ScreenChatProvider } from '@/lib/lineModes';

export const SETTINGS_SECTIONS: readonly { id: string; name: string; text: string }[] = [
  { id: 'project', name: 'Project and models', text: 'The project folder and the AI provider and model for each kind of work.' },
  { id: 'git', name: 'Saving to git', text: 'Whether Cockpit commits each save for you.' },
  { id: 'remote', name: 'Remote', text: 'The remote repository this project pushes to.' },
  { id: 'github', name: 'GitHub', text: 'The GitHub account Cockpit uses.' },
  { id: 'ai', name: 'AI steps', text: 'Which steps may use AI and which stay static.' },
];

/** Settings reads nothing extra for its chat: the sections are fixed. */
export type SettingsModeData = { sections: typeof SETTINGS_SECTIONS };
export const SETTINGS_MODE_DATA: SettingsModeData = { sections: SETTINGS_SECTIONS };

const EXPLAIN: ChatOption = { id: 'settings.explain', label: 'Explain', sentence: 'What these settings change.', effect: 'read' };

function options(place: Place): ChatOption[] {
  if (place.steps.length) return [EXPLAIN];
  return [{ id: 'settings.open', label: 'Open a section', sentence: 'Pick a group of settings to change it.', effect: 'read' }, EXPLAIN];
}

function answer(optionId: string, place: Place, data: SettingsModeData): ChatAnswer | null {
  if (optionId === 'settings.open') return { text: 'Which settings do you want to change?', pick: { label: 'Sections', items: data.sections.map((s) => ({ ...s })) } };
  if (optionId === 'settings.explain') {
    const open = data.sections.find((s) => s.id === place.steps[0]?.id);
    if (open) return { text: `${open.name}: ${open.text}` };
    return { text: 'Settings apply to every command run from Cockpit. Nothing here changes your project files.' };
  }
  return null;
}

function intro(place: Place): ChatAnswer {
  const open = place.steps[0];
  if (open) return { text: `${open.label} is open beside this chat.` };
  return { text: 'Which settings do you want to change? Open a section, or ask for an explanation.' };
}

export const SETTINGS_MODES: ScreenChatProvider<SettingsModeData> = {
  screen: 'settings',
  label: 'Settings',
  href: '/settings',
  params: ['section'],
  defaultMode: 'chat',
  options,
  answer,
  intro,
  labelOf: (_param, id) => SETTINGS_SECTIONS.find((s) => s.id === id)?.name ?? id,
  anchor: (place) => (place.steps[0] ? `settings-${place.steps[0].id}` : null),
};
