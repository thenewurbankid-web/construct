'use client';

import type { ReactNode } from 'react';
import type { ChatAsk } from '@/lib/lineChat';
import type { LineMode, Place, ScreenChatProvider } from '@/lib/lineModes';
import type { StreamElements } from '@/lib/StreamedText';
import type { ScreenChatControl } from '../hooks/useScreenChat';
import { useScreenModes } from '../hooks/useScreenModes';
import { ScreenModesPage } from '../pages/ScreenModesPage';

/** The chat handle a screen's own answers use, with the mode the person is in. */
export type ScreenControl = ScreenChatControl & { mode: LineMode };

type ScreenModesProps<D> = {
  provider: ScreenChatProvider<D>;
  /** What the provider reads (null while the screen is still reading it). */
  data: D | null;
  /** The screen's regular view (Under the hood). It reads the place from the URL, so it opens where the chat is. */
  hood: ReactNode;
  /** Options the provider does not answer itself (a plan step, a navigation, a screen's own answer through `control`). */
  onOption?: (optionId: string, place: Place, control: ScreenControl) => void;
  /** A screen that also answers typed requests (a request box under the options) and one question at a time. */
  ask?: ChatAsk | null;
  input?: ChatAsk | null;
  onAnswer?: (askId: string, text: string, control: ScreenControl) => void;
  onCancelAsk?: () => void;
  /** An item picked from the screen's own answer. */
  onOwnPick?: (messageId: string, itemId: string, control: ScreenControl) => void;
  /** The screen's components for the Line elements its answers embed. */
  elements?: StreamElements;
  /** Under the chat (e.g. the Plan panel). */
  footer?: ReactNode;
  /** For a screen whose selection lives above its view (not read from the URL): called with the place at the start and
   * whenever the chat or a crumb moves it, so the screen selects it. */
  onPlace?: (place: Place) => void;
};

/** Two modes for one screen, driven by its provider (lib/lineModes.ts): Chat (breadcrumb, full-screen chat, a pick
 * opens the item with the chat beside it) and Under the hood (the screen with the chat as a helper). */
export function ScreenModesController<D>({ provider, data, hood, onOption, footer, onPlace, ask, input, onAnswer, onCancelAsk, onOwnPick, elements }: ScreenModesProps<D>) {
  const modes = useScreenModes(provider, data, onOption, onPlace, onOwnPick);
  const control = modes.chat ? { ...modes.chat.control, mode: modes.mode } : null;
  const answer = onAnswer && control ? (askId: string, text: string) => onAnswer(askId, text, control) : undefined;
  return <ScreenModesPage screen={provider.screen} title={provider.label} modes={modes} footer={footer} hood={hood} extras={{ ask, input, onAnswer: answer, onCancelAsk, elements }} />;
}
