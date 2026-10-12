import type { ReactNode } from 'react';
import { ChatEntry } from '@/lib/ChatEntry';
import type { ChatEntryProps } from '@/lib/lineChat';
import type { Crumb, LineMode, ModeScreenId } from '@/lib/lineModes';
import { Breadcrumb } from './Breadcrumb';
import './line-modes.css';

/** The chat, as ChatEntry takes it, without where it sits (the frame decides `selected` and the page). */
export type FrameChat = Omit<ChatEntryProps, 'selected' | 'children'>;

type ModesFrameProps = {
  screen: ModeScreenId;
  mode: LineMode;
  crumbs: Crumb[];
  onCrumb: (crumb: Crumb) => void;
  chat: FrameChat;
  /** In chat mode: the id of what is open (null: the chat fills the screen and `view` is not shown). */
  open: string | null;
  /** The screen's regular view at the current place. */
  view: ReactNode;
  /** Under the hood: whether the chat helper is hidden, and the toggle. */
  hidden: boolean;
  onToggleHidden: () => void;
  /** Chat mode: the live stage beside the chat (what is active under the hood). */
  stage?: ReactNode;
};

/** Two modes around one screen. Chat: the breadcrumb, then a full-screen chat (lib/ChatEntry.tsx) with the screen's
 * options; once something is open, the screen's view fills the page and the chat is a side panel. Under the hood: the
 * screen's view with the same chat beside it as a helper the person can hide. */
export function ModesFrame({ screen, mode, crumbs, onCrumb, chat, open, view, hidden, onToggleHidden, stage = null }: ModesFrameProps) {
  if (mode === 'chat') {
    return (
      <div className="lm" data-mode="chat" data-screen={screen} data-testid="lm-screen">
        <Breadcrumb crumbs={crumbs} onCrumb={onCrumb} />
        {stage}
        <ChatEntry {...chat} selected={open}>
          {open === null ? null : view}
        </ChatEntry>
      </div>
    );
  }
  return (
    <div className="lm" data-mode="hood" data-screen={screen} data-chat={hidden ? 'hidden' : 'shown'} data-testid="lm-screen">
      <button type="button" className="lm-chat-toggle" data-testid="lm-chat-toggle" data-line-control="shell.chatToggle" aria-expanded={!hidden} onClick={onToggleHidden}>
        {hidden ? 'Show the chat' : 'Hide the chat'}
      </button>
      <ChatEntry {...chat} selected="hood">
        {view}
      </ChatEntry>
    </div>
  );
}
