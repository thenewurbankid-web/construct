import type { ReactNode } from 'react';
import type { ChatMessage, ChatOption } from '@/lib/lineChat';
import type { Crumb } from '@/lib/lineModes';
import { LiveStageController } from '../controllers/LiveStageController';
import { ModesFrameController } from '../controllers/ModesFrameController';
import type { ScreenModesView } from '../types';

type ScreenModesPageProps = { screen: Parameters<typeof ModesFrameController>[0]['screen']; title: string; modes: ScreenModesView; footer?: ReactNode; hood: ReactNode };

const NO_OPTIONS: ChatOption[] = [];
const NO_MESSAGES: ChatMessage[] = [];
const NO_CRUMBS: Crumb[] = [];
const NOTHING = () => {};

/** One screen in its two modes. The frame is there from the first paint (the chat is busy and empty until the screen's
 * data is read), so the screen's view is never remounted when the chat becomes ready; it remounts only when the chat
 * or a crumb moves the place, so it reads the URL and opens exactly there. */
export function ScreenModesPage({ screen, title, modes, footer, hood }: ScreenModesPageProps) {
  const { chat } = modes;
  const navKey = chat?.navKey ?? 0;
  return (
    <ModesFrameController
      screen={screen}
      mode={modes.mode}
      crumbs={chat?.crumbs ?? NO_CRUMBS}
      onCrumb={modes.onCrumb}
      chat={{ title, testId: 'lm-chat-entry', options: chat?.options ?? NO_OPTIONS, messages: chat?.messages ?? NO_MESSAGES, onOption: chat?.onOption ?? NOTHING, onPick: chat?.onPick ?? NOTHING, footer, busy: !chat }}
      open={modes.open}
      stage={<LiveStageController blocks={modes.blocks} revision={navKey} />}
      view={
        <div key={navKey} className="lm-hood-view" data-testid="lm-hood-view">
          {hood}
        </div>
      }
    />
  );
}
