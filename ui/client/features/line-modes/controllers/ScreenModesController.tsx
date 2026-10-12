'use client';

import { useEffect, type ReactNode } from 'react';
import { crumbTarget, effectiveMode, type Crumb, type Place, type ScreenChatProvider } from '@/lib/lineModes';
import { ModesFrame } from '../components/ModesFrame';
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
  /** For a screen whose selection lives above its view (not read from the URL): called with the place at the start and
   * whenever the chat or a crumb moves it, so the screen selects it. */
  onPlace?: (place: Place) => void;
};

/** Tells the shell's switch which mode this screen shows until the person picks one. */
export function useScreenDefault(mode: 'chat' | 'hood') {
  const { setScreenDefault } = useLineMode();
  useEffect(() => {
    setScreenDefault(mode);
    return () => setScreenDefault(null);
  }, [mode, setScreenDefault]);
}

/** Two modes for one screen, driven by its provider (lib/lineModes.ts). The place lives in the URL; when the chat (or a
 * crumb) moves it, the screen's view remounts and reads the URL, so Under the hood opens exactly there. */
export function ScreenModesController<D>({ provider, data, hood, onOption, footer, onPlace }: ScreenModesProps<D>) {
  const { stored, setMode } = useLineMode();
  useScreenDefault(provider.defaultMode);
  const mode = effectiveMode(stored, provider.defaultMode);
  const chat = useScreenChat(provider, data, onOption, onPlace);
  if (!chat) return <>{hood}</>;
  const onCrumb = (crumb: Crumb) => {
    const target = crumbTarget(crumb);
    chat.go(target.place);
    setMode(target.mode);
  };
  const last = chat.place.steps.at(-1);
  return (
    <ModesFrame
      screen={provider.screen}
      mode={mode}
      crumbs={chat.crumbs}
      onCrumb={onCrumb}
      chat={{ title: provider.label, testId: 'lm-chat-entry', options: chat.options, messages: chat.messages, onOption: chat.onOption, onPick: chat.onPick, footer }}
      open={last ? last.id : null}
      view={
        <div key={chat.navKey} className="lm-hood-view" data-testid="lm-hood-view">
          {hood}
        </div>
      }
    />
  );
}
