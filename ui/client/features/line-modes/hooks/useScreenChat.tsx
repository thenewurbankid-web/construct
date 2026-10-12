'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, ChatOption } from '@/lib/lineChat';
import { PLACE_EVENT } from '@/lib/urlPlace';
import { chatAppend, chatOption, chatPick, chatStart, crumbsOf, hrefOf, optionsAt, placeFromSearch, type ChatAnswer, type ChatState, type Crumb, type Place, type ScreenChatProvider } from '@/lib/lineModes';

/** The URL of a place on the page the person is on (a screen can answer on more than one route, e.g. / and /plan). */
function urlOf<D>(provider: ScreenChatProvider<D>, place: Place): string {
  const search = hrefOf(provider, place).split('?')[1];
  return `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
}

/** What a screen may do in its chat when it answers itself (an option the provider leaves to it, a typed request, a
 * picked item of its own answer): add its answer to the conversation, or move the chat to a place. */
export type ScreenChatControl = { reply: (answer: ChatAnswer, you: string | null) => void; go: (place: Place) => void; place: Place };

export type ScreenChatView = {
  place: Place;
  crumbs: Crumb[];
  options: ChatOption[];
  messages: ChatMessage[];
  /** Bumped whenever the chat (or a crumb) moves the place: the Under the hood view remounts and reads the URL. */
  navKey: number;
  onOption: (optionId: string) => void;
  onPick: (messageId: string, itemId: string) => void;
  /** Move to a place (a crumb): the URL and the chat follow. */
  go: (place: Place) => void;
  /** The screen's handle on this chat (see ScreenChatControl). */
  control: ScreenChatControl;
};

/** The chat of one screen, driven by its provider (lib/lineModes.ts chatOption / chatPick). The place lives in the URL
 * (history.replaceState, like useUrlSelection), so both modes and a reload agree on where the person is. Options the
 * provider does not answer go to `onUnanswered` (the screen runs them: a plan step, a navigation). */
export function useScreenChat<D>(provider: ScreenChatProvider<D>, data: D | null, onUnanswered?: (optionId: string, place: Place, control: ScreenChatControl) => void, onPlace?: (place: Place) => void, onOwnPick?: (messageId: string, itemId: string, control: ScreenChatControl) => void): ScreenChatView | null {
  const [state, setState] = useState<ChatState | null>(null);
  const [navKey, setNavKey] = useState(0);
  const providerRef = useRef(provider);
  providerRef.current = provider;
  // A screen whose state lives above its view (not in the URL) follows the place here: at the start and on every move.
  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;

  useEffect(() => {
    if (data === null || state) return;
    const start = chatStart(provider, placeFromSearch(provider, window.location.search, data), data);
    setState(start);
    onPlaceRef.current?.(start.place);
  }, [provider, data, state]);

  // A pick Under the hood (or in the view beside the chat) writes the URL: the chat and its breadcrumb follow it there.
  // The view is already at that place, so it is not remounted and the screen is not told again.
  const latest = useRef({ state, data });
  latest.current = { state, data };
  useEffect(() => {
    const follow = () => {
      const { state: now, data: d } = latest.current;
      if (!now || d === null) return;
      const here = placeFromSearch(providerRef.current, window.location.search, d);
      if (hrefOf(providerRef.current, here) === hrefOf(providerRef.current, now.place)) return;
      setState(chatStart(providerRef.current, here, d));
    };
    window.addEventListener(PLACE_EVENT, follow);
    return () => window.removeEventListener(PLACE_EVENT, follow);
  }, []);

  const moved = useCallback((next: ChatState, before: ChatState) => {
    if (hrefOf(providerRef.current, next.place) === hrefOf(providerRef.current, before.place)) return;
    window.history.replaceState(null, '', urlOf(providerRef.current, next.place));
    setNavKey((k) => k + 1);
    onPlaceRef.current?.(next.place);
  }, []);

  const go = useCallback(
    (place: Place) => {
      if (!state || data === null) return;
      const next = chatStart(provider, place, data);
      moved(next, state);
      setState(next);
    },
    [state, data, provider, moved],
  );

  const reply = useCallback((answer: ChatAnswer, you: string | null) => setState((s) => (s ? chatAppend(s, answer, you) : s)), []);
  const control = useMemo<ScreenChatControl>(() => ({ reply, go, place: state?.place ?? { screen: provider.screen, steps: [] } }), [reply, go, state?.place, provider.screen]);

  const onOption = useCallback(
    (optionId: string) => {
      if (!state || data === null) return;
      const next = chatOption(state, provider, data, optionId);
      if (next === state) return onUnanswered?.(optionId, state.place, control);
      moved(next, state);
      setState(next);
    },
    [state, data, provider, onUnanswered, moved, control],
  );

  const onPick = useCallback(
    (messageId: string, itemId: string) => {
      if (!state || data === null) return;
      // An item of the screen's own answer (chatAppend) opens no level: the screen handles it.
      if (!state.opens[messageId]) return onOwnPick?.(messageId, itemId, control);
      const next = chatPick(state, provider, data, messageId, itemId);
      moved(next, state);
      setState(next);
    },
    [state, data, provider, moved, onOwnPick, control],
  );

  return useMemo(() => {
    if (!state || data === null) return null;
    return { place: state.place, crumbs: crumbsOf(provider, state.place), options: optionsAt(provider, state.place, data), messages: state.log, navKey, onOption, onPick, go, control };
  }, [state, data, provider, navKey, onOption, onPick, go, control]);
}
