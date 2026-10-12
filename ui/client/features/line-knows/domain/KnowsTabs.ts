// Pure (DOMAIN-001): the four tabs of "What Line knows", the chat's options for each (stable ids, lib/lineChat.ts) and
// the message that says where the person is.
import type { ChatMessage, ChatOption } from '@/lib/lineChat';
import type { KnowsTab, KnowsTabId } from '@/lib/lineKnowsContract';

export const KNOWS_TABS: KnowsTab[] = [
  { id: 'map', label: 'Map', sentence: 'See what Line knows about your project as a picture, starting from something you know.' },
  { id: 'memory', label: 'Memory', sentence: 'See and change what Line remembered from your past decisions.' },
  { id: 'change', label: 'Change', sentence: 'Turn what the Map shows into changes; each one waits for your approval.' },
  { id: 'smart', label: 'How smart is it', sentence: 'See how accurate Line is on your own project, and how to make it better.' },
];

const IDS = KNOWS_TABS.map((t) => t.id);

/** The tab a URL asks for (?tab=memory), else Map. */
export function tabFromQuery(value: string | null | undefined): KnowsTabId {
  return IDS.includes(value as KnowsTabId) ? (value as KnowsTabId) : 'map';
}

/** The chat's options: open any other tab (the current one is disabled, saying why). */
export function knowsOptions(current: KnowsTabId): ChatOption[] {
  return KNOWS_TABS.map((t) => ({
    id: `knows.${t.id}`,
    label: t.label,
    sentence: t.sentence,
    effect: 'read' as const,
    ...(t.id === current ? { disabled: 'You are on this tab already.' } : {}),
  }));
}

/** The tab an option id opens, or null. */
export function tabOfOption(optionId: string): KnowsTabId | null {
  const id = optionId.replace(/^knows\./, '');
  return IDS.includes(id as KnowsTabId) ? (id as KnowsTabId) : null;
}

/** The chat's opening message for a tab. */
export function knowsMessage(tab: KnowsTabId, mock: boolean): ChatMessage {
  const t = KNOWS_TABS.find((x) => x.id === tab) ?? KNOWS_TABS[0];
  return {
    id: `knows-${t.id}`,
    from: 'line',
    text: `${t.label}: ${t.sentence}${mock ? ' This is sample data (mock mode).' : ''}`,
    details: ['Everything here is read from this computer; nothing leaves it.'],
  };
}
