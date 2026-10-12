// Two modes: the contract's own mock screen. A tiny Features-like world (features → items → parts) with a provider that
// follows lib/lineModes.ts, so the frame and the crumb → Under the hood switch are tested without a server. Every real
// screen's provider follows the same shape, in its own feature folder.
import type { ChatAnswer, Place, ScreenChatProvider } from './lineModes.ts';
import { namedItems } from './lineModes.ts';

/** feature → item → parts. */
export type MockWorld = Record<string, Record<string, string[]>>;

export const MOCK_WORLD: MockWorld = {
  billing: { InvoicesPage: ['title', 'table'], InvoiceCard: [] },
  orders: { OrdersPage: ['title', 'list'], OrderButton: ['label'] },
};

const at = (place: Place, param: string) => place.steps.find((s) => s.param === param)?.id ?? null;

function pickAnswer(place: Place, world: MockWorld): ChatAnswer {
  const feature = at(place, 'feature');
  const item = at(place, 'item');
  if (!feature) return { text: 'Which feature do you want to open?', pick: { label: 'Features', items: namedItems(Object.keys(world), (n) => `Open ${n}.`) } };
  if (!item) return { text: `Which item of ${feature} do you want to open?`, pick: { label: 'Items', items: namedItems(Object.keys(world[feature] ?? {}), (n) => `Open ${n}.`) } };
  return { text: `Which part of ${item} do you want to open?`, pick: { label: 'Parts', items: namedItems(world[feature]?.[item] ?? [], (n) => `Open the ${n} part.`) } };
}

/** The mock screen's provider: one "Open ..." option per level, and Explain. */
export const MOCK_PROVIDER: ScreenChatProvider<MockWorld> = {
  screen: 'mock',
  label: 'Features',
  href: '/mock',
  params: ['feature', 'item', 'part'],
  defaultMode: 'chat',
  options: (place) => {
    const open = [
      { id: 'mock.open', label: 'Open a feature', sentence: 'Pick a feature to open it.', effect: 'read' as const },
      { id: 'mock.open', label: 'Open an item', sentence: 'Pick an item of this feature to open it.', effect: 'read' as const },
      { id: 'mock.open', label: 'Open a part', sentence: 'Pick a part of this item to open it.', effect: 'read' as const },
    ][place.steps.length];
    const explain = { id: 'mock.explain', label: 'Explain', sentence: 'Say what is open here.', effect: 'read' as const };
    return open ? [open, explain] : [explain];
  },
  answer: (optionId, place, world) => {
    if (optionId === 'mock.open') return pickAnswer(place, world);
    if (optionId === 'mock.explain') return { text: place.steps.length ? `${place.steps.map((s) => s.label).join(', ')} is open.` : 'Nothing is open yet.' };
    return null;
  },
  intro: (place) => ({ text: place.steps.length ? `${place.steps[place.steps.length - 1].label} is open.` : 'What do you want to do?' }),
};
