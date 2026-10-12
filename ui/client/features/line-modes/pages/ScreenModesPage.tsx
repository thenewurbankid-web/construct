import type { ReactNode } from 'react';
import { LiveStageController } from '../controllers/LiveStageController';
import { ModesFrameController } from '../controllers/ModesFrameController';
import type { ScreenModesView } from '../types';

type ScreenModesPageProps = { screen: Parameters<typeof ModesFrameController>[0]['screen']; title: string; modes: ScreenModesView; footer?: ReactNode; hood: ReactNode };

/** One screen in its two modes. Until its chat is ready (its data still being read) the screen shows as it is. The
 * view remounts whenever the chat or a crumb moves the place, so it reads the URL and opens exactly there. */
export function ScreenModesPage({ screen, title, modes, footer, hood }: ScreenModesPageProps) {
  const { chat } = modes;
  if (!chat) return <>{hood}</>;
  return (
    <ModesFrameController
      screen={screen}
      mode={modes.mode}
      crumbs={chat.crumbs}
      onCrumb={modes.onCrumb}
      chat={{ title, testId: 'lm-chat-entry', options: chat.options, messages: chat.messages, onOption: chat.onOption, onPick: chat.onPick, footer }}
      open={modes.open}
      stage={<LiveStageController blocks={modes.blocks} revision={chat.navKey} />}
      view={
        <div key={chat.navKey} className="lm-hood-view" data-testid="lm-hood-view">
          {hood}
        </div>
      }
    />
  );
}
