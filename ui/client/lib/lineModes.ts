// Two modes (owner, 2026-10-12): every Cockpit screen has a Chat mode (a full-screen chat in cd1's style offering the
// screen's own options; picking an item opens it with the chat as a side panel) and an Under the hood mode (the regular
// screen with the chat as a collapsible helper). One global switch in the shell, remembered per user.
//
// This is the contract every screen follows. Pure: no React, no DOM, no storage. Each screen supplies a small options
// provider (ScreenChatProvider) in its own feature folder; the shared frame (features/line-modes) renders it with
// lib/ChatEntry.tsx and drives it with chatOption / chatPick below. Options follow lineChat's option contract (stable
// dotted ids, a label, a full sentence, a known effect).
//
// Where the person is, is a Place: the screen plus one URL query parameter per level (e.g. Features: feature, item,
// part). The URL is the one place both modes read, so a breadcrumb crumb is a Place, and clicking it means "Under the
// hood, at exactly this URL": the screen's own Under the hood view reads the same parameters and selects the item.
import { chatMessageProblems, chatOptionProblems, type ChatItem, type ChatMessage, type ChatOption } from './lineChat.ts';
import type { StagePart } from './liveStage.ts';

/** lineChat's shapes, so a provider needs one import. */
export type { ChatItem, ChatMessage, ChatOption };

/** The two modes: chat (full-screen chat first) and hood (the regular screen, chat as a collapsible helper). */
export type LineMode = 'chat' | 'hood';

/** The screens that have both modes. `mock` is the contract's own test screen (lib/lineModesMock.ts). */
export type ModeScreenId = 'open' | 'features' | 'components' | 'pages' | 'workflows' | 'import' | 'import-agent' | 'plan' | 'settings' | 'train' | 'mock';

/** One level of a place: the URL parameter, the selected id and the words the breadcrumb shows. */
export type PlaceStep = { param: string; id: string; label: string };

/** Where the person is: a screen and its selection path, outermost first. */
export type Place = { screen: ModeScreenId; steps: PlaceStep[] };

/** One breadcrumb crumb. `href` is the Under the hood URL of exactly that place; the last crumb is `current`. */
export type Crumb = { id: string; label: string; href: string; place: Place; current: boolean };

/** What a provider answers to an option: a Line message without its id (the frame numbers it). A `pick` opens the next
 * level of the place by default; `opens` names another level's parameter (one of the provider's `params`). */
export type ChatAnswer = Omit<ChatMessage, 'id' | 'from'> & { opens?: string };

/**
 * A screen's chat, as the shared frame needs it. `D` is whatever the screen already reads (a Line project, a plan, a
 * fixed list); the provider is pure over it.
 * - `params`: the URL parameters of the screen's levels, outermost first (Features: feature, item, part).
 * - `options(place, data)`: the options offered at this place (lineChat's contract; ids start with the screen id).
 * - `answer(optionId, place, data)`: a read answer (text, items to pick, a link), or null for an option the screen's
 *   own handler runs (a plan step, a navigation).
 * - `intro(place, data)`: the first message at this place.
 * - `label(param, id, data)`: the words for a selected id (the breadcrumb and the chat say it); default: the id.
 * - `defaultMode`: the screen's mode until the person picks one with the switch.
 */
export type ScreenChatProvider<D> = {
  screen: ModeScreenId;
  label: string;
  href: string;
  params: readonly string[];
  defaultMode: LineMode;
  options: (place: Place, data: D) => ChatOption[];
  answer: (optionId: string, place: Place, data: D) => ChatAnswer | null;
  intro: (place: Place, data: D) => ChatAnswer;
  labelOf?: (param: string, id: string, data: D) => string;
  /** For a screen that shows every level on one page (Settings' sections, Train's panels): the DOM id of the element
   * Under the hood that shows the place, which the frame scrolls into view and marks as open. */
  anchor?: (place: Place) => string | null;
  /** Live stage (chat mode): what the screen knows about each level of the place (kind, status, base, findings). A
   * level it does not describe still shows, as "Open". */
  stageParts?: (place: Place, data: D) => StagePart[];
};

