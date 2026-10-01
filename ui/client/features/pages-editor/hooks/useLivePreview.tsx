'use client';

import { useCallback, useRef } from 'react';
import { usePreview } from '@/features/live-preview';
import { resolvePreviewSelection } from '../domain/PreviewSelection';
import { openSourceTargetFromCxSrc } from '../domain/OpenSource';
import { requestOpenSource } from '../services/OpenSourceRequest';
import type { PagesEditorNode } from '../types';

type Args = {
  roots: PagesEditorNode[];
  feature: string;
  file: string;
  onSelectNode: (id: string) => void;
};

/** Pages editor's own live preview (#834/#837 extracted the generic half to `@/features/live-preview`'s
 * `usePreview`): click-to-source is resolved against the open page's tree, and "Show in source" after an app
 * error opens the file in the (already-mounted) Navigator panel -- both pages-editor-specific, so they stay
 * here as the two callbacks `usePreview` takes. */
export function useLivePreview({ roots, feature, file, onSelectNode }: Args) {
  const latest = useRef({ roots, feature, file, onSelectNode });
  latest.current = { roots, feature, file, onSelectNode };

  const onSourceSelected = useCallback((src: string) => {
    const cur = latest.current;
    const r = resolvePreviewSelection(src, cur.roots, cur.feature, cur.file);
    if (r.kind === 'selected') {
      cur.onSelectNode(r.nodeId);
      return `Selected ${src}`;
    }
    if (r.kind === 'other-file') return `That element lives in ${r.file}, not the open page.`;
    if (r.kind === 'stale') return 'No element at that position in the open page — reload the preview if you just edited it.';
    return 'Unrecognised source annotation from the preview.';
  }, []);

  const onShowInSource = useCallback((src: string) => {
    const target = openSourceTargetFromCxSrc(src);
    if (target) requestOpenSource(target);
  }, []);

  return usePreview({ onSourceSelected, onShowInSource });
}
