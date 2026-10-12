// cd1: the chat-entry contract, shared by every Line screen that opens as a chat (Features first; Pages and Components
// later). A screen opens as a full-screen chat with predefined options; picking an item opens its page and the chat
// moves to a side panel with that item's options. Plain English first; technical detail sits in a collapsed Details.
// The component that renders this contract is lib/ChatEntry.tsx; the style is lib/line-style.css (Trace's demo style).
import type { ReactNode } from 'react';
import type { StreamElements } from './StreamedText';

/** What an option does when picked. `read` answers from a read route (open, what is missing, explain); `plan` adds a
 * plan step the person approves (create, fix); `navigate` opens another screen (import). */
export type ChatEffect = 'read' | 'plan' | 'navigate';

/** One predefined option. `id` is stable (e.g. "features.missing", "feature.add"): tests, Trace mode and agents pick
 * options by id, never by label. `disabled` is the sentence that says why it cannot be picked now. */
export type ChatOption = { id: string; label: string; sentence: string; effect: ChatEffect; disabled?: string };

/** The status of an item, in Trace's vocabulary: fit (all fine), wait (needs an answer), gap (something is wrong). */
export type ChatTone = 'fit' | 'wait' | 'gap';

/** One pickable thing inside a message (a feature, a library item, a fix). `id` is stable. `control` (cg1/ct1): the
 * Trace control id the pick button carries as data-line-control (its target is the item's id). */
export type ChatItem = { id: string; name: string; text: string; status?: { tone: ChatTone; label: string }; control?: string };

/** A message. `text` is plain English (one or more sentences); `details` are the technical lines (rule, file:line,
 * tool call) shown only under a collapsed Details; `pick` is a list of items the person can pick from this message;
 * `link` is a plain link (another screen). `tone: 'refusal'` marks a sentence that says why something did not happen. */
export type ChatMessage = {
  id: string;
  from: 'line' | 'you';
  text: string;
  details?: string[];
  pick?: { label: string; items: ChatItem[] };
  link?: { href: string; label: string };
  tone?: 'plain' | 'refusal';
};

/** A question waiting for a typed answer (e.g. the name of a new component), shown in place of the options. */
export type ChatAsk = { id: string; label: string; suggestion: string; submit: string };

/** Props of ChatEntry (lib/ChatEntry.tsx). `selected` null: the chat fills the screen. `selected` set: `children` (the
 * item's page) fills the screen and the chat is a side panel beside it, with `options` for that item. */
export type ChatEntryProps = {
  title: string;
  options: ChatOption[];
  messages: ChatMessage[];
  selected: string | null;
  onOption: (optionId: string) => void;
  /** An item was picked from message `messageId`. */
  onPick: (messageId: string, itemId: string) => void;
  ask?: ChatAsk | null;
  onAnswer?: (askId: string, text: string) => void;
  onCancelAsk?: () => void;
  busy?: boolean;
  /** Under the chat in the side panel (the Plan panel). */
  footer?: ReactNode;
  children?: ReactNode;
  testId?: string;
  /** A free request box under the options (a screen's chat helper), cleared once sent; answered through onAnswer. */
  input?: ChatAsk | null;
  /** Overrides the layout `selected` implies: 'panel' is a compact chat in a side panel (no page beside it). */
  layout?: 'full' | 'side' | 'panel';
  /** The screen's components for the whitelisted Line elements an answer may embed (lib/streamedTextTags.ts). */
  elements?: StreamElements;
};

const OPTION_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const SENTENCE = /^[A-Za-z0-9"][\s\S]*[.?!]$/;

/** The contract's checks for a set of options: stable dotted ids ("features.open"), unique, a label, a full sentence,
 * a known effect, and a disabled reason that is itself a sentence. Answers the problems in plain English (none: []). */
export function chatOptionProblems(options: ChatOption[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const o of options) {
    if (!OPTION_ID.test(o.id)) out.push(`Option id "${o.id}" is not a stable dotted id such as "features.open".`);
    if (seen.has(o.id)) out.push(`Option id "${o.id}" is used twice.`);
    seen.add(o.id);
    if (!o.label.trim()) out.push(`Option "${o.id}" has no label.`);
    if (!SENTENCE.test(o.sentence)) out.push(`Option "${o.id}" does not explain itself in a full sentence.`);
    if (!['read', 'plan', 'navigate'].includes(o.effect)) out.push(`Option "${o.id}" has an unknown effect "${o.effect}".`);
    if (o.disabled !== undefined && !SENTENCE.test(o.disabled)) out.push(`Option "${o.id}" is disabled without a full sentence saying why.`);
  }
  return out;
}

/** The contract's checks for a message: an id, plain-English text that is a full sentence, items with ids. */
export function chatMessageProblems(m: ChatMessage): string[] {
  const out: string[] = [];
  if (!m.id) out.push('A message has no id.');
  if (m.from === 'line' && !SENTENCE.test(m.text)) out.push(`Message "${m.id}" is not a full sentence: "${m.text}".`);
  const ids = new Set<string>();
  for (const it of m.pick?.items ?? []) {
    if (!it.id) out.push(`An item in message "${m.id}" has no id.`);
    if (ids.has(it.id)) out.push(`Item id "${it.id}" is used twice in message "${m.id}".`);
    ids.add(it.id);
  }
  return out;
}
