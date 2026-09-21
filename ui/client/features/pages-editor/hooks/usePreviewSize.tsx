'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PREVIEW_SIZES, previewSizeOption, sanitizePreviewSize } from '../domain/PreviewSize';
import type { PreviewSizeId } from '../domain/PreviewSize';
import { fetchPreviewProjectKey } from '../services/ProjectKey';
import { loadPreviewSize, savePreviewSize } from '../services/PreviewSizeStorage';
import { usePreviewMeasure } from './usePreviewMeasure';

/** The preview's device size, remembered per project, plus the frame's real
 * measured size. Fit until the project is known, so the frame never opens at a
 * width nobody asked for. */
export function usePreviewSize() {
  const [size, setSize] = useState<PreviewSizeId>('fit');
  const projectKey = useRef<string | null>(null);
  const known = useRef(false);
  const { boxRef, measured } = usePreviewMeasure();

  useEffect(() => {
    let cancelled = false;
    fetchPreviewProjectKey().then((key) => {
      if (cancelled) return;
      projectKey.current = key;
      known.current = true;
      setSize(loadPreviewSize(key));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = useCallback((next: string) => {
    const id = sanitizePreviewSize(next);
    setSize(id);
    if (known.current) savePreviewSize(projectKey.current, id);
  }, []);

  return useMemo(
    () => ({ size, option: previewSizeOption(size), sizes: PREVIEW_SIZES, choose, boxRef, measured }),
    [size, choose, boxRef, measured],
  );
}