/** The chat's state at one moment: the place, the conversation, and which level each pick message opens. */
export type ChatState = { place: Place; log: ChatMessage[]; opens: Record<string, string>; n: number };

const MODES: readonly LineMode[] = ['chat', 'hood'];

/** A stored mode, or null when the person has not picked one (then the screen's default applies). */
export function parseMode(value: unknown): LineMode | null {
  return MODES.includes(value as LineMode) ? (value as LineMode) : null;
}

/** The storage key of a person's mode: one per signed-in login; a local Cockpit with no sign-in has one person. */
export function modeKey(login: string | null | undefined): string {
  return login ? `cockpit.mode.${login}` : 'cockpit.mode';
}

/** The mode a screen shows: the person's choice, else the screen's default. */
export function effectiveMode(stored: LineMode | null, screenDefault: LineMode): LineMode {
  return stored ?? screenDefault;
}

/** The URL of a place: the screen's href with one query parameter per level, in level order. */
export function hrefOf<D>(provider: ScreenChatProvider<D>, place: Place): string {
  const q = new URLSearchParams();
  for (const s of place.steps) q.set(s.param, s.id);
  const search = q.toString();
  return search ? `${provider.href}?${search}` : provider.href;
}

const labelFor = <D>(provider: ScreenChatProvider<D>, param: string, id: string, data: D) => provider.labelOf?.(param, id, data) ?? id;

/** The place a URL query describes: the provider's levels in order, stopping at the first one that is not set. */
export function placeFromSearch<D>(provider: ScreenChatProvider<D>, search: string, data: D): Place {
  const q = new URLSearchParams(search);
  const steps: PlaceStep[] = [];
  for (const param of provider.params) {
    const id = q.get(param);
    if (!id) break;
    steps.push({ param, id, label: labelFor(provider, param, id, data) });
  }
  return { screen: provider.screen, steps };
}

/** The breadcrumb of a place: the screen, then each level ("Features › orders › OrdersPage › title"). */
export function crumbsOf<D>(provider: ScreenChatProvider<D>, place: Place): Crumb[] {
  const at = (depth: number): Place => ({ screen: place.screen, steps: place.steps.slice(0, depth) });
  const root: Crumb = { id: provider.screen, label: provider.label, href: hrefOf(provider, at(0)), place: at(0), current: place.steps.length === 0 };
  const levels = place.steps.map((s, i) => ({ id: `${s.param}:${s.id}`, label: s.label, href: hrefOf(provider, at(i + 1)), place: at(i + 1), current: i === place.steps.length - 1 }));
  return [root, ...levels];
}

/** Clicking a crumb: Under the hood, at exactly that place (same screen, that item selected). */
export function crumbTarget(crumb: Crumb): { mode: LineMode; href: string; place: Place } {
  return { mode: 'hood', href: crumb.href, place: crumb.place };
}

/** The generic option every screen gets once something is open: one level up. Its id is "<screen>.up". */
export function upOption<D>(provider: ScreenChatProvider<D>, place: Place): ChatOption | null {
  if (!place.steps.length) return null;
  const parent = place.steps.length > 1 ? place.steps[place.steps.length - 2].label : provider.label;
  return { id: `${provider.screen}.up`, label: `Back to ${parent}`, sentence: `Close ${place.steps[place.steps.length - 1].label} and go back to ${parent}.`, effect: 'read' };
}

/** The options at a place: the provider's, then "Back to ..." when something is open. */
export function optionsAt<D>(provider: ScreenChatProvider<D>, place: Place, data: D): ChatOption[] {
  const up = upOption(provider, place);
  return up ? [...provider.options(place, data), up] : provider.options(place, data);
}

