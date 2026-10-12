'use client';

import { useEffect } from 'react';
import { effectiveMode, type Crumb, type LineMode, type Place, type ScreenChatProvider } from '@/lib/lineModes';
import { crumbToHood } from '../workflows/CrumbToHood';
import { stageBlocks, stepsFromRows, type StageBlock } from '@/lib/liveStage';
import { useLineMode } from './useLineMode';
import { useScreenChat, type ScreenChatControl } from './useScreenChat';
import { useScreenDefault } from './useScreenDefault';
import type { ScreenModesView } from '../types';

const NO_BLOCKS: StageBlock[] = [];

/** The live stage's blocks: the place's levels as the screen describes them, and the Plan's steps when the screen's data
 * carries the Plan panel's rows (a screen with the Plan's options joined). */
function screenBlocks<D>(provider: ScreenChatProvider<D>, place: Place, data: D): StageBlock[] {
  const rows = (data as { plan?: unknown }).plan;
  const steps = Array.isArray(rows) ? stepsFromRows(rows) : [];
  return stageBlocks(place, provider.stageParts?.(place, data) ?? [], steps);
}

/** Marks and scrolls to the element Under the hood that shows the place (a provider's anchor), after each move. */
function useAnchor(anchor: string | null, mode: LineMode, navKey: number) {
  useEffect(() => {
    if (!anchor) return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelectorAll('[data-lm-open]').forEach((el) => el.removeAttribute('data-lm-open'));
      const el = document.getElementById(anchor);
      el?.setAttribute('data-lm-open', 'true');
      el?.scrollIntoView({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [anchor, mode, navKey]);
}

/** Two modes for one screen: its mode, its chat (lib/lineModes.ts, driven by the provider) and what a crumb does
 * (Under the hood, at exactly that place). */
export function useScreenModes<D>(provider: ScreenChatProvider<D>, data: D | null, onOption?: (optionId: string, place: Place, control: ScreenChatControl & { mode: LineMode }) => void, onPlace?: (place: Place) => void, onOwnPick?: (messageId: string, itemId: string, control: ScreenChatControl & { mode: LineMode }) => void): ScreenModesView {
  const { stored, setMode } = useLineMode();
  useScreenDefault(provider.defaultMode);
  const mode = effectiveMode(stored, provider.defaultMode);
  // The screen's own answers get the mode too (a screen that drives its view moves the chat to it in Chat mode).
  const chat = useScreenChat(provider, data, onOption && ((id, place, c) => onOption(id, place, { ...c, mode })), onPlace, onOwnPick && ((m, item, c) => onOwnPick(m, item, { ...c, mode })));
  useAnchor(chat ? (provider.anchor?.(chat.place) ?? null) : null, mode, chat?.navKey ?? 0);
  const onCrumb = (crumb: Crumb) => crumbToHood(crumb, chat?.go, setMode);
  const blocks = chat && data !== null && mode === 'chat' ? screenBlocks(provider, chat.place, data) : NO_BLOCKS;
  return { mode, chat, open: chat?.place.steps.at(-1)?.id ?? null, onCrumb, blocks };
}
