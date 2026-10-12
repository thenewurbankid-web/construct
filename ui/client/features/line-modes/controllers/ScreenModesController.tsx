'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ChatEntry } from '@/lib/ChatEntry';
import { crumbTarget, effectiveMode, type Crumb, type Place, type ScreenChatProvider } from '@/lib/lineModes';
import { Breadcrumb } from '../components/Breadcrumb';
import '../components/line-modes.css';
import { useLineMode } from '../hooks/useLineMode';
import { useScreenChat } from '../hooks/useScreenChat';

type ScreenModesProps<D> = {
  provider: ScreenChatProvider<D>;
  /** What the provider reads (null while the screen is still reading it). */
  data: D | null;
  /** The screen's regular view (Under the hood). It reads the place from the URL, so it opens where the chat is. */
  hood: ReactNode;
  /** Options the provider does not answer itself (a plan step, a navigation). */
  onOption?: (optionId: string, place: Place) => void;
  /** Under the chat (e.g. the Plan panel). */
  footer?: ReactNode;
};

const CHAT_KEY = 'cockpit.mode.chatHidden';

function useChatHidden(): [boolean, () => void] {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(CHAT_KEY) === '1');
    } catch {
      // Storage blocked: the chat starts shown.
    }
  }, []);
  const toggle = () =>
    setHidden((h) => {
      try {
        window.localStorage.setItem(CHAT_KEY, h ? '0' : '1');
      } catch {
        // Storage blocked: the choice lasts until the tab closes.
      }
      return !h;
    });
  return [hidden, toggle];
}

/** Two modes for one screen. Chat: the breadcrumb, then a full-screen chat with the screen's options; once something is
 * open, its Under the hood view fills the screen and the chat is a side panel. Under the hood: the regular screen with
 * the same chat as a helper beside it, which the person can hide. A crumb switches to Under the hood at that place. */
export function ScreenModesController<D>({ provider, data, hood, onOption, footer }: ScreenModesProps<D>) {
  const { stored, setMode, setScreenDefault } = useLineMode();
  const mode = effectiveMode(stored, provider.defaultMode);
  const chat = useScreenChat(provider, data, onOption);
  const [hidden, toggleHidden] = useChatHidden();
  useEffect(() => {
    setScreenDefault(provider.defaultMode);
    return () => setScreenDefault(null);
  }, [provider.defaultMode, setScreenDefault]);

  const onCrumb = (crumb: Crumb) => {
    const target = crumbTarget(crumb);
    chat?.go(target.place);
    setMode(target.mode);
  };
  const view = <div key={chat?.navKey ?? 0} className="lm-hood-view" data-testid="lm-hood-view">{hood}</div>;
  if (!chat) return <>{hood}</>;
  const entry = (selected: string | null, children: ReactNode) => (
    <ChatEntry title={provider.label} testId="lm-chat-entry" selected={selected} options={chat.options} messages={chat.messages} onOption={chat.onOption} onPick={chat.onPick} footer={footer}>
      {children}
    </ChatEntry>
  );

  if (mode === 'chat') {
    const last = chat.place.steps.at(-1);
    return (
      <div className="lm" data-mode="chat" data-screen={provider.screen} data-testid="lm-screen">
        <Breadcrumb crumbs={chat.crumbs} onCrumb={onCrumb} />
        {entry(last ? last.id : null, last ? view : null)}
      </div>
    );
  }
  return (
    <div className="lm" data-mode="hood" data-screen={provider.screen} data-chat={hidden ? 'hidden' : 'shown'} data-testid="lm-screen">
      <button type="button" className="lm-chat-toggle" data-testid="lm-chat-toggle" data-line-control="shell.chatToggle" aria-expanded={!hidden} onClick={toggleHidden}>
        {hidden ? 'Show the chat' : 'Hide the chat'}
      </button>
      {entry('hood', view)}
    </div>
  );
}
