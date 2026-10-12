'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { matchElement, type ElementDesc } from '@/lib/elementMatch';
import type { StageBlock } from '@/lib/liveStage';
import type { ShownBlock } from '../components/LiveStage';

const LEAVE_MS = 260;
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Blocks that just left the stage stay a moment, marked leaving, so they fade out (not with reduced motion). */
function useLeaving(blocks: StageBlock[]): ShownBlock[] {
  const [gone, setGone] = useState<StageBlock[]>([]);
  const before = useRef<StageBlock[]>(blocks);
  useEffect(() => {
    const ids = new Set(blocks.map((b) => b.id));
    const left = before.current.filter((b) => !ids.has(b.id));
    before.current = blocks;
    if (!left.length || reducedMotion()) return;
    setGone(left);
    const t = window.setTimeout(() => setGone([]), LEAVE_MS);
    return () => window.clearTimeout(t);
  }, [blocks]);
  const ids = new Set(blocks.map((b) => b.id));
  return [...blocks, ...gone.filter((b) => !ids.has(b.id)).map((b) => ({ ...b, leaving: true }))];
}

/** What the static ladder reads off an element on screen (lib/elementMatch.ts). */
function describe(el: HTMLElement, i: number): ElementDesc {
  const d = el.dataset;
  return {
    key: String(i),
    lineTarget: d.lineTarget ?? d.item ?? d.feature ?? null,
    nodeId: d.nodeId ?? null,
    role: el.getAttribute('role') ?? el.tagName.toLowerCase(),
    name: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 80) ?? null,
    label: el.getAttribute('aria-label'),
    position: d.position ?? null,
  };
}

const CANDIDATES = '[data-line-target], [data-item], [data-feature], [data-node-id]';

/** Outlines the part in focus in the screen's view beside the chat (Trace's highlight look), by the static ladder only.
 * Answers the sentence to show when nothing could be outlined. */
function useFocusOutline(focus: { id: string; what: string } | null, revision: unknown): string | null {
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    const view = document.querySelector<HTMLElement>('[data-testid="lm-screen"] .ln-ce-page');
    document.querySelectorAll('[data-lm-focus]').forEach((el) => el.removeAttribute('data-lm-focus'));
    if (!focus || !view) return setNote(null);
    const frame = window.requestAnimationFrame(() => {
      const els = [...view.querySelectorAll<HTMLElement>(CANDIDATES)];
      const m = matchElement({ lineTarget: focus.id, name: focus.id, what: focus.what }, els.map(describe));
      if (m.ok) els[Number(m.key)].setAttribute('data-lm-focus', m.by);
      setNote(m.ok ? null : m.sentence);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focus?.id, focus?.what, revision]);
  return note;
}

/** The live stage's state: the blocks (with the ones fading out), open or folded, and the outline note. */
export function useLiveStage(blocks: StageBlock[], revision: unknown) {
  const [open, setOpen] = useState(true);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const shown = useLeaving(blocks);
  const focused = blocks.find((b) => b.focus) ?? null;
  const note = useFocusOutline(focused ? { id: focused.id.split(':').slice(1).join(':'), what: focused.name } : null, revision);
  return { shown, open, toggle, note };
}
