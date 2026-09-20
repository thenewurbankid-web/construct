'use client';

import { FlowFilePeek } from '../components/FlowFilePeek';
import { useReferenceTrail } from '../hooks/useReferenceTrail';
import { getNavFile } from '../services/ReferenceNavApi';

type FlowFilePeekControllerProps = { feature: string; file: string; onClose: () => void };

/** The file a Ctrl/Cmd-click on a Flow row opened (#328): the Pages editor's own reference trail (#321),
 * started from a file the flow drew rather than from a page. */
export function FlowFilePeekController({ feature, file, onClose }: FlowFilePeekControllerProps) {
  const nav = useReferenceTrail(feature, file, '', getNavFile);
  return (
    <FlowFilePeek
      steps={nav.steps}
      index={nav.index}
      items={nav.items}
      current={nav.current}
      loading={nav.loading}
      error={nav.error}
      hopError={nav.hopError}
      onFollow={nav.follow}
      onBack={nav.back}
      onForward={nav.forward}
      onSelect={nav.select}
      onClose={onClose}
    />
  );
}
