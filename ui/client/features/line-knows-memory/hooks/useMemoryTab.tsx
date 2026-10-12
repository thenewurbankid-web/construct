'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KnowsTabProps, MemoryTabView } from '@/lib/lineKnowsContract';
import { memoryTabView } from '../domain/MemoryTab';
import { loadMemoryTab, runMemoryAction, type MemoryTabAction, type MemoryTabAnswer } from '../workflows/MemoryActions';

export type MemoryTabScreen = {
  view: MemoryTabView;
  message: string | null;
  busy: boolean;
  act: (action: MemoryTabAction) => void;
  importFile: (file: File) => void;
};

const START: MemoryTabAnswer = { view: null, sentence: 'Reading what Line remembered.', message: null };

/** Hand the exported file to the browser as a download. */
function save(file: { name: string; text: string }) {
  const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
}

/** The Memory tab: what Line remembered, read when the tab opens; each action by the person, one at a time. */
export function useMemoryTab({ http }: KnowsTabProps): MemoryTabScreen {
  const [answer, setAnswer] = useState<MemoryTabAnswer>(START);
  const [busy, setBusy] = useState(false);
  const latest = useRef(answer);
  latest.current = answer;
  useEffect(() => {
    let live = true;
    void loadMemoryTab(http).then((next) => {
      if (live) setAnswer(next);
    });
    return () => {
      live = false;
    };
  }, [http]);
  const act = useCallback(
    (action: MemoryTabAction) => {
      setBusy(true);
      void runMemoryAction(http, action, latest.current)
        .then((next) => {
          if (next.file) save(next.file);
          setAnswer({ ...next, file: undefined });
        })
        .finally(() => setBusy(false));
    },
    [http],
  );
  const importFile = useCallback(
    (file: File) => {
      void file.text().then((text) => act({ kind: 'import', text }));
    },
    [act],
  );
  const view = useMemo(() => {
    const v = memoryTabView(answer.view);
    return answer.view ? v : { ...v, sentence: answer.sentence };
  }, [answer]);
  return { view, message: answer.message, busy, act, importFile };
}
