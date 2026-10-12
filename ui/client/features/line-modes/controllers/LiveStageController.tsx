'use client';

import type { StageBlock } from '@/lib/liveStage';
import { LiveStage } from '../components/LiveStage';
import { useLiveStage } from '../hooks/useLiveStage';

/** Chat mode's live stage for a screen: give it the active blocks (lib/liveStage.ts stageBlocks) and something that
 * changes when the view beside the chat changes (so the focus outline is placed again). */
export function LiveStageController({ blocks, revision }: { blocks: StageBlock[]; revision: unknown }) {
  const { shown, open, toggle, note } = useLiveStage(blocks, revision);
  return <LiveStage blocks={shown} open={open} onToggle={toggle} note={note} />;
}
