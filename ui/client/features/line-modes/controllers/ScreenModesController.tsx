'use client';

import type { ReactNode } from 'react';
import type { Place, ScreenChatProvider } from '@/lib/lineModes';
import { useScreenModes } from '../hooks/useScreenModes';
import { ScreenModesPage } from '../pages/ScreenModesPage';

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

/** Two modes for one screen, driven by its provider (lib/lineModes.ts): Chat (breadcrumb, full-screen chat, a pick
 * opens the item with the chat beside it) and Under the hood (the screen with the chat as a helper). */
export function ScreenModesController<D>({ provider, data, hood, onOption, footer, onPlace }: ScreenModesProps<D>) {
  const modes = useScreenModes(provider, data, onOption, onPlace);
  return <ScreenModesPage screen={provider.screen} title={provider.label} modes={modes} footer={footer} hood={hood} />;
}
