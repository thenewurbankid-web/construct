// cd1: part of the Features chat (static rules over the read routes' answers, no model). Tested by FeatureChat.spec.mjs.
import type { ChatAsk, ChatItem, ChatMessage, LibraryItem, LineProject } from '../types';

const SINGULAR: Record<string, string> = { components: 'component', pages: 'page', workflows: 'workflow', fixtures: 'fixture' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Add from the library": pick the library item to base it on. */
export function basePick(project: LineProject, feature: string, id: string): ChatMessage {
  const item = (l: LibraryItem): ChatItem => ({ id: l.id, name: l.name, text: `A ${SINGULAR[l.kind] ?? l.kind} from your library.` });
  if (!project.library.length) return { id, from: 'line', text: 'Your library is empty, so there is nothing to base a new item on yet.' };
  return { id, from: 'line', text: `Which library item should the new item in ${feature} be based on?`, pick: { label: 'Library items', items: project.library.map(item) } };
}

/** The name question for a new item based on `libraryId`, with a suggested name ("Orders" + "Button"). */
export function nameAsk(libraryId: string, feature: string): ChatAsk {
  const [kind, libName = ''] = libraryId.split('/');
  const pascal = kind === 'components' || kind === 'pages';
  const suggestion = pascal ? `${cap(feature)}${cap(libName)}` : `${feature}${cap(libName)}`;
  return { id: `name:${libraryId}`, label: `What should the new ${SINGULAR[kind] ?? 'item'} be called?`, suggestion, submit: 'Add to plan' };
}
