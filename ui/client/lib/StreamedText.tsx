'use client';

import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { AnimatedMarkdown } from 'flowtoken';
import 'flowtoken/dist/styles.css';
import { sanitizeStream, type StreamTag } from './streamedTextTags';

// The ONE way Cockpit shows a model's or an agent's answer: flowtoken's animated markdown, as the words arrive (a real
// stream) or as a reveal of the finished sentence. Only the whitelisted Line elements (lib/streamedTextTags.ts) that the
// screen provides render as our components; any other tag, raw HTML or script stays plain text. No animation when the
// person prefers reduced motion. Fixed UI text (labels, buttons) never goes through here.

/** The screen's components for the whitelisted tags, given each tag's attributes. */
export type StreamElements = Partial<Record<StreamTag, (attrs: Record<string, string>) => ReactNode>>;

const REDUCE = '(prefers-reduced-motion: reduce)';
const subscribe = (on: () => void) => {
  const q = window.matchMedia?.(REDUCE);
  q?.addEventListener('change', on);
  return () => q?.removeEventListener('change', on);
};
const reduced = () => window.matchMedia?.(REDUCE).matches ?? false;
// Server render: no animation (the first paint is the finished text).
const serverReduced = () => true;

/** Whether the person prefers reduced motion. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, reduced, serverReduced);
}

type StreamedTextProps = {
  text: string;
  elements?: StreamElements;
  className?: string;
  testId?: string;
};

export function StreamedText({ text, elements, className, testId }: StreamedTextProps) {
  const still = usePrefersReducedMotion();
  const tags = useMemo(() => Object.keys(elements ?? {}), [elements]);
  const content = useMemo(() => sanitizeStream(text, tags), [text, tags]);
  // The HTML parser gives tag names in lower case; flowtoken looks components up by that name.
  const custom = useMemo(() => {
    const out: Record<string, (props: Record<string, string>) => ReactNode> = {};
    for (const [tag, render] of Object.entries(elements ?? {})) if (render) out[tag.toLowerCase()] = (props) => render(props);
    return out;
  }, [elements]);
  return (
    <div className={['ln-streamed', className].filter(Boolean).join(' ')} data-testid={testId} data-motion={still ? 'still' : 'animated'}>
      <AnimatedMarkdown content={content} animation={still ? null : 'fadeIn'} animationDuration="0.4s" animationTimingFunction="ease-out" sep="word" customComponents={custom} />
    </div>
  );
}
