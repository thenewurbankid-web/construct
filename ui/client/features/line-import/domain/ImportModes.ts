// Two modes: the Import screen's options provider (lib/lineModes.ts). One level: the folder to bring into Line
// (?folder=). Reading the folder is the screen's own action (the same one its Read button runs). Pure.
import type { ChatAnswer, ChatOption, Place, ScreenChatProvider } from '@/lib/lineModes';

/** What the Import chat reads: the folders it may import (null while they are read), and where the import is. */
export type ImportModeData = { folders: string[] | null; folder: string; phase: string; summary: string | null; error: string | null };

const AGENT: ChatOption = { id: 'import.agent', label: 'Let the Import agent do it', sentence: 'The agent plans the whole import for you to review and approve, step by step.', effect: 'navigate' };
const EXPLAIN: ChatOption = { id: 'import.explain', label: 'Explain', sentence: 'What importing a folder does, and what it never touches.', effect: 'read' };

function options(place: Place, data: ImportModeData): ChatOption[] {
  const pick: ChatOption = { id: 'import.folder', label: 'Pick a folder', sentence: 'Choose the one folder of your app to bring into Line.', effect: 'read' };
  if (!place.steps.length) return [data.folders ? pick : { ...pick, disabled: 'Still reading the folders of this project.' }, AGENT, EXPLAIN];
  return [
    { id: 'import.scan', label: 'Read this folder', sentence: 'Line reads the folder and proposes what each file becomes.', effect: 'read' },
    { id: 'import.status', label: 'Where is it?', sentence: 'Say where this import is and what comes next.', effect: 'read' },
    AGENT,
    EXPLAIN,
  ];
}

const NEXT: Record<string, string> = {
  pick: 'Nothing has been read yet. Pick Read this folder.',
  scanning: 'Line is reading the folder.',
  scanned: 'Line has read the folder. Answer its questions, if any, then make the plan beside this chat.',
  planning: 'Line is writing the plan.',
  planned: 'The plan is ready beside this chat. Read its steps, then Apply.',
  applying: 'The plan is being applied.',
  applied: 'The import is done. You can undo it beside this chat.',
};

function answer(optionId: string, place: Place, data: ImportModeData): ChatAnswer | null {
  if (optionId === 'import.folder') {
    if (!data.folders?.length) return { text: 'Line found no folder it can import in this project.' };
    return { text: 'Which folder do you want to bring into Line?', pick: { label: 'Folders', items: data.folders.map((f) => ({ id: f, name: f, text: `Import ${f}; nothing outside it changes.` })) } };
  }
  if (optionId === 'import.agent') return { text: 'The Import agent plans the whole import; you review and approve each step.', link: { href: '/import/agent', label: 'Open the Import agent' } };
  if (optionId === 'import.status') {
    if (data.error) return { text: data.error.replace(/\.?$/, '.'), tone: 'refusal' };
    const summary = data.summary ? ` ${data.summary.replace(/\.?$/, '.')}` : '';
    return { text: `${NEXT[data.phase] ?? 'Line is working on it.'}${summary}` };
  }
  if (optionId === 'import.explain') return { text: 'Import brings one folder of an app that was not built with Line into Line, through plan steps. Only that folder is ever written.' };
  return null;
}

function intro(place: Place): ChatAnswer {
  const folder = place.steps[0];
  if (folder) return { text: `${folder.label} is open beside this chat. Read it to see what Line proposes.` };
  return { text: 'Import brings one folder of an existing app into Line. Pick the folder, or let the Import agent plan it.' };
}

export const IMPORT_MODES: ScreenChatProvider<ImportModeData> = {
  screen: 'import',
  label: 'Import',
  href: '/import',
  params: ['folder'],
  defaultMode: 'chat',
  options,
  answer,
  intro,
};
