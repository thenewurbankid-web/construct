'use client';

import { LineTraceController } from '@/features/line-trace';
import { OpenProjectHelper } from '../components/OpenProjectHelper';
import { useOpenProjectHelper } from '../hooks/useOpenProjectHelper';

/** The Your projects screen's chat helper with Trace and Auto (the same Trace bar and Auto player as the Line screens,
 * matching this screen's requests statically). `projects`: the workspace's projects; `onOpen` opens one. */
export function OpenProjectHelperController({ projects, onOpen }: { projects: { name: string; path: string }[] | null; onOpen: (dir: string) => void }) {
  const h = useOpenProjectHelper(projects, onOpen);
  return <OpenProjectHelper open={h.open} onOpen={h.setOpen} chat={h.chat} onOpenProject={h.openProject} trace={<LineTraceController screen="open-project" api={h.traceApi} />} />;
}
