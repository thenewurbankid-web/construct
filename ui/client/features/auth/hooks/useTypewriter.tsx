'use client';

import { useEffect, useState } from 'react';
import { initialTypewriter, stepTypewriter, typedText, type TypewriterState } from '../domain/Typewriter';

/** The tagline text for a typing-effect loop over `phrases`. Under `prefers-reduced-motion` it shows the
 * first phrase, complete and still — motion is decoration here, the words are not. */
export function useTypewriter(phrases: readonly string[]): { text: string; animated: boolean } {
  const [state, setState] = useState<TypewriterState>(initialTypewriter);
  const [animated, setAnimated] = useState(true);

  useEffect(() => {
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setAnimated(false);
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout>;
    let current = initialTypewriter;
    const tick = () => {
      const next = stepTypewriter(current, phrases);
      current = next.state;
      setState(next.state);
      timer = setTimeout(tick, next.delayMs);
    };
    timer = setTimeout(tick, 400);
    return () => clearTimeout(timer);
  }, [phrases]);

  if (!animated) return { text: phrases[0] ?? '', animated: false };
  return { text: typedText(state, phrases), animated: true };
}
