// "What Line knows", the shell's view shapes. The wire shapes and the tabs' view models are the one mirror in
// lib/lineKnowsContract.ts; each tab is its own feature (line-knows-map, -memory, -change, -smart).
import type { ChatMessage, ChatOption } from '@/lib/lineChat';
import type { KnowsHttp, KnowsTab, KnowsTabId } from '@/lib/lineKnowsContract';

export type * from '@/lib/lineKnowsContract';

/** Everything the shell shows and does. `http` is null while mock mode's code loads. */
export type KnowsScreen = {
  tabs: KnowsTab[];
  tab: KnowsTabId;
  focus: string | null;
  http: KnowsHttp | null;
  mock: boolean;
  options: ChatOption[];
  messages: ChatMessage[];
  setTab: (tab: KnowsTabId) => void;
  onOption: (optionId: string) => void;
  onFocus: (nodeId: string | null) => void;
  goTo: (tab: KnowsTabId, focus?: string | null) => void;
};
