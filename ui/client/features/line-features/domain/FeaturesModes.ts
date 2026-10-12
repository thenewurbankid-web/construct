// Two modes: the Features screen's options provider (lib/lineModes.ts). Levels: feature › item › part, kept in the URL
// as ?feature=, ?item= and ?part= ("Features › orders › OrdersPage › title"). The full-screen and feature options are
// cd1's own (ChatOptions.ts, answered by useFeatureChat); this adds opening an item and a part, so the chat (and its
// breadcrumb) can go one level deeper. Pure; tested by FeaturesModes.spec.mjs.
import type { ChatAnswer, ChatOption, LineProject, Place, ScreenChatProvider } from '../types';
import { LIST_OPTIONS, itemOptions } from './ChatOptions.ts';
import { listIntro } from './ListAnswers.ts';

/** What the Features chat reads: the project, and the settable values (parts) of the open item when it is a page. */
export type FeaturesModeData = { project: LineProject; parts: string[] };

const at = (place: Place, param: string) => place.steps.find((s) => s.param === param)?.id ?? null;
const KIND_WORD: Record<string, string> = { pages: 'page', components: 'component', workflows: 'workflow', fixtures: 'fixture' };

function itemOf(project: LineProject, feature: string | null, name: string | null) {
  return project.features.find((f) => f.name === feature)?.items.find((i) => i.name === name) ?? null;
}

const OPEN_ITEM: ChatOption = { id: 'feature.items', label: 'Open an item', sentence: 'Pick a page, component, workflow or fixture of this feature to open it.', effect: 'read' };

/** The options at a place. Feature level: cd1's (Fix enabled by the detail's findings) plus Open an item. Item level:
 * Open a part (a page's values) and Explain. Part level: Explain. "Back to ..." is added by the contract (optionsAt). */
export function featuresOptions(place: Place, data: FeaturesModeData | null, detail: Parameters<typeof itemOptions>[0] = null): ChatOption[] {
  const depth = place.steps.length;
  if (depth === 0) return LIST_OPTIONS;
  if (depth === 1) {
    const cd1 = itemOptions(detail);
    return [...cd1.slice(0, -1), OPEN_ITEM, ...cd1.slice(-1)];
  }
  if (depth === 2) {
    const item = data ? itemOf(data.project, at(place, 'feature'), at(place, 'item')) : null;
    const parts: ChatOption = { id: 'feature.parts', label: 'Open a part', sentence: 'Pick a value of this page, such as its title, to open it.', effect: 'read' };
    const whyNot = item?.kind === 'pages' ? (data?.parts.length ? null : 'This page has no values you can change without code.') : 'Only a page has parts you can open here.';
    return [whyNot ? { ...parts, disabled: whyNot } : parts, { id: 'feature.item-explain', label: 'Explain', sentence: 'What this item is and what it is based on.', effect: 'read' }];
  }
  return [{ id: 'feature.part-explain', label: 'Explain', sentence: 'What this part is and where you change it.', effect: 'read' }];
}

/** The answers this provider adds (cd1's own options are answered by useFeatureChat, so they answer null here). */
export function featuresAnswer(optionId: string, place: Place, data: FeaturesModeData): ChatAnswer | null {
  const feature = at(place, 'feature');
  const name = at(place, 'item');
  const item = itemOf(data.project, feature, name);
  if (optionId === 'feature.items') {
    const items = data.project.features.find((f) => f.name === feature)?.items ?? [];
    if (!items.length) return { text: `${feature} has nothing in it yet.` };
    return { text: `Which item of ${feature} do you want to open?`, opens: 'item', pick: { label: 'Items', items: items.map((i) => ({ id: i.name, name: i.name, text: `A ${KIND_WORD[i.kind] ?? i.kind}, ${i.status === 'ok' ? 'fine' : 'needs attention'}.`, status: { tone: i.status === 'ok' ? 'fit' : 'gap', label: i.status === 'ok' ? 'Fine' : 'Needs attention' } })) } };
  }
  if (optionId === 'feature.parts') {
    if (!data.parts.length) return { text: `${name} has no values you can change without code.` };
    return { text: `Which part of ${name} do you want to open?`, opens: 'part', pick: { label: 'Parts', items: data.parts.map((p) => ({ id: p, name: p, text: `The ${p} of ${name}.` })) } };
  }
  if (optionId === 'feature.item-explain' && item) {
    const base = item.base.value ? `It is based on ${item.base.value} from your library.` : 'It has no library base yet.';
    return { text: `${item.name} is a ${KIND_WORD[item.kind] ?? item.kind} of ${feature}. ${base}`, details: [item.file] };
  }
  if (optionId === 'feature.part-explain') {
    const part = at(place, 'part');
    return { text: `${part} is a value of ${name}. Change it on Pages, where every save is a plan step you approve.`, link: { href: `/pages?feature=${encodeURIComponent(feature ?? '')}&page=${encodeURIComponent(name ?? '')}`, label: `Open ${name} on Pages` } };
  }
  return null;
}

/** The first message at a place. */
export function featuresIntro(place: Place, data: FeaturesModeData): ChatAnswer {
  const [feature, item, part] = place.steps.map((s) => s.id);
  if (part) return { text: `${part} of ${item} is open beside this chat.` };
  if (item) return { text: `${item} is open beside this chat. Open one of its parts, or ask for an explanation.` };
  if (feature) return { text: `${feature} is open beside this chat. Ask what is missing, for an explanation, or add something from the library.` };
  const intro = listIntro(data.project);
  return { text: intro.text, pick: intro.pick };
}

/** The Features screen's provider (cd1's chat first: Features opens in chat mode until the person picks a mode). */
export const FEATURES_MODES: ScreenChatProvider<FeaturesModeData> = {
  screen: 'features',
  label: 'Features',
  href: '/',
  params: ['feature', 'item', 'part'],
  defaultMode: 'chat',
  options: (place, data) => featuresOptions(place, data),
  answer: featuresAnswer,
  intro: featuresIntro,
};
