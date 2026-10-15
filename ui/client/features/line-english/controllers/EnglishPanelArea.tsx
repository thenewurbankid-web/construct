'use client';

import '../components/line-english.css';
import { EnglishPanel } from '../components/EnglishPanel';
import { useEnglishView } from '../hooks/useEnglishView';

/** The English panel for the open file (t5-3); `revision` re-reads it once a plan step landed. */
export function EnglishPanelArea({ file, revision }: { file: string | null; revision: number }) {
  return <EnglishPanel state={useEnglishView(file, revision)} />;
}