/** A fresh chat at a place: only the provider's intro. */
export function chatStart<D>(provider: ScreenChatProvider<D>, place: Place, data: D): ChatState {
  const state: ChatState = { place, log: [], opens: {}, n: 0 };
  return say(state, provider, provider.intro(place, data), null);
}

function nextLevel<D>(provider: ScreenChatProvider<D>, place: Place): string | null {
  return provider.params[place.steps.length] ?? null;
}

function say<D>(state: ChatState, provider: ScreenChatProvider<D>, answer: ChatAnswer, you: string | null): ChatState {
  const n = state.n + 1;
  const id = `${state.place.steps.length}.${n}`;
  const { opens, ...rest } = answer;
  const level = rest.pick ? (opens ?? nextLevel(provider, state.place)) : null;
  const mine: ChatMessage[] = you ? [{ id: `you.${n}`, from: 'you', text: you }] : [];
  return { ...state, n, log: [...state.log, ...mine, { ...rest, id, from: 'line' }], opens: level ? { ...state.opens, [id]: level } : state.opens };
}

/** The person picked an option. "<screen>.up" goes one level up; a read answer is added to the conversation. An
 * option the provider does not answer (a plan step, a navigation) leaves the state as it is: the screen runs it. */
export function chatOption<D>(state: ChatState, provider: ScreenChatProvider<D>, data: D, optionId: string): ChatState {
  if (optionId === `${provider.screen}.up`) return chatStart(provider, { ...state.place, steps: state.place.steps.slice(0, -1) }, data);
  const answer = provider.answer(optionId, state.place, data);
  if (!answer) return state;
  const label = optionsAt(provider, state.place, data).find((o) => o.id === optionId)?.label ?? optionId;
  return say(state, provider, answer, label);
}

/** The person picked an item from a message: the place gains that level (replacing it and anything deeper when the
 * message opens an outer level) and the chat starts again there. A message that opens nothing changes nothing. */
export function chatPick<D>(state: ChatState, provider: ScreenChatProvider<D>, data: D, messageId: string, itemId: string): ChatState {
  const param = state.opens[messageId];
  if (!param) return state;
  const depth = provider.params.indexOf(param);
  if (depth < 0 || depth > state.place.steps.length) return state;
  const steps = [...state.place.steps.slice(0, depth), { param, id: itemId, label: labelFor(provider, param, itemId, data) }];
  return chatStart(provider, { ...state.place, steps }, data);
}

/** The contract's checks for a provider at one place, in plain English (none: []): its options pass lineChat's checks
 * and start with the screen id, its params are unique, and its intro and answers are well-formed messages. */
export function providerProblems<D>(provider: ScreenChatProvider<D>, place: Place, data: D): string[] {
  const out = [...chatOptionProblems(optionsAt(provider, place, data))];
  // The first segment names the screen; cd1's singular ("feature.add" on Features) counts as the screen's own.
  const own = (id: string) => { const first = id.split('.')[0]; return provider.screen.startsWith(first) && first.length >= provider.screen.length - 1; };
  for (const o of provider.options(place, data)) if (!own(o.id)) out.push(`Option "${o.id}" does not start with its screen "${provider.screen}".`);
  if (new Set(provider.params).size !== provider.params.length) out.push(`Screen "${provider.screen}" repeats a level parameter.`);
  const check = (a: ChatAnswer | null, id: string) => (a ? chatMessageProblems({ ...a, id, from: 'line' }) : []);
  out.push(...check(provider.intro(place, data), 'intro'));
  for (const o of provider.options(place, data)) out.push(...check(provider.answer(o.id, place, data), o.id));
  return out;
}

/** Items for a pick message from plain names (most providers list names). */
export function namedItems(names: readonly string[], text: (name: string) => string, control?: string): ChatItem[] {
  return names.map((name) => ({ id: name, name, text: text(name), control }));
}
