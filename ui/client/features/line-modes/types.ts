// Two modes: the shapes the line-modes feature passes between its hooks and pages. The contract is lib/lineModes.ts.
import type { Crumb, LineMode } from '@/lib/lineModes';
import type { ScreenChatView } from './hooks/useScreenChat';

export type { ScreenChatView };

/** A screen's two modes as its page renders them: the mode, the chat (null until its data is read), what is open, and
 * what a crumb does. */
export type ScreenModesView = { mode: LineMode; chat: ScreenChatView | null; open: string | null; onCrumb: (crumb: Crumb) => void };
