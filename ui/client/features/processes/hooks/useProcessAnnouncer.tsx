'use client';

import { useEffect, useRef, useState } from 'react';
import { nextSeenStates, stateChangeAnnouncements, type SeenStates } from '../domain/ProcessAnnouncements';
import type { ProcessSummary } from '../types';

/** The sentence for the bottom panel's live region (#371): a process finishing, failing or being
 * cancelled is announced even while you are looking at a different tab, or a different screen. */
export function useProcessAnnouncer(summaries: ProcessSummary[]): string {
  const seen = useRef<SeenStates>({});
  const [message, setMessage] = useState('');
  useEffect(() => {
    const lines = stateChangeAnnouncements(summaries, seen.current);
    seen.current = nextSeenStates(summaries, seen.current);
    if (lines.length > 0) setMessage(lines[lines.length - 1]);
  }, [summaries]);
  return message;
}
