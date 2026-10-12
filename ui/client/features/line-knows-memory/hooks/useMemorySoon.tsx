'use client';

import { useEffect, useState } from 'react';
import type { KnowsTabProps } from '@/lib/lineKnowsContract';

/** The tab's slot until it is built: the contract's one sentence for it (from the server, or the mock in mock mode). */
export function useMemorySoon({ http, focus }: KnowsTabProps): string | null {
  const [sentence, setSentence] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void (() => http.memoryRecords())().then((r) => { if (live) setSentence(r && typeof r.sentence === 'string' ? r.sentence : null); }, () => { if (live) setSentence(null); });
    return () => { live = false; };
  }, [http, focus]);
  return sentence;
}
